-- P3: receive-only test addresses for the three fictional demo suppliers.
-- Generated randomly; nobody holds their private keys. They only ever RECEIVE test dZAR,
-- so anyone can watch payments arrive on Snowtrace / BscScan. Same addresses on every
-- EVM chain. Required before chain-mode invoices can be submitted. Safe to re-run.
update public.suppliers set wallet_address = '0xa1f35993bFfa1C9219e596FBb58e510fB98607B4' where id = '20000000-0000-4000-8000-000000000001'; -- Blue Basin Tanks (Pty) Ltd
update public.suppliers set wallet_address = '0x4E42b0ecC90677d5E6d51Fd54e3d8f0a3b6EeECD' where id = '20000000-0000-4000-8000-000000000002'; -- Pipeworks Direct CC
update public.suppliers set wallet_address = '0xfD78547677ea7b82AD14da551624f6695C8db312' where id = '20000000-0000-4000-8000-000000000003'; -- Summit Motors (Pty) Ltd
