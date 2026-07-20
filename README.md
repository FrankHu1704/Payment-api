# Payment API — Furacão Dashboard

API/serviço em Node.js que monitora SMS de confirmação de pagamentos M-PESA e E-MOLA
(via `termux-sms-list`, requer Termux:API no Android), reenvia cada comprovativo detectado
para uma API remota configurável, mantém um histórico local e expõe um dashboard web em
tempo real (via Socket.IO) com estatísticas de vendas por pacote de dados.

## Funcionalidades

- **Detecção automática** de códigos de confirmação M-PESA (`Confirmado XXXXXXXXXX`) e
  E-MOLA (`PPxxxxxxxx`), com extração do valor transacionado.
- **Encaminhamento** de cada comprovativo novo (não duplicado) via `POST` para a API
  configurada, com autenticação `Bearer`.
- **Persistência** de configuração (`config.json`) e histórico de envios (`sms_log.json`)
  em disco.
- **Monitor automático**: verifica novas SMS a cada 15 segundos.
- **API REST**:
  - `GET /api/config` — lê a configuração atual (URL/chave da API remota)
  - `POST /api/config` — atualiza a configuração
  - `GET /api/stats` — totais (geral, M-PESA, E-MOLA, receita)
  - `GET /api/logs` — últimos 100 registros
  - `GET /api/ping` — testa conectividade com a API remota
  - `POST /api/restart` — reinicia o monitor de SMS
- **WebSocket (Socket.IO)**: eventos `new-sms` e `stats-updated` em tempo real.
- **Dashboard** (`public/index.html`, gerado automaticamente no arranque): estatísticas,
  vendas por pacote (tabela de preços Furacão), configuração e histórico de registros.

## Requisitos

- Node.js >= 16
- Para o encaminhamento de SMS funcionar, o processo precisa correr num dispositivo com
  [Termux](https://termux.dev/) + Termux:API (comando `termux-sms-list`). Fora desse
  ambiente, a API/dashboard funcionam normalmente, mas não haverá SMS para monitorar.

## Instalação

```bash
npm install
```

## Configuração

Por padrão, a URL e a chave da API remota podem ser definidas via variáveis de ambiente:

```bash
export SMS_API_URL="http://SEU_IP:3030/sms"
export SMS_API_KEY="sua-chave-secreta"
export PORT=3000
```

Também podem ser alteradas em tempo de execução pelo próprio dashboard (aba
Configuração), que persiste os valores em `config.json`.

## Uso

```bash
npm start
```

O dashboard fica disponível em `http://localhost:3000` (e no IP da rede local).

## Estrutura

```
index.js          # servidor Express + Socket.IO, monitor de SMS e geração do dashboard
package.json
public/            # gerado automaticamente (index.html do dashboard)
config.json        # gerado automaticamente (config em runtime, não versionado)
sms_log.json       # gerado automaticamente (histórico em runtime, não versionado)
```
