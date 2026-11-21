// Try the AI PDF features locally with YOUR key: the form draft (POST /invoices/extract), and
// the analysis check, where the same code civicproof-api uses compares the PDF with the form.
// Nothing is stored and no invoice is touched.
//
//   1. GEMINI_API_KEY=AIza... in contracts/.env (git-ignored; never commit it)
//   2. From the repo root:   node supabase/tools/pdf-try.mts path/to/PD-0147.pdf [more.pdf ...]
//      (Node 22 needs:       node --experimental-strip-types supabase/tools/pdf-try.mts ...)
//
// For PD-0147.pdf it runs two cases: the honest form (R12,000.00 a pipe, same as the PDF) and
// THE CHEAT (the supplier types the R5,200.00 benchmark price into the form, but the attached
// PDF still charges R12,000.00).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { draftFromPdf } from '../functions/_shared/draft.ts';
import { applyDocumentCheck, readInvoicePdf } from '../functions/_shared/extract.ts';
import { DEMO } from '../functions/_shared/demo_contexts.ts';
import { analyse, type AnalysisContext } from '../functions/_shared/rules.ts';

try { process.loadEnvFile('contracts/.env'); } catch { /* fall back to the shell environment */ }
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('✗ No GEMINI_API_KEY. Add it to contracts/.env, then run this again.'); process.exit(1); }
const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node supabase/tools/pdf-try.mts PD-0147.pdf SM-2290.pdf BB-002.pdf'); process.exit(1); }
const env = { get: (k: string) => ({ AI_MODE: 'llm', GEMINI_API_KEY: key, GEMINI_MODEL: process.env.GEMINI_MODEL } as Record<string, string | undefined>)[k] };

// The form each demo PDF belongs to.
const tanks = DEMO['#1 tanks'];
const FORMS: Record<string, [string, AnalysisContext][]> = {
  'PD-0147': [
    ['honest form', DEMO['#2 pipes']],
    ['THE CHEAT: form says R5,200.00 a pipe', { ...DEMO['#2 pipes'], invoice: { ...DEMO['#2 pipes'].invoice, total_cents: 10400000 },
      items: [{ ...DEMO['#2 pipes'].items[0], unit_price_cents: 520000, line_total_cents: 10400000 }] }],
  ],
  'SM-2290': [['honest form', DEMO['#3 bakkie']]],
  'BB-002': [['honest form', { ...tanks, invoice: { ...tanks.invoice, invoice_number: 'BB-002', invoice_date: '2026-11-20', total_cents: 6400000 },
    items: [{ description: 'Tank installation', category: 'installation', reference_sku: 'INSTALL-TANK', quantity: 8, unit_price_cents: 800000, line_total_cents: 6400000 }] }]],
};

for (const file of files) {
  const name = basename(file).replace(/\.pdf$/i, '');
  const t = Date.now();
  const read = await readInvoicePdf(new Uint8Array(readFileSync(file)), env);
  console.log(`\n━━ ${basename(file)} · ${read ? `🤖 read by ${read.model} (${Date.now() - t} ms)` : '✗ could not be read (see the warning above)'}`);
  if (!read) continue;
  const d = read.doc;
  console.log(`   PDF says: ${d.supplier_name} · ${d.registration_no} · ${d.invoice_number} · ${d.invoice_date} · total R${(d.total_cents / 100).toFixed(2)}`);
  for (const l of d.line_items) console.log(`             ${l.quantity} × ${l.description} @ R${(l.unit_price_cents / 100).toFixed(2)}`);
  // POST /invoices/extract: the draft the supplier's form would be pre-filled with.
  const forms = FORMS[name] ?? [];
  if (forms.length) {
    const ctx = forms[0][1];
    const draft = await draftFromPdf(new Uint8Array(readFileSync(file)), ctx.project.permitted_categories, ctx.supplier, env);
    if (draft.ok) {
      const d = draft.data;
      console.log(`   form draft (/invoices/extract): ${d.invoice_number} · ${d.invoice_date} · total ${d.total_cents} cents · confidence ${d.confidence}`);
      for (const l of d.line_items) console.log(`             ${l.quantity} × ${l.description} [${l.category ?? 'no category'}] @ ${l.unit_price_cents} cents`);
      for (const w of d.warnings) console.log(`      ⚠ ${w}`);
    } else console.log(`   form draft: ✗ ${draft.reason}`);
  }
  for (const [label, ctx] of FORMS[name] ?? []) {
    const out = applyDocumentCheck(analyse(ctx), ctx, read, true);
    const found = out.checks.filter((c: { code: string }) => c.code === 'DOCUMENT_MISMATCH');
    console.log(`   vs ${label}: ${found.length ? `⚠ ${found.length} difference(s) → ${out.recommendation}` : '✓ matches'}`);
    for (const c of found) console.log(`      - ${c.detail}`);
  }
}
