-- Database safety checks. All fixtures are rolled back; no files are uploaded.
begin;
do $$
declare supplier_user uuid; municipal_user uuid; project_id uuid := '10000000-0000-4000-8000-000000000001';
  supplier_id uuid := '20000000-0000-4000-8000-000000000001';
  invoice_one uuid := gen_random_uuid(); invoice_two uuid := gen_random_uuid();
  other_project uuid := gen_random_uuid(); release_id uuid := gen_random_uuid(); approval_id uuid;
begin
  select id into strict supplier_user from public.users where role='supplier';
  select id into strict municipal_user from public.users where role='municipality';
  if (select count(*) from pg_tables where schemaname='public') <> 13 then raise exception 'Expected 13 application tables'; end if;
  if exists (select 1 from pg_tables where schemaname='public' and not rowsecurity) then raise exception 'RLS missing'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and
    (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or
     has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
    then raise exception 'Browser role has application table privileges'; end if;
  if exists (select 1 from pg_policies where schemaname in ('public','storage')) then raise exception 'Unexpected browser policy'; end if;

  insert into public.invoices (id,project_id,supplier_id,submitted_by,invoice_number,invoice_date,total_cents,document_path,document_sha256)
  values (invoice_one,project_id,supplier_id,supplier_user,'VERIFY-DUPLICATE','2026-11-18',100,'verification/no-real-file.pdf',repeat('a',64)),
    (invoice_two,project_id,supplier_id,supplier_user,'VERIFY-DUPLICATE','2026-11-18',100,'verification/no-real-file.pdf',repeat('a',64));
  -- The duplicate number and hash above must both be accepted.
  begin
    update public.invoices set status='paid' where id=invoice_one;
    raise exception 'Test failed: invalid state accepted';
  exception when raise_exception then
    if SQLERRM not like 'INVALID_STATE:%' then raise; end if;
  end;

  insert into public.projects (id,code,name,budget_cents,permitted_categories,created_by)
    values(other_project,'VERIFY-'||other_project::text,'Rollback-only project',1000,array['pipes'],municipal_user);
  begin
    update public.invoices set project_id=other_project,milestone_id='30000000-0000-4000-8000-000000000001' where id=invoice_two;
    raise exception 'Test failed: cross-project milestone accepted';
  exception when foreign_key_violation then null; end;

  insert into public.transactions (id,project_id,invoice_id,operation,amount_cents,mode,status)
    values(release_id,project_id,invoice_one,'release',100,'simulated','pending');
  begin
    insert into public.transactions (project_id,invoice_id,operation,amount_cents,mode,status)
      values(project_id,invoice_one,'release',100,'simulated','pending');
    raise exception 'Test failed: duplicate live release accepted';
  exception when unique_violation then null; end;
  update public.transactions set status='failed' where id=release_id;
  insert into public.transactions (project_id,invoice_id,operation,amount_cents,mode,status)
    values(project_id,invoice_one,'release',100,'simulated','pending');

  update public.invoices set status='analysed' where id=invoice_one;
  insert into public.ai_reviews (invoice_id,extraction,flags,recommendation,explanation,mode)
    values(invoice_one,'{}',array['PRICE_ABOVE_BENCHMARK'],'HOLD_FOR_REVIEW','Rollback-only check','rules');
  begin
    insert into public.approvals(invoice_id,actor_id,decision) values(invoice_one,municipal_user,'approve');
    raise exception 'Test failed: flagged approval without reason accepted';
  exception when raise_exception then
    if SQLERRM not like 'REASON_REQUIRED:%' then raise; end if;
  end;
  insert into public.approvals(invoice_id,actor_id,decision,reason)
    values(invoice_one,municipal_user,'approve','Rollback-only justification') returning id into approval_id;
  if not (select overrode_ai from public.approvals where id=approval_id) then raise exception 'AI override not recorded'; end if;
  update public.invoices set status='approved' where id=invoice_one;
  update public.invoices set status='payment_pending' where id=invoice_one;
  begin
    update public.invoices set status='paid' where id=invoice_one;
    raise exception 'Test failed: paid without confirmation accepted';
  exception when raise_exception then
    if SQLERRM not like 'INVALID_STATE:%' then raise; end if;
  end;

  update public.invoices set submitted_by=municipal_user,status='analysed' where id=invoice_two;
  begin
    insert into public.approvals(invoice_id,actor_id,decision,reason)
      values(invoice_two,municipal_user,'approve','Rollback-only test');
    raise exception 'Test failed: self approval accepted';
  exception when raise_exception then
    if SQLERRM not like 'FORBIDDEN: self approval%' then raise; end if;
  end;
end;
$$;
select 'passed: RLS, grants, duplicate invoice acceptance, milestone isolation, release uniqueness, state transitions, override reasons and self approval' as verification;
rollback;
