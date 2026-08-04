# Deploy manual via Termux (CLI da Vercel)

Use isto quando a integração da Vercel usada pelo assistente estiver fora do ar. O
projeto **payment-api** já existe na Vercel (time `frank-s-projects-12a83ab3`) — os
passos abaixo linkam com ele, não criam um novo.

## 1. Preparar o Termux

```bash
pkg update && pkg install nodejs git -y
```

## 2. Clonar o repositório (ou atualizar, se já clonado)

```bash
git clone https://github.com/FrankHu1704/Payment-api.git
cd Payment-api
git checkout claude/payment-api-implementation-8ag82z
git pull
```

## 3. Instalar a CLI da Vercel e logar

```bash
npm install -g vercel
vercel login
```

Escolha login por e-mail — a Vercel manda um link de confirmação.

## 4. Linkar com o projeto já existente

```bash
vercel link
```

Quando perguntar:
- **Set up and deploy?** → No (só linkar)
- **Which scope?** → escolha o time (frank's projects)
- **Link to existing project?** → Yes
- **Project name** → `payment-api`

## 5. Configurar as variáveis de ambiente

Rode um `vercel env add <NOME> production` por variável (ele pede o valor depois de
apertar Enter):

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_ANON_KEY production
vercel env add SMS_API_KEY production
vercel env add MPESA_API_KEY production
vercel env add MPESA_PUBLIC_KEY production
vercel env add MPESA_HOST production
vercel env add MPESA_ORIGIN production
vercel env add MPESA_SERVICE_PROVIDER_CODE production
vercel env add MPESA_INITIATOR_IDENTIFIER production
vercel env add MPESA_SECURITY_CREDENTIAL production
vercel env add GATEWAY_API_KEY production
```

Valores (veja `.env.example` na raiz do repo para o significado de cada um):

- `SUPABASE_URL` = `https://vatvdkwuidtstyonwrwl.supabase.co`
- `SUPABASE_ANON_KEY` = a chave anon do projeto Supabase "Senga" (Project Settings → API)
- `SMS_API_KEY` / `GATEWAY_API_KEY` = chaves fortes à sua escolha
- `MPESA_API_KEY` / `MPESA_PUBLIC_KEY` = **da aba Testing** do seu perfil em
  developer.mpesa.vm.co.mz (não a de Production)
- `MPESA_HOST` = `api.sandbox.vm.co.mz`
- `MPESA_ORIGIN` = `developer.mpesa.vm.co.mz`
- `MPESA_SERVICE_PROVIDER_CODE` = seu shortcode de sandbox
- `MPESA_INITIATOR_IDENTIFIER` / `MPESA_SECURITY_CREDENTIAL` = só necessários pro
  endpoint de Reversal — se ainda não tiver esses valores (são fornecidos pela
  Vodacom/M-Pesa, não pelo self-signup), pode digitar qualquer texto por enquanto;
  só o `/api/mpesa/reversal` vai falhar até você ter os valores reais.

Alternativa mais rápida (menos digitação no celular): abra
`https://vercel.com/frank-s-projects-12a83ab3/payment-api/settings/environment-variables`
no navegador do celular e cole tudo por lá — dá no mesmo.

## 6. Deploy

```bash
vercel --prod
```

## 7. Desativar a Deployment Protection

Isso só dá pra fazer pelo navegador (não tem comando de CLI pra isso):
`Settings → Deployment Protection → Vercel Authentication → Disabled` (para Production),
senão o checkout público e os webhooks dos lojistas ficam bloqueados atrás de login da
Vercel.

## 8. Conferir

```bash
curl https://payment-api-blond.vercel.app/api/status
```

Deve responder `{"status":"online"}` (se `SUPABASE_URL`/`SUPABASE_ANON_KEY` estiverem
certos). Depois teste o dashboard em `https://payment-api-blond.vercel.app/dashboard.html`
e o checkout criando uma sessão de teste via `POST /api/checkout-sessions`.
