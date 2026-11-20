-- Complete P1's read/confirmation contract without widening profile access.
begin;
alter table public.verifications add column answer text
  check(answer in ('yes','no','not_sure'));
alter table public.verifications add constraint verification_answer_community
  check(answer is null or kind='community');
grant insert(answer) on public.verifications to authenticated;

-- Keep the existing redacted dashboard and include public milestone fields.
create or replace function private.public_dashboard(p_project uuid,p_mode text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'code',p.code,'name',p.name,'description',p.description,'location',p.location,
    'budget_cents',p.budget_cents,'permitted_categories',p.permitted_categories,'mode',p_mode,
    'paid_cents',coalesce((select sum(t.amount_cents) from public.transactions t where t.project_id=p.id and t.mode=p_mode and t.operation='release' and t.status='confirmed'),0),
    'balance_cents',coalesce((select sum(case when t.operation='fund_project' then t.amount_cents when t.operation='release' then -t.amount_cents else 0 end) from public.transactions t where t.project_id=p.id and t.mode=p_mode and t.status='confirmed'),0),
    'available_cents',public.cp_available(p.id,p_mode),
    'wallet_address',(select w.wallet_address from public.project_wallets w where w.project_id=p.id and w.mode=p_mode),
    'milestones',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'code',m.code,'title',m.title,'description',m.description,'status',m.status,'verified_at',m.verified_at) order by m.code,m.id) from public.milestones m where m.project_id=p.id),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'supplier_name',s.name,'total_cents',i.total_cents,'status',i.status,'invoice_date',i.invoice_date) order by i.created_at) from public.invoices i join public.suppliers s on s.id=i.supplier_id where i.project_id=p.id and i.ledger_mode=p_mode),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'invoice_id',t.invoice_id,'operation',t.operation,'amount_cents',t.amount_cents,'mode',t.mode,'status',t.status,'tx_hash',t.tx_hash,'block_number',t.block_number,'created_at',t.created_at) order by t.created_at desc) from public.transactions t where t.project_id=p.id and t.mode=p_mode),'[]'::jsonb)
  ) order by p.code),'[]'::jsonb) from public.projects p
  where (p_project is null or p.id=p_project) and p_mode in ('simulated','fuji','bsc')
$$;

-- Edge first reads the invoice under the caller's RLS, then uses this service-only
-- RPC. Repeat ownership checks here and return only the actor's display name.
create function public.cp_invoice_approvals(p_actor uuid,p_invoice_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ctx jsonb;
begin
  ctx:=public.cp_context(p_actor);
  if not exists(
    select 1 from public.invoices i join public.suppliers s on s.id=i.supplier_id
    where i.id=p_invoice_id and (ctx->>'role' in ('municipality','auditor')
      or (ctx->>'role'='supplier' and s.user_id=p_actor))
  ) then raise exception 'FORBIDDEN: invoice access required'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('actor_display_name',u.display_name)
    order by a.created_at,a.id),'[]'::jsonb)
    from public.approvals a join public.users u on u.id=a.actor_id where a.invoice_id=p_invoice_id);
end; $$;
revoke all on function public.cp_invoice_approvals(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cp_invoice_approvals(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
