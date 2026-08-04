const { getSupabase } = require('../../lib/supabase');
const { authenticateBySession } = require('../../lib/merchantAuth');

module.exports = async (req, res) => {
  if (req.method !== 'DELETE') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }

  const merchantId = await authenticateBySession(req);
  if (!merchantId) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const { id } = req.query || {};
  if (!id) {
    res.status(400).json({ message: 'id é obrigatório' });
    return;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('payment_api_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('merchant_id', merchantId)
    .select('id')
    .maybeSingle();

  if (error) {
    res.status(500).json({ message: 'Erro ao revogar chave', erro: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ message: 'Chave não encontrada' });
    return;
  }

  res.status(200).json({ success: true });
};
