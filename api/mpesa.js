const { mpesaRequest } = require('../lib/mpesa');
const { requireBearer } = require('../lib/auth');
const { getSupabase } = require('../lib/supabase');

// Um único arquivo pros 3 endpoints da M-Pesa Payments Gateway (C2B, Reversal, Query
// Transaction Status), roteados por ?action=, pra caber no limite de 12 Serverless
// Functions do plano Hobby da Vercel.
//   POST /api/mpesa?action=c2b
//   POST /api/mpesa?action=reversal
//   GET  /api/mpesa?action=status&queryReference=...&thirdPartyReference=...

async function handleC2b(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }
  if (!requireBearer(req, 'GATEWAY_API_KEY')) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const { msisdn, amount, transactionReference, thirdPartyReference } = req.body || {};
  if (!msisdn || !amount || !transactionReference || !thirdPartyReference) {
    res.status(400).json({
      message: 'msisdn, amount, transactionReference e thirdPartyReference são obrigatórios'
    });
    return;
  }
  if (!process.env.MPESA_SERVICE_PROVIDER_CODE) {
    res.status(500).json({ message: 'MPESA_SERVICE_PROVIDER_CODE não configurado' });
    return;
  }

  let resultado;
  try {
    resultado = await mpesaRequest({
      method: 'POST',
      port: 18352,
      path: '/ipg/v1x/c2bPayment/singleStage/',
      body: {
        input_TransactionReference: transactionReference,
        input_CustomerMSISDN: String(msisdn),
        input_Amount: String(amount),
        input_ThirdPartyReference: thirdPartyReference,
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
      kind: 'c2b',
      transaction_reference: transactionReference,
      third_party_reference: thirdPartyReference,
      msisdn: String(msisdn),
      amount: String(amount),
      conversation_id: resultado.body.output_ConversationID || null,
      transaction_id: resultado.body.output_TransactionID || null,
      response_code: resultado.body.output_ResponseCode || null,
      response_desc: resultado.body.output_ResponseDesc || null,
      raw_response: resultado.body
    });
  } catch (e) {
    // não falha a resposta ao cliente por causa do log de auditoria
  }

  res.status(resultado.statusCode || 200).json(resultado.body);
}

async function handleReversal(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }
  if (!requireBearer(req, 'GATEWAY_API_KEY')) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const { transactionId, thirdPartyReference, reversalAmount } = req.body || {};
  if (!transactionId || !thirdPartyReference) {
    res.status(400).json({ message: 'transactionId e thirdPartyReference são obrigatórios' });
    return;
  }

  const { MPESA_SERVICE_PROVIDER_CODE, MPESA_INITIATOR_IDENTIFIER, MPESA_SECURITY_CREDENTIAL } = process.env;
  if (!MPESA_SERVICE_PROVIDER_CODE || !MPESA_INITIATOR_IDENTIFIER || !MPESA_SECURITY_CREDENTIAL) {
    res.status(500).json({
      message: 'MPESA_SERVICE_PROVIDER_CODE / MPESA_INITIATOR_IDENTIFIER / MPESA_SECURITY_CREDENTIAL não configurados'
    });
    return;
  }

  const body = {
    input_TransactionID: transactionId,
    input_SecurityCredential: MPESA_SECURITY_CREDENTIAL,
    input_InitiatorIdentifier: MPESA_INITIATOR_IDENTIFIER,
    input_ThirdPartyReference: thirdPartyReference,
    input_ServiceProviderCode: MPESA_SERVICE_PROVIDER_CODE
  };
  if (reversalAmount) body.input_ReversalAmount = String(reversalAmount);

  let resultado;
  try {
    resultado = await mpesaRequest({ method: 'PUT', port: 18354, path: '/ipg/v1x/reversal/', body });
  } catch (erro) {
    res.status(502).json({ message: 'Erro ao comunicar com a M-Pesa Payments Gateway', erro: erro.message });
    return;
  }

  try {
    const supabase = getSupabase();
    await supabase.from('payment_api_mpesa_transactions').insert({
      kind: 'reversal',
      transaction_reference: transactionId,
      third_party_reference: thirdPartyReference,
      amount: reversalAmount ? String(reversalAmount) : null,
      conversation_id: resultado.body.output_ConversationID || null,
      transaction_id: resultado.body.output_TransactionID || null,
      response_code: resultado.body.output_ResponseCode || null,
      response_desc: resultado.body.output_ResponseDesc || null,
      raw_response: resultado.body
    });
  } catch (e) {
    // não falha a resposta ao cliente por causa do log de auditoria
  }

  res.status(resultado.statusCode || 200).json(resultado.body);
}

async function handleStatus(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }
  if (!requireBearer(req, 'GATEWAY_API_KEY')) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const { queryReference, thirdPartyReference } = req.query || {};
  if (!queryReference || !thirdPartyReference) {
    res.status(400).json({ message: 'queryReference e thirdPartyReference são obrigatórios' });
    return;
  }
  if (!process.env.MPESA_SERVICE_PROVIDER_CODE) {
    res.status(500).json({ message: 'MPESA_SERVICE_PROVIDER_CODE não configurado' });
    return;
  }

  const qs = new URLSearchParams({
    input_ThirdPartyReference: thirdPartyReference,
    input_QueryReference: queryReference,
    input_ServiceProviderCode: process.env.MPESA_SERVICE_PROVIDER_CODE
  }).toString();

  let resultado;
  try {
    resultado = await mpesaRequest({ method: 'GET', port: 18353, path: `/ipg/v1x/queryTransactionStatus/?${qs}` });
  } catch (erro) {
    res.status(502).json({ message: 'Erro ao comunicar com a M-Pesa Payments Gateway', erro: erro.message });
    return;
  }

  try {
    const supabase = getSupabase();
    await supabase.from('payment_api_mpesa_transactions').insert({
      kind: 'status_query',
      transaction_reference: String(queryReference),
      third_party_reference: String(thirdPartyReference),
      conversation_id: resultado.body.output_ConversationID || null,
      response_code: resultado.body.output_ResponseCode || null,
      response_desc: resultado.body.output_ResponseDesc || null,
      raw_response: resultado.body
    });
  } catch (e) {
    // não falha a resposta ao cliente por causa do log de auditoria
  }

  res.status(resultado.statusCode || 200).json(resultado.body);
}

module.exports = async (req, res) => {
  const { action } = req.query || {};
  if (action === 'c2b') return handleC2b(req, res);
  if (action === 'reversal') return handleReversal(req, res);
  if (action === 'status') return handleStatus(req, res);
  res.status(404).json({ message: 'Use ?action=c2b|reversal|status' });
};
