import { withCatalogueMatches } from './catalogue.ts';
import { DEMO } from './demo_contexts.ts';
import { analyse, type AnalysisContext } from './rules.ts';

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

// The live catalogue (seed.sql): cp_analysis_context returns whole reference_prices rows.
const catalogue = [
  { sku: 'TANK-10000L', description: '10,000 L water tank', category: 'water_storage', unit_price_cents: 1450000, source: 'Seeded fictional demo data' },
  { sku: 'PIPE-HDPE-250-12', description: '250 mm HDPE pipe, 12 m', category: 'pipes', unit_price_cents: 520000, source: 'Seeded fictional demo data' },
  { sku: 'INSTALL-TANK', description: 'Tank installation', category: 'installation', unit_price_cents: 750000, source: 'Seeded fictional demo data' },
];
// A demo invoice as the web form sends it: no SKU on any line.
const fromForm = (name: string, description?: string): AnalysisContext => {
  const c = DEMO[name];
  return { ...c, prices: catalogue, items: c.items.map((i) => ({ ...i, reference_sku: null, description: description ?? i.description })) };
};

Deno.test('form-submitted pipes invoice is matched and the R136,000 excess appears', () => {
  const r = analyse(withCatalogueMatches(fromForm('#2 pipes', '250mm HDPE pipes (12 m lengths)')));
  assert(r.flags.includes('PRICE_ABOVE_BENCHMARK') && r.potential_excess_cents === 13600000, `got ${r.flags} / ${r.potential_excess_cents}`);
  assert(r.recommendation === 'HOLD_FOR_REVIEW', 'held');
});

Deno.test('form-submitted tanks invoice is matched and still approves', () => {
  const r = analyse(withCatalogueMatches(fromForm('#1 tanks', '10 000 L water tanks')));
  assert(r.recommendation === 'APPROVE' && r.flags.length === 0 && r.benchmarks.length === 1, `got ${r.recommendation} ${r.flags}`);
});

Deno.test('installation lines match the installation price', () => {
  const ctx: AnalysisContext = { ...fromForm('#1 tanks'), items: [{ description: 'Installation of tanks at 4 sites', category: 'installation', reference_sku: null, quantity: 8, unit_price_cents: 800000, line_total_cents: 6400000 }] };
  ctx.invoice = { ...ctx.invoice, total_cents: 6400000 };
  assert(withCatalogueMatches(ctx).items[0].reference_sku === 'INSTALL-TANK', 'matched');
});

Deno.test('a bakkie declared as pipes is NOT priced as a pipe (left for the AI concern)', () => {
  const ctx = withCatalogueMatches(fromForm('#3b bakkie as "pipes"'));
  assert(ctx.items[0].reference_sku === null, 'unmatched');
  assert(analyse(ctx).recommendation === 'APPROVE', 'rules alone still approve; AI_CATEGORY_CONCERN is what holds it');
});

Deno.test('a vehicle category with no catalogue item stays unmatched and is rejected', () => {
  const r = analyse(withCatalogueMatches(fromForm('#3 bakkie')));
  assert(r.recommendation === 'REJECT' && r.flags.includes('NO_BENCHMARK'), `got ${r.recommendation}`);
});

Deno.test('a SKU the supplier gave is never replaced, and the input is not modified', () => {
  const ctx = { ...fromForm('#2 pipes'), items: [{ ...DEMO['#2 pipes'].items[0], reference_sku: 'SOMETHING-ELSE' }] };
  assert(withCatalogueMatches(ctx).items[0].reference_sku === 'SOMETHING-ELSE', 'kept');
  const plain = fromForm('#2 pipes');
  withCatalogueMatches(plain);
  assert(plain.items[0].reference_sku === null, 'input untouched');
});

Deno.test('two catalogue items in one category: no guessing', () => {
  const ctx = { ...fromForm('#2 pipes'), prices: [...catalogue, { sku: 'PIPE-110', description: '110 mm HDPE pipe', category: 'pipes', unit_price_cents: 150000, source: 'x' }] };
  assert(withCatalogueMatches(ctx).items[0].reference_sku === null, 'ambiguous → unmatched');
});
