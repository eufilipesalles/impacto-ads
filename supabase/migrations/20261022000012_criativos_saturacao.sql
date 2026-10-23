-- Impacto Ads — criativos: volume das duas últimas semanas (para o sinal de saturação só disparar com dados suficientes)
create or replace function public.creative_stats_v2(p_client uuid default null, p_days int default 30)
returns table (
  ad_id text, client_id uuid, client_name text, client_objective text, ad_account_id text,
  name text, campaign_name text, campaign_objective text, effective_status text,
  format text, thumbnail_url text, image_url text, preview_url text, post_url text,
  body text, title text, cta_type text, created_time timestamptz,
  quality_ranking text, engagement_ranking text, conversion_ranking text, freq_7d numeric,
  days_active bigint, first_day date, last_day date,
  spend numeric, impressions bigint, reach_sum bigint, clicks bigint, link_clicks bigint,
  conversations bigint, leads bigint, purchases bigint, purchase_value numeric,
  video_3s bigint, video_plays bigint, thruplays bigint,
  video_p25 bigint, video_p50 bigint, video_p75 bigint, video_p95 bigint, video_p100 bigint,
  video_avg_time numeric,
  reactions bigint, comments bigint, shares bigint, saves bigint,
  imp_recent bigint, clicks_recent bigint, imp_before bigint, clicks_before bigint
)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select i.*, a.client_id
    from public.insights_daily i
    join public.ad_accounts a on a.id = i.ad_account_id
    join public.clients c on c.id = a.client_id and c.active
    where i.level = 'ad'
      and i.date between public.ref_date() - (greatest(p_days, 14) - 1) and public.ref_date()
      and (p_client is null or a.client_id = p_client)
  ), agg as (
    select object_id, client_id, ad_account_id,
      count(*) filter (where spend > 0 and date > public.ref_date() - p_days) days_active,
      min(date) filter (where date > public.ref_date() - p_days) first_day,
      max(date) filter (where date > public.ref_date() - p_days) last_day,
      sum(spend) filter (where date > public.ref_date() - p_days) spend,
      sum(impressions) filter (where date > public.ref_date() - p_days)::bigint impressions,
      sum(reach) filter (where date > public.ref_date() - p_days)::bigint reach_sum,
      sum(clicks) filter (where date > public.ref_date() - p_days)::bigint clicks,
      sum(link_clicks) filter (where date > public.ref_date() - p_days)::bigint link_clicks,
      sum(conversations) filter (where date > public.ref_date() - p_days)::bigint conversations,
      sum(leads) filter (where date > public.ref_date() - p_days)::bigint leads,
      sum(purchases) filter (where date > public.ref_date() - p_days)::bigint purchases,
      sum(purchase_value) filter (where date > public.ref_date() - p_days) purchase_value,
      sum(video_views) filter (where date > public.ref_date() - p_days)::bigint video_3s,
      sum(video_plays) filter (where date > public.ref_date() - p_days)::bigint video_plays,
      sum(thruplays) filter (where date > public.ref_date() - p_days)::bigint thruplays,
      sum(video_p25) filter (where date > public.ref_date() - p_days)::bigint p25,
      sum(video_p50) filter (where date > public.ref_date() - p_days)::bigint p50,
      sum(video_p75) filter (where date > public.ref_date() - p_days)::bigint p75,
      sum(video_p95) filter (where date > public.ref_date() - p_days)::bigint p95,
      sum(video_p100) filter (where date > public.ref_date() - p_days)::bigint p100,
      -- tempo médio ponderado pelas reproduções de cada dia
      round(sum(video_avg_time * video_plays) filter (where video_avg_time is not null and date > public.ref_date() - p_days)
            / nullif(sum(video_plays) filter (where video_avg_time is not null and date > public.ref_date() - p_days), 0), 2) avg_time,
      sum(reactions) filter (where date > public.ref_date() - p_days)::bigint reactions,
      sum(comments) filter (where date > public.ref_date() - p_days)::bigint comments,
      sum(shares) filter (where date > public.ref_date() - p_days)::bigint shares,
      sum(saves) filter (where date > public.ref_date() - p_days)::bigint saves,
      -- últimos 7 dias × 7 dias anteriores (sempre olha 14 dias, independente do período)
      coalesce(sum(impressions) filter (where date > public.ref_date() - 7), 0)::bigint imp_recent,
      coalesce(sum(link_clicks) filter (where date > public.ref_date() - 7), 0)::bigint clicks_recent,
      coalesce(sum(impressions) filter (where date <= public.ref_date() - 7 and date > public.ref_date() - 14), 0)::bigint imp_before,
      coalesce(sum(link_clicks) filter (where date <= public.ref_date() - 7 and date > public.ref_date() - 14), 0)::bigint clicks_before
    from base
    group by object_id, client_id, ad_account_id
    having sum(spend) filter (where date > public.ref_date() - p_days) > 0
  )
  select g.object_id, g.client_id, c.name, c.objective::text, g.ad_account_id,
         ad.name, cp.name, cp.objective, ad.effective_status,
         ad.format, ad.thumbnail_url, ad.image_url, ad.preview_url, ad.post_url,
         ad.body, ad.title, ad.cta_type, ad.created_time,
         ad.quality_ranking, ad.engagement_ranking, ad.conversion_ranking, ad.freq_7d,
         g.days_active, g.first_day, g.last_day,
         g.spend, g.impressions, g.reach_sum, g.clicks, g.link_clicks,
         g.conversations, g.leads, g.purchases, g.purchase_value,
         g.video_3s, g.video_plays, g.thruplays, g.p25, g.p50, g.p75, g.p95, g.p100, g.avg_time,
         g.reactions, g.comments, g.shares, g.saves,
         g.imp_recent, g.clicks_recent, g.imp_before, g.clicks_before
  from agg g
  join public.clients c on c.id = g.client_id
  left join public.ads ad on ad.id = g.object_id
  left join public.campaigns cp on cp.id = ad.campaign_id
  order by g.spend desc
$$;

revoke execute on function public.creative_stats_v2(uuid, int) from public, anon;
grant execute on function public.creative_stats_v2(uuid, int) to authenticated;

-- Série diária de um criativo, agora com leads
create or replace function public.creative_daily_v2(p_ad text, p_days int default 30)
returns table (date date, spend numeric, impressions bigint, link_clicks bigint, conversations bigint, leads bigint,
               purchases bigint, purchase_value numeric, video_3s bigint, thruplays bigint)
language sql stable security invoker set search_path = '' as $$
  select g.d::date, coalesce(sum(i.spend),0), coalesce(sum(i.impressions),0)::bigint, coalesce(sum(i.link_clicks),0)::bigint,
         coalesce(sum(i.conversations),0)::bigint, coalesce(sum(i.leads),0)::bigint, coalesce(sum(i.purchases),0)::bigint,
         coalesce(sum(i.purchase_value),0), coalesce(sum(i.video_views),0)::bigint, coalesce(sum(i.thruplays),0)::bigint
  from generate_series(public.ref_date() - (p_days - 1), public.ref_date(), interval '1 day') g(d)
  left join public.insights_daily i on i.level = 'ad' and i.object_id = p_ad and i.date = g.d::date
  group by g.d order by g.d
$$;
revoke execute on function public.creative_daily_v2(text, int) from public, anon;
grant execute on function public.creative_daily_v2(text, int) to authenticated;
