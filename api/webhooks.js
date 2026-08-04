const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { authenticateBySession } = require('../lib/merchantAuth');

module.exports = async (req, res) => {
  const merchantId = await authenticateBySession(req);
  if (!merchantId) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('payment_api_webhooks')
      .select('id, url, created_at')
      .eq('merchant_id', merchantId)
      .maybeSingle();

    if (error) {
      res.status(500).json({ message: 'Erro ao consultar webhook', erro: error.message });
      return;
    }
    res.status(200).json(data || null);
    return;
  }

  if (req.method === 'POST') {
    const url = req.body && req.body.url;
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      res.status(400).json({ message: 'url válida é obrigatória' });
      return;
    }

    const { data: existente } = await supabase
      .from('payment_api_webhooks')
      .select('id, secret')
      .eq('merchant_id', merchantId)
      .maybeSingle();

    const secret = existente?.secret || crypto.randomBytes(24).toString('hex');

    const { error } = existente
      ? await supabase.from('payment_api_webhooks').update({ url }).eq('id', existente.id)
      : await supabase.from('payment_api_webhooks').insert({ merchant_id: merchantId, url, secret });

    if (error) {
      res.status(500).json({ message: 'Erro ao salvar webhook', erro: error.message });
      return;
    }

    // O secret só é revelado na criação (usado pra validar a assinatura HMAC recebida)
    res.status(200).json({ success: true, url, secret: existente ? undefined : secret });
    return;
  }

  res.status(405).json({ message: 'Método não permitido' });
};
