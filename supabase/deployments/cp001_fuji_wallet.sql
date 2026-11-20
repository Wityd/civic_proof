-- P3 supplied this public deployment address. Read-only Fuji RPC verification
-- matched CP001's projectId hash and 200000000-cent allocation before insertion.
-- Recording this address does not switch runtime mode or create chain receipts.
insert into public.project_wallets (project_id, mode, wallet_address)
values ('10000000-0000-4000-8000-000000000001', 'fuji', '0xAdA383A5DF097C3Ef1F23ee2d4db670A8Ac83D4D')
on conflict (project_id, mode) do update set wallet_address = excluded.wallet_address;
