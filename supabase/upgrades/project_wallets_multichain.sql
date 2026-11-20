-- Apply once to the existing CivicProof v1 project. No seed records are replaced.
begin;
create table public.project_wallets (
  project_id uuid not null references public.projects(id),
  mode text not null check (mode in ('fuji','bsc')),
  wallet_address text not null check (
    wallet_address ~ '^0x[0-9a-fA-F]{40}$' and
    wallet_address <> '0x0000000000000000000000000000000000000000'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, mode)
);
create unique index project_wallets_chain_address on public.project_wallets(mode, lower(wallet_address));
alter table public.project_wallets enable row level security;
revoke all on public.project_wallets from public, anon, authenticated;
grant select, insert, update, delete on public.project_wallets to service_role;
create trigger touch_updated_at before update on public.project_wallets
  for each row execute function public.civicproof_touch_updated_at();

alter table public.transactions drop constraint transactions_mode_check;
alter table public.transactions add constraint transactions_mode_check
  check (mode in ('simulated','fuji','bsc'));
alter table public.transactions drop constraint transactions_operation_check;
alter table public.transactions add constraint transactions_operation_check
  check (operation in ('create_project','fund_project','submit_request','approve','reject',
    'register_milestone','verify_milestone','release'));
-- These names were inspected on the original live schema before this upgrade.
alter table public.transactions drop constraint transactions_check1;
alter table public.transactions add constraint transactions_milestone_required
  check (operation not in ('register_milestone','verify_milestone') or milestone_id is not null);
alter table public.transactions drop constraint transactions_check4;
alter table public.transactions add constraint transactions_chain_confirmation
  check (mode not in ('fuji','bsc') or status <> 'confirmed' or block_number is not null);
-- Keep transactions_one_live_release unique by invoice across ALL modes.
notify pgrst, 'reload schema';
commit;
