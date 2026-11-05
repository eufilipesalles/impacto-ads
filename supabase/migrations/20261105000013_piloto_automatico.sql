-- Impacto Ads — piloto automático (fase 1) e biblioteca de materiais (Google Drive)

-- ---------- Conjuntos de anúncios (orçamento pode estar no conjunto em vez da campanha) ----------
create table if not exists public.adsets (
  id                text primary key,
  ad_account_id     text not null references public.ad_accounts(id) on delete cascade,
  campaign_id       text,
  name              text,
  status            text,
  effective_status  text,
  daily_budget      numeric(12,2),
  lifetime_budget   numeric(12,2),
  optimization_goal text,
  updated_at        timestamptz not null default now()
);
create index if not exists adsets_campaign_idx on public.adsets (campaign_id);
alter table public.adsets enable row level security;
create policy "equipe_le_adsets" on public.adsets for select to authenticated using ((select public.is_team_member()));

-- ---------- Configuração do piloto por cliente ----------
-- level 0 = só sugere; 1 = executa sozinho o que protege a verba, o resto pede aprovação;
-- 2 = executa também aumentos de orçamento, sempre dentro do teto mensal
create table if not exists public.autopilot_settings (
  client_id        uuid primary key references public.clients(id) on delete cascade,
  level            int not null default 0 check (level between 0 and 2),
  target_cost      numeric(12,2),        -- meta de custo por resultado (vazio = média do próprio cliente)
  monthly_cap      numeric(12,2),        -- teto de gasto no mês (vazio = verba mensal do cliente)
  max_increase_pct int not null default 20 check (max_increase_pct between 5 and 30),
  updated_at       timestamptz not null default now(),
  updated_by       text
);
alter table public.autopilot_settings enable row level security;
create policy "equipe_le_autopilot_settings" on public.autopilot_settings for select to authenticated using ((select public.is_team_member()));
create policy "equipe_insere_autopilot_settings" on public.autopilot_settings for insert to authenticated with check ((select public.is_team_member()));
create policy "equipe_edita_autopilot_settings" on public.autopilot_settings for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- ---------- Botão geral "parar tudo" ----------
create table if not exists public.autopilot_global (
  id        int primary key default 1 check (id = 1),
  paused    boolean not null default false,
  paused_at timestamptz,
  paused_by text
);
insert into public.autopilot_global (id) values (1) on conflict do nothing;
alter table public.autopilot_global enable row level security;
create policy "equipe_le_autopilot_global" on public.autopilot_global for select to authenticated using ((select public.is_team_member()));

-- ---------- Fila de ações (proposta → aprovada → executada / desfeita) ----------
create table if not exists public.autopilot_actions (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  ad_account_id text references public.ad_accounts(id) on delete cascade,
  rule          text not null,            -- pause_no_result | pause_expensive | scale_up | scale_down | monthly_cap | create_ad | manual
  kind          text not null check (kind in ('pause','activate','set_budget','create_ad')),
  protective    boolean not null default false,   -- reduz gasto / protege a verba
  object_type   text check (object_type in ('campaign','adset','ad')),
  object_id     text,
  object_name   text,
  campaign_name text,
  title         text not null,
  reason        text not null,
  evidence      jsonb,                    -- números que justificam a ação
  params        jsonb not null default '{}'::jsonb,
  previous      jsonb,                    -- estado antes de executar (para desfazer)
  result        jsonb,
  status        text not null default 'proposed'
                check (status in ('proposed','approved','executing','done','failed','rejected','expired','undone')),
  auto          boolean not null default false,   -- executada sem aprovação humana
  error         text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    text,
  executed_at   timestamptz,
  undone_at     timestamptz,
  undone_by     text
);
create index if not exists autopilot_actions_status_idx on public.autopilot_actions (status, created_at desc);
create index if not exists autopilot_actions_object_idx on public.autopilot_actions (object_id, created_at desc);
alter table public.autopilot_actions enable row level security;
create policy "equipe_le_autopilot_actions" on public.autopilot_actions for select to authenticated using ((select public.is_team_member()));

-- ---------- Google Drive ----------
alter table public.clients add column if not exists drive_folder_id text;

-- Conexão da conta Google (só o servidor lê: sem política para usuários)
create table if not exists public.google_connection (
  id             int primary key default 1 check (id = 1),
  email          text,
  refresh_token  text,
  root_folder_id text,
  connected_at   timestamptz,
  connected_by   text
);
alter table public.google_connection enable row level security;

create table if not exists public.oauth_states (
  state      text primary key,
  email      text,
  return_to  text,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;

-- Materiais encontrados nas pastas do Drive de cada cliente
create table if not exists public.creative_assets (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  drive_file_id     text not null unique,
  name              text not null,
  mime_type         text,
  kind              text check (kind in ('image','video')),
  size_bytes        bigint,
  width             int,
  height            int,
  duration_ms       bigint,
  thumbnail_url     text,
  web_view_link     text,
  folder_name       text,
  drive_modified_at timestamptz,
  meta              jsonb not null default '{}'::jsonb,   -- { "act_123": { "image_hash": "...", "video_id": "...", "sent_at": "..." } }
  removed           boolean not null default false,       -- saiu da pasta do Drive
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists creative_assets_client_idx on public.creative_assets (client_id, drive_modified_at desc);
alter table public.creative_assets enable row level security;
create policy "equipe_le_creative_assets" on public.creative_assets for select to authenticated using ((select public.is_team_member()));

-- Miniaturas dos materiais (públicas, só imagens reduzidas)
insert into storage.buckets (id, name, public) values ('creative-thumbs', 'creative-thumbs', true)
on conflict (id) do nothing;

-- ---------- Execução diária: depois da coleta das 06h e da do meio-dia (horário de Brasília) ----------
select cron.schedule('autopilot', '15 10 * * *', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/autopilot',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"action": "evaluate"}'::jsonb,
    timeout_milliseconds := 150000);
$job$);

-- À tarde: só ações de proteção (pausar o que está queimando verba); aumento de orçamento só de manhã
select cron.schedule('autopilot-tarde', '30 15 * * *', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/autopilot',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"action": "evaluate", "protective_only": true}'::jsonb,
    timeout_milliseconds := 150000);
$job$);
