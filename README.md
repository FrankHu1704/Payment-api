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

## Gateway M-Pesa oficial (`/api/mpesa`)

Além do encaminhamento via SMS, o projeto integra diretamente a
[M-Pesa Payments Gateway](https://developer.mpesa.vm.co.mz/) (C2B, Reversal e Query
Transaction Status), autenticando com o esquema RSA descrito em "Getting Started →
Developing Without a Library" do portal: o `Authorization: Bearer` é o `MPESA_API_KEY`
cifrado com `MPESA_PUBLIC_KEY` (RSA/PKCS1, 4096 bits) e codificado em Base64 — feito em
`lib/mpesa.js` com o módulo `crypto` nativo do Node, sem depender do SDK Java/Python do
portal.

Os 3 endpoints vivem num único arquivo (`api/mpesa.js`, roteado por `?action=`) — o
plano Hobby da Vercel limita a 12 Serverless Functions por deploy, então rotas
relacionadas ficam agrupadas num arquivo em vez de uma pasta por rota.

Todos exigem `Authorization: Bearer <GATEWAY_API_KEY>` do lado do seu próprio
backend/frontend — nunca chame `/api/mpesa` direto do navegador do cliente final, pois
isso exporia o `GATEWAY_API_KEY`.

- `POST /api/mpesa?action=c2b` — inicia um pagamento do cliente para o negócio (USSD
  Push no celular do cliente). Body: `{ msisdn, amount, transactionReference, thirdPartyReference }`.
- `POST /api/mpesa?action=reversal` — reverte uma transação bem-sucedida. Body:
  `{ transactionId, thirdPartyReference, reversalAmount? }` (sem `reversalAmount`,
  tenta reversão total).
- `GET /api/mpesa?action=status&queryReference=...&thirdPartyReference=...` — consulta
  o status de uma transação pelo TransactionID, ThirdPartyReference ou ConversationID.

Cada chamada é registrada (melhor esforço, não bloqueia a resposta) na tabela
`public.payment_api_mpesa_transactions` do Supabase, para auditoria.

Variáveis de ambiente adicionais (veja `.env.example`): `MPESA_API_KEY`,
`MPESA_PUBLIC_KEY`, `MPESA_HOST`, `MPESA_ORIGIN`, `MPESA_SERVICE_PROVIDER_CODE`,
`MPESA_INITIATOR_IDENTIFIER` e `MPESA_SECURITY_CREDENTIAL` (últimas duas só para
Reversal), e `GATEWAY_API_KEY`. Use as credenciais da aba **Testing** do seu perfil no
portal — nunca as de Production num ambiente de desenvolvimento.

## Plataforma multi-tenant de pagamentos (`/api/keys`, `/api/webhooks`, `/api/checkout-sessions`)

Além do gateway "cru" (`/api/mpesa`), o projeto tem uma camada de plataforma —
outros negócios se cadastram, geram suas próprias chaves de API, criam links de
checkout e recebem webhooks — nos moldes de Zumbopay/DebitoPay/Stripe.

Pelo mesmo motivo do limite de 12 functions no plano Hobby: `api/checkout-sessions.js`
concentra criação/consulta/pagamento (roteado por `?id=` e `?action=pay`), e
`api/keys.js` concentra listar/criar/revogar (roteado por método HTTP + `?id=`).

**Modelo agregador**: o dinheiro de todos os lojistas cai na mesma conta M-Pesa da
plataforma (`MPESA_SERVICE_PROVIDER_CODE`); um livro-razão (`payment_api_ledger_entries`)
registra quanto cada lojista tem a receber. Repasse (payout) aos lojistas **não** é
automatizado nesta versão — só o registro contábil.

### Cadastro do lojista

`public/dashboard.html` — signup/login via Supabase Auth (client-side, com
`@supabase/supabase-js` via CDN). Ao criar a conta, um trigger Postgres
(`payment_api_handle_new_merchant`) cria automaticamente o perfil em
`payment_api_merchants`. Pelo dashboard o lojista:
- gera/revoga pares de chave `pk_live_.../sk_live_...` (o secret só é mostrado uma vez);
- configura a URL do seu webhook;
- vê suas transações e receita (lidos direto do Supabase via RLS, sem endpoint próprio).

### Integração do lojista (API)

- `POST /api/checkout-sessions` — `Authorization: Bearer sk_live_...` (chave secreta do
  lojista). Body: `{ amount, reference?, successUrl?, cancelUrl? }`. Retorna
  `{ id, url }`, onde `url` é o link de checkout hospedado
  (`/checkout.html?session=<id>`) pra mandar pro cliente final.
- `GET /api/checkout-sessions?id=<id>` — público, usado pela própria página de checkout
  (valor, nome do lojista, status — nada sensível).
- `POST /api/checkout-sessions?id=<id>&action=pay` — público, chamado pela página de
  checkout quando o cliente final informa o MSISDN. Dispara o C2B (`lib/mpesa.js`) com
  as credenciais globais da plataforma; a resposta da M-Pesa é síncrona por padrão,
  então o status final (`paid`/`failed`) já volta na mesma chamada.
- `POST /api/keys` / `GET /api/keys` / `DELETE /api/keys?id=<id>` — `Authorization: Bearer
  <sessão do Supabase Auth>`, gerenciamento de chaves.
- `POST /api/webhooks` / `GET /api/webhooks` — idem, configura a URL do webhook do
  lojista.

Ao um checkout resolver como `paid`, `lib/webhook.js` entrega (melhor esforço, 1
tentativa) um evento `checkout_session.paid` pro webhook do lojista, assinado em
`X-Webhook-Signature` (HMAC-SHA256 com o secret gerado na configuração do webhook), e
loga o resultado em `payment_api_webhook_deliveries`.

### Autenticação (`lib/merchantAuth.js`)

Dois esquemas de bearer token, nunca misturados: `sk_live_...` (chamadas
servidor-a-servidor do lojista, validadas por hash SHA-256 contra
`payment_api_api_keys.secret_key_hash`) e sessão do Supabase Auth (chamadas do
dashboard, validadas com `supabase.auth.getUser(jwt)`).

### Fora de escopo desta versão

Payout automático aos lojistas, reversal exposto na UI do lojista, retry/queue robusto
de webhook (só 1 tentativa) e fluxo customizado de confirmação de e-mail — usa o padrão
do Supabase Auth (pode ser necessário desativar "Confirm email" nas configs do projeto
Supabase pra testar sem precisar confirmar e-mail).

## Desenvolvimento local da API

```bash
npm install
npx vercel dev
```

(requer as variáveis de `.env.example` num `.env.local`)
