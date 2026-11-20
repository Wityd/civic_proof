-- P2 deployment review: safe sender ownership, pending reservations and rollback.
begin;
-- Tentative approval/official-verification records must be removable on a known
-- pre-broadcast failure/revert. Browser roles retain zero write privileges.
grant delete on public.approvals,public.verifications to service_role;

create table private.chain_dispatch (
  tx_id uuid primary key references public.transactions(id) on delete cascade,
  mode text not null check(mode in ('fuji','bsc')),
  owner uuid not null,
  expires_at timestamptz not null,
  released_at timestamptz
);
alter table private.chain_dispatch enable row level security;
grant select,insert,update,delete on private.chain_dispatch to service_role;
create unique index one_chain_sender_per_mode on private.chain_dispatch(mode) where released_at is null;

-- One sender per transaction AND per chain prevents duplicate retries and signer
-- nonce races. A lease can expire only before any transaction hash was recorded.
create function public.cp_chain_claim(p_tx_id uuid,p_owner uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare tx public.transactions%rowtype;
begin
  select * into tx from public.transactions where id=p_tx_id;
  if tx.id is null or tx.status<>'pending' or tx.tx_hash is not null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('civicproof-signer-'||tx.mode,0));
  select * into tx from public.transactions where id=p_tx_id;
  if tx.id is null or tx.status<>'pending' or tx.tx_hash is not null then return false; end if;
  update private.chain_dispatch d set released_at=now()
    where d.mode=tx.mode and d.released_at is null and (
      exists(select 1 from public.transactions t where t.id=d.tx_id and t.status<>'pending') or
      (d.expires_at<now() and exists(select 1 from public.transactions t where t.id=d.tx_id and t.tx_hash is null)));
  if exists(select 1 from private.chain_dispatch where mode=tx.mode and released_at is null) then return false; end if;
  insert into private.chain_dispatch(tx_id,mode,owner,expires_at)
    values(tx.id,tx.mode,p_owner,now()+interval '10 minutes')
    on conflict(tx_id) do update set owner=excluded.owner,expires_at=excluded.expires_at,released_at=null;
  return true;
end; $$;

create function public.cp_chain_record_hash(p_tx_id uuid,p_owner uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from private.chain_dispatch where tx_id=p_tx_id and owner=p_owner and released_at is null for update;
  if not found then raise exception 'INVALID_STATE: sender claim is no longer owned'; end if;
  return public.cp_chain_settle(p_tx_id,'pending',p_hash);
end; $$;

create function public.cp_chain_release_claim(p_tx_id uuid) returns void
language sql security invoker set search_path='' as $$
  update private.chain_dispatch d set released_at=now() where d.tx_id=p_tx_id
    and not exists(select 1 from public.transactions t where t.id=d.tx_id and t.status='pending')
$$;

create function private.cp_immutable_chain_hash() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.mode in ('fuji','bsc') and old.tx_hash is not null and new.tx_hash is distinct from old.tx_hash then
    raise exception 'INVALID_STATE: recorded chain transaction hash is immutable';
  end if;
  return new;
end; $$;
revoke all on function private.cp_immutable_chain_hash() from public,anon,authenticated;
grant execute on function private.cp_immutable_chain_hash() to service_role;
create trigger immutable_chain_hash before update on public.transactions
  for each row execute function private.cp_immutable_chain_hash();

create or replace function public.cp_available(p_project uuid,p_mode text) returns bigint
language sql stable security invoker set search_path='' as $$
  select coalesce((select sum(case when operation='fund_project' then amount_cents when operation='release' then -amount_cents else 0 end) from public.transactions where project_id=p_project and mode=p_mode and status='confirmed'),0)
  - coalesce((select sum(total_cents) from public.invoices where project_id=p_project and ledger_mode=p_mode and status in ('approved','payment_pending','payment_failed')),0)
  - coalesce((select sum(amount_cents) from public.transactions where project_id=p_project and mode=p_mode and operation='approve' and status='pending'),0)
$$;
revoke all on function public.cp_chain_claim(uuid,uuid),public.cp_chain_record_hash(uuid,uuid,text),public.cp_chain_release_claim(uuid),public.cp_available(uuid,text) from public,anon,authenticated;
grant execute on function public.cp_chain_claim(uuid,uuid),public.cp_chain_record_hash(uuid,uuid,text),public.cp_chain_release_claim(uuid),public.cp_available(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
