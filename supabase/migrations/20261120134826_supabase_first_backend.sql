-- Supabase-first application boundary. Apply after the 14-table baseline.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
create table private.runtime_config (
  singleton boolean primary key default true check(singleton),
  wallet_mode text not null default 'simulated' check(wallet_mode in ('simulated','fuji','bsc'))
);
alter table private.runtime_config enable row level security;
grant select,update on private.runtime_config to service_role;
insert into private.runtime_config(singleton) values(true);
alter table public.invoices add column ledger_mode text not null default 'simulated'
  check(ledger_mode in ('simulated','fuji','bsc'));

-- Only trusted server code writes financial state. Browser permissions below are
-- SELECT or narrowly scoped profile/contact/community operations.
create function private.app_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.users where id=(select auth.uid())
$$;
create function private.can_read_invoice(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.invoices i join public.suppliers s on s.id=i.supplier_id
    join public.users u on u.id=auth.uid()
    where i.id=p_id and (u.role in ('municipality','auditor') or (u.role='supplier' and s.user_id=u.id))
  )
$$;
revoke all on function private.app_role(),private.can_read_invoice(uuid) from public,anon,authenticated;
grant execute on function private.app_role(),private.can_read_invoice(uuid) to authenticated,service_role;

grant select on public.projects,public.project_wallets,public.milestones,public.reference_prices to anon,authenticated;
create policy public_projects on public.projects for select to anon,authenticated using(true);
create policy public_wallets on public.project_wallets for select to anon,authenticated using(true);
create policy public_milestones on public.milestones for select to anon,authenticated using(true);
create policy public_prices on public.reference_prices for select to anon,authenticated using(true);
grant select on public.users,public.suppliers,public.invoices,public.invoice_items,public.ai_reviews,
  public.approvals,public.transactions,public.evidence,public.verifications,public.concerns to authenticated;
create policy own_profile on public.users for select to authenticated using(id=(select auth.uid()));
grant update(display_name) on public.users to authenticated;
create policy edit_own_profile on public.users for update to authenticated
  using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy supplier_private_reads on public.suppliers for select to authenticated using(
  user_id=(select auth.uid()) or (select private.app_role()) in ('municipality','auditor'));
grant update(contact_name,contact_email,contact_phone) on public.suppliers to authenticated;
create policy supplier_contact_edit on public.suppliers for update to authenticated
  using(user_id=(select auth.uid()) and (select private.app_role())='supplier')
  with check(user_id=(select auth.uid()) and (select private.app_role())='supplier');
create policy invoice_private_reads on public.invoices for select to authenticated using(private.can_read_invoice(id));
create policy item_private_reads on public.invoice_items for select to authenticated using(private.can_read_invoice(invoice_id));
create policy review_private_reads on public.ai_reviews for select to authenticated using(private.can_read_invoice(invoice_id));
create policy approval_private_reads on public.approvals for select to authenticated using(private.can_read_invoice(invoice_id));
create policy transaction_private_reads on public.transactions for select to authenticated using(
  (select private.app_role()) in ('municipality','auditor') or (invoice_id is not null and private.can_read_invoice(invoice_id)));
create policy evidence_reads on public.evidence for select to authenticated using((select private.app_role()) is not null);
create policy verification_reads on public.verifications for select to authenticated using((select private.app_role()) is not null);
create policy concern_reads on public.concerns for select to authenticated using(
  raised_by=(select auth.uid()) or (select private.app_role()) in ('municipality','auditor'));
grant insert(project_id,raised_by,message) on public.concerns to authenticated;
create policy citizen_concern_insert on public.concerns for insert to authenticated with check(
  raised_by=(select auth.uid()) and (select private.app_role())='citizen' and status='open'
  and response is null and responded_by is null and responded_at is null);
grant insert(milestone_id,actor_id,kind,note) on public.verifications to authenticated;
create policy citizen_confirmation_insert on public.verifications for insert to authenticated with check(
  actor_id=(select auth.uid()) and (select private.app_role())='citizen' and kind='community');

create function private.can_read_file(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    (p_bucket='invoices' and exists(select 1 from public.invoices i where i.document_path=p_path and private.can_read_invoice(i.id))) or
    (p_bucket='evidence' and private.app_role() is not null and exists(select 1 from public.evidence e where e.object_path=p_path))
  )
$$;
revoke all on function private.can_read_file(text,text) from public,anon,authenticated;
grant execute on function private.can_read_file(text,text) to authenticated;
create policy authorised_private_files on storage.objects for select to authenticated
  using(bucket_id in ('invoices','evidence') and private.can_read_file(bucket_id,name));

-- Explicit redaction boundary: private definer reads, public invoker wrappers.
-- Anonymous dashboard access is intentional; this function returns ONLY public fields.
create function private.public_dashboard(p_project uuid,p_mode text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'code',p.code,'name',p.name,'description',p.description,'location',p.location,
    'budget_cents',p.budget_cents,'permitted_categories',p.permitted_categories,'mode',p_mode,
    'paid_cents',coalesce((select sum(t.amount_cents) from public.transactions t where t.project_id=p.id and t.mode=p_mode and t.operation='release' and t.status='confirmed'),0),
    'balance_cents',coalesce((select sum(case when t.operation='fund_project' then t.amount_cents when t.operation='release' then -t.amount_cents else 0 end) from public.transactions t where t.project_id=p.id and t.mode=p_mode and t.status='confirmed'),0),
    'wallet_address',(select w.wallet_address from public.project_wallets w where w.project_id=p.id and w.mode=p_mode),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'supplier_name',s.name,'total_cents',i.total_cents,'status',i.status,'invoice_date',i.invoice_date) order by i.created_at) from public.invoices i join public.suppliers s on s.id=i.supplier_id where i.project_id=p.id and i.ledger_mode=p_mode),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'invoice_id',t.invoice_id,'operation',t.operation,'amount_cents',t.amount_cents,'mode',t.mode,'status',t.status,'tx_hash',t.tx_hash,'block_number',t.block_number,'created_at',t.created_at) order by t.created_at desc) from public.transactions t where t.project_id=p.id and t.mode=p_mode),'[]'::jsonb)
  ) order by p.code),'[]'::jsonb) from public.projects p
  where (p_project is null or p.id=p_project) and p_mode in ('simulated','fuji','bsc')
$$;
revoke all on function private.public_dashboard(uuid,text) from public;
grant usage on schema private to anon;
grant execute on function private.public_dashboard(uuid,text) to anon,authenticated,service_role;
create function public.get_public_dashboard(p_project_id uuid default null,p_mode text default 'simulated') returns jsonb
language sql stable security invoker set search_path='' as $$ select private.public_dashboard(p_project_id,p_mode) $$;
revoke all on function public.get_public_dashboard(uuid,text) from public;
grant execute on function public.get_public_dashboard(uuid,text) to anon,authenticated,service_role;

create function public.cp_context(p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r text; m text;
begin
  select role into r from public.users where id=p_actor;
  if r is null then raise exception 'FORBIDDEN: unknown application user' using errcode='42501'; end if;
  select wallet_mode into m from private.runtime_config where singleton;
  return jsonb_build_object('role',r,'mode',m);
end; $$;

create function public.cp_available(p_project uuid,p_mode text) returns bigint
language sql stable security invoker set search_path='' as $$
  select coalesce((select sum(case when operation='fund_project' then amount_cents when operation='release' then -amount_cents else 0 end) from public.transactions where project_id=p_project and mode=p_mode and status='confirmed'),0)
  - coalesce((select sum(total_cents) from public.invoices where project_id=p_project and ledger_mode=p_mode and status in ('approved','payment_pending','payment_failed')),0)
$$;

create function public.cp_submit_invoice(p_actor uuid,p_invoice jsonb,p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ctx jsonb; inv public.invoices%rowtype; item jsonb; ix integer:=0; mid uuid;
begin
  ctx:=public.cp_context(p_actor);
  if ctx->>'role' <> 'supplier' then raise exception 'FORBIDDEN: supplier required' using errcode='42501'; end if;
  if ctx->>'mode' <> 'simulated' then raise exception 'CHAIN_NOT_READY: P3 adapter required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'VALIDATION: 1-100 items required'; end if;
  if not exists(select 1 from public.suppliers where id=(p_invoice->>'supplier_id')::uuid and user_id=p_actor) then raise exception 'FORBIDDEN: supplier ownership' using errcode='42501'; end if;
  mid:=nullif(p_invoice->>'milestone_id','')::uuid;
  if mid is not null and not exists(select 1 from public.transactions where milestone_id=mid and project_id=(p_invoice->>'project_id')::uuid and mode=ctx->>'mode' and operation='register_milestone' and status='confirmed') then raise exception 'INVALID_STATE: milestone not registered'; end if;
  insert into public.invoices(id,project_id,supplier_id,submitted_by,milestone_id,invoice_number,invoice_date,total_cents,document_path,document_sha256,ledger_mode)
  values((p_invoice->>'id')::uuid,(p_invoice->>'project_id')::uuid,(p_invoice->>'supplier_id')::uuid,p_actor,mid,
    p_invoice->>'invoice_number',(p_invoice->>'invoice_date')::date,(p_invoice->>'total_cents')::bigint,
    p_invoice->>'document_path',p_invoice->>'document_sha256',ctx->>'mode') returning * into inv;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.invoice_items(invoice_id,line_index,description,category,reference_sku,quantity,unit_price_cents,line_total_cents)
    values(inv.id,ix,item->>'description',item->>'category',nullif(item->>'reference_sku',''),
      (item->>'quantity')::numeric,(item->>'unit_price_cents')::bigint,(item->>'line_total_cents')::bigint);
    ix:=ix+1;
  end loop;
  insert into public.transactions(project_id,invoice_id,operation,amount_cents,mode,status,tx_hash,confirmed_at)
  values(inv.project_id,inv.id,'submit_request',inv.total_cents,inv.ledger_mode,'confirmed','sim_'||gen_random_uuid(),now());
  return to_jsonb(inv);
end; $$;

create function public.cp_store_analysis(p_actor uuid,p_invoice_id uuid,p_review jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype; review public.ai_reviews%rowtype;
begin
  if public.cp_context(p_actor)->>'role' <> 'municipality' then raise exception 'FORBIDDEN: municipality required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice_id for update;
  if inv.id is null then raise exception 'NOT_FOUND: invoice'; end if;
  if inv.status <> 'submitted' then raise exception 'INVALID_STATE: already analysed'; end if;
  insert into public.ai_reviews(invoice_id,extraction,checks,flags,benchmarks,potential_excess_cents,recommendation,explanation,mode)
  values(inv.id,p_review->'extraction',p_review->'checks',array(select jsonb_array_elements_text(p_review->'flags')),
    p_review->'benchmarks',(p_review->>'potential_excess_cents')::bigint,p_review->>'recommendation',p_review->>'explanation',p_review->>'mode') returning * into review;
  update public.invoices set status='analysed' where id=inv.id;
  return to_jsonb(review);
end; $$;

create function public.cp_analysis_context(p_actor uuid,p_invoice_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;
begin
  if public.cp_context(p_actor)->>'role' <> 'municipality' then raise exception 'FORBIDDEN: municipality required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice_id;
  if inv.id is null then raise exception 'NOT_FOUND: invoice'; end if;
  if inv.status <> 'submitted' then raise exception 'INVALID_STATE: submitted invoice required'; end if;
  return jsonb_build_object('invoice',to_jsonb(inv),
    'supplier',(select to_jsonb(s) from public.suppliers s where s.id=inv.supplier_id),
    'project',(select to_jsonb(p) from public.projects p where p.id=inv.project_id),
    'items',(select jsonb_agg(to_jsonb(i) order by line_index) from public.invoice_items i where invoice_id=inv.id),
    'prices',(select jsonb_agg(to_jsonb(r)) from public.reference_prices r),
    'available_cents',public.cp_available(inv.project_id,inv.ledger_mode),
    'duplicate',exists(select 1 from public.invoices i where i.id<>inv.id and
      ((i.supplier_id=inv.supplier_id and i.invoice_number=inv.invoice_number) or i.document_sha256=inv.document_sha256)));
end; $$;

create function public.cp_decide(p_actor uuid,p_invoice_id uuid,p_decision text,p_reason text default null) returns jsonb
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
  if ctx->>'mode' <> inv.ledger_mode or inv.ledger_mode <> 'simulated' then raise exception 'CHAIN_NOT_READY: active-mode adapter required'; end if;
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

create function public.cp_execute_payment(p_actor uuid,p_invoice_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype; tx public.transactions%rowtype; ctx jsonb; balance bigint;
begin
  ctx:=public.cp_context(p_actor);
  if ctx->>'role' <> 'municipality' then raise exception 'FORBIDDEN: municipality required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice_id;
  if inv.id is null then raise exception 'NOT_FOUND: invoice'; end if;
  perform 1 from public.projects where id=inv.project_id for update;
  select * into inv from public.invoices where id=p_invoice_id for update;
  select * into tx from public.transactions where invoice_id=inv.id and operation='release' and status in ('pending','confirmed') limit 1;
  if tx.id is not null then return to_jsonb(tx); end if;
  if ctx->>'mode' <> inv.ledger_mode or inv.ledger_mode <> 'simulated' then raise exception 'CHAIN_NOT_READY: active-mode adapter required'; end if;
  if inv.status not in ('approved','payment_failed') then raise exception 'INVALID_STATE: approved invoice required'; end if;
  if inv.milestone_id is not null and not exists(select 1 from public.milestones where id=inv.milestone_id and status='verified') then raise exception 'MILESTONE_NOT_VERIFIED: delivery required'; end if;
  select coalesce(sum(case when operation='fund_project' then amount_cents when operation='release' then -amount_cents else 0 end),0) into balance
    from public.transactions where project_id=inv.project_id and mode=inv.ledger_mode and status='confirmed';
  if balance < inv.total_cents then raise exception 'BUDGET_EXCEEDED: insufficient balance'; end if;
  update public.invoices set status='payment_pending' where id=inv.id;
  insert into public.transactions(project_id,invoice_id,operation,amount_cents,mode,status,tx_hash,confirmed_at)
  values(inv.project_id,inv.id,'release',inv.total_cents,inv.ledger_mode,'confirmed','sim_'||gen_random_uuid(),now()) returning * into tx;
  update public.invoices set status='paid' where id=inv.id;
  return to_jsonb(tx);
end; $$;

create function public.cp_milestone(p_actor uuid,p_milestone uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.milestones%rowtype; ctx jsonb; op text; tx public.transactions%rowtype;
begin
  ctx:=public.cp_context(p_actor);
  if ctx->>'role' not in ('municipality','auditor') or (p_action='register' and ctx->>'role'<>'municipality') then raise exception 'FORBIDDEN: official role required' using errcode='42501'; end if;
  if p_action not in ('register','verify') or p_action is null then raise exception 'VALIDATION: invalid action'; end if;
  if ctx->>'mode' <> 'simulated' then raise exception 'CHAIN_NOT_READY: P3 adapter required'; end if;
  select * into m from public.milestones where id=p_milestone for update;
  if m.id is null then raise exception 'NOT_FOUND: milestone'; end if;
  op:=case p_action when 'register' then 'register_milestone' else 'verify_milestone' end;
  select * into tx from public.transactions where milestone_id=m.id and operation=op and mode=ctx->>'mode' and status='confirmed' limit 1;
  if tx.id is not null then return to_jsonb(tx); end if;
  if p_action='verify' and not exists(select 1 from public.transactions where milestone_id=m.id and operation='register_milestone' and mode=ctx->>'mode' and status='confirmed') then raise exception 'INVALID_STATE: register milestone first'; end if;
  if p_action='verify' then
    insert into public.verifications(milestone_id,actor_id,kind,note) values(m.id,p_actor,'official','Official verification') on conflict do nothing;
    update public.milestones set status='verified',verified_at=now() where id=m.id;
  end if;
  insert into public.transactions(project_id,milestone_id,operation,mode,status,tx_hash,confirmed_at)
  values(m.project_id,m.id,op,ctx->>'mode','confirmed','sim_'||gen_random_uuid(),now()) returning * into tx;
  return to_jsonb(tx);
end; $$;

-- Every cp_* RPC is server-only, including reads of privileged operational data.
create function public.cp_add_evidence(p_actor uuid,p_milestone uuid,p_path text,p_hash text,p_caption text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ctx jsonb; e public.evidence%rowtype; prior uuid;
begin
  ctx:=public.cp_context(p_actor);
  if ctx->>'role' not in ('supplier','citizen') then raise exception 'FORBIDDEN: supplier or citizen required' using errcode='42501'; end if;
  if not exists(select 1 from public.milestones where id=p_milestone) then raise exception 'NOT_FOUND: milestone'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_hash,0));
  select id into prior from public.evidence where document_sha256=p_hash order by created_at,id limit 1;
  insert into public.evidence(milestone_id,uploaded_by,object_path,document_sha256,caption,duplicate_of)
  values(p_milestone,p_actor,p_path,p_hash,p_caption,prior) returning * into e;
  return to_jsonb(e)||jsonb_build_object('flags',case when prior is null then '[]'::jsonb else '["DUPLICATE_EVIDENCE"]'::jsonb end);
end; $$;

create function public.cp_respond_concern(p_actor uuid,p_concern uuid,p_response text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.concerns%rowtype;
begin
  if public.cp_context(p_actor)->>'role' <> 'municipality' then raise exception 'FORBIDDEN: municipality required' using errcode='42501'; end if;
  if length(trim(coalesce(p_response,''))) not between 1 and 4000 then raise exception 'VALIDATION: response required'; end if;
  update public.concerns set response=p_response,responded_by=p_actor,responded_at=now(),status='responded' where id=p_concern returning * into c;
  if c.id is null then raise exception 'NOT_FOUND: concern'; end if;
  return to_jsonb(c);
end; $$;

create function public.cp_create_project(p_actor uuid,p_project jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; ctx jsonb;
begin
  ctx:=public.cp_context(p_actor);
  if ctx->>'role' <> 'municipality' then raise exception 'FORBIDDEN: municipality required' using errcode='42501'; end if;
  if ctx->>'mode' <> 'simulated' then raise exception 'CHAIN_NOT_READY: P3 adapter required'; end if;
  insert into public.projects(code,name,description,location,budget_cents,permitted_categories,created_by)
  values(p_project->>'code',p_project->>'name',coalesce(p_project->>'description',''),coalesce(p_project->>'location',''),
    (p_project->>'budget_cents')::bigint,array(select jsonb_array_elements_text(p_project->'permitted_categories')),p_actor) returning * into p;
  insert into public.transactions(project_id,operation,amount_cents,mode,status,tx_hash,confirmed_at) values
    (p.id,'create_project',0,'simulated','confirmed','sim_'||gen_random_uuid(),now()),
    (p.id,'fund_project',p.budget_cents,'simulated','confirmed','sim_'||gen_random_uuid(),now());
  return to_jsonb(p);
end; $$;

do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'cp\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end; $$;
notify pgrst,'reload schema';
commit;
