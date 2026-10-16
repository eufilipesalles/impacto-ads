-- Impacto Ads — acesso restrito à equipe + consultas do painel

-- ============ EQUIPE ============
create table public.team_members (
  email      text primary key check (email = lower(email)),
  name       text,
  created_at timestamptz not null default now()
);
alter table public.team_members enable row level security;

insert into public.team_members (email, name) values
  ('eufilipesalles.contato@gmail.com', 'Filipe'),
  ('filiperscoproducao@gmail.com',     'Filipe')
on conflict do nothing;

create or replace function public.is_team_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members
                 where email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_team_member() from public, anon;
grant execute on function public.is_team_member() to authenticated, service_role;

create policy "equipe_le_team" on public.team_members for select to authenticated
  using ((select public.is_team_member()));

-- Troca "qualquer usuário logado" por "membro da equipe" em todas as políticas
do $$
declare t text;
begin
  foreach t in array array['clients','ad_accounts','campaigns','ads','insights_daily','alert_rules','alerts','sync_runs']
  loop
    execute format('alter policy "equipe_le_%1$s" on public.%1$I using ((select public.is_team_member()))', t);
  end loop;
end $$;

alter policy "equipe_edita_clients"   on public.clients     using ((select public.is_team_member())) with check ((select public.is_team_member()));
alter policy "equipe_edita_accounts"  on public.ad_accounts with check ((select public.is_team_member()));
alter policy "equipe_edita_rules"     on public.alert_rules using ((select public.is_team_member())) with check ((select public.is_team_member()));
alter policy "equipe_atualiza_alerts" on public.alerts      using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- ============ CONSULTAS DO PAINEL ============
-- Série diária de um cliente (todas as contas somadas)
create or replace function public.client_daily(p_client uuid, p_days int default 30)
returns table (date date, spend numeric, conversations bigint, impressions bigint, link_clicks bigint, reach bigint)
language sql stable security invoker set search_path = '' as $$
  select g.d::date,
         coalesce(sum(i.spend),0), coalesce(sum(i.conversations),0)::bigint,
         coalesce(sum(i.impressions),0)::bigint, coalesce(sum(i.link_clicks),0)::bigint,
         coalesce(sum(i.reach),0)::bigint
  from generate_series(public.ref_date() - (p_days - 1), public.ref_date(), interval '1 day') g(d)
  left join public.ad_accounts a on a.client_id = p_client
  left join public.insights_daily i on i.level = 'account' and i.object_id = a.id and i.date = g.d::date
  group by g.d order by g.d
$$;

-- Campanhas de um cliente no período
create or replace function public.campaign_stats(p_client uuid, p_days int default 7)
returns table (campaign_id text, name text, objective text, effective_status text, daily_budget numeric,
               spend numeric, conversations bigint, impressions bigint, link_clicks bigint,
               cost_per_conversation numeric, ctr numeric, cpm numeric)
language sql stable security invoker set search_path = '' as $$
  select cp.id, cp.name, cp.objective, cp.effective_status, cp.daily_budget,
         coalesce(sum(i.spend),0) spend,
         coalesce(sum(i.conversations),0)::bigint conv,
         coalesce(sum(i.impressions),0)::bigint imp,
         coalesce(sum(i.link_clicks),0)::bigint lc,
         case when sum(i.conversations) > 0 then round(sum(i.spend)/sum(i.conversations),2) end,
         case when sum(i.impressions) > 0 then round(sum(i.link_clicks)::numeric/sum(i.impressions)*100,2) end,
         case when sum(i.impressions) > 0 then round(sum(i.spend)/sum(i.impressions)*1000,2) end
  from public.campaigns cp
  join public.ad_accounts a on a.id = cp.ad_account_id and a.client_id = p_client
  left join public.insights_daily i on i.level = 'campaign' and i.object_id = cp.id
        and i.date between public.ref_date() - (p_days - 1) and public.ref_date()
  group by cp.id
  having coalesce(sum(i.spend),0) > 0 or cp.effective_status = 'ACTIVE'
  order by spend desc
$$;

-- Criativos (anúncios) de um cliente no período
create or replace function public.ad_stats(p_client uuid, p_days int default 7)
returns table (ad_id text, name text, campaign_name text, effective_status text, thumbnail_url text,
               spend numeric, conversations bigint, impressions bigint, link_clicks bigint,
               cost_per_conversation numeric, ctr numeric)
language sql stable security invoker set search_path = '' as $$
  select ad.id, ad.name, cp.name, ad.effective_status, ad.thumbnail_url,
         sum(i.spend), sum(i.conversations)::bigint, sum(i.impressions)::bigint, sum(i.link_clicks)::bigint,
         case when sum(i.conversations) > 0 then round(sum(i.spend)/sum(i.conversations),2) end,
         case when sum(i.impressions) > 0 then round(sum(i.link_clicks)::numeric/sum(i.impressions)*100,2) end
  from public.insights_daily i
  join public.ad_accounts a on a.id = i.ad_account_id and a.client_id = p_client
  left join public.ads ad on ad.id = i.object_id
  left join public.campaigns cp on cp.id = coalesce(ad.campaign_id, i.campaign_id)
  where i.level = 'ad' and i.date between public.ref_date() - (p_days - 1) and public.ref_date()
  group by ad.id, ad.name, cp.name, ad.effective_status, ad.thumbnail_url, i.object_id
  having sum(i.spend) > 0
  order by sum(i.spend) desc
$$;

-- Totais da carteira no período (para os números do topo)
create or replace function public.portfolio_daily(p_days int default 30)
returns table (date date, spend numeric, conversations bigint)
language sql stable security invoker set search_path = '' as $$
  select g.d::date, coalesce(sum(i.spend),0), coalesce(sum(i.conversations),0)::bigint
  from generate_series(public.ref_date() - (p_days - 1), public.ref_date(), interval '1 day') g(d)
  left join public.insights_daily i on i.level = 'account' and i.date = g.d::date
  left join public.ad_accounts a on a.id = i.object_id
  left join public.clients c on c.id = a.client_id
  where c.active is distinct from false
  group by g.d order by g.d
$$;

grant execute on function public.client_daily(uuid,int), public.campaign_stats(uuid,int),
                          public.ad_stats(uuid,int), public.portfolio_daily(int) to authenticated;
revoke execute on function public.client_daily(uuid,int), public.campaign_stats(uuid,int),
                           public.ad_stats(uuid,int), public.portfolio_daily(int) from public, anon;
