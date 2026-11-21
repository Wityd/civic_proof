// Step 5 of the AI pipeline (brief: "possible supplier relationships"), done by plain code.
//
// Two "different" companies that share a payout wallet, a contact email or a contact phone
// number may be one business split in two: a classic way to split one large purchase into
// smaller invoices, or to fake competing quotes. When the invoicing supplier shares any of
// these with another registered supplier, the analysis adds SUPPLIER_LINKED (medium) and an
// APPROVE becomes HOLD_FOR_REVIEW. A shared contact person's name alone is weaker (people
// share names), so it is noted as info only. Nothing is ever called fraud: the reviewer is
// asked to check that the companies are independent.

export type SupplierRecord = {
  id: string; name: string;
  contact_name?: string | null; contact_email?: string | null; contact_phone?: string | null; wallet_address?: string | null;
};
export type Link = { other: SupplierRecord; shared: string[]; strong: boolean };
type Check = { code: string; severity: 'medium' | 'info'; detail: string };
// deno-lint-ignore no-explicit-any
type Review = { checks: any[]; flags: string[]; recommendation: string; [k: string]: any };

const wallet = (v?: string | null) => (v && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? v.trim().toLowerCase() : null);
const email = (v?: string | null) => (v && v.includes('@') ? v.trim().toLowerCase() : null);
// "+27 82 555 0147", "082 555 0147" and "0825550147" are one number: compare the last 9 digits.
const phone = (v?: string | null) => { const d = (v ?? '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : null; };
const person = (v?: string | null) => { const n = (v ?? '').trim().toLowerCase().replace(/\s+/g, ' '); return n.length >= 5 ? n : null; };

/** Other suppliers sharing payout or contact details with this one. */
export function findLinks(me: SupplierRecord, others: SupplierRecord[]): Link[] {
  const links: Link[] = [];
  for (const o of others) {
    if (o.id === me.id) continue;
    const shared: string[] = [];
    const same = (f: (v?: string | null) => string | null, a?: string | null, b?: string | null) => { const x = f(a); return x !== null && x === f(b); };
    if (same(wallet, me.wallet_address, o.wallet_address)) shared.push('payout wallet');
    if (same(email, me.contact_email, o.contact_email)) shared.push('contact email');
    if (same(phone, me.contact_phone, o.contact_phone)) shared.push('contact phone number');
    const strong = shared.length > 0;
    if (same(person, me.contact_name, o.contact_name)) shared.push('contact person');
    if (shared.length) links.push({ other: o, shared, strong });
  }
  return links;
}

const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** One check per linked supplier; mentions it when that supplier has also invoiced this project. */
export function linkChecks(me: SupplierRecord, links: Link[], projectInvoices: { supplier_id: string; invoice_number: string }[]): Check[] {
  return links.map((l) => {
    const theirs = projectInvoices.filter((i) => i.supplier_id === l.other.id).map((i) => i.invoice_number);
    const also = theirs.length ? `, which has also invoiced this project (${theirs.slice(0, 3).join(', ')})` : '';
    return {
      code: 'SUPPLIER_LINKED',
      severity: l.strong ? 'medium' : 'info',
      detail: `${me.name} shares the same ${list(l.shared)} with ${l.other.name}${also}. Check that these are independent companies before paying.`,
    };
  });
}

/** Adds the checks. Only adds caution: a medium link turns APPROVE into HOLD_FOR_REVIEW. */
export function applyLinks<R extends Review>(review: R, checks: Check[]): R {
  if (!checks.length) return review;
  return {
    ...review,
    checks: [...review.checks, ...checks],
    flags: [...new Set([...review.flags, 'SUPPLIER_LINKED'])],
    recommendation: review.recommendation === 'APPROVE' && checks.some((c) => c.severity === 'medium') ? 'HOLD_FOR_REVIEW' : review.recommendation,
  } as R;
}
