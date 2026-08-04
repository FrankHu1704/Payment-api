const { mpesaRequest } = require('../../lib/mpesa');
const { requireBearer } = require('../../lib/auth');
const { getSupabase } = require('../../lib/supabase');

// Reverte (total ou parcialmente) uma transação bem-sucedida pelo TransactionID.
// Docs: developer.mpesa.vm.co.mz > APIs > Reversal
module.exports = async (req, res) => {
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
  // Campo opcional: se ausente, a M-Pesa Payments Gateway tenta reversão total.
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
};
