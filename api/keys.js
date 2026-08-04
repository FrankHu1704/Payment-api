const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { authenticateBySession, hashSecretKey } = require('../lib/merchantAuth');

function generateKeyPair() {
  const publicKey = 'pk_live_' + crypto.randomBytes(16).toString('hex');
  const secretKey = 'sk_live_' + crypto.randomBytes(24).toString('hex');
  return { publicKey, secretKey };
}

module.exports = async (req, res) => {
  const merchantId = await authenticateBySession(req);
  if (!merchantId) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('payment_api_api_keys')
      .select('id, public_key, label, revoked_at, created_at')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ message: 'Erro ao listar chaves', erro: error.message });
      return;
    }
    res.status(200).json(data);
    return;
  }

  if (req.method === 'POST') {
    const { publicKey, secretKey } = generateKeyPair();
    const label = (req.body && req.body.label) || null;

    const { error } = await supabase.from('payment_api_api_keys').insert({
      merchant_id: merchantId,
      public_key: publicKey,
      secret_key_hash: hashSecretKey(secretKey),
      label
    });

    if (error) {
      res.status(500).json({ message: 'Erro ao criar chave', erro: error.message });
      return;
    }

    // secretKey só é retornado aqui — não é recuperável depois (só o hash fica salvo)
    res.status(201).json({ publicKey, secretKey });
    return;
  }

  res.status(405).json({ message: 'Método não permitido' });
};
