-- Impacto Ads — saldo das contas
-- Conferido contra o Meta em 16/10/2026: o "Saldo disponível" que o Meta mostra (funding_source_details)
-- é o valor com impostos; (depositado − gasto) é o mesmo saldo sem impostos. A razão entre os dois
-- foi 1,138 em todas as contas. O painel mostra o valor do Meta e usa o valor sem impostos só para
-- calcular quantos dias o saldo dura (o gasto diário do Meta também é sem impostos).

alter table public.ad_accounts add column if not exists balance_updated_at timestamptz;

alter view public.account_balance rename column available to meta_balance;
alter view public.account_balance rename column meta_display_balance to net_balance;
alter view public.account_balance rename column last_synced_at to updated_at;

create or replace view public.account_balance
with (security_invoker = true) as
select a.id, a.client_id,
       a.prepaid_balance::numeric as meta_balance,                         -- igual ao Gerenciador
       (case when a.spend_cap > 0 and a.amount_spent is not null
            then greatest(a.spend_cap - a.amount_spent, 0) end)::numeric(14,2) as net_balance, -- sem impostos
       coalesce(a.balance_updated_at, a.last_synced_at) as updated_at
from public.ad_accounts a;

-- Saldo e status de hora em hora (consulta leve, sem métricas)
select cron.schedule('meta-saldos', '30 * * * *', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/meta-sync',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"action": "balances"}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
