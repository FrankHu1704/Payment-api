const crypto = require('crypto');
const { getSupabase } = require('./supabase');
const { getBearerToken } = require('./auth');

function hashSecretKey(secretKey) {
  return crypto.createHash('sha256').update(secretKey, 'utf8').digest('hex');
}

// Autentica uma chamada servidor-a-servidor do lojista via "Authorization: Bearer sk_live_...".
// Retorna o merchant_id ou null.
async function authenticateBySecretKey(req) {
  const token = getBearerToken(req);
  if (!token || !token.startsWith('sk_live_')) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('payment_api_api_keys')
    .select('merchant_id, revoked_at')
    .eq('secret_key_hash', hashSecretKey(token))
    .maybeSingle();

  if (error || !data || data.revoked_at) return null;
  return data.merchant_id;
}

// Autentica uma chamada do dashboard via "Authorization: Bearer <jwt do Supabase Auth>".
// Retorna o merchant_id (= auth.uid()) ou null.
async function authenticateBySession(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

module.exports = { hashSecretKey, authenticateBySecretKey, authenticateBySession };
