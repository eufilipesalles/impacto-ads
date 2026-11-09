-- Descoberta automática de contas de anúncios (BMs)
create table if not exists public.ad_accounts_ignored (
  id         text primary key,
  name       text,
  created_at timestamptz not null default now()
);
alter table public.ad_accounts_ignored enable row level security;
create policy "equipe_le_ignoradas" on public.ad_accounts_ignored for select to authenticated using ((select public.is_team_member()));

-- a função de contas dispara a coleta de uma conta recém-adicionada (só o service_role chama)
create or replace function public.get_cron_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret'
$$;
revoke all on function public.get_cron_secret() from public, anon, authenticated;
grant execute on function public.get_cron_secret() to service_role;

-- todo dia às 05h50 (Brasília), antes da coleta das 06h: contas novas liberadas para o sistema entram sozinhas
select cron.schedule('contas-novas', '50 8 * * *', $job$
  select net.http_post(
    url     := 'https://wjufrlarxkoulzyfgbga.supabase.co/functions/v1/accounts',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'impacto_cron_secret')),
    body    := '{"action": "auto"}'::jsonb,
    timeout_milliseconds := 120000);
$job$);

-- Pedidos de acesso a contas de clientes (enviados pela BM da Impacto; entram sozinhos quando o cliente aprova)
create table if not exists public.ad_account_requests (
  id           text primary key,
  client_name  text not null,
  client_id    uuid references public.clients(id) on delete set null,
  bm_id        text,
  status       text not null,   -- sem_acesso | pedido_enviado | erro_pedido | adicionada
  note         text,
  requested_at timestamptz not null default now(),
  done_at      timestamptz
);
alter table public.ad_account_requests enable row level security;
create policy "equipe_le_pedidos" on public.ad_account_requests for select to authenticated using ((select public.is_team_member()));
