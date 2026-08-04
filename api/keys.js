const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { authenticateBySession, hashSecretKey } = require('../lib/merchantAuth');

function generateKeyPair() {
  const publicKey = 'pk_live_' + crypto.randomBytes(16).toString('hex');
  const secretKey = 'sk_live_' + crypto.randomBytes(24).toString('hex');
  return { publicKey, secretKey };
}

// GET    /api/keys           lista as chaves do lojista logado
// POST   /api/keys           cria um novo par pk_live_/sk_live_ (secret só aparece aqui)
// DELETE /api/keys?id=123    revoga a chave
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

  if (req.method === 'DELETE') {
    const { id } = req.query || {};
    if (!id) {
      res.status(400).json({ message: 'id é obrigatório' });
      return;
    }

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
    return;
  }

  res.status(405).json({ message: 'Método não permitido' });
};
