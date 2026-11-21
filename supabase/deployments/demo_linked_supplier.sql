-- DEMO ONLY (fictional): a "different" company that shares Pipeworks Direct CC's payout wallet
-- and phone number, so the analysis can show SUPPLIER_LINKED ("possible supplier relationships").
-- Run once in the Supabase SQL editor. Safe to re-run. Adds one supplier; changes no invoice,
-- balance or wallet. Aqua is verified and registered in 2025, so the rules alone would approve
-- a fair invoice from it: only the relationship check holds it.
insert into public.suppliers (id, name, registration_no, registered_on, verified, contact_phone, wallet_address, user_id)
select '20000000-0000-4000-8000-000000000004', 'Aqua Pipe Solutions CC', '2025/482913/23', '2025-06-02', true,
       '+27 82 555 0147', '0x4E42b0ecC90677d5E6d51Fd54e3d8f0a3b6EeECD', u.id
from public.users u where u.role = 'supplier'
order by u.created_at limit 1
on conflict (id) do nothing;

update public.suppliers set contact_phone = '082 555 0147'
where id = '20000000-0000-4000-8000-000000000002' and contact_phone is null;  -- Pipeworks Direct CC

select id, name, verified, contact_phone, wallet_address from public.suppliers order by id;
