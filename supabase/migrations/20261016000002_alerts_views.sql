-- Impacto Ads — regras efetivas, motor de alertas e visões para o painel

-- Regra efetiva por cliente: a regra do cliente sobrescreve a global (client_id null) do mesmo tipo
create or replace view public.effective_alert_rules
with (security_invoker = true) as
select c.id as client_id, t.type,
       coalesce(cr.id, gr.id)               as rule_id,
       coalesce(cr.threshold, gr.threshold) as threshold,
       coalesce(cr.window_days, gr.window_days, 3) as window_days
from public.clients c
cross join (select distinct type from public.alert_rules) t
left join public.alert_rules cr on cr.client_id = c.id and cr.type = t.type
left join public.alert_rules gr on gr.client_id is null and gr.type = t.type
where c.active
  and coalesce(cr.enabled, gr.enabled, false);

-- Data de referência: ontem no fuso de Brasília (último dia completo)
create or replace function public.ref_date() returns date
language sql stable set search_path = '' as $$
  select ((now() at time zone 'America/Sao_Paulo')::date - 1)
$$;

-- Formata valor em reais: 1234.5 -> 'R$ 1.234,50'
create or replace function public.brl(v numeric) returns text
language sql immutable set search_path = '' as $$
  select 'R$ ' || translate(to_char(coalesce(v,0), 'FM999,999,999,990.00'), ',.', '.,')
$$;

create or replace function public.evaluate_alerts() returns int
language plpgsql security definer set search_path = '' as $$
declare
  d    date := public.ref_date();
  m0   date := date_trunc('month', public.ref_date())::date;
  dim  int  := extract(day from (date_trunc('month', public.ref_date()) + interval '1 month - 1 day'))::int;
  n    int;
begin
  drop table if exists _hits;
  create temp table _hits (
    rule_id uuid, client_id uuid, ad_account_id text, type text, severity text,
    dedupe_key text, title text, details jsonb
  ) on commit drop;

  -- 1) Custo por conversa (janela de N dias até ontem)
  insert into _hits
  select r.rule_id, r.client_id, a.id, r.type,
         case when s.conv = 0 then 'critical' else 'warning' end,
         'cpc:' || a.id,
         case when s.conv = 0
              then format('%s: %s gastos em %s dias sem nenhuma conversa', c.name, public.brl(s.spend), r.window_days)
              else format('%s: custo por conversa %s (teto %s)', c.name, public.brl(s.spend/s.conv), public.brl(r.threshold)) end,
         jsonb_build_object('spend', s.spend, 'conversations', s.conv, 'window_days', r.window_days,
                            'cost_per_conversation', case when s.conv > 0 then round(s.spend/s.conv,2) end,
                            'threshold', r.threshold)
  from public.effective_alert_rules r
  join public.clients c on c.id = r.client_id
  join public.ad_accounts a on a.client_id = r.client_id
  cross join lateral (
    select coalesce(sum(i.spend),0) spend, coalesce(sum(i.conversations),0) conv
    from public.insights_daily i
    where i.level = 'account' and i.object_id = a.id
      and i.date between d - (r.window_days - 1) and d
  ) s
  where r.type = 'cost_per_conversation' and r.threshold is not null
    and ( (s.conv > 0 and s.spend / s.conv > r.threshold)
       or (s.conv = 0 and s.spend >= r.threshold) );

  -- 2) Frequência 7 dias
  insert into _hits
  select r.rule_id, r.client_id, a.id, r.type, 'warning', 'freq:' || a.id,
         format('%s: frequência %s nos últimos 7 dias (limite %s) — público saturando', c.name,
                replace(round(a.freq_7d,1)::text,'.',','), replace(round(r.threshold,1)::text,'.',',')),
         jsonb_build_object('frequency_7d', a.freq_7d, 'reach_7d', a.reach_7d, 'threshold', r.threshold)
  from public.effective_alert_rules r
  join public.clients c on c.id = r.client_id
  join public.ad_accounts a on a.client_id = r.client_id
  where r.type = 'frequency' and a.freq_7d > r.threshold;

  -- 3) Ritmo de verba do mês (threshold = % de tolerância acima do ritmo ideal)
  insert into _hits
  select r.rule_id, c.id, null, r.type,
         case when s.spend > c.monthly_budget then 'critical' else 'warning' end,
         'pace:' || c.id || ':' || to_char(m0,'YYYY-MM'),
         case when s.spend > c.monthly_budget
              then format('%s: verba do mês estourada — %s de %s', c.name, public.brl(s.spend), public.brl(c.monthly_budget))
              else format('%s: gasto acima do ritmo — %s gastos, o ideal até ontem seria %s', c.name,
                          public.brl(s.spend), public.brl(c.monthly_budget * extract(day from d) / dim)) end,
         jsonb_build_object('month_spend', s.spend, 'monthly_budget', c.monthly_budget,
                            'expected_to_date', round(c.monthly_budget * extract(day from d) / dim, 2))
  from public.effective_alert_rules r
  join public.clients c on c.id = r.client_id
  cross join lateral (
    select coalesce(sum(i.spend),0) spend
    from public.insights_daily i join public.ad_accounts a on a.id = i.object_id
    where i.level = 'account' and a.client_id = c.id and i.date between m0 and d
  ) s
  where r.type = 'budget_pace' and c.monthly_budget > 0
    and s.spend > c.monthly_budget * extract(day from d) / dim * (1 + coalesce(r.threshold,15)/100);

  -- 4) Sem entrega: há campanha ativa, mas a conta não gastou nada ontem
  insert into _hits
  select r.rule_id, c.id, a.id, r.type, 'critical', 'nodeliv:' || a.id || ':' || d,
         format('%s: campanhas ativas sem nenhuma entrega ontem (%s)', c.name, to_char(d,'DD/MM')),
         jsonb_build_object('date', d, 'active_campaigns', ac.n)
  from public.effective_alert_rules r
  join public.clients c on c.id = r.client_id
  join public.ad_accounts a on a.client_id = c.id
  cross join lateral (select count(*) n from public.campaigns cp
                      where cp.ad_account_id = a.id and cp.effective_status = 'ACTIVE') ac
  where r.type = 'no_delivery' and ac.n > 0
    and coalesce((select i.spend from public.insights_daily i
                  where i.level='account' and i.object_id=a.id and i.date=d),0) = 0;

  -- 5) Status da conta
  insert into _hits
  select r.rule_id, c.id, a.id, r.type, 'critical', 'acct:' || a.id || ':' || a.account_status,
         format('%s: conta de anúncios com problema — %s', c.name,
           case a.account_status
             when 2 then 'desativada' when 3 then 'pagamento pendente' when 7 then 'em análise de risco'
             when 8 then 'pendente de liquidação' when 9 then 'em período de carência'
             when 100 then 'fechamento pendente' when 101 then 'encerrada'
             else 'status ' || a.account_status end),
         jsonb_build_object('account_status', a.account_status, 'disable_reason', a.disable_reason)
  from public.effective_alert_rules r
  join public.clients c on c.id = r.client_id
  join public.ad_accounts a on a.client_id = c.id
  where r.type = 'account_status' and a.account_status is not null and a.account_status <> 1;

  -- 6) Anúncios reprovados / com problema
  insert into _hits
  select r.rule_id, c.id, a.id, r.type,
         case when ad.effective_status = 'DISAPPROVED' then 'critical' else 'warning' end,
         'ad:' || ad.id || ':' || ad.effective_status,
         format('%s: anúncio "%s" %s', c.name, coalesce(ad.name, ad.id),
                case when ad.effective_status = 'DISAPPROVED' then 'reprovado' else 'com problema de veiculação' end),
         jsonb_build_object('ad_id', ad.id, 'effective_status', ad.effective_status, 'issues', ad.issues)
  from public.effective_alert_rules r
  join public.clients c on c.id = r.client_id
  join public.ad_accounts a on a.client_id = c.id
  join public.ads ad on ad.ad_account_id = a.id
  join public.campaigns cp on cp.id = ad.campaign_id and cp.status = 'ACTIVE'
  where r.type = 'ad_disapproved' and ad.effective_status in ('DISAPPROVED','WITH_ISSUES');

  -- 7) Saldo da conta acabando: saldo pré-pago (ou o restante do limite de gastos), threshold = R$
  insert into _hits
  select r.rule_id, c.id, a.id, r.type,
         case when b.saldo <= 0 then 'critical' else 'warning' end,
         'cap:' || a.id,
         case when b.saldo <= 0
              then format('%s: conta sem saldo — anúncios parados até recarregar', c.name)
              else format('%s: saldo da conta acabando — restam %s', c.name, public.brl(b.saldo)) end,
         jsonb_build_object('saldo', b.saldo, 'prepaid_balance', a.prepaid_balance,
                            'spend_cap', a.spend_cap, 'amount_spent', a.amount_spent)
  from public.effective_alert_rules r
  join public.clients c on c.id = r.client_id
  join public.ad_accounts a on a.client_id = c.id
  cross join lateral (select coalesce(a.prepaid_balance,
                        case when a.spend_cap > 0 then a.spend_cap - a.amount_spent end) saldo) b
  where r.type = 'spend_cap' and b.saldo is not null
    and b.saldo < coalesce(r.threshold, 100);

  -- Abre novos / atualiza os que continuam ativos
  insert into public.alerts (rule_id, client_id, ad_account_id, type, severity, dedupe_key, title, details)
  select rule_id, client_id, ad_account_id, type, severity, dedupe_key, title, details from _hits
  on conflict (dedupe_key) where status <> 'resolved'
  do update set last_seen_at = now(), title = excluded.title,
                details = excluded.details, severity = excluded.severity;
  get diagnostics n = row_count;

  -- Resolve automaticamente o que deixou de acontecer
  update public.alerts al set status = 'resolved', resolved_at = now()
  where al.status <> 'resolved'
    and not exists (select 1 from _hits h where h.dedupe_key = al.dedupe_key);

  return n;
end $$;

revoke all on function public.evaluate_alerts() from public, anon, authenticated;

-- ============ VISÃO GERAL POR CLIENTE (painel com semáforo) ============
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
    sum(i.spend)         filter (where i.date >= d.m0)                       spend_month
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
       (select min(a.last_synced_at) from public.ad_accounts a where a.client_id = c.id) last_synced_at
from public.clients c
left join agg on agg.client_id = c.id
left join al  on al.client_id  = c.id
where c.active;

grant execute on function public.evaluate_alerts() to service_role;
