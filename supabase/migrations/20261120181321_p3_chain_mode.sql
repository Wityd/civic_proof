-- P3: chain mode (Avalanche Fuji / BNB testnet) for civicproof-api.
--
-- Simulated mode is unchanged. In chain mode every money action is three steps:
--   1. cp_chain_prepare / cp_chain_submit_invoice   same rule checks as simulated mode,
--      rows locked, a PENDING transaction row written; returns what the chain needs.
--   2. The Edge Function dry-runs, sends and confirms the contract call.
--   3. cp_chain_settle   CONFIRMED (real tx hash + block) applies the effect,
--      FAILED rolls it back, PENDING (timeout) keeps the hash for reconciliation.
-- The chain stays the authority for money; this database mirrors confirmed results.
begin;

-- Active mode for public reads. Service role only.
create function public.cp_wallet_mode() returns text
language sql stable security invoker set search_path='' as $$
  select wallet_mode from private.runtime_config where singleton
$$;

-- What a contract call needs for one transaction row.
create function private.cp_chain_args(p_tx public.transactions) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'op', p_tx.operation,
    'mode', p_tx.mode,
    'project_id', p_tx.project_id,
    'project_wallet', (select w.wallet_address from public.project_wallets w where w.project_id=p_tx.project_id and w.mode=p_tx.mode),
    'invoice_id', p_tx.invoice_id,
    'milestone_id', coalesce(p_tx.milestone_id, (select i.milestone_id from public.invoices i where i.id=p_tx.invoice_id)),
    'supplier_address', (select s.wallet_address from public.invoices i join public.suppliers s on s.id=i.supplier_id where i.id=p_tx.invoice_id),
    'amount_cents', p_tx.amount_cents,
    'document_sha256', (select i.document_sha256 from public.invoices i where i.id=p_tx.invoice_id))
$$;

create function private.cp_chain_result(p_tx public.transactions) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tx', to_jsonb(p_tx), 'chain', private.cp_chain_args(p_tx))
$$;

create function private.cp_require_chain_mode(p_ctx jsonb) returns text
language plpgsql stable security definer set search_path='' as $$
begin
  if p_ctx->>'mode' not in ('fuji','bsc') then raise exception 'VALIDATION: chain mode is not active'; end if;
  return p_ctx->>'mode';
end $$;

create function private.cp_require_project_wallet(p_project uuid, p_mode text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.project_wallets where project_id=p_project and mode=p_mode) then
    raise exception 'CHAIN_NOT_READY: project has no % wallet', p_mode;
  end if;
end $$;

-- ── submit (supplier) ────────────────────────────────────────────────────────
create function public.cp_chain_submit_invoice(p_actor uuid, p_invoice jsonb, p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ctx jsonb; m text; inv public.invoices%rowtype; item jsonb; ix integer:=0; mid uuid; tx public.transactions%rowtype;
begin
  ctx:=public.cp_context(p_actor);
  if ctx->>'role' <> 'supplier' then raise exception 'FORBIDDEN: supplier required' using errcode='42501'; end if;
  m:=private.cp_require_chain_mode(ctx);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'VALIDATION: 1-100 items required'; end if;
  if not exists(select 1 from public.suppliers where id=(p_invoice->>'supplier_id')::uuid and user_id=p_actor) then raise exception 'FORBIDDEN: supplier ownership' using errcode='42501'; end if;
  if not exists(select 1 from public.suppliers where id=(p_invoice->>'supplier_id')::uuid and wallet_address is not null) then
    raise exception 'VALIDATION: supplier has no wallet address';
  end if;
  perform private.cp_require_project_wallet((p_invoice->>'project_id')::uuid, m);
  mid:=nullif(p_invoice->>'milestone_id','')::uuid;
  if mid is not null and not exists(select 1 from public.transactions where milestone_id=mid and project_id=(p_invoice->>'project_id')::uuid and mode=m and operation='register_milestone' and status='confirmed') then
    raise exception 'INVALID_STATE: milestone not registered';
  end if;
  insert into public.invoices(id,project_id,supplier_id,submitted_by,milestone_id,invoice_number,invoice_date,total_cents,document_path,document_sha256,ledger_mode)
  values((p_invoice->>'id')::uuid,(p_invoice->>'project_id')::uuid,(p_invoice->>'supplier_id')::uuid,p_actor,mid,
    p_invoice->>'invoice_number',(p_invoice->>'invoice_date')::date,(p_invoice->>'total_cents')::bigint,
    p_invoice->>'document_path',p_invoice->>'document_sha256',m) returning * into inv;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.invoice_items(invoice_id,line_index,description,category,reference_sku,quantity,unit_price_cents,line_total_cents)
    values(inv.id,ix,item->>'description',item->>'category',nullif(item->>'reference_sku',''),
      (item->>'quantity')::numeric,(item->>'unit_price_cents')::bigint,(item->>'line_total_cents')::bigint);
    ix:=ix+1;
  end loop;
  insert into public.transactions(project_id,invoice_id,operation,amount_cents,mode,status)
  values(inv.project_id,inv.id,'submit_request',inv.total_cents,m,'pending') returning * into tx;
  return private.cp_chain_result(tx) || jsonb_build_object('invoice', to_jsonb(inv));
end $$;

-- ── approve / reject / release / register_milestone / verify_milestone ──────
create function public.cp_chain_prepare(p_actor uuid, p_op text, p_ref uuid, p_reason text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ctx jsonb; m text; inv public.invoices%rowtype; ms public.milestones%rowtype; tx public.transactions%rowtype; balance bigint;
begin
  ctx:=public.cp_context(p_actor);
  if p_op is null or p_op not in ('approve','reject','release','register_milestone','verify_milestone') then raise exception 'VALIDATION: invalid chain operation'; end if;
  if p_op in ('approve','reject','release','register_milestone') and ctx->>'role' <> 'municipality' then raise exception 'FORBIDDEN: municipality required' using errcode='42501'; end if;
  if p_op = 'verify_milestone' and ctx->>'role' not in ('municipality','auditor') then raise exception 'FORBIDDEN: official role required' using errcode='42501'; end if;
  m:=private.cp_require_chain_mode(ctx);

  if p_op in ('register_milestone','verify_milestone') then
    select * into ms from public.milestones where id=p_ref;
    if ms.id is null then raise exception 'NOT_FOUND: milestone'; end if;
    perform 1 from public.projects where id=ms.project_id for update;
    select * into ms from public.milestones where id=p_ref for update;
    perform private.cp_require_project_wallet(ms.project_id, m);
    -- Idempotent: a live or finished operation is returned, never repeated.
    select * into tx from public.transactions where milestone_id=ms.id and operation=p_op and mode=m and status in ('pending','confirmed') limit 1;
    if tx.id is not null then return private.cp_chain_result(tx); end if;
    if p_op='verify_milestone' and not exists(select 1 from public.transactions where milestone_id=ms.id and operation='register_milestone' and mode=m and status='confirmed') then
      raise exception 'INVALID_STATE: register milestone first';
    end if;
    if p_op='verify_milestone' then
      -- Record WHO verified now (removed again if the chain transaction fails).
      insert into public.verifications(milestone_id,actor_id,kind,note)
      values(ms.id,p_actor,'official','Official verification (on-chain)') on conflict do nothing;
    end if;
    insert into public.transactions(project_id,milestone_id,operation,mode,status)
    values(ms.project_id,ms.id,p_op,m,'pending') returning * into tx;
    return private.cp_chain_result(tx);
  end if;

  -- Invoice operations: same lock order as cp_decide / cp_execute_payment.
  select * into inv from public.invoices where id=p_ref;
  if inv.id is null then raise exception 'NOT_FOUND: invoice'; end if;
  perform 1 from public.projects where id=inv.project_id for update;
  select * into inv from public.invoices where id=p_ref for update;
  if inv.ledger_mode <> m then raise exception 'CHAIN_NOT_READY: invoice belongs to the % ledger', inv.ledger_mode; end if;

  select * into tx from public.transactions where invoice_id=inv.id and status='pending' and operation<>'submit_request' limit 1;
  if tx.id is not null then
    if tx.operation=p_op then return private.cp_chain_result(tx); end if;
    raise exception 'INVALID_STATE: a % transaction is still pending', tx.operation;
  end if;
  if not exists(select 1 from public.transactions where invoice_id=inv.id and operation='submit_request' and mode=m and status='confirmed') then
    raise exception 'INVALID_STATE: invoice is not registered on chain yet';
  end if;

  if p_op='release' then
    select * into tx from public.transactions where invoice_id=inv.id and operation='release' and status in ('pending','confirmed') limit 1;
    if tx.id is not null then return private.cp_chain_result(tx); end if;
    if inv.status not in ('approved','payment_failed') then raise exception 'INVALID_STATE: approved invoice required'; end if;
    if inv.milestone_id is not null and not exists(select 1 from public.milestones where id=inv.milestone_id and status='verified') then
      raise exception 'MILESTONE_NOT_VERIFIED: delivery required';
    end if;
    select coalesce(sum(case when operation='fund_project' then amount_cents when operation='release' then -amount_cents else 0 end),0) into balance
      from public.transactions where project_id=inv.project_id and mode=m and status='confirmed';
    if balance < inv.total_cents then raise exception 'BUDGET_EXCEEDED: insufficient balance'; end if;
    update public.invoices set status='payment_pending' where id=inv.id;
  else
    if p_op='approve' and inv.total_cents > public.cp_available(inv.project_id,m) then raise exception 'BUDGET_EXCEEDED: insufficient available funds'; end if;
    -- The approval row is written now so P2's approval guard (role, state, self-approval,
    -- override reason) runs BEFORE anything reaches the chain. Removed again on failure.
    insert into public.approvals(invoice_id,actor_id,decision,reason) values(inv.id,p_actor,p_op,p_reason);
  end if;

  insert into public.transactions(project_id,invoice_id,operation,amount_cents,mode,status)
  values(inv.project_id,inv.id,p_op,inv.total_cents,m,'pending') returning * into tx;
  return private.cp_chain_result(tx);
end $$;

-- ── settle ───────────────────────────────────────────────────────────────────
create function public.cp_chain_settle(p_tx_id uuid, p_status text, p_tx_hash text default null,
  p_block bigint default null, p_error text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare tx public.transactions%rowtype;
begin
  if p_status is null or p_status not in ('pending','confirmed','failed') then raise exception 'VALIDATION: invalid settle status'; end if;
  if p_tx_hash is not null and p_tx_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'VALIDATION: invalid transaction hash'; end if;
  select * into tx from public.transactions where id=p_tx_id;
  if tx.id is null then raise exception 'NOT_FOUND: transaction'; end if;
  perform 1 from public.projects where id=tx.project_id for update;
  select * into tx from public.transactions where id=p_tx_id for update;
  if tx.mode not in ('fuji','bsc') then raise exception 'VALIDATION: not a chain transaction'; end if;
  if tx.status <> 'pending' then return private.cp_chain_result(tx); end if; -- already settled: idempotent

  if p_status='pending' then
    update public.transactions set tx_hash=coalesce(p_tx_hash, tx_hash) where id=tx.id returning * into tx;
    return private.cp_chain_result(tx);
  end if;

  if p_status='confirmed' then
    if p_tx_hash is null or p_block is null then raise exception 'VALIDATION: confirmed needs hash and block'; end if;
    update public.transactions set status='confirmed', tx_hash=p_tx_hash, block_number=p_block, confirmed_at=now(), error_code=null
      where id=tx.id returning * into tx;
    if tx.operation='approve' then update public.invoices set status='approved' where id=tx.invoice_id;
    elsif tx.operation='reject' then update public.invoices set status='rejected' where id=tx.invoice_id;
    elsif tx.operation='release' then update public.invoices set status='paid' where id=tx.invoice_id;
    elsif tx.operation='verify_milestone' then
      update public.milestones set status='verified', verified_at=now() where id=tx.milestone_id and status<>'verified';
    end if;
    return private.cp_chain_result(tx);
  end if;

  -- failed: nothing happened on chain, so undo what prepare did
  if tx.operation='submit_request' then
    delete from public.transactions where id=tx.id;
    delete from public.invoice_items where invoice_id=tx.invoice_id;
    delete from public.invoices where id=tx.invoice_id;
    return jsonb_build_object('tx', to_jsonb(tx) || jsonb_build_object('status','failed','error_code',p_error), 'deleted_invoice', tx.invoice_id);
  end if;
  update public.transactions set status='failed', tx_hash=coalesce(p_tx_hash, tx_hash), error_code=coalesce(p_error,'CHAIN_FAILED')
    where id=tx.id returning * into tx;
  if tx.operation in ('approve','reject') then
    delete from public.approvals where invoice_id=tx.invoice_id and decision=tx.operation and created_at=tx.created_at;
  elsif tx.operation='release' then
    update public.invoices set status='payment_failed' where id=tx.invoice_id and status='payment_pending';
  elsif tx.operation='verify_milestone' then
    delete from public.verifications where milestone_id=tx.milestone_id and kind='official' and created_at=tx.created_at;
  end if;
  return private.cp_chain_result(tx);
end $$;

-- Pending chain transactions that have a hash, for reconciliation after a timeout.
create function public.cp_chain_pending() returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(private.cp_chain_result(t) order by t.created_at), '[]'::jsonb)
  from public.transactions t where t.status='pending' and t.mode in ('fuji','bsc') and t.tx_hash is not null
$$;

-- Hold never touches the chain, so it must keep working in chain mode. Identical to
-- the original cp_decide except: chain-mode invoices may be HELD here, while approve and
-- reject in chain mode go through cp_chain_prepare.
create or replace function public.cp_decide(p_actor uuid,p_invoice_id uuid,p_decision text,p_reason text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype; decision public.approvals%rowtype; ctx jsonb; target text;
begin
  ctx:=public.cp_context(p_actor);
  if ctx->>'role' <> 'municipality' then raise exception 'FORBIDDEN: municipality required' using errcode='42501'; end if;
  if p_decision not in ('approve','hold','reject') or p_decision is null then raise exception 'VALIDATION: invalid decision'; end if;
  select * into inv from public.invoices where id=p_invoice_id;
  if inv.id is null then raise exception 'NOT_FOUND: invoice'; end if;
  perform 1 from public.projects where id=inv.project_id for update;
  select * into inv from public.invoices where id=p_invoice_id for update;
  if ctx->>'mode' <> inv.ledger_mode then raise exception 'CHAIN_NOT_READY: active-mode adapter required'; end if;
  if inv.ledger_mode <> 'simulated' and p_decision <> 'hold' then raise exception 'CHAIN_NOT_READY: use the chain adapter'; end if;
  if exists(select 1 from public.transactions where invoice_id=inv.id and status='pending' and operation<>'submit_request') then
    raise exception 'INVALID_STATE: a chain transaction is still pending';
  end if;
  if p_decision='approve' and inv.total_cents > public.cp_available(inv.project_id,inv.ledger_mode) then raise exception 'BUDGET_EXCEEDED: insufficient available funds'; end if;
  insert into public.approvals(invoice_id,actor_id,decision,reason) values(inv.id,p_actor,p_decision,p_reason) returning * into decision;
  target:=case p_decision when 'approve' then 'approved' when 'hold' then 'on_hold' else 'rejected' end;
  update public.invoices set status=target where id=inv.id;
  if p_decision <> 'hold' then
    insert into public.transactions(project_id,invoice_id,operation,amount_cents,mode,status,tx_hash,confirmed_at)
    values(inv.project_id,inv.id,p_decision,inv.total_cents,inv.ledger_mode,'confirmed','sim_'||gen_random_uuid(),now());
  end if;
  return jsonb_build_object('invoice_id',inv.id,'status',target,'approval',to_jsonb(decision));
end; $$;

-- Server-only, like every other cp_* function.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p
           where (p.pronamespace='public'::regnamespace and (p.proname like 'cp\_chain\_%' escape '\' or p.proname in ('cp_wallet_mode','cp_decide')))
              or (p.pronamespace='private'::regnamespace and p.proname in ('cp_chain_args','cp_chain_result','cp_require_chain_mode','cp_require_project_wallet')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end; $$;
notify pgrst,'reload schema';
commit;
