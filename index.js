// ============================================================
// SMS FORWARDER - VERSÃO MELHORADA COM DASHBOARD FURACÃO
// ============================================================

const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const os = require('os');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const LOG_FILE = path.join(__dirname, 'sms_log.json');

let config = {
  apiUrl: process.env.SMS_API_URL || '207.180.248.161:3030/sms',
  apiKey: process.env.SMS_API_KEY || '21b0e2aeb4044c579b72abf39f40a854'
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...saved };
  } catch(e) {}
}

if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, JSON.stringify([]));
}

function salvarConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }
function obterLog() { try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch(e) { return []; } }
function salvarLog(log) { fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2)); }

// ============================================================
// DETECÇÃO
// ============================================================
function detectarCodigo(body) {
  const mpesaMatch = body.match(/Confirmado\s+([A-Z0-9]{10,12})\.?/i);
  if (mpesaMatch) return { codigo: mpesaMatch[1], servico: 'M-PESA' };

  const emolaMatch = body.match(/(PP[A-Za-z0-9.\-]{8,})/i);
  if (emolaMatch) return { codigo: emolaMatch[1], servico: 'EMOLA' };

  return null;
}

function extrairValor(body) {
  const match = body.match(/(?:TRANSFERISTE|RECEBESTE|VALOR)[\s:]*([\d.,]+)\s*MT/i);
  if (match) return parseFloat(match[1].replace(',', '.'));
  return null;
}

// ============================================================
// SERVIDOR
// ============================================================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ROTAS
// ============================================================
app.get('/api/config', (req, res) => {
  res.json({ apiUrl: config.apiUrl, apiKey: config.apiKey });
});

app.post('/api/config', (req, res) => {
  config.apiUrl = req.body.apiUrl || config.apiUrl;
  config.apiKey = req.body.apiKey || config.apiKey;
  salvarConfig();
  console.log('✅ Configuração salva');
  res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
  const log = obterLog();
  const total = log.length;
  const mpesa = log.filter(x => x.servico === 'M-PESA').length;
  const emola = log.filter(x => x.servico === 'EMOLA').length;
  const totalValor = log.reduce((acc, x) => acc + (x.valor || 0), 0);
  res.json({ total, mpesa, emola, totalValor });
});

app.get('/api/logs', (req, res) => {
  const log = obterLog();
  res.json(log.slice(-100).reverse());
});

app.get('/api/ping', async (req, res) => {
  if (!config.apiUrl) return res.json({ status: 'nao_configurado' });

  try {
    const baseUrl = config.apiUrl.replace('/sms', '').replace(/\/$/, '');
    await axios.get(`${baseUrl}/api/status`, { timeout: 5000 });
    res.json({ status: 'online', latency: 50 });
  } catch(e) {
    res.json({ status: 'offline' });
  }
});

app.post('/api/restart', (req, res) => {
  if (intervalId) clearInterval(intervalId);
  iniciarMonitor();
  res.json({ success: true });
});

// ============================================================
// MONITOR
// ============================================================
let intervalId = null;

async function enviarSMS() {
  if (!config.apiUrl || !config.apiKey) {
    console.log('⚠️ Aguardando configuração...');
    return;
  }

  exec('termux-sms-list -l 50', async (err, stdout) => {
    if (err || !stdout || stdout.trim() === '[]') return;

    let mensagens;
    try { mensagens = JSON.parse(stdout); } catch(e) { return; }

    const log = obterLog();
    let enviados = 0;

    for (let sms of mensagens) {
      const body = sms.body || '';
      const detectado = detectarCodigo(body);
      if (!detectado) continue;

      const jaEnviado = log.some(x => x.codigo === detectado.codigo);
      if (jaEnviado) continue;

      const valor = extrairValor(body);

      console.log(`\n📱 ${detectado.servico}: ${detectado.codigo} - ${valor || '?'}MT`);

      try {
        const response = await axios({
          method: 'POST',
          url: config.apiUrl,
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          data: { body: body },
          timeout: 10000
        });

        const registro = {
          codigo: detectado.codigo,
          valor: valor,
          servico: detectado.servico,
          data: new Date().toISOString(),
          status: 'sucesso',
          resposta: response.data
        };

        log.push(registro);
        salvarLog(log);
        enviados++;

        console.log(`✅ Enviado! Resposta: ${response.data?.message || 'OK'}`);
        io.emit('new-sms', registro);

      } catch(error) {
        const erroMsg = error.response?.data?.message || error.message;
        const statusCode = error.response?.status || error.code;
        console.log(`❌ Erro ${statusCode}: ${erroMsg}`);

        const registro = {
          codigo: detectado.codigo,
          valor: valor,
          servico: detectado.servico,
          data: new Date().toISOString(),
          status: 'erro',
          erro: `${statusCode} - ${erroMsg}`
        };

        log.push(registro);
        salvarLog(log);
        io.emit('new-sms', registro);
      }
    }

    if (enviados > 0) {
      console.log(`📊 ${enviados} novo(s) comprovativo(s) enviado(s)`);
      io.emit('stats-updated');
    }
  });
}

async function iniciarMonitor() {
  console.log('\n🚀 Iniciando monitoramento...');
  if (intervalId) clearInterval(intervalId);
  await enviarSMS();
  intervalId = setInterval(enviarSMS, 15000);
  console.log('⏱️  Verificando a cada 15 segundos\n');
}

// ============================================================
// WEBSOCKET
// ============================================================
io.on('connection', (socket) => {
  console.log('📡 Cliente conectado');
  socket.emit('logs', obterLog().slice(-50).reverse());
  socket.emit('stats', {
    total: obterLog().length,
    mpesa: obterLog().filter(x => x.servico === 'M-PESA').length,
    emola: obterLog().filter(x => x.servico === 'EMOLA').length,
    totalValor: obterLog().reduce((acc, x) => acc + (x.valor || 0), 0)
  });
});

// ============================================================
// PAINEL HTML
// ============================================================
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>🌪️ Furacão Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #06080c;
      --surface: #0d1117;
      --surface2: #151b25;
      --border: #1e2733;
      --text: #e6edf3;
      --text2: #7d8590;
      --accent: #00e676;
      --accent-dim: rgba(0,230,118,0.12);
      --mpesa: #e8363a;
      --mpesa-dim: rgba(232,54,58,0.12);
      --emola: #ff9100;
      --emola-dim: rgba(255,145,0,0.12);
      --erro: #f44336;
      --erro-dim: rgba(244,67,54,0.1);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100dvh;
      overflow-x: hidden;
    }

    /* ── HEADER ── */
    .hero {
      position: relative;
      padding: 24px 20px 20px;
      overflow: hidden;
    }
    .hero::before {
      content: '';
      position: absolute;
      top: -60%;
      left: -30%;
      width: 160%;
      height: 200%;
      background: radial-gradient(ellipse at center, rgba(0,230,118,0.06) 0%, transparent 60%);
      pointer-events: none;
    }
    .greeting {
      font-size: 14px;
      color: var(--text2);
      margin-bottom: 2px;
      font-weight: 500;
    }
    .greeting-icon { font-size: 18px; vertical-align: middle; margin-right: 4px; }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .brand h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, var(--accent), #69f0ae);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-sub {
      font-size: 12px;
      color: var(--text2);
      font-weight: 400;
    }
    .api-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      margin-top: 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text2);
    }
    .dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #555;
    }
    .dot.online { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
    .dot.offline { background: var(--erro); box-shadow: 0 0 6px var(--erro); }
    .dot.pending { background: #ff9100; }

    /* ── CONTAINER ── */
    .container { padding: 0 16px 100px; }

    /* ── STATS GRID ── */
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
      position: relative;
      overflow: hidden;
    }
    .stat::after {
      content: '';
      position: absolute;
      top: 0; right: 0;
      width: 60px; height: 60px;
      border-radius: 0 0 0 60px;
      opacity: 0.04;
    }
    .stat.green::after { background: var(--accent); }
    .stat.red::after { background: var(--mpesa); }
    .stat.orange::after { background: var(--emola); }
    .stat-icon { font-size: 16px; margin-bottom: 6px; }
    .stat-val {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -1px;
      line-height: 1;
    }
    .stat-val.green { color: var(--accent); }
    .stat-val.red { color: var(--mpesa); }
    .stat-val.orange { color: var(--emola); }
    .stat-label {
      font-size: 11px;
      color: var(--text2);
      font-weight: 500;
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* ── VENDAS CARD ── */
    .vendas-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .vendas-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .vendas-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
    }
    .vendas-total {
      font-size: 13px;
      font-weight: 700;
      color: var(--accent);
    }
    .vendas-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 260px;
      overflow-y: auto;
    }
    .vendas-list::-webkit-scrollbar { width: 3px; }
    .vendas-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .venda-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: var(--surface2);
      border-radius: 10px;
      font-size: 12px;
    }
    .venda-pkg {
      font-weight: 600;
      color: var(--text);
    }
    .venda-cat {
      font-size: 10px;
      color: var(--text2);
      margin-top: 1px;
    }
    .venda-qty {
      background: var(--accent-dim);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 11px;
    }
    .venda-rev {
      font-weight: 700;
      color: var(--accent);
      font-size: 12px;
      min-width: 55px;
      text-align: right;
    }
    .empty-state {
      text-align: center;
      padding: 24px;
      color: var(--text2);
      font-size: 13px;
    }

    /* ── CARD GENÉRICO ── */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }

    /* ── TABS ── */
    .tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 14px;
    }
    .tab {
      flex: 1;
      padding: 8px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text2);
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab.active {
      background: var(--accent-dim);
      border-color: rgba(0,230,118,0.3);
      color: var(--accent);
    }

    /* ── INPUTS ── */
    .input-group { margin-bottom: 10px; }
    .input-label {
      display: block;
      font-size: 11px;
      color: var(--text2);
      font-weight: 600;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 11px 14px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      outline: none;
      transition: border 0.2s;
    }
    input:focus { border-color: var(--accent); }

    .btn-row { display: flex; gap: 8px; margin-top: 12px; }
    .btn {
      flex: 1;
      padding: 11px;
      border: none;
      border-radius: 10px;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn:active { opacity: 0.7; }
    .btn-primary { background: var(--accent); color: #000; }
    .btn-ghost { background: var(--surface2); color: var(--text2); border: 1px solid var(--border); }

    /* ── LOG ITEMS ── */
    .logs-wrap {
      max-height: 400px;
      overflow-y: auto;
    }
    .logs-wrap::-webkit-scrollbar { width: 3px; }
    .logs-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    .log-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px;
      margin-bottom: 6px;
      background: var(--surface2);
      border-radius: 10px;
      border-left: 3px solid var(--erro);
      transition: background 0.2s;
    }
    .log-item.sucesso { border-left-color: var(--accent); }
    .log-body { flex: 1; min-width: 0; }
    .log-top {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 3px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .pill-mpesa { background: var(--mpesa-dim); color: var(--mpesa); }
    .pill-emola { background: var(--emola-dim); color: var(--emola); }
    .pill-ok { background: var(--accent-dim); color: var(--accent); }
    .pill-err { background: var(--erro-dim); color: var(--erro); }
    .log-code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
      word-break: break-all;
    }
    .log-valor {
      font-weight: 700;
      color: var(--accent);
      font-size: 13px;
    }
    .log-pkg {
      font-size: 10px;
      color: var(--text2);
      margin-top: 1px;
    }
    .log-meta {
      font-size: 10px;
      color: var(--text2);
      margin-top: 3px;
    }
    .log-erro {
      font-size: 10px;
      color: var(--erro);
      margin-top: 2px;
    }

    /* ── FOOTER ── */
    .footer {
      text-align: center;
      padding: 20px;
      font-size: 11px;
      color: var(--text2);
      opacity: 0.5;
    }

    /* ── TOAST ── */
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 20px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      z-index: 9999;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 8px 30px rgba(0,0,0,0.4);
    }
    .toast.show { transform: translateX(-50%) translateY(0); }

    /* ── ANIMATE ── */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate { animation: fadeUp 0.4s ease forwards; }
  </style>
</head>
<body>

<!-- HERO -->
<div class="hero">
  <div class="greeting" id="greeting"></div>
  <div class="brand">
    <h1>🌪️ Furacão Dashboard</h1>
  </div>
  <div class="brand-sub">Monitoramento de Vendas • M-PESA / E-MOLA</div>
  <div class="api-pill" id="apiStatus">
    <span class="dot" id="statusDot"></span>
    <span id="statusText">Verificando...</span>
  </div>
</div>

<div class="container">

  <!-- STATS -->
  <div class="stats">
    <div class="stat green">
      <div class="stat-icon">💰</div>
      <div class="stat-val green" id="statValor">0</div>
      <div class="stat-label">Receita (MT)</div>
    </div>
    <div class="stat">
      <div class="stat-icon">📦</div>
      <div class="stat-val" id="statTotal">0</div>
      <div class="stat-label">Total Vendas</div>
    </div>
    <div class="stat red">
      <div class="stat-icon">🔴</div>
      <div class="stat-val red" id="statMpesa">0</div>
      <div class="stat-label">M-PESA</div>
    </div>
    <div class="stat orange">
      <div class="stat-icon">🟠</div>
      <div class="stat-val orange" id="statEmola">0</div>
      <div class="stat-label">E-MOLA</div>
    </div>
  </div>

  <!-- VENDAS POR PACOTE -->
  <div class="vendas-card animate">
    <div class="vendas-header">
      <span class="vendas-title">📊 Vendas por Pacote</span>
      <span class="vendas-total" id="vendasResumo">0 pacotes</span>
    </div>
    <div class="tabs">
      <div class="tab active" data-filter="todos" onclick="filtrarVendas('todos')">Todos</div>
      <div class="tab" data-filter="diario" onclick="filtrarVendas('diario')">Diários</div>
      <div class="tab" data-filter="semanal" onclick="filtrarVendas('semanal')">Semanais</div>
      <div class="tab" data-filter="mensal" onclick="filtrarVendas('mensal')">Mensais</div>
    </div>
    <div class="vendas-list" id="vendasList">
      <div class="empty-state">Nenhuma venda registrada ainda</div>
    </div>
  </div>

  <!-- CONFIG -->
  <div class="card">
    <div class="card-head">⚙️ Configuração</div>
    <div class="input-group">
      <label class="input-label">URL da API</label>
      <input type="text" id="apiUrl" placeholder="http://IP:3030/sms">
    </div>
    <div class="input-group">
      <label class="input-label">Chave API</label>
      <input type="password" id="apiKey" placeholder="Sua API Key">
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="saveBtn">Salvar</button>
      <button class="btn btn-ghost" id="restartBtn">Reiniciar</button>
    </div>
  </div>

  <!-- LOGS -->
  <div class="card">
    <div class="card-head">📋 Últimos Registros</div>
    <div class="logs-wrap" id="logsContainer"></div>
  </div>

  <div class="footer">🌪️ Furacão Dashboard • Conectando mais rápido</div>
</div>

<div class="toast" id="toast"></div>

<script src="/socket.io/socket.io.js"></script>
<script>
// ════════════════════════════════════════
// TABELA DE PREÇOS FURACÃO
// ════════════════════════════════════════
const TABELA = [
  // DIÁRIOS
  { preco: 4, dados: '100MB', cat: 'diario', label: 'Diário' },
  { preco: 5, dados: '150MB', cat: 'diario', label: 'Diário' },
  { preco: 6, dados: '256MB', cat: 'diario', label: 'Diário' },
  { preco: 7, dados: '280MB', cat: 'diario', label: 'Diário' },
  { preco: 8, dados: '320MB', cat: 'diario', label: 'Diário' },
  { preco: 9, dados: '360MB', cat: 'diario', label: 'Diário' },
  { preco: 10, dados: '400MB', cat: 'diario', label: 'Diário' },
  { preco: 12, dados: '512MB', cat: 'diario', label: 'Diário' },
  { preco: 15, dados: '600MB', cat: 'diario', label: 'Diário' },
  { preco: 18, dados: '700MB', cat: 'diario', label: 'Diário' },
  { preco: 20, dados: '800MB', cat: 'diario', label: 'Diário' },
  { preco: 22, dados: '900MB', cat: 'diario', label: 'Diário' },
  { preco: 24, dados: '1GB', cat: 'diario', label: 'Diário' },
  { preco: 27, dados: '1.1GB', cat: 'diario', label: 'Diário' },
  { preco: 29, dados: '1.2GB', cat: 'diario', label: 'Diário' },
  { preco: 32, dados: '1.3GB', cat: 'diario', label: 'Diário' },
  { preco: 35, dados: '1.4GB', cat: 'diario', label: 'Diário' },
  { preco: 37, dados: '1.5GB', cat: 'diario', label: 'Diário' },
  { preco: 40, dados: '1.6GB', cat: 'diario', label: 'Diário' },
  { preco: 42, dados: '1.7GB', cat: 'diario', label: 'Diário' },
  { preco: 44, dados: '1.8GB', cat: 'diario', label: 'Diário' },
  { preco: 46, dados: '1.9GB', cat: 'diario', label: 'Diário' },
  { preco: 48, dados: '2GB', cat: 'diario', label: 'Diário' },
  { preco: 51, dados: '2.1GB', cat: 'diario', label: 'Diário' },
  { preco: 53, dados: '2.2GB', cat: 'diario', label: 'Diário' },
  { preco: 56, dados: '2.3GB', cat: 'diario', label: 'Diário' },
  { preco: 59, dados: '2.4GB', cat: 'diario', label: 'Diário' },
  { preco: 61, dados: '2.5GB', cat: 'diario', label: 'Diário' },
  { preco: 64, dados: '2.6GB', cat: 'diario', label: 'Diário' },
  { preco: 66, dados: '2.7GB', cat: 'diario', label: 'Diário' },
  { preco: 68, dados: '2.8GB', cat: 'diario', label: 'Diário' },
  { preco: 70, dados: '2.9GB', cat: 'diario', label: 'Diário' },
  { preco: 72, dados: '3GB', cat: 'diario', label: 'Diário' },
  { preco: 96, dados: '4GB', cat: 'diario', label: 'Diário' },
  { preco: 120, dados: '5GB', cat: 'diario', label: 'Diário' },
  { preco: 144, dados: '6GB', cat: 'diario', label: 'Diário' },
  { preco: 168, dados: '7GB', cat: 'diario', label: 'Diário' },
  { preco: 192, dados: '8GB', cat: 'diario', label: 'Diário' },
  { preco: 216, dados: '9GB', cat: 'diario', label: 'Diário' },
  { preco: 239, dados: '10GB', cat: 'diario', label: 'Diário' },
  // 5 DIAS RENOVÁVEIS
  { preco: 65, dados: '2228MB', cat: '5dias', label: '5 Dias ♻️' },
  { preco: 88, dados: '3341MB', cat: '5dias', label: '5 Dias ♻️' },
  { preco: 112, dados: '4457MB', cat: '5dias', label: '5 Dias ♻️' },
  { preco: 137, dados: '5571MB', cat: '5dias', label: '5 Dias ♻️' },
  { preco: 212, dados: '8914MB', cat: '5dias', label: '5 Dias ♻️' },
  // SEMANAIS
  { preco: 95, dados: '3.4GB', cat: 'semanal', label: 'Semanal' },
  { preco: 140, dados: '5.2GB', cat: 'semanal', label: 'Semanal' },
  { preco: 195, dados: '7.1GB', cat: 'semanal', label: 'Semanal' },
  { preco: 285, dados: '10.7GB', cat: 'semanal', label: 'Semanal' },
  { preco: 385, dados: '14.3GB', cat: 'semanal', label: 'Semanal' },
  // MENSAIS
  { preco: 95, dados: '2.8GB', cat: 'mensal', label: 'Mensal' },
  { preco: 190, dados: '7GB', cat: 'mensal', label: 'Mensal' },
  { preco: 285, dados: '10GB', cat: 'mensal', label: 'Mensal' },
  { preco: 470, dados: '17.9GB', cat: 'mensal', label: 'Mensal' },
  { preco: 950, dados: '35.8GB', cat: 'mensal', label: 'Mensal' },
  // ILIMITADOS
  { preco: 450, dados: '11GB+Ilim.', cat: 'ilimitado', label: 'Ilimitado' },
  { preco: 930, dados: '22GB+Ilim.', cat: 'ilimitado', label: 'Ilimitado' },
];

// Mapa rápido preço → pacote(s)
const PRECO_MAP = {};
TABELA.forEach(p => {
  if (!PRECO_MAP[p.preco]) PRECO_MAP[p.preco] = [];
  PRECO_MAP[p.preco].push(p);
});

function identificarPacote(valor) {
  if (!valor) return null;
  const v = Math.round(valor);
  if (PRECO_MAP[v]) return PRECO_MAP[v][0];
  // Tolerância ±1 MT
  if (PRECO_MAP[v - 1]) return PRECO_MAP[v - 1][0];
  if (PRECO_MAP[v + 1]) return PRECO_MAP[v + 1][0];
  return null;
}

// ════════════════════════════════════════
// SAUDAÇÕES
// ════════════════════════════════════════
function atualizarSaudacao() {
  const h = new Date().getHours();
  const el = document.getElementById('greeting');
  let icon, texto;
  if (h >= 5 && h < 12) {
    icon = '☀️'; texto = 'Bom dia';
  } else if (h >= 12 && h < 18) {
    icon = '🌤️'; texto = 'Boa tarde';
  } else {
    icon = '🌙'; texto = 'Boa noite';
  }
  const dia = new Date().toLocaleDateString('pt-PT', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  el.innerHTML = '<span class="greeting-icon">' + icon + '</span> ' + texto + ' — ' + dia.charAt(0).toUpperCase() + dia.slice(1);
}

// ════════════════════════════════════════
// SOCKET + LÓGICA
// ════════════════════════════════════════
const socket = io();
let allLogs = [];
let currentFilter = 'todos';

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function formatarData(dataISO) {
  const d = new Date(dataISO);
  return d.toLocaleString('pt-PT', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// ── STATS ──
async function atualizarStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    animarNumero('statTotal', data.total);
    animarNumero('statMpesa', data.mpesa);
    animarNumero('statEmola', data.emola);
    document.getElementById('statValor').textContent = data.totalValor.toLocaleString('pt-PT');
  } catch(e) {}
}

function animarNumero(id, valor) {
  document.getElementById(id).textContent = valor;
}

// ── VENDAS POR PACOTE ──
function calcularVendas(logs) {
  const vendas = {};
  let totalPkgs = 0;
  let totalRev = 0;

  logs.forEach(log => {
    if (log.status !== 'sucesso' || !log.valor) return;
    const pkg = identificarPacote(log.valor);
    if (!pkg) return;
    const key = pkg.preco + '_' + pkg.dados + '_' + pkg.cat;
    if (!vendas[key]) {
      vendas[key] = { ...pkg, qty: 0, rev: 0 };
    }
    vendas[key].qty++;
    vendas[key].rev += pkg.preco;
    totalPkgs++;
    totalRev += pkg.preco;
  });

  return { vendas: Object.values(vendas).sort((a, b) => b.qty - a.qty), totalPkgs, totalRev };
}

function filtrarVendas(filter) {
  currentFilter = filter;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filter);
  });
  renderizarVendas();
}

function renderizarVendas() {
  const { vendas, totalPkgs, totalRev } = calcularVendas(allLogs);
  const filtered = currentFilter === 'todos' ? vendas : vendas.filter(v => v.cat === currentFilter);

  document.getElementById('vendasResumo').textContent = totalPkgs + ' pacotes • ' + totalRev.toLocaleString('pt-PT') + ' MT';

  const container = document.getElementById('vendasList');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhuma venda nesta categoria</div>';
    return;
  }

  container.innerHTML = filtered.map(v =>
    '<div class="venda-row">' +
      '<div>' +
        '<div class="venda-pkg">' + v.dados + '</div>' +
        '<div class="venda-cat">' + v.label + ' • ' + v.preco + ' MT/un</div>' +
      '</div>' +
      '<div class="venda-qty">' + v.qty + 'x</div>' +
      '<div class="venda-rev">' + v.rev.toLocaleString('pt-PT') + ' MT</div>' +
    '</div>'
  ).join('');
}

// ── CONFIG ──
async function carregarConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    document.getElementById('apiUrl').value = data.apiUrl || '';
    document.getElementById('apiKey').value = data.apiKey || '';
  } catch(e) {}
}

async function salvarConfig() {
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiUrl: document.getElementById('apiUrl').value,
      apiKey: document.getElementById('apiKey').value
    })
  });
  showToast('✅ Configuração salva');
  await reiniciarMonitor();
}

async function reiniciarMonitor() {
  await fetch('/api/restart', { method: 'POST' });
  showToast('🔄 Monitor reiniciado');
}

// ── PING ──
async function atualizarPing() {
  try {
    const res = await fetch('/api/ping');
    const data = await res.json();
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    dot.className = 'dot';
    if (data.status === 'online') {
      dot.classList.add('online');
      txt.textContent = 'API Online';
    } else if (data.status === 'nao_configurado') {
      dot.classList.add('pending');
      txt.textContent = 'Configure a API';
    } else {
      dot.classList.add('offline');
      txt.textContent = 'API Offline';
    }
  } catch(e) {
    document.getElementById('statusDot').className = 'dot offline';
    document.getElementById('statusText').textContent = 'Sem conexão';
  }
}

// ── LOGS ──
function renderizarLog(log) {
  const pkg = identificarPacote(log.valor);
  const servicoClass = (log.servico === 'EMOLA') ? 'pill-emola' : 'pill-mpesa';
  const statusClass = log.status === 'sucesso' ? 'pill-ok' : 'pill-err';
  const statusText = log.status === 'sucesso' ? '✓ OK' : '✗ ERRO';

  const pkgInfo = pkg
    ? '<div class="log-pkg">📦 ' + pkg.dados + ' ' + pkg.label + '</div>'
    : '';

  const erroInfo = log.erro
    ? '<div class="log-erro">' + log.erro + '</div>'
    : '';

  return '<div class="log-item ' + (log.status === 'sucesso' ? 'sucesso' : 'erro') + '">' +
    '<div class="log-body">' +
      '<div class="log-top">' +
        '<span class="pill ' + servicoClass + '">' + (log.servico || 'M-PESA') + '</span>' +
        '<span class="pill ' + statusClass + '">' + statusText + '</span>' +
        '<span class="log-valor">' + (log.valor ? log.valor + ' MT' : '? MT') + '</span>' +
      '</div>' +
      '<div class="log-code">' + log.codigo + '</div>' +
      pkgInfo +
      '<div class="log-meta">' + formatarData(log.data) + '</div>' +
      erroInfo +
    '</div>' +
  '</div>';
}

async function carregarLogs() {
  try {
    const res = await fetch('/api/logs');
    allLogs = await res.json();
    const container = document.getElementById('logsContainer');
    container.innerHTML = allLogs.map(renderizarLog).join('');
    renderizarVendas();
  } catch(e) {}
}

function adicionarLog(log) {
  allLogs.unshift(log);
  const container = document.getElementById('logsContainer');
  const div = document.createElement('div');
  div.innerHTML = renderizarLog(log);
  const el = div.firstChild;
  el.style.animation = 'fadeUp 0.3s ease';
  container.insertBefore(el, container.firstChild);
  if (container.children.length > 50) container.removeChild(container.lastChild);
  renderizarVendas();
}

// ── INIT ──
socket.on('connect', () => {
  atualizarStats();
  carregarLogs();
  carregarConfig();
});
socket.on('new-sms', (sms) => {
  adicionarLog(sms);
  atualizarStats();
  showToast('📱 Novo comprovativo: ' + (sms.valor || '?') + ' MT');
});
socket.on('stats-updated', () => atualizarStats());

document.getElementById('saveBtn').onclick = salvarConfig;
document.getElementById('restartBtn').onclick = reiniciarMonitor;

atualizarSaudacao();
atualizarStats();
carregarLogs();
carregarConfig();
atualizarPing();

setInterval(atualizarSaudacao, 60000);
setInterval(atualizarPing, 10000);
setInterval(atualizarStats, 30000);
</script>
</body>
</html>`;

fs.writeFileSync(path.join(publicDir, 'index.html'), html);
console.log('✅ Painel criado');

// ============================================================
// INICIAR
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔════════════════════════════════╗`);
  console.log(`║  🌪️  FURACÃO DASHBOARD v4.0  🌪️  ║`);
  console.log(`╠════════════════════════════════╣`);
  console.log(`║  📱 Painel: http://localhost:${PORT} ║`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`║  🌐 Rede: http://${net.address}:${PORT} ║`);
      }
    }
  }
  console.log(`╚════════════════════════════════╝`);
});

iniciarMonitor();

process.on('SIGINT', () => {
  console.log('\n👋 Encerrando...');
  if (intervalId) clearInterval(intervalId);
  server.close(() => process.exit());
});
