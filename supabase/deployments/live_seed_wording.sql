-- P2: run once in the Supabase SQL editor (live project). Safe to re-run.
-- Rewords the CP001 seed text so it reads naturally on screen. It changes text only:
-- no amount, status, wallet, invoice, chain record or id.
begin;

update public.projects
set description = 'Water tanks, pipes and installation for four village sites in Kgotso Valley.',
    location    = 'Kgotso Valley'
where id = '10000000-0000-4000-8000-000000000001';

update public.milestones
set description = 'Official verification is required before the installation payment is released.'
where id = '30000000-0000-4000-8000-000000000001';

update public.reference_prices
set source = 'CivicProof reference price list (Nov 2026)'
where source = 'Seeded fictional demo data';

-- Analyses already run keep a copy of the price source: reword those copies too.
update public.ai_reviews r
set benchmarks = (
  select jsonb_agg(case when b->>'source' = 'Seeded fictional demo data'
                        then jsonb_set(b, '{source}', '"CivicProof reference price list (Nov 2026)"')
                        else b end order by ord)
  from jsonb_array_elements(r.benchmarks) with ordinality as e(b, ord))
where r.benchmarks::text like '%Seeded fictional demo data%';

commit;

-- Check: every row below should be 0.
select 'projects' as t, count(*) from public.projects where description ilike '%fictional%' or location ilike '%fictional%'
union all select 'milestones', count(*) from public.milestones where description ilike '%fictional%'
union all select 'reference_prices', count(*) from public.reference_prices where source ilike '%fictional%'
union all select 'ai_reviews', count(*) from public.ai_reviews where benchmarks::text ilike '%fictional%';
