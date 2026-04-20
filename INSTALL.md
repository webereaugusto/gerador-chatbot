# Manual de Instalação — Gerador de Chatbot

Guia passo a passo para instalar o Gerador de Chatbot do zero, em produção
(Vercel + Supabase + Evolution API) ou em desenvolvimento local.

> Se você já tem o projeto rodando e só precisa aplicar as migrações mais
> recentes do banco, pule direto para [Atualizações / migrações](#atualizações--migrações).

---

## Sumário

1. [Arquitetura resumida](#arquitetura-resumida)
2. [O que você vai precisar](#o-que-você-vai-precisar)
3. [Passo 1 — Provisionar o Supabase](#passo-1--provisionar-o-supabase)
4. [Passo 2 — Rodar o SQL do banco](#passo-2--rodar-o-sql-do-banco)
5. [Passo 3 — Subir o Evolution API](#passo-3--subir-o-evolution-api-whatsapp)
6. [Passo 4 — Clonar e configurar o repositório](#passo-4--clonar-e-configurar-o-repositório)
7. [Passo 5 — Rodar localmente](#passo-5--rodar-localmente-opcional)
8. [Passo 6 — Publicar na Vercel](#passo-6--publicar-na-vercel)
9. [Passo 7 — Criar conta + primeiro chatbot](#passo-7--criar-conta--primeiro-chatbot)
10. [Passo 8 — Conectar o WhatsApp (QR in-app)](#passo-8--conectar-o-whatsapp-qr-in-app)
11. [Atualizações / migrações](#atualizações--migrações)
12. [Solução de problemas](#solução-de-problemas)

---

## Arquitetura resumida

```
┌────────────┐       ┌──────────────────┐       ┌──────────────┐
│  Browser   │◀─────▶│ Vercel (Node.js) │◀─────▶│  Supabase    │
│  (painel)  │       │  server.js       │       │  (Postgres + │
└────────────┘       │  api/index.js    │       │   Auth)      │
                     └──────────────────┘       └──────────────┘
                              ▲    ▲
                              │    │ webhook
                              │    │
                              ▼    │
                       ┌──────────────────┐       ┌────────────┐
                       │ Evolution API    │◀─────▶│ WhatsApp   │
                       │  (VPS própria)   │       │            │
                       └──────────────────┘       └────────────┘
```

| Componente      | Onde roda                     | Obrigatório? |
| --------------- | ----------------------------- | ------------ |
| Frontend + API  | Vercel (serverless)           | Sim          |
| Banco + Auth    | Supabase                      | Sim          |
| Evolution API   | VPS sua (Railway, Render, VPS) | Sim          |
| OpenAI          | API externa                   | Sim          |

> **Por que o Evolution não pode rodar na Vercel?** A Evolution mantém uma
> sessão WebSocket persistente com o WhatsApp e precisa de disco/estado. Vercel
> é serverless — use um VPS qualquer ou Railway/Render/Coolify.

---

## O que você vai precisar

- Conta no **Supabase** (free já basta).
- Conta no **Vercel** (free já basta).
- Uma conta no **GitHub** (para clonar / fazer o deploy).
- Uma **chave da OpenAI** (você gera em <https://platform.openai.com/api-keys>).
- Um **VPS** ou serviço que rode containers (para o Evolution API).
- **Node.js 20+** instalado localmente (só se for rodar `npm install` na sua
  máquina; a Vercel cuida disso em produção).
- Um número de WhatsApp dedicado para cada chatbot (um chip diferente por bot).

---

## Passo 1 — Provisionar o Supabase

1. Acesse <https://app.supabase.com> e clique em **New project**.
2. Escolha uma senha forte para o banco e selecione a região mais próxima.
3. Aguarde provisionar (leva 1–2 minutos).
4. No menu lateral, vá em **Settings → API** e anote:
   - **Project URL** → será o `SUPABASE_URL`
   - **anon public** → será o `SUPABASE_ANON_KEY`
   - **service_role** → será o `SUPABASE_SERVICE_ROLE` (⚠️ segredo — nunca commitar)

> Por padrão o Supabase exige confirmação de e-mail no signup. Se quiser
> desativar para testes, vá em **Authentication → Providers → Email** e
> desligue **Confirm email**.

---

## Passo 2 — Rodar o SQL do banco

1. No painel do Supabase, abra **SQL Editor**.
2. Clique em **New query**.
3. Copie **TODO** o conteúdo do arquivo [`db/schema.sql`](db/schema.sql) deste
   repositório e cole no editor.
4. Clique em **Run** (ou aperte `Ctrl+Enter`).

Você deverá ver `Success. No rows returned`. Esse script é **idempotente**
(usa `if not exists`), então pode ser executado novamente sem problema.

### O que esse SQL cria

| Tabela                       | Para quê                                              |
| ---------------------------- | ----------------------------------------------------- |
| `public.chatbots`            | Chatbots do usuário (um por linha)                    |
| `public.leads`               | Contatos que conversaram com cada chatbot             |
| `public.messages`            | Histórico de mensagens (user/assistant) por lead      |
| `public.api_keys`            | Hashes de API keys para integração externa (v1)       |
| `public.chatbot_integrations` | Google Sheets / Docs conectados ao chatbot via tools |

Também ativa **Row Level Security (RLS)** em todas, garantindo que cada usuário
só enxerga **seus próprios** registros.

---

## Passo 3 — Subir o Evolution API (WhatsApp)

O Evolution é uma API não oficial do WhatsApp usada para pareamento via QR
code. **Não pode rodar na Vercel.** Use uma das opções abaixo.

### Opção A — Docker num VPS

```bash
docker run -d \
  --name evolution \
  --restart unless-stopped \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY="UMA_CHAVE_GLOBAL_LONGA_E_ALEATORIA" \
  -e DATABASE_ENABLED=false \
  -e LOG_LEVEL=ERROR \
  atendai/evolution-api:latest
```

### Opção B — docker-compose (recomendado)

Siga a [documentação oficial](https://doc.evolution-api.com/v2/pt/install/docker).

### Exponha com HTTPS

Configure um proxy reverso (Caddy, Traefik, Nginx + Certbot) apontando um
domínio próprio (ex.: `https://evolution.seudominio.com`) para a porta 8080
do container. **HTTPS é obrigatório**, senão o Vercel não consegue disparar
webhooks.

### Anote

- **URL pública**: ex. `https://evolution.seudominio.com` → `EVOLUTION_BASE_URL`
- **Chave global**: o valor que você colocou em `AUTHENTICATION_API_KEY`
  → `EVOLUTION_GLOBAL_API_KEY` (⚠️ é a chave **global**, não a da instância)

---

## Passo 4 — Clonar e configurar o repositório

```bash
git clone https://github.com/webereaugusto/gerador-chatbot.git
cd gerador-chatbot
npm install
cp .env.example .env
```

Edite o `.env` criado:

```ini
PORT=3000

SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE=eyJhbGciOi...

# Gere uma string longa e aleatória (obrigatório p/ API v1 e gerar chaves).
# Pode ser algo como: openssl rand -hex 32
API_KEY_PEPPER=troque-por-uma-string-aleatoria-bem-longa

# Evolution API (VPS próprio)
EVOLUTION_BASE_URL=https://evolution.seudominio.com
EVOLUTION_GLOBAL_API_KEY=UMA_CHAVE_GLOBAL_LONGA_E_ALEATORIA
```

> **Como gerar um `API_KEY_PEPPER` forte:**
> - Linux/Mac: `openssl rand -hex 32`
> - Windows (PowerShell): `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})`

---

## Passo 5 — Rodar localmente (opcional)

Só para testar antes de publicar:

```bash
npm run dev
```

Abra <http://localhost:3000> no navegador. Você deve ver a tela de login.

> Para o WhatsApp funcionar localmente, o Evolution precisa conseguir bater no
> seu `localhost:3000` (use ngrok, Cloudflare Tunnel, etc. e aponte o webhook
> para a URL pública do túnel).

---

## Passo 6 — Publicar na Vercel

### 6.1 — Via dashboard (mais simples)

1. Acesse <https://vercel.com/new>.
2. **Import Git Repository** → escolha o fork/clone do repositório.
3. Em **Framework Preset** deixe **Other** (o `vercel.json` já configura tudo).
4. Em **Environment Variables**, adicione para **Production** (e Preview se
   quiser testar previews):

| Variável                   | Valor                                              |
| -------------------------- | -------------------------------------------------- |
| `SUPABASE_URL`             | URL do seu projeto Supabase                        |
| `SUPABASE_ANON_KEY`        | chave anon do Supabase                             |
| `SUPABASE_SERVICE_ROLE`    | chave service_role do Supabase (⚠️ segredo)        |
| `API_KEY_PEPPER`           | string longa e aleatória (mesma do `.env` local)   |
| `EVOLUTION_BASE_URL`       | URL pública do seu Evolution                       |
| `EVOLUTION_GLOBAL_API_KEY` | chave global do Evolution                          |

5. Clique em **Deploy**.

### 6.2 — Via CLI

```bash
npm i -g vercel
vercel login            # faça login na conta certa
vercel whoami           # confirme o usuário
vercel link             # escolha o time/conta correto
vercel env add          # adicione as vars uma a uma
vercel deploy --prod
```

### 6.3 — Importante: Deployment Protection

Se o projeto na Vercel tiver **Deployment Protection** ligado, o Evolution
**não conseguirá** chamar o webhook (vai receber um HTML de login e não o JSON
da API).

**Desative** em: **Project → Settings → Deployment Protection → Disabled**.

---

## Passo 7 — Criar conta + primeiro chatbot

1. Abra a URL da Vercel (`https://SEU-PROJETO.vercel.app`).
2. Clique em **Criar conta** → use o e-mail que deseja como admin.
3. Confirme o e-mail (se estiver habilitado no Supabase).
4. Faça login.
5. Clique em **Novo chatbot** e preencha:
   - **Nome** — apenas para você identificar.
   - **Chave da OpenAI** — `sk-...` gerada no painel da OpenAI.
   - **Modelo** — padrão `gpt-4o-mini` (ótimo custo/benefício).
   - **System prompt** — instruções em primeira pessoa ("Você é um atendente da
     loja X...").
   - **Base de conhecimento** — FAQ, catálogo resumido, tabelas. O agente usa
     como contexto.
6. Salve. Agora você verá o card do chatbot.

---

## Passo 8 — Conectar o WhatsApp (QR in-app)

> **Você NÃO precisa** configurar a Evolution manualmente — o backend faz
> tudo automaticamente.

1. No card do chatbot, clique em **Conectar WhatsApp**.
2. O backend cria uma instância na sua Evolution e exibe o QR code.
3. No celular que será dedicado a esse chatbot:
   - Abra **WhatsApp** → **Aparelhos conectados** → **Conectar um aparelho**.
   - Escaneie o QR.
4. O status no card vira **CONECTADO** em alguns segundos.
5. O backend também **captura automaticamente o número do chip** e preenche em
   `Compartilhar → WhatsApp do atendente` (usa o endpoint
   `/instance/fetchInstances` da Evolution e o evento `CONNECTION_UPDATE` do
   webhook).

### Filtro de teste (opcional — recomendado no início)

No formulário do chatbot, em **Configurar → WhatsApp**:

- Marque **Restringir respostas a um único número**.
- Informe o número em qualquer formato: `(19) 98194-0463`, `+55 19 98194-0463`,
  `5519981940463`.
- Agora só esse número consegue disparar a IA — mensagens de outros contatos
  são ignoradas (`200 { ignored: true }`), sem custo de OpenAI.

---

## Atualizações / migrações

Quando você fizer `git pull` de uma nova versão, verifique se o [`CHANGELOG`](#)
ou o `db/schema.sql` mudou. Como o schema é **idempotente**, basta abrir o
**SQL Editor** do Supabase e rodar o arquivo inteiro de novo — ele só aplica
o que ainda não existe.

### Colunas importantes adicionadas recentemente

Se você é de uma versão antiga, as colunas abaixo precisam existir
(já estão no `db/schema.sql`):

```sql
alter table public.chatbots
  add column if not exists whatsapp_test_filter_enabled boolean not null default false;
alter table public.chatbots
  add column if not exists whatsapp_test_phone text not null default '';
alter table public.chatbots
  add column if not exists whatsapp_connection_status text not null default 'disconnected';
alter table public.chatbots
  add column if not exists whatsapp_connected_at timestamptz;
alter table public.chatbots
  add column if not exists openai_model text not null default 'gpt-4o-mini';
alter table public.chatbots
  add column if not exists temperature numeric not null default 0.6;
alter table public.chatbots
  add column if not exists max_tokens integer not null default 400;
alter table public.chatbots
  add column if not exists humanize_enabled boolean not null default true;
alter table public.chatbots
  add column if not exists whatsapp_share_phone text not null default '';

alter table public.leads
  add column if not exists source text not null default 'whatsapp';
alter table public.leads
  add column if not exists human_takeover boolean not null default false;
```

E as tabelas `public.api_keys` e `public.chatbot_integrations`, com suas
políticas RLS (veja `db/schema.sql`).

---

## Solução de problemas

### ❌ "Servidor sem configuração do Supabase" ao carregar o painel

Falta `SUPABASE_URL`, `SUPABASE_ANON_KEY` ou `SUPABASE_SERVICE_ROLE` nas
Environment Variables da Vercel. Adicione e **redeploy**.

### ❌ "Falha ao iniciar conexão" ao clicar em Conectar WhatsApp

- Verifique `EVOLUTION_BASE_URL` e `EVOLUTION_GLOBAL_API_KEY`.
- Teste manualmente: `curl https://SEU-EVOLUTION/instance/fetchInstances -H "apikey: SUA_CHAVE_GLOBAL"` deve retornar `[]` ou uma lista.
- Se for 401/403, a chave está errada. Se for timeout, o host não está
  acessível publicamente.

### ❌ QR code não aparece ou dá erro no celular

- A Evolution precisa estar acessível via **HTTPS** com certificado válido.
- Confirme no log da Vercel: deve aparecer `[EVO qr] instance=bot_XXXX hasQr=true`.
- Se o QR expirar, feche o modal e clique em **Gerar novo QR**.

### ❌ WhatsApp conecta mas não responde a mensagens

- Verifique se **Deployment Protection** está desativado na Vercel.
- Confirme se o webhook está configurado: na UI da Evolution, a instância
  `bot_XXXX` deve ter webhook para `https://SEU-PROJETO.vercel.app/webhook/evolution/UUID_DO_BOT`.
- Cheque os logs da Vercel por `[WEBHOOK]` para ver se o evento chegou.

### ❌ O número do WhatsApp some do "Compartilhar" após editar o chatbot

Corrigido na versão mais recente. Atualize o repositório (`git pull`) e redeploy.

### ❌ Erro ao gerar API key / usar API v1

Faltou `API_KEY_PEPPER` nas Environment Variables. Adicione (use uma string
longa e aleatória) e redeploy. A chave **não precisa ser a mesma** do `.env`
local, mas tem que existir.

### ❌ Emails de confirmação não chegam

- No Supabase, **Authentication → Providers → Email**, você pode desativar
  **Confirm email** para testes.
- Ou configure um **SMTP** próprio em **Authentication → Email Templates**.

---

## Próximos passos

Depois de instalar, explore:

- **Compartilhar** — gera link `wa.me` e snippet de botão flutuante para
  qualquer site.
- **Widget** — chat embutido para o seu site (sem WhatsApp).
- **Leads** — inbox com todas as conversas. Ative o **Modo humano** para
  assumir manualmente um atendimento.
- **Integrações Google** — conecte uma planilha/doc público e o agente consulta
  automaticamente via tool calling.
- **API v1** — leia os dados por fora (CRM, n8n, outros sistemas). Gere uma
  chave em **API** no menu lateral e veja `/api-manual.html`.

---

Qualquer dúvida, abra uma issue no repositório.
