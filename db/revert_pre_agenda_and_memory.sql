-- ============================================================
-- Reversão: estado alinhado ao commit pre-agenda (76a9902)
-- Rode no SQL Editor do Supabase SE você já tinha aplicado:
--   - tabelas do módulo de agendamento (scheduling_*), ou
--   - colunas de memória conversacional (memory_*, conversation_summary, etc.)
--
-- Idempotente: usa IF EXISTS / IF EXISTS em colunas quando suportado.
-- PostgreSQL 9.x+: drop column if exists
-- ============================================================

-- -----------------------------
-- 1) Módulo de agendamento (se existir)
-- Ordem: dependentes primeiro
-- -----------------------------
drop table if exists public.scheduling_appointments cascade;
drop table if exists public.scheduling_availability_exceptions cascade;
drop table if exists public.scheduling_availability_rules cascade;
drop table if exists public.scheduling_professional_services cascade;
drop table if exists public.scheduling_services cascade;
drop table if exists public.scheduling_professionals cascade;

-- -----------------------------
-- 2) Índice e colunas extras em messages (memória / marcação)
-- -----------------------------
drop index if exists public.messages_important_idx;

alter table public.messages
  drop column if exists important;
alter table public.messages
  drop column if exists meta;

-- -----------------------------
-- 3) Colunas extras em leads (memória)
-- -----------------------------
alter table public.leads
  drop column if exists conversation_summary;
alter table public.leads
  drop column if exists lead_memory;
alter table public.leads
  drop column if exists memory_metrics;
alter table public.leads
  drop column if exists memory_updated_at;

-- -----------------------------
-- 4) Colunas extras em chatbots (memória)
-- -----------------------------
alter table public.chatbots
  drop column if exists memory_summary_enabled;
alter table public.chatbots
  drop column if exists memory_structured_enabled;
alter table public.chatbots
  drop column if exists context_window_messages;
alter table public.chatbots
  drop column if exists context_window_chars;
alter table public.chatbots
  drop column if exists message_retention_days;
alter table public.chatbots
  drop column if exists memory_audit_enabled;

-- Pronto. O arquivo db/schema.sql na branch pre-agenda é a fonte da verdade
-- para novas instalações; este script apenas remove vestígios no banco legado.
