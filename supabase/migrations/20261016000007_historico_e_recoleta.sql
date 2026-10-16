-- Impacto Ads — correção do cruzamento de dados com o Meta
-- 1) Marca quando a conta recebeu a carga completa (90 dias). Nula = a próxima coleta faz a carga completa.
--    Todas começam nulas: recarrega tudo já com a atribuição igual à do Gerenciador de Anúncios.
alter table public.ad_accounts add column if not exists history_loaded_at timestamptz;

-- 2) O Meta revisa conversões por até 7 dias (janela de atribuição) e ajusta gasto de dias anteriores.
--    Coleta das 06h relê os últimos 28 dias; a das 12h relê os últimos 3.
select cron.schedule('meta-sync', '0 9 * * *', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/meta-sync',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"days": 28}'::jsonb,
    timeout_milliseconds := 150000);
$job$);

select cron.schedule('meta-sync-meio-dia', '0 15 * * *', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/meta-sync',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"days": 3}'::jsonb,
    timeout_milliseconds := 150000);
$job$);

-- 3) Saldo: total depositado − total gasto (atualizado a cada coleta). O texto "Saldo disponível"
--    do Meta continua guardado em funding_display/prepaid_balance para conferência.
create or replace view public.account_balance
with (security_invoker = true) as
select a.id, a.client_id,
       case when a.spend_cap > 0 and a.amount_spent is not null then greatest(a.spend_cap - a.amount_spent, 0) end as available,
       a.prepaid_balance as meta_display_balance,
       a.last_synced_at
from public.ad_accounts a;
