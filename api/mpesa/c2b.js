const { mpesaRequest } = require('../../lib/mpesa');
const { requireBearer } = require('../../lib/auth');
const { getSupabase } = require('../../lib/supabase');

// Customer to Business Single Stage: debita a carteira do cliente e credita a do negócio.
// Docs: developer.mpesa.vm.co.mz > APIs > C2B > C2B Single Stage API
module.exports = async (req, res) => {
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
};
