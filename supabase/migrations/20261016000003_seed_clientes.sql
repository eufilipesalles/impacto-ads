-- Impacto Ads — clientes iniciais e regras de alerta padrão

with c(name, objective, act) as (values
  ('Dotto',               'a_definir',          'act_2674180019583393'),
  ('Rispoli',             'a_definir',          'act_1505648210970850'),
  ('Rodomann',            'misto',              'act_2123338401943238'),
  ('1001 Embalagens',     'a_definir',          'act_1314843013073341'),
  ('Grill Camobi',        'a_definir',          'act_768891138651531'),
  ('Wks Madeiras',        'a_definir',          'act_205385132393156'),
  ('Loja Grand Bazzar',   'a_definir',          'act_3441866406081488'),
  ('Marcelo''s Pastello', 'a_definir',          'act_1952598172098082'),
  ('Ortobom',             'a_definir',          'act_2016785322065950'),
  ('Clínica Flamboyant',  'conversas_whatsapp', 'act_27108874215379552')
),
ins as (
  insert into public.clients (name, objective)
  select name, objective from c
  on conflict (name) do update set objective = excluded.objective
  returning id, name
)
insert into public.ad_accounts (id, client_id)
select c.act, ins.id from c join ins on ins.name = c.name
on conflict (id) do nothing;

-- Regras globais (valem para todos; uma regra por cliente sobrescreve)
insert into public.alert_rules (client_id, type, threshold, window_days) values
  (null, 'cost_per_conversation', null, 3),  -- teto definido por cliente
  (null, 'frequency',             3.0,  7),
  (null, 'budget_pace',           15,   1),  -- 15% acima do ritmo ideal
  (null, 'no_delivery',           null, 1),
  (null, 'account_status',        null, 1),
  (null, 'ad_disapproved',        null, 1),
  (null, 'spend_cap',             100,  1)   -- avisa quando restar < R$ 100 no limite da conta
on conflict do nothing;
