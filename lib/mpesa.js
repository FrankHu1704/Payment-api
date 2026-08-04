const https = require('https');
const crypto = require('crypto');

// Authorization Bearer = Base64( RSA-PKCS1(API Key, Public Key) ), conforme
// developer.mpesa.vm.co.mz > Getting Started > Developing Without a Library.
function buildBearerToken() {
  const apiKey = process.env.MPESA_API_KEY;
  const publicKeyB64 = process.env.MPESA_PUBLIC_KEY;
  if (!apiKey || !publicKeyB64) {
    throw new Error('MPESA_API_KEY / MPESA_PUBLIC_KEY não configurados nas variáveis de ambiente');
  }

  const der = Buffer.from(publicKeyB64, 'base64');
  const publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  const encrypted = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(apiKey, 'utf8')
  );

  return encrypted.toString('base64');
}

function mpesaRequest({ method, port, path, body }) {
  return new Promise((resolve, reject) => {
    const host = process.env.MPESA_HOST || 'api.sandbox.vm.co.mz';
    const payload = body ? JSON.stringify(body) : undefined;

    let bearerToken;
    try {
      bearerToken = buildBearerToken();
    } catch (erro) {
      reject(erro);
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
      'Origin': process.env.MPESA_ORIGIN || 'developer.mpesa.vm.co.mz'
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({ host, port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data }; }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { buildBearerToken, mpesaRequest };
