// ============================================================
// MONITOR TERMUX — lê SMS locais e encaminha para a API na Vercel
// Roda no celular Android via Termux + Termux:API.
// ============================================================

const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = {
  apiUrl: 'https://payment-api-blond.vercel.app/api/sms',
  apiKey: 'defina-a-mesma-chave-da-SMS_API_KEY-na-vercel'
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...saved };
  } catch (e) {}
} else {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(`⚠️  Criado ${CONFIG_FILE} — edite apiUrl/apiKey antes de continuar.`);
}

const ENVIADOS_FILE = path.join(__dirname, 'enviados.json');
function obterEnviados() {
  try { return JSON.parse(fs.readFileSync(ENVIADOS_FILE, 'utf8')); } catch (e) { return []; }
}
function salvarEnviados(lista) {
  fs.writeFileSync(ENVIADOS_FILE, JSON.stringify(lista, null, 2));
}
if (!fs.existsSync(ENVIADOS_FILE)) salvarEnviados([]);

// ============================================================
// DETECÇÃO (mesma lógica da API)
// ============================================================
function detectarCodigo(body) {
  const mpesaMatch = body.match(/Confirmado\s+([A-Z0-9]{10,12})\.?/i);
  if (mpesaMatch) return { codigo: mpesaMatch[1], servico: 'M-PESA' };

  const emolaMatch = body.match(/(PP[A-Za-z0-9.\-]{8,})/i);
  if (emolaMatch) return { codigo: emolaMatch[1], servico: 'EMOLA' };

  return null;
}

// ============================================================
// MONITOR
// ============================================================
let intervalId = null;

async function enviarSMS() {
  if (!config.apiUrl || !config.apiKey) {
    console.log('⚠️ Configure config.json antes de continuar.');
    return;
  }

  exec('termux-sms-list -l 50', async (err, stdout) => {
    if (err || !stdout || stdout.trim() === '[]') return;

    let mensagens;
    try { mensagens = JSON.parse(stdout); } catch (e) { return; }

    const enviados = obterEnviados();
    let novosEnvios = 0;

    for (const sms of mensagens) {
      const body = sms.body || '';
      const detectado = detectarCodigo(body);
      if (!detectado) continue;

      if (enviados.includes(detectado.codigo)) continue;

      console.log(`\n📱 ${detectado.servico}: ${detectado.codigo}`);

      try {
        const response = await axios({
          method: 'POST',
          url: config.apiUrl,
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          data: { body },
          timeout: 10000
        });

        console.log(`✅ Enviado! Resposta: ${response.data?.message || 'OK'}`);
        enviados.push(detectado.codigo);
        salvarEnviados(enviados);
        novosEnvios++;
      } catch (error) {
        const erroMsg = error.response?.data?.message || error.message;
        const statusCode = error.response?.status || error.code;
        console.log(`❌ Erro ${statusCode}: ${erroMsg}`);

        // 400/401 não são recuperáveis reenviando o mesmo SMS — marca como tratado
        // para não tentar de novo a cada ciclo.
        if (statusCode === 400 || statusCode === 401) {
          enviados.push(detectado.codigo);
          salvarEnviados(enviados);
        }
      }
    }

    if (novosEnvios > 0) {
      console.log(`📊 ${novosEnvios} novo(s) comprovativo(s) enviado(s)`);
    }
  });
}

function iniciarMonitor() {
  console.log('\n🚀 Iniciando monitoramento...');
  console.log(`🌐 Destino: ${config.apiUrl}`);
  if (intervalId) clearInterval(intervalId);
  enviarSMS();
  intervalId = setInterval(enviarSMS, 15000);
  console.log('⏱️  Verificando a cada 15 segundos\n');
}

iniciarMonitor();

process.on('SIGINT', () => {
  console.log('\n👋 Encerrando...');
  if (intervalId) clearInterval(intervalId);
  process.exit();
});
