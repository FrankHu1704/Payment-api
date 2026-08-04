const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { getSupabase } = require('./supabase');

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function postJson(urlString, payload, extraHeaders) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(urlString);
    } catch (e) {
      resolve({ ok: false, statusCode: null });
      return;
    }

    const client = target.protocol === 'http:' ? http : https;
    const req = client.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...extraHeaders
        },
        timeout: 8000
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ ok: res.statusCode < 400, statusCode: res.statusCode }));
      }
    );

    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ ok: false, statusCode: null }));
    req.write(payload);
    req.end();
  });
}

// Entrega best-effort (1 tentativa) o evento de uma checkout session para o webhook
// configurado pelo lojista, se houver, e registra o resultado em
// payment_api_webhook_deliveries. Nunca lança — falhas de entrega não devem derrubar
// o fluxo de pagamento.
async function deliverCheckoutWebhook(checkoutSession) {
  const supabase = getSupabase();

  const { data: webhook } = await supabase
    .from('payment_api_webhooks')
    .select('id, url, secret')
    .eq('merchant_id', checkoutSession.merchant_id)
    .maybeSingle();

  if (!webhook) return;

  const event = {
    type: 'checkout_session.' + checkoutSession.status,
    data: {
      id: checkoutSession.id,
      status: checkoutSession.status,
      amount: checkoutSession.amount,
      currency: checkoutSession.currency,
      reference: checkoutSession.reference,
      mpesa_transaction_id: checkoutSession.mpesa_transaction_id || null
    }
  };
  const payload = JSON.stringify(event);
  const signature = signPayload(payload, webhook.secret);

  const result = await postJson(webhook.url, payload, { 'X-Webhook-Signature': signature });

  try {
    await supabase.from('payment_api_webhook_deliveries').insert({
      webhook_id: webhook.id,
      checkout_session_id: checkoutSession.id,
      payload: event,
      status_code: result.statusCode,
      success: result.ok
    });
  } catch (e) {
    // log best-effort — não falha o fluxo por causa disso
  }
}

module.exports = { signPayload, deliverCheckoutWebhook };
