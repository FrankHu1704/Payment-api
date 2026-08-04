const crypto = require('crypto');
const { getSupabase } = require('../../lib/supabase');
const { authenticateBySecretKey } = require('../../lib/merchantAuth');

// Gera um id curto (20 chars) — cabe no limite de 20 chars do
// input_TransactionReference/input_ThirdPartyReference da M-Pesa Payments Gateway.
function generateSessionId() {
  return crypto.randomBytes(15).toString('base64url').slice(0, 20);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }

  const merchantId = await authenticateBySecretKey(req);
  if (!merchantId) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const { amount, reference, successUrl, cancelUrl } = req.body || {};
  const amountNum = Number(amount);
  if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
    res.status(400).json({ message: 'amount deve ser um número maior que zero' });
    return;
  }

  const id = generateSessionId();
  const supabase = getSupabase();

  const { error } = await supabase.from('payment_api_checkout_sessions').insert({
    id,
    merchant_id: merchantId,
    amount: amountNum,
    reference: reference || null,
    success_url: successUrl || null,
    cancel_url: cancelUrl || null
  });

  if (error) {
    res.status(500).json({ message: 'Erro ao criar sessão de checkout', erro: error.message });
    return;
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${protocol}://${req.headers.host}`;
  res.status(201).json({ id, url: `${origin}/checkout.html?session=${id}` });
};
