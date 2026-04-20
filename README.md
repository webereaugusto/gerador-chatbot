# Gerador de Chatbot (OpenAI + Evolution + Supabase)

Aplicacao simples para criar chatbots independentes, cada um com:

- Chave propria da OpenAI
- Instancia propria da Evolution API (WhatsApp)
- Base de conhecimento propria
- Webhook proprio
- Leads e conversas armazenados no Supabase
- Widget para site, botao WhatsApp para compartilhar e API externa v1

> 📖 **Primeira instalacao?** Siga o [**Manual de instalacao**](INSTALL.md)
> passo a passo — Supabase, SQL, Evolution, Vercel, variaveis de ambiente,
> criacao de conta e conexao do WhatsApp.

## Pre-requisitos (resumo)

1. Conta no **Supabase** + projeto criado.
2. **Evolution API** rodando num VPS proprio com HTTPS.
3. Chave da **OpenAI**.
4. **Node.js 20+** (apenas para rodar local).
5. Conta na **Vercel** (para deploy).

## Setup do banco (resumo)

Abra o **SQL Editor** do Supabase e rode o conteudo completo de
[`db/schema.sql`](db/schema.sql). O script e **idempotente** (usa `if not exists`)
e pode ser executado em instalacoes novas ou ja existentes.

Tabelas criadas:

- `public.chatbots` — chatbots do usuario
- `public.leads` — contatos que conversaram
- `public.messages` — historico de mensagens
- `public.api_keys` — hashes das chaves da API externa (v1)
- `public.chatbot_integrations` — Google Sheets / Docs conectados ao agente

Todas com **Row Level Security** ligado (isolamento por usuario).

Passo-a-passo completo e explicacao de cada coluna: [INSTALL.md](INSTALL.md).

## Rodando local

```bash
git clone https://github.com/webereaugusto/gerador-chatbot.git
cd gerador-chatbot
npm install
cp .env.example .env   # depois edite com suas chaves
npm run dev
```

Abra `http://localhost:3000`.

- Se voce ainda nao tem conta, clique em **Criar conta**.
- Em seguida crie um chatbot preenchendo OpenAI + Evolution + Prompt + Base de
  conhecimento.
- Copie a URL de **Webhook** exibida no card do chatbot e configure na
  instancia da Evolution (evento `messages.upsert`).
- Mensagens recebidas viram leads e conversas, visiveis em **Leads** no menu
  lateral.

## Estrutura

```
├── server.js               # API Express + Supabase
├── db/
│   └── schema.sql          # Schema + RLS
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── api/
│   └── index.js            # Entrada serverless (Vercel)
├── vercel.json
├── .env.example
└── package.json
```

## Deploy na Vercel

O projeto ja inclui `vercel.json` e `api/index.js` para rodar o Express como
funcao Node na Vercel.

```bash
npm i -g vercel
vercel login
vercel link
vercel deploy --prod
```

### Publicar na sua conta (nao na de outra pessoa)

1. Confira quem esta logado: `vercel whoami`.
2. Se nao for a conta certa: `vercel logout` e depois `vercel login` (use o
   e-mail da conta **weber** / desejada no navegador).
3. Na pasta do projeto: `vercel link` e escolha o **seu** time ou conta
   pessoal (nao outro time por engano).
4. Configure de novo as variaveis `SUPABASE_*` em **Settings → Environment
   Variables** do novo projeto (ou `vercel env add`).
5. `vercel deploy --prod`.

### Variaveis de ambiente (obrigatorio)

No painel do projeto: **Settings → Environment Variables**, adicione para
**Production** (e Preview se quiser testar previews):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE`
- `API_KEY_PEPPER` — string longa e aleatoria (obrigatoria para **gerar chaves** e usar a **API externa v1**)
- `EVOLUTION_BASE_URL` — URL do Evolution no seu VPS (ex.: `https://evolution.seudominio.com`)
- `EVOLUTION_GLOBAL_API_KEY` — valor de `AUTHENTICATION_API_KEY` no `.env` do Evolution (chave **global** da instalacao; **nao** e a chave da instancia)

Sem Supabase, `/api/config` retorna vazio e o app nao autentica. Sem `API_KEY_PEPPER`, as rotas `/api/v1/*` e `/api/api-keys` retornam erro de configuracao. Sem `EVOLUTION_BASE_URL` + `EVOLUTION_GLOBAL_API_KEY`, o botao **Conectar WhatsApp** retorna 503.

### Conexao WhatsApp (QR in-app)

O usuario **nao configura Evolution** em lugar nenhum do painel. O fluxo agora e:

1. Usuario cria o chatbot e salva apenas a chave da OpenAI, prompt e base de conhecimento.
2. No card do chatbot, clica em **Conectar WhatsApp**.
3. O backend cria a instancia no Evolution (nome gerado automaticamente), pega o QR code e exibe no painel.
4. Usuario escaneia o QR com o WhatsApp do celular.
5. O backend faz polling e marca a conexao como `open` quando pareada.
6. O webhook e configurado automaticamente na Evolution.

Importante sobre a Evolution:

- Precisa rodar num **host persistente** (VPS, Railway, Render, Coolify). Vercel nao serve como host de Evolution (serverless).
- A URL precisa ser publica em HTTPS para o webhook do seu chatbot funcionar.
- Se o projeto Vercel estiver com **Deployment Protection**, o Evolution nao consegue chamar o webhook — desative em **Settings → Deployment Protection**.

### Modelo e humanizacao

Cada chatbot tem seu proprio modelo LLM, temperatura, max_tokens e flag de humanizacao.

- **Modelo** (`openai_model`): `gpt-4o-mini` (padrao), `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`, `o1-mini`. Valores fora da whitelist sao normalizados para `gpt-4o-mini`.
- **Temperatura** (`temperature`): 0 a 1.5, padrao 0.6. Valores baixos = mais previsivel; altos = mais criativo.
- **Max tokens** (`max_tokens`): 80 a 1500, padrao 400. Limita o tamanho da resposta. Entre 250 e 500 e ideal para WhatsApp.
- **Humanizar conversa** (`humanize_enabled`): quando ligado, o backend (1) envia presence `composing` ("digitando...") antes de cada parte da resposta, (2) aplica um delay proporcional ao tamanho do texto antes de enviar (~25ms por caractere, entre 800ms e 3,5s), e (3) divide respostas longas em ate 3 baloes (paragrafos ou frases). Quando desligado, envia tudo num balao so, instantaneo.

O backend tambem anexa automaticamente um **style guide** curto ao final do system prompt (nao se apresentar, respostas curtas, sem repetir), reforcando o comportamento mesmo em chatbots que ja tem prompt custom.

### Filtro de teste (whitelist de numero)

No cadastro do chatbot ha a seção **Filtro de teste (WhatsApp)**:

- Marque **Restringir respostas a um único número** quando for testar a integracao com o
  Evolution e nao quiser que mensagens de contatos reais disparem a IA.
- Informe o **numero permitido** em qualquer formato: `(19) 98194-0463`, `+55 19 98194-0463`,
  `5519981940463` etc. O backend normaliza para `55DDDNUMERO` e compara pelos
  ultimos 10 digitos (tolera o 9o digito variavel).
- Com a opcao ligada, qualquer outro numero que chegar no webhook recebe `200 { ignored: true, reason: "test_filter" }` e **nao** gera lead nem custo de OpenAI.
- Mensagens de grupos (`@g.us`) tambem sao ignoradas.

## APIs principais

| Metodo | Rota                              | Descricao                            |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/config`                     | Chaves publicas do Supabase           |
| GET    | `/api/chatbots`                   | Lista chatbots do usuario             |
| POST   | `/api/chatbots`                   | Cria chatbot                          |
| PUT    | `/api/chatbots/:id`               | Atualiza chatbot                      |
| DELETE | `/api/chatbots/:id`               | Exclui chatbot                        |
| POST   | `/api/chatbots/:id/test`          | Testa chatbot com pergunta de IA      |
| POST   | `/api/chatbots/:id/connect`       | Cria instancia Evolution e retorna QR |
| GET    | `/api/chatbots/:id/connection-state` | Estado da conexao (`open/qr/connecting/disconnected`) |
| POST   | `/api/chatbots/:id/disconnect`    | Logout da instancia Evolution         |
| GET    | `/api/chatbots/:id/leads`         | Leads do chatbot                      |
| GET    | `/api/leads/:id/messages`         | Mensagens de um lead                  |
| GET    | `/api/api-keys`                   | Lista chaves de API (JWT)             |
| POST   | `/api/api-keys`                   | Gera chave (JWT) — retorna `key` uma vez |
| DELETE | `/api/api-keys/:id`               | Revoga chave (JWT)                    |
| POST   | `/webhook/evolution/:botId`       | Webhook da Evolution                   |

### API externa v1 (integracoes — somente leitura)

Autenticacao: header **`Authorization: Bearer gc_live_...`** ou **`X-Api-Key: gc_live_...`**
(a chave completa comeca com `gc_live_` e e gerada no painel em **API**).

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/v1/chatbots` | Lista chatbots (sem segredos; inclui `webhookUrl`, `configured`) |
| GET | `/api/v1/chatbots/:chatbotId/leads` | Leads do chatbot. Query: `limit` (1–100, padrao 50), `before` (ISO, paginacao por `last_message_at`) |
| GET | `/api/v1/leads/:leadId/messages` | Lead + mensagens em ordem cronologica |

Exemplo (substitua a URL e a chave):

```bash
curl -s -H "Authorization: Bearer gc_live_SUA_CHAVE" \
  "https://SEU-PROJETO.vercel.app/api/v1/chatbots"
```

Proxima pagina de leads (se `hasMore` for true):

```bash
curl -s -H "X-Api-Key: gc_live_SUA_CHAVE" \
  "https://SEU-PROJETO.vercel.app/api/v1/chatbots/UUID_DO_BOT/leads?limit=50&before=2026-04-18T12:00:00.000Z"
```

Documentacao HTML no proprio app (apos deploy):

- `/api-manual.html` — manual completo da API v1
- `/api-test.html` — pagina simples para testar GETs com sua chave no navegador

## Observacoes

- Credenciais do chatbot (OpenAI e Evolution API Key) sao salvas em texto no
  banco. Para producao serio, criptografe antes de salvar.
- O webhook mantem contexto de ate 12 mensagens recentes por lead.
