-- Impacto Ads — schema inicial (Fase 1: coleta + alertas)



-- ============ CLIENTES E CONTAS ============
create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  objective       text not null default 'a_definir'
                  check (objective in ('a_definir','conversas_whatsapp','reconhecimento','trafego','vendas','leads','misto')),
  monthly_budget  numeric(12,2),                 -- verba mensal combinada (R$)
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.ad_accounts (
  id                 text primary key check (id ~ '^act_[0-9]+$'),   -- act_123...
  client_id          uuid not null references public.clients(id) on delete cascade,
  name               text,
  currency           text,
  timezone_name      text,
  account_status     int,          -- 1=ativa, 2=desativada, 3=pendente pagamento, 7/8/9=revisão/fechamento...
  disable_reason     int,
  amount_spent       numeric(14,2),  -- total histórico (moeda da conta)
  spend_cap          numeric(14,2),  -- limite de gastos da conta (0/null = sem limite)
  balance            numeric(14,2),
  funding_display    text,           -- texto da forma de pagamento retornado pelo Meta
  freq_7d            numeric(8,2),   -- frequência agregada dos últimos 7 dias
  reach_7d           bigint,
  last_synced_at     timestamptz,
  last_sync_error    text,
  created_at         timestamptz not null default now()
);
create index on public.ad_accounts(client_id);

-- ============ ESTRUTURA DE CAMPANHAS ============
create table public.campaigns (
  id               text primary key,
  ad_account_id    text not null references public.ad_accounts(id) on delete cascade,
  name             text,
  objective        text,
  status           text,
  effective_status text,
  daily_budget     numeric(12,2),
  lifetime_budget  numeric(12,2),
  updated_at       timestamptz not null default now()
);
create index on public.campaigns(ad_account_id);

create table public.ads (
  id               text primary key,
  ad_account_id    text not null references public.ad_accounts(id) on delete cascade,
  campaign_id      text,
  adset_id         text,
  name             text,
  status           text,
  effective_status text,
  issues           jsonb,          -- issues_info / ad_review_feedback
  thumbnail_url    text,
  updated_at       timestamptz not null default now()
);
create index on public.ads(ad_account_id);
create index on public.ads(effective_status);

-- ============ MÉTRICAS DIÁRIAS ============
create table public.insights_daily (
  level            text not null check (level in ('account','campaign','ad')),
  object_id        text not null,       -- act_..., id da campanha ou do anúncio
  ad_account_id    text not null references public.ad_accounts(id) on delete cascade,
  campaign_id      text,
  date             date not null,
  spend            numeric(12,2) not null default 0,
  impressions      bigint not null default 0,
  reach            bigint not null default 0,
  clicks           bigint not null default 0,
  link_clicks      bigint not null default 0,
  conversations    int not null default 0,   -- conversas iniciadas (mensagens)
  leads            int not null default 0,
  video_views      bigint not null default 0,
  actions          jsonb,                    -- payload bruto de actions p/ análises futuras
  synced_at        timestamptz not null default now(),
  primary key (level, object_id, date)
);
create index on public.insights_daily(ad_account_id, date);
create index on public.insights_daily(level, date);

-- ============ ALERTAS ============
create table public.alert_rules (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients(id) on delete cascade,   -- null = regra global
  type         text not null check (type in (
                 'cost_per_conversation',  -- custo por conversa acima do teto (janela window_days)
                 'frequency',              -- frequência 7d acima do limite
                 'budget_pace',            -- gasto do mês acima do ritmo previsto (threshold = % tolerância)
                 'no_delivery',            -- campanha ativa sem gasto ontem
                 'account_status',         -- conta com problema (desativada, pagamento pendente...)
                 'ad_disapproved',         -- anúncio reprovado / com problema
                 'spend_cap'               -- limite de gastos da conta perto do fim (threshold = R$ restante)
               )),
  threshold    numeric(12,2),
  window_days  int not null default 3,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  unique nulls not distinct (client_id, type)
);

create table public.alerts (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid references public.alert_rules(id) on delete set null,
  client_id     uuid not null references public.clients(id) on delete cascade,
  ad_account_id text references public.ad_accounts(id) on delete cascade,
  type          text not null,
  severity      text not null default 'warning' check (severity in ('info','warning','critical')),
  dedupe_key    text not null,            -- evita repetir o mesmo alerta enquanto estiver aberto
  title         text not null,
  details       jsonb,
  status        text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  notified_at   timestamptz
);
create unique index alerts_open_dedupe on public.alerts(dedupe_key) where status <> 'resolved';
create index on public.alerts(client_id, status);
create index on public.alerts(rule_id);
create index on public.alerts(ad_account_id);

-- ============ LOG DE SINCRONIZAÇÃO ============
create table public.sync_runs (
  id            bigserial primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  trigger       text,                    -- cron | manual
  accounts_ok   int default 0,
  accounts_err  int default 0,
  errors        jsonb
);

-- ============ updated_at ============
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- ============ RLS ============
-- Sistema interno: só usuários autenticados da equipe Impacto acessam.
-- A Edge Function usa a service role e ignora RLS.
do $$
declare t text;
begin
  foreach t in array array['clients','ad_accounts','campaigns','ads','insights_daily','alert_rules','alerts','sync_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "equipe_le_%1$s" on public.%1$I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Equipe pode editar cadastro de clientes, regras e status dos alertas pelo painel
create policy "equipe_edita_clients"  on public.clients     for all    to authenticated using (true) with check (true);
create policy "equipe_edita_accounts" on public.ad_accounts for insert to authenticated with check (true);
create policy "equipe_edita_rules"    on public.alert_rules for all    to authenticated using (true) with check (true);
create policy "equipe_atualiza_alerts" on public.alerts     for update to authenticated using (true) with check (true);
