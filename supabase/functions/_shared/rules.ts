// Deterministic fallback for P4's AI integration. No model key or prompts required.
export type Item = { description: string; category: string; reference_sku?: string | null; quantity: number; unit_price_cents: number; line_total_cents: number };
export type Invoice = { supplier_id: string; invoice_number: string; invoice_date: string; total_cents: number };
export type Price = { sku: string; unit_price_cents: number; source: string };
export type AnalysisContext = {
  invoice: Invoice;
  supplier: { name: string; registration_no: string; registered_on: string; verified: boolean };
  project: { permitted_categories: string[] };
  items: Item[];
  prices: Price[] | null;
  duplicate: boolean;
  available_cents: number;
};
type Check = { code: string; severity: 'high' | 'medium' | 'info'; detail: string; line?: number };

export function analyse(context: AnalysisContext) {
  const checks: Check[] = [];
  const benchmarks: Record<string, unknown>[] = [];
  let potentialExcess = 0;
  const add = (code: string, severity: Check['severity'], detail: string, line?: number) => checks.push({ code, severity, detail, ...(line === undefined ? {} : { line }) });
  let sum = 0n;
  context.items.forEach((item, line) => {
    sum += BigInt(item.line_total_cents);
    const scaledQuantity = BigInt(Math.round(item.quantity * 10000));
    const expected = (scaledQuantity * BigInt(item.unit_price_cents) + 5000n) / 10000n;
    const delta = expected - BigInt(item.line_total_cents);
    if (delta > 1n || delta < -1n) add('ARITHMETIC_MISMATCH', 'high', 'Quantity times unit price differs from line total.', line);
    if (!context.project.permitted_categories.includes(item.category)) add('PURPOSE_MISMATCH', 'high', 'Category is outside the project purpose.', line);
    const price = context.prices?.find((p) => p.sku === item.reference_sku);
    if (!price) { add('NO_BENCHMARK', 'info', 'No reference price matches this line.', line); return; }
    const benchmarkTotal = Number((scaledQuantity * BigInt(price.unit_price_cents) + 5000n) / 10000n);
    const excess = Math.max(0, item.line_total_cents - benchmarkTotal);
    benchmarks.push({ line, sku: price.sku, benchmark_unit_cents: price.unit_price_cents, invoice_unit_cents: item.unit_price_cents, benchmark_total_cents: benchmarkTotal, excess_cents: excess, source: price.source });
    if (BigInt(item.unit_price_cents) * 100n > BigInt(price.unit_price_cents) * 115n) {
      add('PRICE_ABOVE_BENCHMARK', 'high', 'Unit price exceeds the reference price by more than 15%.', line);
      potentialExcess += excess;
    }
  });
  const totalDelta = sum - BigInt(context.invoice.total_cents);
  if (totalDelta > 1n || totalDelta < -1n) add('ARITHMETIC_MISMATCH', 'high', 'Line totals differ from the invoice total.');
  if (context.duplicate) add('DUPLICATE_INVOICE', 'high', 'The supplier invoice number or document hash has been submitted before.');
  if (context.invoice.total_cents > context.available_cents) add('BUDGET_EXCEEDED', 'high', 'Invoice total exceeds currently available project funds.');
  const ageDays = (Date.parse(context.invoice.invoice_date) - Date.parse(context.supplier.registered_on)) / 86400000;
  if (!context.supplier.verified || ageDays < 90) add('SUPPLIER_REVIEW_REQUIRED', 'medium', 'Supplier is unverified or registered less than 90 days before the invoice date.');
  const flags = [...new Set(checks.filter((c) => c.severity !== 'info').map((c) => c.code))];
  const recommendation = flags.includes('PURPOSE_MISMATCH') ? 'REJECT' : checks.some((c) => c.severity === 'high' || c.severity === 'medium') ? 'HOLD_FOR_REVIEW' : 'APPROVE';
  return {
    extraction: { supplier_name: context.supplier.name, registration_no: context.supplier.registration_no, invoice_number: context.invoice.invoice_number, invoice_date: context.invoice.invoice_date, line_items: context.items, total_cents: context.invoice.total_cents, confidence: 1 },
    checks, flags: [...new Set(checks.map((c) => c.code))], benchmarks, potential_excess_cents: potentialExcess, recommendation,
    explanation: `${recommendation === 'APPROVE' ? 'The deterministic checks found no blocking flags.' : 'The deterministic checks require an authorised human decision.'} ${checks.length ? checks.map((c) => c.detail).filter((v, i, a) => a.indexOf(v) === i).join(' ') : ''} AI recommends; authorised humans decide.`,
    mode: 'rules',
  };
}
