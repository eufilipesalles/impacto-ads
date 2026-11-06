-- Gerenciador de anúncios, criativos sem Drive (upload direto e link do Instagram) e relatórios automáticos

-- ---------- Biblioteca de criativos: novas origens ----------
alter table public.creative_assets alter column drive_file_id drop not null;
alter table public.creative_assets
  add column if not exists source       text not null default 'drive' check (source in ('drive','upload','instagram')),
  add column if not exists storage_path text,
  add column if not exists ig_media_id  text,
  add column if not exists ig_user_id   text,
  add column if not exists caption      text,
  add column if not exists created_by   text,
  add column if not exists used_at      timestamptz;          -- primeira vez que virou anúncio
create index if not exists creative_assets_ig_idx on public.creative_assets (client_id, ig_media_id);

-- Arquivos enviados pelo painel (privado: o Meta baixa por link temporário)
insert into storage.buckets (id, name, public, file_size_limit)
values ('creative-uploads', 'creative-uploads', false, 52428800)
on conflict (id) do nothing;

create policy "equipe_envia_criativos" on storage.objects for insert to authenticated
  with check (bucket_id in ('creative-uploads','creative-thumbs') and (select public.is_team_member()));
create policy "equipe_le_criativos" on storage.objects for select to authenticated
  using (bucket_id = 'creative-uploads' and (select public.is_team_member()));

-- ---------- Ações manuais pelo gerenciador ----------
-- (as ações do gerenciador usam a mesma tabela do piloto: ficam no histórico e podem ser desfeitas)

-- ---------- Números do gerenciador ----------
create or replace function public.manager_stats(p_client uuid, p_since date, p_until date)
returns table (level text, object_id text, spend numeric, impressions bigint, link_clicks bigint,
               conversations bigint, leads bigint, purchases bigint, purchase_value numeric, days_with_spend bigint)
language sql stable security invoker set search_path = public as $$
  select i.level, i.object_id, sum(i.spend), sum(i.impressions)::bigint, sum(i.link_clicks)::bigint,
         sum(i.conversations)::bigint, sum(i.leads)::bigint, sum(i.purchases)::bigint, sum(i.purchase_value),
         count(*) filter (where i.spend > 0)
  from insights_daily i
  join ad_accounts a on a.id = i.ad_account_id
  where a.client_id = p_client and i.level in ('campaign','ad') and i.date between p_since and p_until
  group by i.level, i.object_id
$$;
grant execute on function public.manager_stats(uuid, date, date) to authenticated;

-- ---------- Relatórios automáticos ----------
create table if not exists public.client_reports (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  kind       text not null check (kind in ('weekly','monthly')),
  since      date not null,
  until      date not null,
  text       text,                       -- texto pronto para o grupo do WhatsApp
  internal   jsonb not null default '[]'::jsonb,  -- críticas e alertas só para a equipe
  data       jsonb not null default '{}'::jsonb,  -- números usados (e base dos slides mensais)
  created_at timestamptz not null default now(),
  created_by text,
  sent_at    timestamptz,
  sent_by    text,
  unique (client_id, kind, since, until)
);
create index if not exists client_reports_recent_idx on public.client_reports (kind, created_at desc);
alter table public.client_reports enable row level security;
create policy "equipe_le_client_reports" on public.client_reports for select to authenticated using ((select public.is_team_member()));
create policy "equipe_marca_enviado" on public.client_reports for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- Semanal: toda segunda às 08h20 (Brasília), depois da coleta das 06h
select cron.schedule('relatorio-semanal', '20 11 * * 1', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/strategy',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"action": "weekly_reports"}'::jsonb,
    timeout_milliseconds := 300000);
$job$);

-- Mensal: dia 1 às 08h40 (Brasília), referente ao mês anterior
select cron.schedule('relatorio-mensal', '40 11 1 * *', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/strategy',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"action": "monthly_reports"}'::jsonb,
    timeout_milliseconds := 300000);
$job$);

-- Criativo deixado para o piloto: entra no melhor conjunto na próxima rodada (Autônomo) ou vira proposta
alter table public.creative_assets
  add column if not exists auto_place         boolean not null default false,
  add column if not exists target_campaign_id text;
