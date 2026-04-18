-- ============================================================
-- Schema do Gerador de Chatbot
-- Rode uma vez no SQL Editor do Supabase do seu projeto.
-- ============================================================

create extension if not exists "pgcrypto";

-- -----------------------------
-- Tabela: chatbots
-- -----------------------------
create table if not exists public.chatbots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  openai_api_key text not null default '',
  evolution_base_url text not null default '',
  evolution_api_key text not null default '',
  evolution_instance text not null default '',
  system_prompt text not null default '',
  knowledge_base text not null default '',
  whatsapp_test_filter_enabled boolean not null default false,
  whatsapp_test_phone text not null default '',
  whatsapp_connection_status text not null default 'disconnected',
  whatsapp_connected_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists chatbots_user_id_idx
  on public.chatbots(user_id);

-- migracao idempotente (projetos antigos sem as colunas de filtro de teste)
alter table public.chatbots
  add column if not exists whatsapp_test_filter_enabled boolean not null default false;
alter table public.chatbots
  add column if not exists whatsapp_test_phone text not null default '';

-- migracao idempotente (conexao gerenciada do WhatsApp)
alter table public.chatbots
  add column if not exists whatsapp_connection_status text not null default 'disconnected';
alter table public.chatbots
  add column if not exists whatsapp_connected_at timestamptz;

-- -----------------------------
-- Tabela: leads
-- -----------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  phone text not null,
  name text,
  source text not null default 'whatsapp',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (chatbot_id, phone)
);

-- migracao idempotente (caso tabela ja exista sem a coluna source)
alter table public.leads
  add column if not exists source text not null default 'whatsapp';

create index if not exists leads_chatbot_id_idx
  on public.leads(chatbot_id);

create index if not exists leads_last_message_idx
  on public.leads(last_message_at desc);

-- -----------------------------
-- Tabela: messages
-- -----------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_lead_id_idx
  on public.messages(lead_id, created_at);

-- -----------------------------
-- Tabela: api_keys (integrações externas — somente hash da chave)
-- -----------------------------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Integração',
  key_hash text not null unique,
  key_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_user_id_idx
  on public.api_keys(user_id);

-- -----------------------------
-- Row Level Security
-- -----------------------------
alter table public.chatbots enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.api_keys enable row level security;

-- Chatbots: o usuario so ve/gere os proprios
drop policy if exists "chatbots_select_own" on public.chatbots;
create policy "chatbots_select_own"
  on public.chatbots for select
  using (auth.uid() = user_id);

drop policy if exists "chatbots_insert_own" on public.chatbots;
create policy "chatbots_insert_own"
  on public.chatbots for insert
  with check (auth.uid() = user_id);

drop policy if exists "chatbots_update_own" on public.chatbots;
create policy "chatbots_update_own"
  on public.chatbots for update
  using (auth.uid() = user_id);

drop policy if exists "chatbots_delete_own" on public.chatbots;
create policy "chatbots_delete_own"
  on public.chatbots for delete
  using (auth.uid() = user_id);

-- Leads: visiveis so via chatbots do usuario
drop policy if exists "leads_select_own" on public.leads;
create policy "leads_select_own"
  on public.leads for select
  using (
    exists (
      select 1 from public.chatbots c
      where c.id = leads.chatbot_id
        and c.user_id = auth.uid()
    )
  );

-- Messages: visiveis so via leads do usuario
drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own"
  on public.messages for select
  using (
    exists (
      select 1 from public.leads l
      join public.chatbots c on c.id = l.chatbot_id
      where l.id = messages.lead_id
        and c.user_id = auth.uid()
    )
  );

-- API keys: só o dono
drop policy if exists "api_keys_select_own" on public.api_keys;
create policy "api_keys_select_own"
  on public.api_keys for select
  using (auth.uid() = user_id);

drop policy if exists "api_keys_insert_own" on public.api_keys;
create policy "api_keys_insert_own"
  on public.api_keys for insert
  with check (auth.uid() = user_id);

drop policy if exists "api_keys_update_own" on public.api_keys;
create policy "api_keys_update_own"
  on public.api_keys for update
  using (auth.uid() = user_id);

drop policy if exists "api_keys_delete_own" on public.api_keys;
create policy "api_keys_delete_own"
  on public.api_keys for delete
  using (auth.uid() = user_id);

-- Projetos antigos: se a tabela api_keys ainda nao existir, rode apenas o bloco
-- "Tabela: api_keys" e as politicas "API keys" acima no SQL Editor.
