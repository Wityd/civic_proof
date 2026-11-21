import { applyLinks, findLinks, linkChecks, type SupplierRecord } from './relations.ts';
import { DEMO } from './demo_contexts.ts';
import { analyse } from './rules.ts';

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

// The seeded suppliers: distinct wallets, no contact details.
const blueBasin: SupplierRecord = { id: 's1', name: 'Blue Basin Tanks (Pty) Ltd', wallet_address: '0xa1f35993bFfa1C9219e596FBb58e510fB98607B4' };
const pipeworks: SupplierRecord = { id: 's2', name: 'Pipeworks Direct CC', wallet_address: '0x4E42b0ecC90677d5E6d51Fd54e3d8f0a3b6EeECD', contact_phone: '082 555 0147' };
const summit: SupplierRecord = { id: 's3', name: 'Summit Motors (Pty) Ltd', wallet_address: '0xfD78547677ea7b82AD14da551624f6695C8db312' };
// demo_linked_supplier.sql: a "different" company with Pipeworks' wallet and phone.
const aqua: SupplierRecord = { id: 's4', name: 'Aqua Pipe Solutions CC', wallet_address: '0x4e42b0ecc90677d5e6d51fd54e3d8f0a3b6eeecd', contact_phone: '+27 82 555 0147' };

Deno.test('the seeded demo suppliers are not linked (no false alarms)', () => {
  for (const me of [blueBasin, pipeworks, summit]) assert(findLinks(me, [blueBasin, pipeworks, summit]).length === 0, me.name);
});

Deno.test('a shared payout wallet and phone (any format) link two companies', () => {
  const links = findLinks(aqua, [blueBasin, pipeworks, summit]);
  assert(links.length === 1 && links[0].other.id === 's2' && links[0].strong, JSON.stringify(links));
  assert(JSON.stringify(links[0].shared) === JSON.stringify(['payout wallet', 'contact phone number']), links[0].shared.join());
});

Deno.test('a fair invoice from a linked company is held, and the detail names the other invoice', () => {
  const ctx = DEMO['#1 tanks'];
  const r = analyse(ctx);
  assert(r.recommendation === 'APPROVE', 'rules alone approve');
  const checks = linkChecks(aqua, findLinks(aqua, [pipeworks]), [{ supplier_id: 's2', invoice_number: 'PD-0147' }]);
  const out = applyLinks(r, checks);
  assert(out.recommendation === 'HOLD_FOR_REVIEW' && out.flags.includes('SUPPLIER_LINKED'), out.recommendation);
  const d = checks[0].detail;
  assert(d.includes('payout wallet and contact phone number') && d.includes('Pipeworks Direct CC') && d.includes('PD-0147') && d.includes('independent'), d);
  assert(!/fraud|corrupt|criminal/i.test(d), 'never an accusation');
});

Deno.test('a shared contact person alone is info only and does not hold', () => {
  const a = { ...blueBasin, contact_name: 'Thabo  Nkosi' }, b = { ...summit, contact_name: 'thabo nkosi' };
  const checks = linkChecks(a, findLinks(a, [b]), []);
  assert(checks.length === 1 && checks[0].severity === 'info', JSON.stringify(checks));
  assert(applyLinks(analyse(DEMO['#1 tanks']), checks).recommendation === 'APPROVE', 'still approve');
});

Deno.test('links only add caution: REJECT stays REJECT; empty or missing details never match', () => {
  const out = applyLinks(analyse(DEMO['#3 bakkie']), linkChecks(aqua, findLinks(aqua, [pipeworks]), []));
  assert(out.recommendation === 'REJECT', out.recommendation);
  const blank = { id: 'x', name: 'X', contact_email: '', contact_phone: '12', wallet_address: 'not-a-wallet' };
  assert(findLinks(blank, [{ id: 'y', name: 'Y', contact_email: '', contact_phone: '12', wallet_address: 'not-a-wallet' }]).length === 0, 'blank values');
  assert(findLinks(pipeworks, [pipeworks]).length === 0, 'never linked to itself');
});
