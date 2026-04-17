# Gerador de Chatbot (OpenAI + Evolution + Supabase)

Aplicacao simples para criar chatbots independentes, cada um com:

- Chave propria da OpenAI
- Instancia propria da Evolution API
- Base de conhecimento propria
- Webhook proprio
- Leads e conversas armazenados no Supabase

## Pre-requisitos

1. Conta no Supabase com um projeto ja criado.
2. Chaves do Supabase preenchidas no arquivo `.env` (use `.env.example` como base).
3. Node.js 18+.

## Setup do banco (Supabase)

Abra o **SQL Editor** do seu projeto no Supabase e rode o conteudo de
`db/schema.sql`. Isso cria as tabelas:

- `public.chatbots`
- `public.leads`
- `public.messages`

E ativa RLS para isolar dados por usuario.

## Rodando

```bash
npm install
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

### Variaveis de ambiente (obrigatorio)

No painel do projeto: **Settings → Environment Variables**, adicione para
**Production** (e Preview se quiser testar previews):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE`

Sem isso, `/api/config` retorna vazio e o app nao autentica.

### Evolution API (webhook publico)

Se o projeto estiver com **Deployment Protection** (login Vercel na URL), a
Evolution **nao** conseguira chamar o webhook. Em **Project → Settings →
Deployment Protection**, desative a protecao para **Production** (ou use um
bypass token documentado na Vercel) para que `POST /webhook/evolution/:botId`
funcione.

O dominio de producao aparece no dashboard apos o deploy (ex. `*.vercel.app`).

## APIs principais

| Metodo | Rota                              | Descricao                            |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/config`                     | Chaves publicas do Supabase           |
| GET    | `/api/chatbots`                   | Lista chatbots do usuario             |
| POST   | `/api/chatbots`                   | Cria chatbot                          |
| PUT    | `/api/chatbots/:id`               | Atualiza chatbot                      |
| DELETE | `/api/chatbots/:id`               | Exclui chatbot                        |
| POST   | `/api/chatbots/:id/test`          | Testa chatbot com pergunta de IA      |
| GET    | `/api/chatbots/:id/leads`         | Leads do chatbot                      |
| GET    | `/api/leads/:id/messages`         | Mensagens de um lead                  |
| POST   | `/webhook/evolution/:botId`       | Webhook da Evolution                   |

## Observacoes

- Credenciais do chatbot (OpenAI e Evolution API Key) sao salvas em texto no
  banco. Para producao serio, criptografe antes de salvar.
- O webhook mantem contexto de ate 12 mensagens recentes por lead.
