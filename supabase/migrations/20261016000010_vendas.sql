-- Impacto Ads — vendas (compras registradas pelo pixel/Meta)
-- "Compras" = coluna Compras do Gerenciador (omni_purchase); "faturamento" = valor de conversão das compras.

alter table public.insights_daily
  add column if not exists purchases      int not null default 0,
  add column if not exists purchase_value numeric(14,2) not null default 0,
  add column if not exists add_to_cart    int not null default 0,
  add column if not exists checkouts      int not null default 0,
  add column if not exists action_values  jsonb;

-- Recarrega todas as contas (90 dias) na próxima coleta para preencher as novas colunas
update public.ad_accounts set history_loaded_at = null where history_loaded_at is not null;

-- Visão geral: novas colunas no fim (as antigas não mudam)
create or replace view public.client_overview
with (security_invoker = true) as
with d as (select public.ref_date() d, date_trunc('month', public.ref_date())::date m0),
agg as (
  select a.client_id,
    sum(i.spend)         filter (where i.date = d.d)                         spend_yesterday,
    sum(i.spend)         filter (where i.date > d.d - 7)                     spend_7d,
    sum(i.conversations) filter (where i.date > d.d - 7)                     conv_7d,
    sum(i.spend)         filter (where i.date > d.d - 14 and i.date <= d.d - 7) spend_prev_7d,
    sum(i.conversations) filter (where i.date > d.d - 14 and i.date <= d.d - 7) conv_prev_7d,
    sum(i.impressions)   filter (where i.date > d.d - 7)                     impressions_7d,
    sum(i.link_clicks)   filter (where i.date > d.d - 7)                     link_clicks_7d,
    sum(i.spend)         filter (where i.date >= d.m0)                       spend_month,
    sum(i.purchases)     filter (where i.date > d.d - 7)                     purchases_7d,
    sum(i.purchase_value) filter (where i.date > d.d - 7)                    revenue_7d,
    sum(i.purchases)     filter (where i.date > d.d - 14 and i.date <= d.d - 7) purchases_prev_7d,
    sum(i.purchase_value) filter (where i.date > d.d - 14 and i.date <= d.d - 7) revenue_prev_7d
  from public.ad_accounts a
  join public.insights_daily i on i.level = 'account' and i.object_id = a.id
  cross join d
  where i.date <= d.d
  group by a.client_id
),
al as (
  select client_id,
         count(*) filter (where severity = 'critical') critical_open,
         count(*) filter (where severity = 'warning')  warning_open
  from public.alerts where status <> 'resolved' group by client_id
)
select c.id client_id, c.name, c.objective, c.monthly_budget,
       coalesce(agg.spend_yesterday,0) spend_yesterday,
       coalesce(agg.spend_7d,0) spend_7d,
       coalesce(agg.conv_7d,0) conversations_7d,
       case when agg.conv_7d > 0 then round(agg.spend_7d / agg.conv_7d, 2) end cost_per_conv_7d,
       case when agg.conv_prev_7d > 0 then round(agg.spend_prev_7d / agg.conv_prev_7d, 2) end cost_per_conv_prev_7d,
       case when agg.impressions_7d > 0 then round(agg.spend_7d / agg.impressions_7d * 1000, 2) end cpm_7d,
       case when agg.impressions_7d > 0 then round(agg.link_clicks_7d::numeric / agg.impressions_7d * 100, 2) end ctr_link_7d,
       (select max(a.freq_7d) from public.ad_accounts a where a.client_id = c.id) freq_7d,
       coalesce(agg.spend_month,0) spend_month,
       coalesce(al.critical_open,0) critical_open,
       coalesce(al.warning_open,0) warning_open,
       case when coalesce(al.critical_open,0) > 0 then 'red'
            when coalesce(al.warning_open,0)  > 0 then 'yellow'
            else 'green' end health,
       (select min(a.last_synced_at) from public.ad_accounts a where a.client_id = c.id) last_synced_at,
       coalesce(agg.purchases_7d,0) purchases_7d,
       coalesce(agg.revenue_7d,0) revenue_7d,
       case when agg.spend_7d > 0 then round(coalesce(agg.revenue_7d,0) / agg.spend_7d, 2) end roas_7d,
       case when agg.purchases_7d > 0 then round(agg.spend_7d / agg.purchases_7d, 2) end cost_per_purchase_7d,
       case when agg.purchases_prev_7d > 0 then round(agg.spend_prev_7d / agg.purchases_prev_7d, 2) end cost_per_purchase_prev_7d,
       case when agg.spend_prev_7d > 0 then round(coalesce(agg.revenue_prev_7d,0) / agg.spend_prev_7d, 2) end roas_prev_7d
from public.clients c
left join agg on agg.client_id = c.id
left join al  on al.client_id  = c.id
where c.active;

-- Série diária com vendas
create or replace function public.client_daily_v2(p_client uuid, p_days int default 30)
returns table (date date, spend numeric, conversations bigint, impressions bigint, link_clicks bigint, reach bigint,
               purchases bigint, purchase_value numeric)
language sql stable security invoker set search_path = '' as $$
  select g.d::date,
         coalesce(sum(i.spend),0), coalesce(sum(i.conversations),0)::bigint,
         coalesce(sum(i.impressions),0)::bigint, coalesce(sum(i.link_clicks),0)::bigint,
         coalesce(sum(i.reach),0)::bigint,
         coalesce(sum(i.purchases),0)::bigint, coalesce(sum(i.purchase_value),0)
  from generate_series(public.ref_date() - (p_days - 1), public.ref_date(), interval '1 day') g(d)
  left join public.ad_accounts a on a.client_id = p_client
  left join public.insights_daily i on i.level = 'account' and i.object_id = a.id and i.date = g.d::date
  group by g.d order by g.d
$$;

create or replace function public.campaign_stats_v2(p_client uuid, p_days int default 7)
returns table (campaign_id text, name text, objective text, effective_status text, daily_budget numeric,
               spend numeric, conversations bigint, impressions bigint, link_clicks bigint,
               cost_per_conversation numeric, ctr numeric, cpm numeric,
               purchases bigint, purchase_value numeric, roas numeric, cost_per_purchase numeric)
language sql stable security invoker set search_path = '' as $$
  select cp.id, cp.name, cp.objective, cp.effective_status, cp.daily_budget,
         coalesce(sum(i.spend),0) spend,
         coalesce(sum(i.conversations),0)::bigint,
         coalesce(sum(i.impressions),0)::bigint,
         coalesce(sum(i.link_clicks),0)::bigint,
         case when sum(i.conversations) > 0 then round(sum(i.spend)/sum(i.conversations),2) end,
         case when sum(i.impressions) > 0 then round(sum(i.link_clicks)::numeric/sum(i.impressions)*100,2) end,
         case when sum(i.impressions) > 0 then round(sum(i.spend)/sum(i.impressions)*1000,2) end,
         coalesce(sum(i.purchases),0)::bigint,
         coalesce(sum(i.purchase_value),0),
         case when sum(i.spend) > 0 then round(coalesce(sum(i.purchase_value),0)/sum(i.spend),2) end,
         case when sum(i.purchases) > 0 then round(sum(i.spend)/sum(i.purchases),2) end
  from public.campaigns cp
  join public.ad_accounts a on a.id = cp.ad_account_id and a.client_id = p_client
  left join public.insights_daily i on i.level = 'campaign' and i.object_id = cp.id
        and i.date between public.ref_date() - (p_days - 1) and public.ref_date()
  group by cp.id
  having coalesce(sum(i.spend),0) > 0 or cp.effective_status = 'ACTIVE'
  order by spend desc
$$;

create or replace function public.ad_stats_v2(p_client uuid, p_days int default 7)
returns table (ad_id text, name text, campaign_name text, effective_status text, thumbnail_url text,
               spend numeric, conversations bigint, impressions bigint, link_clicks bigint,
               cost_per_conversation numeric, ctr numeric,
               purchases bigint, purchase_value numeric, roas numeric, cost_per_purchase numeric)
language sql stable security invoker set search_path = '' as $$
  select ad.id, ad.name, cp.name, ad.effective_status, ad.thumbnail_url,
         sum(i.spend), sum(i.conversations)::bigint, sum(i.impressions)::bigint, sum(i.link_clicks)::bigint,
         case when sum(i.conversations) > 0 then round(sum(i.spend)/sum(i.conversations),2) end,
         case when sum(i.impressions) > 0 then round(sum(i.link_clicks)::numeric/sum(i.impressions)*100,2) end,
         sum(i.purchases)::bigint, sum(i.purchase_value),
         case when sum(i.spend) > 0 then round(sum(i.purchase_value)/sum(i.spend),2) end,
         case when sum(i.purchases) > 0 then round(sum(i.spend)/sum(i.purchases),2) end
  from public.insights_daily i
  join public.ad_accounts a on a.id = i.ad_account_id and a.client_id = p_client
  left join public.ads ad on ad.id = i.object_id
  left join public.campaigns cp on cp.id = coalesce(ad.campaign_id, i.campaign_id)
  where i.level = 'ad' and i.date between public.ref_date() - (p_days - 1) and public.ref_date()
  group by ad.id, ad.name, cp.name, ad.effective_status, ad.thumbnail_url, i.object_id
  having sum(i.spend) > 0
  order by sum(i.spend) desc
$$;

revoke execute on function public.client_daily_v2(uuid,int), public.campaign_stats_v2(uuid,int),
                           public.ad_stats_v2(uuid,int) from public, anon;
grant execute on function public.client_daily_v2(uuid,int), public.campaign_stats_v2(uuid,int),
                          public.ad_stats_v2(uuid,int) to authenticated;
