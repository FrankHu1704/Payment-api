const { mpesaRequest } = require('../../../lib/mpesa');
const { getSupabase } = require('../../../lib/supabase');
const { deliverCheckoutWebhook } = require('../../../lib/webhook');

// Endpoint público — chamado pela página de checkout quando o cliente final informa o
// MSISDN. Dispara o C2B na M-Pesa Payments Gateway usando as credenciais globais da
// plataforma (modelo agregador: o dinheiro cai na conta M-Pesa do dono da plataforma).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }

  const { id } = req.query || {};
  const msisdn = req.body && req.body.msisdn;
  if (!id) {
    res.status(400).json({ message: 'id da sessão é obrigatório' });
    return;
  }
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
};
