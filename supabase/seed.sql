-- Fictional demo fixtures. Requires the four demo Auth/public.users rows first.
-- No fake invoice files, chain hashes or supplier wallet addresses.
begin;
insert into public.projects (id,code,name,description,location,budget_cents,permitted_categories,created_by)
select '10000000-0000-4000-8000-000000000001','CP001','Kgotso Valley Water Access',
 'Fictional demo project: water tanks, pipes and installation at four village sites.',
 'Kgotso Valley (fictional)',200000000,array['water_storage','pipes','installation'],id
from public.users where role='municipality'
on conflict (code) do nothing;

insert into public.suppliers (id,name,registration_no,registered_on,verified,user_id)
select v.id::uuid,v.name,v.registration_no,v.registered_on::date,v.verified,u.id
from (values
 ('20000000-0000-4000-8000-000000000001','Blue Basin Tanks (Pty) Ltd','2015/100001/07','2015-01-15',true),
 ('20000000-0000-4000-8000-000000000002','Pipeworks Direct CC','2026/771204/23','2026-10-28',false),
 ('20000000-0000-4000-8000-000000000003','Summit Motors (Pty) Ltd','2016/100003/07','2016-03-01',true)
) as v(id,name,registration_no,registered_on,verified)
cross join public.users u where u.role='supplier'
on conflict (registration_no) do nothing;

insert into public.milestones (id,project_id,code,title,description)
values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 'M1','8 tanks installed at 4 village sites','Fictional demo milestone; official verification required before installation payment.')
on conflict (project_id,code) do nothing;

insert into public.reference_prices (sku,description,category,unit,unit_price_cents,source,effective_on)
values
 ('TANK-10000L','10,000 L water tank','water_storage','tank',1450000,'Seeded fictional demo data','2026-11-18'),
 ('PIPE-HDPE-250-12','250 mm HDPE pipe, 12 m','pipes','pipe',520000,'Seeded fictional demo data','2026-11-18'),
 ('INSTALL-TANK','Tank installation','installation','tank',750000,'Seeded fictional demo data','2026-11-18')
on conflict (sku) do nothing;

-- A labelled simulated opening ledger; no on-chain funding is claimed.
insert into public.transactions (id,project_id,operation,amount_cents,mode,status,tx_hash,confirmed_at)
values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'create_project',0,'simulated','confirmed','sim_40000000-0000-4000-8000-000000000001',now()),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
  'fund_project',200000000,'simulated','confirmed','sim_40000000-0000-4000-8000-000000000002',now())
on conflict (id) do nothing;
commit;
