create or replace function private.public_dashboard(p_project uuid,p_mode text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'code',p.code,'name',p.name,'description',p.description,'location',p.location,
    'budget_cents',p.budget_cents,'permitted_categories',p.permitted_categories,'mode',p_mode,
    'paid_cents',coalesce((select sum(t.amount_cents) from public.transactions t where t.project_id=p.id and t.mode=p_mode and t.operation='release' and t.status='confirmed'),0),
    'balance_cents',coalesce((select sum(case when t.operation='fund_project' then t.amount_cents when t.operation='release' then -t.amount_cents else 0 end) from public.transactions t where t.project_id=p.id and t.mode=p_mode and t.status='confirmed'),0),
    'available_cents',public.cp_available(p.id,p_mode),
    'wallet_address',(select w.wallet_address from public.project_wallets w where w.project_id=p.id and w.mode=p_mode),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'supplier_name',s.name,'total_cents',i.total_cents,'status',i.status,'invoice_date',i.invoice_date) order by i.created_at) from public.invoices i join public.suppliers s on s.id=i.supplier_id where i.project_id=p.id and i.ledger_mode=p_mode),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'invoice_id',t.invoice_id,'operation',t.operation,'amount_cents',t.amount_cents,'mode',t.mode,'status',t.status,'tx_hash',t.tx_hash,'block_number',t.block_number,'created_at',t.created_at) order by t.created_at desc) from public.transactions t where t.project_id=p.id and t.mode=p_mode),'[]'::jsonb)
  ) order by p.code),'[]'::jsonb) from public.projects p
  where (p_project is null or p.id=p_project) and p_mode in ('simulated','fuji','bsc')
$$;