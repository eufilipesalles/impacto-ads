-- Impacto Ads — análise de criativos
-- Métricas diárias de atenção, retenção e engajamento (nível anúncio) + conteúdo do criativo.

alter table public.insights_daily
  add column if not exists video_plays    bigint not null default 0,  -- reproduções (qualquer duração)
  add column if not exists video_avg_time numeric(10,2),              -- tempo médio assistido (s) no dia
  add column if not exists thruplays      bigint not null default 0,  -- assistiu 15s ou até o fim
  add column if not exists video_p25      bigint not null default 0,
  add column if not exists video_p50      bigint not null default 0,
  add column if not exists video_p75      bigint not null default 0,
  add column if not exists video_p95      bigint not null default 0,
  add column if not exists video_p100     bigint not null default 0,
  add column if not exists reactions      int not null default 0,
  add column if not exists comments       int not null default 0,
  add column if not exists shares         int not null default 0,
  add column if not exists saves          int not null default 0;

alter table public.ads
  add column if not exists created_time        timestamptz,
  add column if not exists format              text,       -- video | imagem | carrossel | dinamico
  add column if not exists body                text,       -- texto principal
  add column if not exists title               text,       -- título
  add column if not exists cta_type            text,
  add column if not exists image_url           text,
  add column if not exists video_id            text,
  add column if not exists preview_url         text,       -- prévia do anúncio no Meta
  add column if not exists post_url            text,       -- publicação no Instagram/Facebook
  add column if not exists quality_ranking     text,       -- rankings do Meta (últimos 7 dias)
  add column if not exists engagement_ranking  text,
  add column if not exists conversion_ranking  text,
  add column if not exists freq_7d             numeric(8,2),
  add column if not exists rankings_updated_at timestamptz;

-- Agregado por criativo no período (para a nota e a página Criativos)
create or replace function public.creative_stats(p_client uuid default null, p_days int default 30)
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
  ctr_recent numeric, ctr_before numeric
)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select i.*, a.client_id
    from public.insights_daily i
    join public.ad_accounts a on a.id = i.ad_account_id
    join public.clients c on c.id = a.client_id and c.active
    where i.level = 'ad'
      and i.date between public.ref_date() - (p_days - 1) and public.ref_date()
      and (p_client is null or a.client_id = p_client)
  ), agg as (
    select object_id, client_id, ad_account_id,
      count(*) filter (where spend > 0) days_active, min(date) first_day, max(date) last_day,
      sum(spend) spend, sum(impressions)::bigint impressions, sum(reach)::bigint reach_sum,
      sum(clicks)::bigint clicks, sum(link_clicks)::bigint link_clicks,
      sum(conversations)::bigint conversations, sum(leads)::bigint leads,
      sum(purchases)::bigint purchases, sum(purchase_value) purchase_value,
      sum(video_views)::bigint video_3s, sum(video_plays)::bigint video_plays, sum(thruplays)::bigint thruplays,
      sum(video_p25)::bigint p25, sum(video_p50)::bigint p50, sum(video_p75)::bigint p75,
      sum(video_p95)::bigint p95, sum(video_p100)::bigint p100,
      -- tempo médio ponderado pelas reproduções de cada dia
      case when sum(video_plays) filter (where video_avg_time is not null) > 0
           then round(sum(video_avg_time * video_plays) filter (where video_avg_time is not null)
                      / sum(video_plays) filter (where video_avg_time is not null), 2) end avg_time,
      sum(reactions)::bigint reactions, sum(comments)::bigint comments, sum(shares)::bigint shares, sum(saves)::bigint saves,
      -- CTR dos últimos 7 dias × 7 dias anteriores (sinal de saturação)
      case when sum(impressions) filter (where date > public.ref_date() - 7) > 0
           then sum(link_clicks) filter (where date > public.ref_date() - 7)::numeric
                / sum(impressions) filter (where date > public.ref_date() - 7) * 100 end ctr_recent,
      case when sum(impressions) filter (where date <= public.ref_date() - 7 and date > public.ref_date() - 14) > 0
           then sum(link_clicks) filter (where date <= public.ref_date() - 7 and date > public.ref_date() - 14)::numeric
                / sum(impressions) filter (where date <= public.ref_date() - 7 and date > public.ref_date() - 14) * 100 end ctr_before
    from base
    group by object_id, client_id, ad_account_id
    having sum(spend) > 0
  )
  select g.object_id, g.client_id, c.name, c.objective, g.ad_account_id,
         ad.name, cp.name, cp.objective, ad.effective_status,
         ad.format, ad.thumbnail_url, ad.image_url, ad.preview_url, ad.post_url,
         ad.body, ad.title, ad.cta_type, ad.created_time,
         ad.quality_ranking, ad.engagement_ranking, ad.conversion_ranking, ad.freq_7d,
         g.days_active, g.first_day, g.last_day,
         g.spend, g.impressions, g.reach_sum, g.clicks, g.link_clicks,
         g.conversations, g.leads, g.purchases, g.purchase_value,
         g.video_3s, g.video_plays, g.thruplays, g.p25, g.p50, g.p75, g.p95, g.p100, g.avg_time,
         g.reactions, g.comments, g.shares, g.saves,
         round(g.ctr_recent, 3), round(g.ctr_before, 3)
  from agg g
  join public.clients c on c.id = g.client_id
  left join public.ads ad on ad.id = g.object_id
  left join public.campaigns cp on cp.id = ad.campaign_id
  order by g.spend desc
$$;

revoke execute on function public.creative_stats(uuid, int) from public, anon;
grant execute on function public.creative_stats(uuid, int) to authenticated;

-- Série diária de um criativo (tendência na tela de detalhe)
create or replace function public.creative_daily(p_ad text, p_days int default 30)
returns table (date date, spend numeric, impressions bigint, link_clicks bigint, conversations bigint,
               purchases bigint, purchase_value numeric, video_3s bigint, thruplays bigint)
language sql stable security invoker set search_path = '' as $$
  select g.d::date, coalesce(sum(i.spend),0), coalesce(sum(i.impressions),0)::bigint, coalesce(sum(i.link_clicks),0)::bigint,
         coalesce(sum(i.conversations),0)::bigint, coalesce(sum(i.purchases),0)::bigint, coalesce(sum(i.purchase_value),0),
         coalesce(sum(i.video_views),0)::bigint, coalesce(sum(i.thruplays),0)::bigint
  from generate_series(public.ref_date() - (p_days - 1), public.ref_date(), interval '1 day') g(d)
  left join public.insights_daily i on i.level = 'ad' and i.object_id = p_ad and i.date = g.d::date
  group by g.d order by g.d
$$;
revoke execute on function public.creative_daily(text, int) from public, anon;
grant execute on function public.creative_daily(text, int) to authenticated;
