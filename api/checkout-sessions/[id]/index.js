const { getSupabase } = require('../../../lib/supabase');

// Endpoint público — usado pela página de checkout pra renderizar valor/nome do lojista.
// Só expõe campos não sensíveis (nada de credenciais ou dados de outros lojistas).
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }

  const { id } = req.query || {};
  if (!id) {
    res.status(400).json({ message: 'id é obrigatório' });
    return;
  }

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
};
