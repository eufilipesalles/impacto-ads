-- Impacto Ads — histórico de relatórios enviados aos clientes
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  since         date not null,
  until         date not null,
  campaign_ids  text[] not null default '{}',     -- vazio = todas as campanhas
  campaign_names text[] not null default '{}',
  metrics       text[] not null,
  title         text not null,
  message       text not null,                    -- texto exatamente como foi copiado/enviado
  totals        jsonb not null,                   -- números do Meta usados no relatório
  previous_totals jsonb,
  options       jsonb not null default '{}',      -- compare, emojis, note
  fetched_at    timestamptz not null,             -- quando os números foram consultados no Meta
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.reports(client_id, created_at desc);
create trigger reports_touch before update on public.reports
  for each row execute function public.touch_updated_at();

alter table public.reports enable row level security;
create policy "equipe_le_reports" on public.reports for select to authenticated using ((select public.is_team_member()));
create policy "equipe_insere_reports" on public.reports for insert to authenticated with check ((select public.is_team_member()));
create policy "equipe_altera_reports" on public.reports for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
