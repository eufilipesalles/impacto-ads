-- Impacto Ads — estratégia: raio-x (posicionamento, região, público, horário), perfil de campanha e lançamento

-- Desempenho dos últimos 30 dias por recorte, por campanha (atualizado todo dia)
create table if not exists public.insights_breakdown (
  ad_account_id  text not null references public.ad_accounts(id) on delete cascade,
  campaign_id    text not null,
  dim            text not null check (dim in ('placement','age_gender','hour','adset','region')),
  key            text not null,
  label          text,
  extra          jsonb,                 -- ex.: cidades e raio do conjunto
  spend          numeric(12,2) not null default 0,
  impressions    bigint not null default 0,
  reach          bigint not null default 0,
  link_clicks    bigint not null default 0,
  conversations  int not null default 0,
  leads          int not null default 0,
  purchases      int not null default 0,
  purchase_value numeric(12,2) not null default 0,
  since          date,
  until          date,
  updated_at     timestamptz not null default now(),
  primary key (ad_account_id, campaign_id, dim, key)
);
alter table public.insights_breakdown enable row level security;
create policy "equipe_le_insights_breakdown" on public.insights_breakdown for select to authenticated using ((select public.is_team_member()));

-- Perfil de campanha do cliente: onde e para quem anunciar
create table if not exists public.client_strategy (
  client_id          uuid primary key references public.clients(id) on delete cascade,
  regions            jsonb not null default '[]'::jsonb,   -- [{ key, name, region, radius_km }]
  age_min            int check (age_min between 18 and 65),
  age_max            int check (age_max between 18 and 65),
  genders            int[],                                -- vazio = todos; 1 = homens; 2 = mulheres
  daily_budget       numeric(12,2),
  placements_mode    text not null default 'winners' check (placements_mode in ('winners','advantage','source')),
  source_campaign_id text,                                 -- campanha-modelo (vazio = a melhor dos últimos 30 dias)
  notes              text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);
alter table public.client_strategy enable row level security;
create policy "equipe_le_client_strategy" on public.client_strategy for select to authenticated using ((select public.is_team_member()));
create policy "equipe_insere_client_strategy" on public.client_strategy for insert to authenticated with check ((select public.is_team_member()));
create policy "equipe_edita_client_strategy" on public.client_strategy for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- Análises estratégicas geradas (IA), para consultar depois e ir para o relatório
create table if not exists public.strategy_reports (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  since       date not null,
  until       date not null,
  analysis    jsonb not null,
  model       text,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists strategy_reports_client_idx on public.strategy_reports (client_id, created_at desc);
alter table public.strategy_reports enable row level security;
create policy "equipe_le_strategy_reports" on public.strategy_reports for select to authenticated using ((select public.is_team_member()));

-- Novo tipo de ação do piloto: lançar campanha
alter table public.autopilot_actions drop constraint if exists autopilot_actions_kind_check;
alter table public.autopilot_actions add constraint autopilot_actions_kind_check
  check (kind in ('pause','activate','set_budget','create_ad','launch_campaign'));

-- Raio-x atualizado todo dia depois da coleta da manhã
select cron.schedule('strategy-collect', '45 9 * * *', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/strategy',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"action": "collect"}'::jsonb,
    timeout_milliseconds := 300000);
$job$);
