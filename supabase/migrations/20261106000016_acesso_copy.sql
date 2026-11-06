-- Acesso restrito para o time de copy: só leitura de Criativos e Estratégia.
-- Ficam fora de team_members de propósito: todas as ações (piloto, gerenciador, materiais, relatórios,
-- configurações) e todas as escritas continuam exigindo team_members.

create table if not exists public.team_viewers (
  email      text primary key check (email = lower(email)),
  name       text,
  areas      text[] not null default array['criativos','estrategia'],
  created_at timestamptz not null default now()
);
alter table public.team_viewers enable row level security;

create or replace function public.is_viewer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_viewers where email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
grant execute on function public.is_viewer() to authenticated;

create policy "viewer_le_proprio" on public.team_viewers for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- leitura do que as páginas Criativos e Estratégia usam
do $$
declare t text;
begin
  foreach t in array array['clients','ad_accounts','campaigns','ads','insights_daily','insights_breakdown','client_strategy','strategy_reports'] loop
    execute format('create policy "copy_le_%1$s" on public.%1$I for select to authenticated using ((select public.is_viewer()))', t);
  end loop;
end $$;

insert into public.team_viewers (email, name) values
  ('camilla@impacto.com.br', 'Camila'),
  ('izabela@impacto.com.br', 'Izabela')
on conflict (email) do nothing;
