-- CivicProof v1. Canonical hosted schema, applied once to the inspected empty project.
-- Auth users are created through the Auth Admin API, never through SQL.
begin;

create table public.users (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) > 0),
  role text not null check (role in ('citizen','supplier','municipality','auditor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  location text not null default '',
  budget_cents bigint not null check (budget_cents > 0),
  permitted_categories text[] not null check (cardinality(permitted_categories) > 0),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- On-chain wallet addresses only. Simulated mode has no invented EVM address.
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

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  registration_no text not null unique,
  registered_on date not null,
  verified boolean not null default false,
  contact_name text,
  contact_email text,
  contact_phone text,
  wallet_address text check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  code text not null,
  title text not null,
  description text not null default '',
  status text not null default 'pending' check (status in ('pending','verified')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code),
  unique (id, project_id),
  check ((status = 'verified') = (verified_at is not null))
);

create table public.reference_prices (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  description text not null,
  category text not null,
  unit text not null,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  source text not null,
  effective_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  supplier_id uuid not null references public.suppliers(id),
  submitted_by uuid not null references public.users(id),
  milestone_id uuid,
  invoice_number text not null check (length(trim(invoice_number)) > 0),
  invoice_date date not null,
  total_cents bigint not null check (total_cents > 0),
  document_path text not null check (length(document_path) > 0),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'submitted' check (status in
    ('submitted','analysed','approved','on_hold','rejected','payment_pending','paid','payment_failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (milestone_id, project_id) references public.milestones(id, project_id)
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  line_index integer not null check (line_index >= 0),
  description text not null,
  category text not null,
  reference_sku text references public.reference_prices(sku),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  created_at timestamptz not null default now(),
  unique (invoice_id, line_index)
);

create table public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  extraction jsonb not null check (jsonb_typeof(extraction) = 'object'),
  checks jsonb not null default '[]' check (jsonb_typeof(checks) = 'array'),
  flags text[] not null default '{}',
  benchmarks jsonb not null default '[]' check (jsonb_typeof(benchmarks) = 'array'),
  potential_excess_cents bigint not null default 0 check (potential_excess_cents >= 0),
  recommendation text not null check (recommendation in ('APPROVE','HOLD_FOR_REVIEW','REJECT')),
  explanation text not null,
  mode text not null check (mode in ('rules','llm')),
  created_at timestamptz not null default now(),
  unique (id, invoice_id)
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  actor_id uuid not null references public.users(id),
  decision text not null check (decision in ('approve','hold','reject')),
  reason text,
  overrode_ai boolean not null default false,
  ai_review_id uuid,
  created_at timestamptz not null default now(),
  foreign key (ai_review_id, invoice_id) references public.ai_reviews(id, invoice_id),
  check (decision = 'approve' or length(trim(coalesce(reason,''))) > 0),
  check (not overrode_ai or (decision = 'approve' and length(trim(coalesce(reason,''))) > 0))
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  invoice_id uuid,
  milestone_id uuid,
  operation text not null check (operation in
    ('create_project','fund_project','submit_request','approve','reject','register_milestone','verify_milestone','release')),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  mode text not null check (mode in ('simulated','fuji','bsc')),
  status text not null default 'pending' check (status in ('pending','confirmed','failed')),
  tx_hash text,
  block_number bigint check (block_number >= 0),
  error_code text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, project_id) references public.invoices(id, project_id),
  foreign key (milestone_id, project_id) references public.milestones(id, project_id),
  check (operation not in ('submit_request','approve','reject','release') or invoice_id is not null),
  constraint transactions_milestone_required check (operation not in ('register_milestone','verify_milestone') or milestone_id is not null),
  check (operation not in ('release','fund_project') or amount_cents > 0),
  check (status <> 'confirmed' or (tx_hash is not null and confirmed_at is not null)),
  constraint transactions_chain_confirmation check (mode not in ('fuji','bsc') or status <> 'confirmed' or block_number is not null)
);
create unique index transactions_one_live_release on public.transactions(invoice_id)
  where operation = 'release' and status in ('pending','confirmed');
create unique index transactions_tx_hash on public.transactions(mode, tx_hash) where tx_hash is not null;

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id),
  uploaded_by uuid not null references public.users(id),
  object_path text not null,
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  caption text not null default '',
  duplicate_of uuid references public.evidence(id),
  created_at timestamptz not null default now(),
  check (duplicate_of is distinct from id)
);

create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id),
  actor_id uuid not null references public.users(id),
  kind text not null check (kind in ('community','official')),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (milestone_id, actor_id, kind)
);

create table public.concerns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  raised_by uuid not null references public.users(id),
  message text not null check (length(trim(message)) > 0),
  status text not null default 'open' check (status in ('open','responded')),
  response text,
  responded_by uuid references public.users(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'responded' or
    (length(trim(coalesce(response,''))) > 0 and responded_by is not null and responded_at is not null))
);

-- Foreign-key and workflow lookup indexes.
create index projects_created_by_idx on public.projects(created_by);
create index suppliers_user_idx on public.suppliers(user_id);
create index invoices_queue_idx on public.invoices(project_id, status, created_at desc);
create index invoices_supplier_number_idx on public.invoices(supplier_id, invoice_number);
create index invoices_submitter_idx on public.invoices(submitted_by);
create index invoices_milestone_project_idx on public.invoices(milestone_id, project_id);
create index invoices_document_hash_idx on public.invoices(document_sha256);
create index invoice_items_reference_idx on public.invoice_items(reference_sku);
create index ai_reviews_latest_idx on public.ai_reviews(invoice_id, created_at desc, id desc);
create index approvals_invoice_idx on public.approvals(invoice_id, created_at desc);
create index approvals_actor_idx on public.approvals(actor_id);
create index approvals_review_invoice_idx on public.approvals(ai_review_id, invoice_id);
create index transactions_project_idx on public.transactions(project_id, created_at desc);
create index transactions_invoice_project_idx on public.transactions(invoice_id, project_id);
create index transactions_milestone_project_idx on public.transactions(milestone_id, project_id);
create index evidence_milestone_idx on public.evidence(milestone_id);
create index evidence_uploader_idx on public.evidence(uploaded_by);
create index evidence_duplicate_idx on public.evidence(duplicate_of);
create index evidence_hash_idx on public.evidence(document_sha256);
create index verifications_actor_idx on public.verifications(actor_id);
create index concerns_project_idx on public.concerns(project_id, created_at desc);
create index concerns_raiser_idx on public.concerns(raised_by);
create index concerns_responder_idx on public.concerns(responded_by);

-- Invoker-only trigger functions: no browser-callable privileged RPCs.
create function public.civicproof_touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;

create function public.civicproof_invoice_state_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if new.status <> 'submitted' then raise exception 'INVALID_STATE: invoices start submitted'; end if;
  elsif new.status is distinct from old.status then
    if not (
      (old.status='submitted' and new.status='analysed') or
      (old.status='analysed' and new.status in ('approved','on_hold','rejected')) or
      (old.status='on_hold' and new.status in ('approved','rejected')) or
      (old.status='approved' and new.status='payment_pending') or
      (old.status='payment_pending' and new.status in ('paid','payment_failed')) or
      (old.status='payment_failed' and new.status='payment_pending')
    ) then raise exception 'INVALID_STATE: % -> %', old.status, new.status; end if;
    if new.status='paid' and not exists (
      select 1 from public.transactions t where t.invoice_id=new.id and
        t.operation='release' and t.status='confirmed' and t.amount_cents=new.total_cents
    ) then raise exception 'INVALID_STATE: confirmed release required'; end if;
  end if;
  return new;
end;
$$;
create trigger invoices_state_guard before insert or update on public.invoices
  for each row execute function public.civicproof_invoice_state_guard();

create function public.civicproof_approval_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare submitter uuid; invoice_state text; latest_review public.ai_reviews%rowtype;
begin
  if not exists (select 1 from public.users where id=new.actor_id and role='municipality') then
    raise exception 'FORBIDDEN: municipality role required';
  end if;
  select submitted_by, status into submitter, invoice_state from public.invoices where id=new.invoice_id for update;
  if invoice_state not in ('analysed','on_hold') or (invoice_state='on_hold' and new.decision='hold') then
    raise exception 'INVALID_STATE: invoice is not reviewable';
  end if;
  if new.decision='approve' and submitter=new.actor_id then raise exception 'FORBIDDEN: self approval'; end if;
  select * into latest_review from public.ai_reviews where invoice_id=new.invoice_id order by created_at desc, id desc limit 1;
  new.ai_review_id := latest_review.id;
  new.overrode_ai := new.decision='approve' and cardinality(coalesce(latest_review.flags,'{}')) > 0;
  if new.overrode_ai and length(trim(coalesce(new.reason,'')))=0 then
    raise exception 'REASON_REQUIRED: flagged invoice';
  end if;
  return new;
end;
$$;
create trigger approvals_guard before insert on public.approvals
  for each row execute function public.civicproof_approval_guard();

do $$
declare table_name text;
begin
  foreach table_name in array array['users','projects','project_wallets','suppliers','milestones','reference_prices',
    'invoices','invoice_items','ai_reviews','approvals','transactions','evidence','verifications','concerns'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
  foreach table_name in array array['users','projects','project_wallets','suppliers','milestones','reference_prices','invoices','transactions','concerns'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.civicproof_touch_updated_at()', table_name);
  end loop;
end;
$$;
revoke all on function public.civicproof_touch_updated_at() from public, anon, authenticated;
revoke all on function public.civicproof_invoice_state_guard() from public, anon, authenticated;
revoke all on function public.civicproof_approval_guard() from public, anon, authenticated;
grant execute on function public.civicproof_touch_updated_at(), public.civicproof_invoice_state_guard(), public.civicproof_approval_guard() to service_role;
-- Decision/review records are append-only for the backend application.
revoke update, delete on public.approvals, public.ai_reviews, public.verifications from service_role;
-- Some new Supabase projects include this event-trigger helper with PUBLIC execute.
-- Retain the owner's automatic RLS behavior while closing browser RPC execution.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end; $$;
notify pgrst, 'reload schema';
commit;
