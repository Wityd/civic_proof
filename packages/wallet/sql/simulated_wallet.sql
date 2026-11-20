-- CivicProof simulated wallet (WALLET_MODE=simulated)
--
-- A database copy of contracts/ProjectWallet.sol + CivicProofFactory.sol with the SAME rules,
-- so the demo behaves identically with or without a chain. Every operation is one
-- function = one transaction, with row locks, so two approvals can never commit the
-- same money and a request can never be released twice.
--
-- Errors are raised as 'CODE' or 'CODE:detail' (e.g. 'INVALID_STATUS:released'),
-- matching the Solidity custom errors. The TypeScript SimulatedWalletService maps them.
--
-- Owner: P3. Applied by P2 alongside supabase/schema.sql. Safe to re-run.
-- Only the API's service-role key may call these: anon and authenticated are revoked below.

create table if not exists public.sim_wallet_projects (
  project_id uuid primary key,
  allocated_cents bigint not null check (allocated_cents > 0),
  funded_cents bigint not null default 0 check (funded_cents >= 0),
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  committed_cents bigint not null default 0 check (committed_cents >= 0),
  released_cents bigint not null default 0 check (released_cents >= 0),
  created_at timestamptz not null default now(),
  check (funded_cents <= allocated_cents),
  check (committed_cents <= balance_cents)
);

create table if not exists public.sim_wallet_milestones (
  milestone_id uuid primary key,
  project_id uuid not null references public.sim_wallet_projects(project_id),
  status text not null default 'registered' check (status in ('registered','verified')),
  registered_at timestamptz not null default now(),
  verified_at timestamptz
);

create table if not exists public.sim_wallet_requests (
  request_id uuid primary key, -- the invoice uuid
  project_id uuid not null references public.sim_wallet_projects(project_id),
  supplier_address text not null check (supplier_address ~ '^0x[0-9a-fA-F]{40}$'),
  amount_cents bigint not null check (amount_cents > 0),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  milestone_id uuid references public.sim_wallet_milestones(milestone_id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','released')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  released_at timestamptz
);

-- The simulated "chain log": one row per successful operation, keyed by its tx hash.
create table if not exists public.sim_wallet_txs (
  tx_hash text primary key,
  operation text not null,
  project_id uuid,
  request_id uuid,
  milestone_id uuid,
  amount_cents bigint not null default 0,
  block_number bigint generated always as identity,
  created_at timestamptz not null default now()
);

alter table public.sim_wallet_projects enable row level security;
alter table public.sim_wallet_milestones enable row level security;
alter table public.sim_wallet_requests enable row level security;
alter table public.sim_wallet_txs enable row level security;

-- ── helpers ──────────────────────────────────────────────────────────────────

create or replace function public.sim_wallet_log(
  p_operation text, p_project_id uuid, p_request_id uuid, p_milestone_id uuid, p_amount_cents bigint
) returns jsonb language plpgsql as $$
declare
  v_hash text := 'sim_' || gen_random_uuid()::text;
  v_block bigint;
begin
  insert into public.sim_wallet_txs (tx_hash, operation, project_id, request_id, milestone_id, amount_cents)
  values (v_hash, p_operation, p_project_id, p_request_id, p_milestone_id, coalesce(p_amount_cents, 0))
  returning block_number into v_block;
  return jsonb_build_object('tx_hash', v_hash, 'block_number', v_block);
end $$;

create or replace function public.sim_wallet_lock_project(p_project_id uuid)
returns public.sim_wallet_projects language plpgsql as $$
declare v public.sim_wallet_projects;
begin
  select * into v from public.sim_wallet_projects where project_id = p_project_id for update;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  return v;
end $$;

-- ── factory ──────────────────────────────────────────────────────────────────

create or replace function public.sim_wallet_create_project(p_project_id uuid, p_allocated_cents bigint)
returns jsonb language plpgsql as $$
begin
  if p_allocated_cents is null or p_allocated_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  insert into public.sim_wallet_projects (project_id, allocated_cents) values (p_project_id, p_allocated_cents)
  on conflict (project_id) do nothing;
  if not found then raise exception 'PROJECT_ALREADY_EXISTS'; end if;
  return public.sim_wallet_log('create_project', p_project_id, null, null, p_allocated_cents);
end $$;

-- ── project wallet ───────────────────────────────────────────────────────────

create or replace function public.sim_wallet_fund_project(p_project_id uuid, p_amount_cents bigint)
returns jsonb language plpgsql as $$
declare p public.sim_wallet_projects;
begin
  p := public.sim_wallet_lock_project(p_project_id);
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_amount_cents > p.allocated_cents - p.funded_cents then
    raise exception 'EXCEEDS_ALLOCATION:remaining %', p.allocated_cents - p.funded_cents;
  end if;
  update public.sim_wallet_projects
     set funded_cents = funded_cents + p_amount_cents, balance_cents = balance_cents + p_amount_cents
   where project_id = p_project_id;
  return public.sim_wallet_log('fund_project', p_project_id, null, null, p_amount_cents);
end $$;

create or replace function public.sim_wallet_submit_request(
  p_request_id uuid, p_project_id uuid, p_supplier_address text, p_amount_cents bigint,
  p_document_sha256 text, p_milestone_id uuid default null
) returns jsonb language plpgsql as $$
begin
  perform public.sim_wallet_lock_project(p_project_id);
  if exists (select 1 from public.sim_wallet_requests where request_id = p_request_id) then
    raise exception 'REQUEST_ALREADY_EXISTS';
  end if;
  if p_supplier_address is null or p_supplier_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_supplier_address ~* '^0x0{40}$' then
    raise exception 'INVALID_ADDRESS';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_document_sha256 is null or p_document_sha256 !~ '^[0-9a-f]{64}$'
     or p_document_sha256 ~ '^0{64}$' then
    raise exception 'INVALID_HASH';
  end if;
  if p_milestone_id is not null and not exists (
    select 1 from public.sim_wallet_milestones where milestone_id = p_milestone_id and project_id = p_project_id
  ) then
    raise exception 'MILESTONE_NOT_FOUND';
  end if;
  insert into public.sim_wallet_requests
    (request_id, project_id, supplier_address, amount_cents, document_sha256, milestone_id)
  values (p_request_id, p_project_id, p_supplier_address, p_amount_cents, p_document_sha256, p_milestone_id);
  return public.sim_wallet_log('submit_request', p_project_id, p_request_id, p_milestone_id, p_amount_cents);
end $$;

-- Locks the request (and its project, in a fixed order) and checks it exists.
create or replace function public.sim_wallet_lock_request(p_request_id uuid)
returns public.sim_wallet_requests language plpgsql as $$
declare v_project uuid; r public.sim_wallet_requests;
begin
  select project_id into v_project from public.sim_wallet_requests where request_id = p_request_id;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  perform public.sim_wallet_lock_project(v_project); -- project first, then request: no deadlocks
  select * into r from public.sim_wallet_requests where request_id = p_request_id for update;
  return r;
end $$;

create or replace function public.sim_wallet_approve(p_request_id uuid)
returns jsonb language plpgsql as $$
declare r public.sim_wallet_requests; p public.sim_wallet_projects; v_available bigint;
begin
  r := public.sim_wallet_lock_request(p_request_id);
  if r.status <> 'pending' then raise exception 'INVALID_STATUS:%', r.status; end if;
  select * into p from public.sim_wallet_projects where project_id = r.project_id;
  v_available := p.balance_cents - p.committed_cents;
  if r.amount_cents > v_available then
    raise exception 'INSUFFICIENT_AVAILABLE:available %', v_available;
  end if;
  update public.sim_wallet_projects set committed_cents = committed_cents + r.amount_cents
   where project_id = r.project_id;
  update public.sim_wallet_requests set status = 'approved', decided_at = now()
   where request_id = p_request_id;
  return public.sim_wallet_log('approve', r.project_id, p_request_id, r.milestone_id, r.amount_cents);
end $$;

create or replace function public.sim_wallet_reject(p_request_id uuid)
returns jsonb language plpgsql as $$
declare r public.sim_wallet_requests;
begin
  r := public.sim_wallet_lock_request(p_request_id);
  if r.status <> 'pending' then raise exception 'INVALID_STATUS:%', r.status; end if;
  update public.sim_wallet_requests set status = 'rejected', decided_at = now()
   where request_id = p_request_id;
  return public.sim_wallet_log('reject', r.project_id, p_request_id, r.milestone_id, 0);
end $$;

create or replace function public.sim_wallet_release(p_request_id uuid)
returns jsonb language plpgsql as $$
declare r public.sim_wallet_requests; v_ms text;
begin
  r := public.sim_wallet_lock_request(p_request_id);
  if r.status <> 'approved' then raise exception 'INVALID_STATUS:%', r.status; end if;
  if r.milestone_id is not null then
    select status into v_ms from public.sim_wallet_milestones where milestone_id = r.milestone_id;
    if v_ms is distinct from 'verified' then raise exception 'MILESTONE_NOT_VERIFIED'; end if;
  end if;
  -- Status flips in the same transaction as the accounting: pays exactly once.
  update public.sim_wallet_requests set status = 'released', released_at = now()
   where request_id = p_request_id;
  update public.sim_wallet_projects
     set committed_cents = committed_cents - r.amount_cents,
         balance_cents = balance_cents - r.amount_cents,
         released_cents = released_cents + r.amount_cents
   where project_id = r.project_id;
  return public.sim_wallet_log('release', r.project_id, p_request_id, r.milestone_id, r.amount_cents);
end $$;

-- ── milestones ───────────────────────────────────────────────────────────────

create or replace function public.sim_wallet_register_milestone(p_milestone_id uuid, p_project_id uuid)
returns jsonb language plpgsql as $$
begin
  perform public.sim_wallet_lock_project(p_project_id);
  insert into public.sim_wallet_milestones (milestone_id, project_id) values (p_milestone_id, p_project_id)
  on conflict (milestone_id) do nothing;
  if not found then raise exception 'MILESTONE_ALREADY_REGISTERED'; end if;
  return public.sim_wallet_log('register_milestone', p_project_id, null, p_milestone_id, 0);
end $$;

create or replace function public.sim_wallet_verify_milestone(p_milestone_id uuid)
returns jsonb language plpgsql as $$
declare m public.sim_wallet_milestones;
begin
  select * into m from public.sim_wallet_milestones where milestone_id = p_milestone_id for update;
  if not found then raise exception 'MILESTONE_NOT_FOUND'; end if;
  if m.status = 'verified' then raise exception 'MILESTONE_ALREADY_VERIFIED'; end if;
  update public.sim_wallet_milestones set status = 'verified', verified_at = now()
   where milestone_id = p_milestone_id;
  return public.sim_wallet_log('verify_milestone', m.project_id, null, p_milestone_id, 0);
end $$;

-- ── views ────────────────────────────────────────────────────────────────────

create or replace function public.sim_wallet_get_balance(p_project_id uuid)
returns jsonb language plpgsql stable as $$
declare p public.sim_wallet_projects;
begin
  select * into p from public.sim_wallet_projects where project_id = p_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  -- bigint as text: JSON numbers lose precision above 2^53
  return jsonb_build_object('balance_cents', p.balance_cents::text,
                            'available_cents', (p.balance_cents - p.committed_cents)::text);
end $$;

create or replace function public.sim_wallet_get_request(p_request_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'request_id', request_id, 'project_id', project_id, 'supplier_address', supplier_address,
    'amount_cents', amount_cents::text, 'document_sha256', document_sha256,
    'milestone_id', milestone_id, 'status', status)
  from public.sim_wallet_requests where request_id = p_request_id
$$;

create or replace function public.sim_wallet_get_milestone(p_milestone_id uuid)
returns text language sql stable as $$
  select coalesce((select status from public.sim_wallet_milestones where milestone_id = p_milestone_id), 'none')
$$;

create or replace function public.sim_wallet_get_tx(p_tx_hash text)
returns jsonb language sql stable as $$
  select jsonb_build_object('tx_hash', tx_hash, 'block_number', block_number, 'operation', operation)
  from public.sim_wallet_txs where tx_hash = p_tx_hash
$$;

-- Demo reset: wipes only the simulated ledger.
create or replace function public.sim_wallet_reset()
returns void language sql as $$
  truncate public.sim_wallet_txs, public.sim_wallet_requests, public.sim_wallet_milestones,
           public.sim_wallet_projects
$$;

-- ── access: service role only ────────────────────────────────────────────────
-- Supabase grants new functions and tables to anon/authenticated by default and exposes
-- them over the REST API. Revoke them so only the API's service-role key can move money.
do $$
declare f regprocedure; r text;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sim\_wallet\_%' loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon','authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.sim_wallet_projects, public.sim_wallet_milestones, '
                     'public.sim_wallet_requests, public.sim_wallet_txs from %I', r);
    end if;
  end loop;
end $$;
