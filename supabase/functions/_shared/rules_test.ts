import { analyse, type AnalysisContext } from './rules.ts';

function assert(value: unknown, message = 'Assertion failed') { if (!value) throw new Error(message); }
function baseline(): AnalysisContext { return {
  invoice: { supplier_id: 'demo', invoice_number: 'T-1', invoice_date: '2026-11-18', total_cents: 11840000 },
  supplier: { name: 'Blue Basin', registration_no: 'demo', registered_on: '2015-01-15', verified: true },
  project: { permitted_categories: ['water_storage','pipes','installation'] },
  items: [{ description: 'Tank', category: 'water_storage', reference_sku: 'TANK', quantity: 8, unit_price_cents: 1480000, line_total_cents: 11840000 }],
  prices: [{ sku: 'TANK', unit_price_cents: 1450000, source: 'Fictional' }], duplicate: false, available_cents: 200000000,
}; }
Deno.test('fair tank invoice approves with no flags', () => { const r = analyse(baseline()); assert(r.recommendation === 'APPROVE'); assert(r.flags.length === 0); assert(r.potential_excess_cents === 0); });
Deno.test('inflated pipe invoice holds and exposes R136,000 excess', () => {
  const c = baseline(); c.invoice.total_cents = 24000000;
  c.items = [{ description: 'Pipe', category: 'pipes', reference_sku: 'PIPE', quantity: 20, unit_price_cents: 1200000, line_total_cents: 24000000 }];
  c.prices = [{ sku: 'PIPE', unit_price_cents: 520000, source: 'Fictional' }]; c.supplier.registered_on = '2026-10-28'; c.supplier.verified = false;
  const r = analyse(c); assert(r.recommendation === 'HOLD_FOR_REVIEW'); assert(r.flags.includes('PRICE_ABOVE_BENCHMARK')); assert(r.flags.includes('SUPPLIER_REVIEW_REQUIRED')); assert(r.potential_excess_cents === 13600000);
});
Deno.test('wrong purpose rejects even without benchmark', () => { const c = baseline(); c.items[0].category = 'vehicles'; c.items[0].reference_sku = null; const r = analyse(c); assert(r.recommendation === 'REJECT'); assert(r.checks.some((x) => x.code === 'NO_BENCHMARK')); });
Deno.test('duplicates, arithmetic and budget are independently flagged', () => { const c = baseline(); c.duplicate = true; c.available_cents = 1; c.items[0].line_total_cents += 5; const r = analyse(c); for (const code of ['DUPLICATE_INVOICE','ARITHMETIC_MISMATCH','BUDGET_EXCEEDED']) assert(r.flags.includes(code)); });
Deno.test('medium supplier-age flag holds even with fair prices', () => { const c = baseline(); c.supplier.registered_on = '2026-11-01'; assert(analyse(c).recommendation === 'HOLD_FOR_REVIEW'); });
Deno.test('exactly 15% over benchmark is allowed', () => { const c = baseline(); c.items[0].unit_price_cents = 1667500; c.items[0].line_total_cents = 13340000; c.invoice.total_cents = 13340000; assert(!analyse(c).flags.includes('PRICE_ABOVE_BENCHMARK')); });
Deno.test('one-cent arithmetic tolerance is accepted', () => { const c = baseline(); c.invoice.total_cents += 1; assert(!analyse(c).flags.includes('ARITHMETIC_MISMATCH')); });
