const crypto = require('crypto');
const { mpesaRequest } = require('../lib/mpesa');
const { getSupabase } = require('../lib/supabase');
const { authenticateBySession } = require('../lib/merchantAuth');

// POST /api/test-payment — dispara um C2B de teste direto do dashboard (sessão do
// lojista, sem precisar de secret key nem criar uma sessão de checkout formal).
// Usa as credenciais globais configuradas (sandbox M-Pesa por padrão).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }

  const merchantId = await authenticateBySession(req);
  if (!merchantId) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const { amount, msisdn } = req.body || {};
  const amountNum = Number(amount);
  if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
    res.status(400).json({ message: 'amount deve ser um número maior que zero' });
    return;
  }
  if (!msisdn || !/^\d{9,12}$/.test(String(msisdn))) {
    res.status(400).json({ message: 'msisdn inválido' });
    return;
  }
  if (!process.env.MPESA_SERVICE_PROVIDER_CODE) {
    res.status(500).json({ message: 'MPESA_SERVICE_PROVIDER_CODE não configurado' });
    return;
  }

  const reference = 'TEST' + crypto.randomBytes(8).toString('hex');

  let resultado;
  try {
    resultado = await mpesaRequest({
      method: 'POST',
      port: 18352,
      path: '/ipg/v1x/c2bPayment/singleStage/',
      body: {
        input_TransactionReference: reference,
        input_CustomerMSISDN: String(msisdn),
        input_Amount: String(amountNum),
        input_ThirdPartyReference: reference,
        input_ServiceProviderCode: process.env.MPESA_SERVICE_PROVIDER_CODE
      }
    });
  } catch (erro) {
    res.status(502).json({ message: 'Erro ao comunicar com a M-Pesa Payments Gateway', erro: erro.message });
    return;
  }

  try {
    const supabase = getSupabase();
    await supabase.from('payment_api_mpesa_transactions').insert({
      kind: 'test',
      transaction_reference: reference,
      third_party_reference: reference,
      msisdn: String(msisdn),
      amount: String(amountNum),
      conversation_id: resultado.body.output_ConversationID || null,
      transaction_id: resultado.body.output_TransactionID || null,
      response_code: resultado.body.output_ResponseCode || null,
      response_desc: resultado.body.output_ResponseDesc || null,
      raw_response: resultado.body
    });
  } catch (e) {
    // não falha a resposta por causa do log de auditoria
  }

  const sucesso = resultado.body.output_ResponseCode === 'INS-0';
  res.status(200).json({
    success: sucesso,
    responseCode: resultado.body.output_ResponseCode,
    responseDesc: resultado.body.output_ResponseDesc,
    transactionId: resultado.body.output_TransactionID || null,
    reference
  });
};
