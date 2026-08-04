const { mpesaRequest } = require('../../lib/mpesa');
const { requireBearer } = require('../../lib/auth');
const { getSupabase } = require('../../lib/supabase');

// Consulta o status de uma transação por TransactionID, ThirdPartyReference ou ConversationID.
// Docs: developer.mpesa.vm.co.mz > APIs > Query Transaction Status
module.exports = async (req, res) => {
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
    resultado = await mpesaRequest({
      method: 'GET',
      port: 18353,
      path: `/ipg/v1x/queryTransactionStatus/?${qs}`
    });
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
};
