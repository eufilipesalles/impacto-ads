-- Acesso por área para quem não é da equipe completa: "relatorios" libera os relatórios automáticos e o montador
create or replace function public.viewer_has(p_area text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_viewers
                 where email = lower(coalesce(auth.jwt() ->> 'email', '')) and p_area = any(areas))
$$;
grant execute on function public.viewer_has(text) to authenticated;

create policy "rel_le_client_reports"   on public.client_reports for select to authenticated using ((select public.viewer_has('relatorios')));
create policy "rel_marca_client_reports" on public.client_reports for update to authenticated
  using ((select public.viewer_has('relatorios'))) with check ((select public.viewer_has('relatorios')));
create policy "rel_le_reports"     on public.reports for select to authenticated using ((select public.viewer_has('relatorios')));
create policy "rel_insere_reports" on public.reports for insert to authenticated with check ((select public.viewer_has('relatorios')));
create policy "rel_altera_reports" on public.reports for update to authenticated
  using ((select public.viewer_has('relatorios'))) with check ((select public.viewer_has('relatorios')));

insert into public.team_viewers (email, name, areas)
values ('ederson@impacto.com.br', 'Ederson', array['criativos','estrategia','relatorios'])
on conflict (email) do update set areas = excluded.areas;
