// The CP001 demo invoices as analysis contexts (fictional data, same as seed.sql).
// Shared by ai_test.ts and tools/ai-try.mts.
import type { AnalysisContext } from './rules.ts';

const project = { permitted_categories: ['water_storage', 'pipes', 'installation'] };
const prices = [
  { sku: 'TANK-10000L', unit_price_cents: 1450000, source: 'Seeded fictional demo data' },
  { sku: 'PIPE-HDPE-250-12', unit_price_cents: 520000, source: 'Seeded fictional demo data' },
  { sku: 'INSTALL-TANK', unit_price_cents: 750000, source: 'Seeded fictional demo data' },
];
const blueBasin = { name: 'Blue Basin Tanks (Pty) Ltd', registration_no: '2015/100001/07', registered_on: '2015-01-15', verified: true };
const pipeworks = { name: 'Pipeworks Direct CC', registration_no: '2026/771204/23', registered_on: '2026-10-28', verified: false };
const summit = { name: 'Summit Motors (Pty) Ltd', registration_no: '2016/100003/07', registered_on: '2016-03-01', verified: true };
const base = { project, prices, duplicate: false, available_cents: 188160000 };

export const DEMO: Record<string, AnalysisContext> = {
  '#1 tanks': { ...base, supplier: blueBasin,
    invoice: { supplier_id: 's1', invoice_number: 'BB-001', invoice_date: '2026-11-18', total_cents: 11840000 },
    items: [{ description: '10,000 L water tank', category: 'water_storage', reference_sku: 'TANK-10000L', quantity: 8, unit_price_cents: 1480000, line_total_cents: 11840000 }] },
  '#2 pipes': { ...base, supplier: pipeworks,
    invoice: { supplier_id: 's2', invoice_number: 'PD-0147', invoice_date: '2026-11-18', total_cents: 24000000 },
    items: [{ description: '250mm HDPE pipe 12m', category: 'pipes', reference_sku: 'PIPE-HDPE-250-12', quantity: 20, unit_price_cents: 1200000, line_total_cents: 24000000 }] },
  '#3 bakkie': { ...base, supplier: summit,
    invoice: { supplier_id: 's3', invoice_number: 'SM-2290', invoice_date: '2026-11-19', total_cents: 78500000 },
    items: [{ description: '4x4 double-cab bakkie', category: 'vehicles', reference_sku: null, quantity: 1, unit_price_cents: 78500000, line_total_cents: 78500000 }] },
  // The case fixed rules cannot see: a vehicle declared under a permitted category.
  '#3b bakkie as "pipes"': { ...base, supplier: summit,
    invoice: { supplier_id: 's3', invoice_number: 'SM-2291', invoice_date: '2026-11-19', total_cents: 78500000 },
    items: [{ description: '4x4 double-cab bakkie', category: 'pipes', reference_sku: null, quantity: 1, unit_price_cents: 78500000, line_total_cents: 78500000 }] },
};
