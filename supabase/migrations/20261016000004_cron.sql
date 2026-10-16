-- Impacto Ads — agendamento da coleta (06h e 12h de Brasília)
-- O segredo do cron é gerado aqui dentro do Vault e nunca sai do banco.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'impacto_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'impacto_cron_secret');
  end if;
end $$;

-- A Edge Function confere o segredo recebido do cron por aqui
create or replace function public.check_cron_secret(s text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets
                 where name = 'impacto_cron_secret' and decrypted_secret = s)
$$;
revoke all on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

select cron.schedule(
  'meta-sync',
  '0 9,15 * * *',   -- UTC → 06:00 e 12:00 em Brasília
  $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/meta-sync',
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"days": 3}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
