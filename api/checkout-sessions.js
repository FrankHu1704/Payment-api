const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { mpesaRequest } = require('../lib/mpesa');
const { authenticateBySecretKey } = require('../lib/merchantAuth');
const { deliverCheckoutWebhook } = require('../lib/webhook');

// Um único arquivo pros 3 endpoints de checkout, pra caber no limite de 12 Serverless
// Functions do plano Hobby da Vercel.
//   POST /api/checkout-sessions                  cria (secret key do lojista)
//   GET  /api/checkout-sessions?id=xxx            info pública (usada pelo checkout.html)
//   POST /api/checkout-sessions?id=xxx&action=pay paga (público, chamado pelo checkout.html)

function generateSessionId() {
  // 20 chars — cabe no limite do input_TransactionReference/input_ThirdPartyReference da M-Pesa
  return crypto.randomBytes(15).toString('base64url').slice(0, 20);
}

async function handleCreate(req, res) {
  const merchantId = await authenticateBySecretKey(req);
  if (!merchantId) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const { amount, reference, successUrl, cancelUrl } = req.body || {};
  const amountNum = Number(amount);
  if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
    res.status(400).json({ message: 'amount deve ser um número maior que zero' });
    return;
  }

  const id = generateSessionId();
  const supabase = getSupabase();

  const { error } = await supabase.from('payment_api_checkout_sessions').insert({
    id,
    merchant_id: merchantId,
    amount: amountNum,
    reference: reference || null,
    success_url: successUrl || null,
    cancel_url: cancelUrl || null
  });

  if (error) {
    res.status(500).json({ message: 'Erro ao criar sessão de checkout', erro: error.message });
    return;
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${protocol}://${req.headers.host}`;
  res.status(201).json({ id, url: `${origin}/checkout.html?session=${id}` });
}

async function handleGetInfo(req, res, id) {
  const supabase = getSupabase();
  const { data: session, error } = await supabase
    .from('payment_api_checkout_sessions')
    .select('id, merchant_id, amount, currency, reference, status, success_url, cancel_url')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    res.status(500).json({ message: 'Erro ao consultar sessão', erro: error.message });
    return;
  }
  if (!session) {
    res.status(404).json({ message: 'Sessão não encontrada' });
    return;
  }

  const { data: merchant } = await supabase
    .from('payment_api_merchants')
    .select('business_name')
    .eq('id', session.merchant_id)
    .maybeSingle();

  res.status(200).json({
    id: session.id,
    amount: session.amount,
    currency: session.currency,
    reference: session.reference,
    status: session.status,
    successUrl: session.success_url,
    cancelUrl: session.cancel_url,
    merchantName: merchant?.business_name || 'Lojista'
  });
}

async function handlePay(req, res, id) {
  if (!id) {
    res.status(400).json({ message: 'id da sessão é obrigatório' });
    return;
  }
  const msisdn = req.body && req.body.msisdn;
  if (!msisdn || !/^\d{9,12}$/.test(String(msisdn))) {
    res.status(400).json({ message: 'msisdn inválido' });
    return;
  }

  const supabase = getSupabase();
  const { data: session, error: erroConsulta } = await supabase
    .from('payment_api_checkout_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (erroConsulta) {
    res.status(500).json({ message: 'Erro ao consultar sessão', erro: erroConsulta.message });
    return;
  }
  if (!session) {
    res.status(404).json({ message: 'Sessão não encontrada' });
    return;
  }
  if (session.status !== 'pending') {
    res.status(409).json({ message: `Sessão já está em status "${session.status}"`, status: session.status });
    return;
  }
  if (!process.env.MPESA_SERVICE_PROVIDER_CODE) {
    res.status(500).json({ message: 'MPESA_SERVICE_PROVIDER_CODE não configurado' });
    return;
  }

  await supabase
    .from('payment_api_checkout_sessions')
    .update({ status: 'processing', customer_msisdn: String(msisdn), updated_at: new Date().toISOString() })
    .eq('id', id);

  let resultado;
  try {
    resultado = await mpesaRequest({
      method: 'POST',
      port: 18352,
      path: '/ipg/v1x/c2bPayment/singleStage/',
      body: {
        input_TransactionReference: id,
        input_CustomerMSISDN: String(msisdn),
        input_Amount: String(session.amount),
        input_ThirdPartyReference: id,
        input_ServiceProviderCode: process.env.MPESA_SERVICE_PROVIDER_CODE
      }
    });
  } catch (erro) {
    await supabase
      .from('payment_api_checkout_sessions')
      .update({ status: 'failed', response_desc: erro.message, updated_at: new Date().toISOString() })
      .eq('id', id);
    res.status(502).json({ message: 'Erro ao comunicar com a M-Pesa Payments Gateway', erro: erro.message, status: 'failed' });
    return;
  }

  // Resposta não é JSON válido — gateway M-Pesa (ou o WAF na frente dela) indisponível.
  if (typeof resultado.body.raw === 'string') {
    const { data: sessionFalha } = await supabase
      .from('payment_api_checkout_sessions')
      .update({
        status: 'failed',
        response_desc: `Gateway M-Pesa indisponível (HTTP ${resultado.statusCode})`,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (sessionFalha) deliverCheckoutWebhook(sessionFalha).catch(() => {});
    res.status(200).json({
      status: 'failed',
      responseCode: null,
      responseDesc: `Gateway M-Pesa indisponível (HTTP ${resultado.statusCode}). Tente novamente em instantes.`
    });
    return;
  }

  const sucesso = resultado.body.output_ResponseCode === 'INS-0';
  const novoStatus = sucesso ? 'paid' : 'failed';

  const { data: sessionAtualizada } = await supabase
    .from('payment_api_checkout_sessions')
    .update({
      status: novoStatus,
      mpesa_conversation_id: resultado.body.output_ConversationID || null,
      mpesa_transaction_id: resultado.body.output_TransactionID || null,
      response_code: resultado.body.output_ResponseCode || null,
      response_desc: resultado.body.output_ResponseDesc || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (sucesso && sessionAtualizada) {
    try {
      await supabase.from('payment_api_ledger_entries').insert({
        merchant_id: sessionAtualizada.merchant_id,
        checkout_session_id: id,
        amount: sessionAtualizada.amount,
        fee: 0,
        net_amount: sessionAtualizada.amount
      });
    } catch (e) {
      // não bloqueia a resposta por causa do ledger
    }
  }

  if (sessionAtualizada) {
    deliverCheckoutWebhook(sessionAtualizada).catch(() => {});
  }

  res.status(200).json({
    status: novoStatus,
    responseCode: resultado.body.output_ResponseCode,
    responseDesc: resultado.body.output_ResponseDesc
  });
}

module.exports = async (req, res) => {
  const { id, action } = req.query || {};

  // action=pay tem prioridade mesmo sem id (handlePay valida e retorna 400 nesse caso) —
  // nunca deve cair no branch de criação por engano.
  if (req.method === 'POST' && action === 'pay') return handlePay(req, res, id);
  if (req.method === 'POST' && !id) return handleCreate(req, res);
  if (req.method === 'GET' && id) return handleGetInfo(req, res, id);

  res.status(404).json({ message: 'Rota não encontrada' });
};
