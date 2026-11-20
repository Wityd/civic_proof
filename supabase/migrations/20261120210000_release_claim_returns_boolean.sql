-- Fix: cp_chain_release_claim returned void, which PostgREST answers with an EMPTY
-- body; civicproof-api's db() parses every response as JSON, so the call crashed with
-- INTERNAL_ERROR after a confirmed chain transaction. Same behaviour, now returns
-- whether a claim was released.
begin;
drop function public.cp_chain_release_claim(uuid);
create function public.cp_chain_release_claim(p_tx_id uuid) returns boolean
language sql security invoker set search_path='' as $$
  with released as (
    update private.chain_dispatch d set released_at=now()
    where d.tx_id=p_tx_id and d.released_at is null
      and not exists(select 1 from public.transactions t where t.id=d.tx_id and t.status='pending')
    returning 1)
  select exists(select 1 from released)
$$;
revoke all on function public.cp_chain_release_claim(uuid) from public,anon,authenticated;
grant execute on function public.cp_chain_release_claim(uuid) to service_role;
notify pgrst,'reload schema';
commit;
