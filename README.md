# Payment API — Furacão Dashboard (Vercel + Supabase)

API serverless que recebe comprovativos de pagamento M-PESA/E-MOLA encaminhados por um
monitor Termux rodando no celular, grava tudo no Supabase e expõe um dashboard web com
estatísticas de vendas em tempo (quase) real.

## Arquitetura

O app original (monitor de SMS + dashboard num único processo com Socket.IO e arquivos
JSON locais) não roda em serverless: `termux-sms-list` só existe dentro do Termux no
Android, funções da Vercel não mantêm WebSocket nem disco persistente entre execuções.
Por isso o projeto foi dividido em duas partes:

1. **`/api` + `/public`** (este deploy na Vercel) — recebe os comprovativos via HTTP,
   grava no Supabase (Postgres) e serve o dashboard. Sem estado local: cada request é
   independente.
2. **`/termux`** — script que continua rodando no celular via Termux, lê as SMS locais
   com `termux-sms-list` e encaminha cada comprovativo novo para a API da Vercel.

```
Celular (Termux) --POST /api/sms--> Vercel (api/*.js) --insert--> Supabase (Postgres)
                                            |
                                      GET /api/stats, /api/logs
                                            |
                                      Dashboard (public/index.html, polling)
```

## Deploy (Vercel)

Já publicado em: **https://payment-api-blond.vercel.app**

Faltam 2 passos manuais no painel da Vercel (não há API para automatizar nenhum dos
dois com segurança):

1. **Settings → Environment Variables** — adicione (Production):
   - `SUPABASE_URL` = `https://vatvdkwuidtstyonwrwl.supabase.co`
   - `SUPABASE_ANON_KEY` = a chave "anon" do projeto Supabase "Senga" (Project Settings → API)
   - `SMS_API_KEY` = uma chave secreta à sua escolha (o monitor Termux precisa da mesma)

   Depois de salvar, redeploy (Deployments → ⋯ → Redeploy) para as functions pegarem
   as novas variáveis.

2. **Settings → Deployment Protection** — por padrão a Vercel protege o deployment com
   login (SSO), o que bloqueia tanto o navegador quanto o monitor Termux. Desative a
   proteção para Production (ou gere um "Protection Bypass for Automation" e inclua o
   header nas requisições do monitor).

Para deploys futuros (`vercel --prod` ou reimportando o repo), as rotas ficam em
`/api/sms`, `/api/stats`, `/api/logs`, `/api/status`, e o dashboard na raiz (`/`).

## Banco de dados (Supabase)

Tabela `public.payment_api_sms_logs`:

| coluna       | tipo        | descrição                              |
|--------------|-------------|-----------------------------------------|
| id           | bigint      | identidade                              |
| codigo       | text unique | código de confirmação (dedup)           |
| valor        | numeric     | valor em MT extraído do SMS             |
| servico      | text        | `M-PESA` ou `EMOLA`                     |
| body         | text        | texto original do SMS                   |
| device       | text        | identificador opcional do dispositivo   |
| received_at  | timestamptz | data de recebimento                     |

RLS habilitado, com policies de select/insert para o role `anon` — a chave anon é usada
apenas no backend (nunca exposta ao navegador); a autenticação real de quem pode gravar é
o `SMS_API_KEY` verificado em `api/sms.js`.

## Rotas da API

- `POST /api/sms` — recebe `{ "body": "<texto do SMS>" }` com
  `Authorization: Bearer <SMS_API_KEY>`. Detecta o código (M-PESA/E-MOLA), extrai o valor,
  ignora duplicados e grava no Supabase.
- `GET /api/stats` — `{ total, mpesa, emola, totalValor }`.
- `GET /api/logs` — últimos 100 registros.
- `GET /api/status` — `{ status: 'online' | 'offline' }` (testa conexão com o Supabase).

## Monitor Termux (`/termux`)

Roda no celular Android com [Termux](https://termux.dev/) + Termux:API:

```bash
cd termux
npm install
node -e "require('fs').writeFileSync('config.json', JSON.stringify({apiUrl:'https://SEU-PROJETO.vercel.app/api/sms', apiKey:'mesmo-valor-de-SMS_API_KEY-na-vercel'}, null, 2))"
# edite termux/config.json com a URL real do seu deploy e a chave configurada na Vercel
npm start
```

Ele lê `termux-sms-list -l 50` a cada 15s, detecta comprovativos novos e faz `POST` para
a API na Vercel. Mantém um `enviados.json` local só para não reenviar o mesmo SMS (o
Supabase também rejeita duplicados do lado do servidor).

## Desenvolvimento local da API

```bash
npm install
npx vercel dev
```

(requer `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SMS_API_KEY` num `.env.local`)
