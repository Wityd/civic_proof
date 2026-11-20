// P3 chain mode, end to end, with no network access:
//   P2's real schema + migrations + seed + the P3 chain-mode migration (PGlite, in memory)
//   + the real contracts on a local Hardhat node
//   + the real chain_routes.ts / chain.ts used by civicproof-api.
//
//   cd contracts && npx hardhat compile     (once, for the artifacts)
//   deno test -A supabase/tests/chain_mode_test.ts
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'npm:ethers@6.17.0';
import { ChainAdapter } from '../functions/_shared/chain.ts';
import { chainDecide, chainExecutePayment, chainMilestone, chainReconcile, chainSubmitInvoice, type ChainDeps } from '../functions/_shared/chain_routes.ts';
import { analyse, type AnalysisContext } from '../functions/_shared/rules.ts';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8551;
const RPC = `http://127.0.0.1:${PORT}`;
// Hardhat's public test account #0: not a secret, only valid on a local node.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const R = (rand: number) => Math.round(rand * 100);
const key = (uuid: string) => keccak256(toUtf8Bytes(uuid));
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const eq = (a: unknown, b: unknown, what: string) => assert(String(a) === String(b), `${what}: expected ${b}, got ${a}`);

const CP001 = '10000000-0000-4000-8000-000000000001';
const M1 = '30000000-0000-4000-8000-000000000001';
const SUP = { blue: '20000000-0000-4000-8000-000000000001', pipes: '20000000-0000-4000-8000-000000000002', summit: '20000000-0000-4000-8000-000000000003' };
const U = { citizen: 'a1000000-0000-4000-8000-000000000001', supplier: 'a1000000-0000-4000-8000-000000000002', municipality: 'a1000000-0000-4000-8000-000000000003', auditor: 'a1000000-0000-4000-8000-000000000004' };

class TestApiError extends Error { constructor(public code: string, message: string, public status: number) { super(`${code}: ${message}`); } }
const STATUSES: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, INVALID_STATE: 409, REASON_REQUIRED: 400, BUDGET_EXCEEDED: 409, MILESTONE_NOT_VERIFIED: 409, CHAIN_NOT_READY: 503 };

let node: Deno.ChildProcess;
let db: PGlite;
let provider: JsonRpcProvider;
let token: Contract;
let walletAddress: string;
let deps: ChainDeps;
let adapter: ChainAdapter;
const supplierAddr: Record<string, string> = {};

/** Same contract as supabase.rpc / index.ts db(): named args, "CODE: message" errors. */
async function rpc(name: string, args: Record<string, unknown>) {
  const keys = Object.keys(args);
  const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  try {
    const r = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as result`, values);
    return r.rows[0]?.result;
  } catch (e) {
    const message = String((e as Error).message);
    const code = message.split(':')[0];
    if (STATUSES[code]) throw new TestApiError(code, message.slice(code.length + 1).trim(), STATUSES[code]);
    throw e;
  }
}
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows[0];
async function expectError(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { eq((e as TestApiError).code, code, 'error code'); return e as TestApiError; }
  throw new Error(`expected ${code}, but it succeeded`);
}
const nonce = () => provider.getTransactionCount(new Wallet(KEY).address);

async function startNode() {
  const cli = `${ROOT}contracts/node_modules/hardhat/internal/cli/bootstrap.js`;
  node = new Deno.Command('node', { args: [cli, 'node', '--port', String(PORT)], cwd: `${ROOT}contracts`, stdout: 'piped', stderr: 'null' }).spawn();
  const reader = node.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let seen = '';
  while (!seen.includes('Started HTTP')) {
    const { value, done } = await reader.read();
    if (done) throw new Error('hardhat node exited');
    seen += value;
  }
  (async () => { while (!(await reader.read()).done) { /* drain */ } })();
}

async function deployContracts() {
  const art = (n: string) => JSON.parse(Deno.readTextFileSync(`${ROOT}contracts/artifacts/contracts/${n}.sol/${n}.json`));
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const deployer = new Wallet(KEY, provider);
  const D = art('DemoZAR'), F = art('CivicProofFactory'), W = art('ProjectWallet');
  // deno-lint-ignore no-explicit-any
  token = await new ContractFactory(D.abi, D.bytecode, deployer).deploy() as any;
  await token.waitForDeployment();
  // deno-lint-ignore no-explicit-any
  const factory: any = await new ContractFactory(F.abi, F.bytecode, deployer).deploy(await token.getAddress());
  await factory.waitForDeployment();
  const created = await (await factory.createProject(key(CP001), R(2_000_000))).wait();
  walletAddress = await factory.walletOf(key(CP001));
  const wallet = new Contract(walletAddress, W.abi, deployer);
  await (await token.mint(deployer.address, R(2_000_000))).wait();
  await (await token.approve(walletAddress, R(2_000_000))).wait();
  const funded = await (await wallet.fundProject(R(2_000_000))).wait();
  return { created, funded };
}

async function setupDatabase(receipts: { created: { hash: string; blockNumber: number }; funded: { hash: string; blockNumber: number } }) {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;`);
  for (const f of ['schema.sql', ...[...Deno.readDirSync(`${ROOT}supabase/migrations`)].map((e) => `migrations/${e.name}`).sort()]) {
    await db.exec(Deno.readTextFileSync(`${ROOT}supabase/${f}`));
  }
  for (const [role, id] of Object.entries(U)) {
    await db.query('insert into auth.users(id) values($1)', [id]);
    await db.query('insert into public.users(id,display_name,role) values($1,$2,$3)', [id, role, role]);
  }
  await db.exec(Deno.readTextFileSync(`${ROOT}supabase/seed.sql`));
  // Point CP001 at the LOCAL wallet, give suppliers receive-only addresses, switch to chain mode.
  await db.query(`insert into public.project_wallets(project_id,mode,wallet_address) values($1,'fuji',$2)`, [CP001, walletAddress]);
  for (const [k, id] of Object.entries(SUP)) {
    supplierAddr[k] = Wallet.createRandom().address;
    await db.query('update public.suppliers set wallet_address=$1 where id=$2', [supplierAddr[k], id]);
  }
  // The opening on-chain ledger (what contracts/scripts/export-ledger.ts produces for Fuji).
  for (const [op, amount, r] of [['create_project', 0, receipts.created], ['fund_project', R(2_000_000), receipts.funded]] as const) {
    await db.query(`insert into public.transactions(project_id,operation,amount_cents,mode,status,tx_hash,block_number,confirmed_at)
      values($1,$2,$3,'fuji','confirmed',$4,$5,now())`, [CP001, op, amount, r.hash, r.blockNumber]);
  }
  await db.exec(`update private.runtime_config set wallet_mode='fuji'`);
}

let invoiceCounter = 0;
function invoice(supplier: keyof typeof SUP, number: string, items: { description: string; category: string; reference_sku: string | null; quantity: number; unit_price_cents: number }[], milestone?: string) {
  const lines = items.map((i) => ({ ...i, line_total_cents: Math.round(i.quantity * i.unit_price_cents) }));
  const sha = keccak256(toUtf8Bytes(`${number}-${++invoiceCounter}`)).slice(2); // stands in for the PDF's SHA-256
  return {
    payload: { id: crypto.randomUUID(), project_id: CP001, supplier_id: SUP[supplier], milestone_id: milestone ?? null, invoice_number: number,
      invoice_date: '2026-11-18', total_cents: lines.reduce((s, l) => s + l.line_total_cents, 0), document_path: `${U.supplier}/${number}.pdf`, document_sha256: sha },
    items: lines,
  };
}
async function submitAndAnalyse(inv: ReturnType<typeof invoice>) {
  // deno-lint-ignore no-explicit-any
  const submitted: any = await chainSubmitInvoice(deps, U.supplier, inv.payload, inv.items);
  eq(submitted.chain_status, 'confirmed', 'submit chain status');
  const ctx = await rpc('cp_analysis_context', { p_actor: U.municipality, p_invoice_id: inv.payload.id }) as AnalysisContext;
  // deno-lint-ignore no-explicit-any
  const review: any = await rpc('cp_store_analysis', { p_actor: U.municipality, p_invoice_id: inv.payload.id, p_review: analyse(ctx) });
  return { submitted, review };
}
// deno-lint-ignore no-explicit-any
const chainRequest = async (invoiceId: string): Promise<any> => new Contract(walletAddress, JSON.parse(Deno.readTextFileSync(`${ROOT}packages/shared/abi/ProjectWallet.json`)), provider).getTransaction(key(invoiceId));
const invoiceStatus = async (id: string) => (await one('select status from public.invoices where id=$1', [id]))?.status;
// deno-lint-ignore no-explicit-any
const dashboard = async (): Promise<any> => ((await rpc('get_public_dashboard', { p_project_id: CP001, p_mode: 'fuji' })) as any[])[0];

Deno.test({
  name: 'P3 chain mode: CP001 golden path and failure handling on a real chain',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    await startNode();
    try {
      const receipts = await deployContracts();
      await setupDatabase({ created: { hash: receipts.created.hash, blockNumber: receipts.created.blockNumber }, funded: { hash: receipts.funded.hash, blockNumber: receipts.funded.blockNumber } });
      adapter = new ChainAdapter({ mode: 'fuji', rpcUrl: RPC, privateKey: KEY, chainId: 31337 });
      deps = { rpc, fail: (c, m, s) => new TestApiError(c, m, s), chain: () => adapter };

      await t.step('dashboard opens at R2,000,000.00 in fuji mode with the real funding hash', async () => {
        const d = await dashboard();
        eq(d.balance_cents, R(2_000_000), 'balance');
        eq(d.wallet_address, walletAddress, 'wallet');
        assert(d.transactions.some((x: { operation: string; tx_hash: string }) => x.operation === 'fund_project' && x.tx_hash === receipts.funded.hash), 'funding hash on dashboard');
        eq(await rpc('cp_wallet_mode', {}), 'fuji', 'active mode');
      });

      await t.step('register M1 on chain (idempotent)', async () => {
        // deno-lint-ignore no-explicit-any
        const r: any = await chainMilestone(deps, U.municipality, M1, 'register');
        eq(r.chain_status, 'confirmed', 'status'); assert(r.block_number > 0, 'block recorded');
        assert(r.explorer_url.startsWith('https://testnet.snowtrace.io/tx/0x'), 'explorer link');
        const before = await nonce();
        // deno-lint-ignore no-explicit-any
        const again: any = await chainMilestone(deps, U.municipality, M1, 'register');
        eq(again.id, r.id, 'same tx row'); eq(await nonce(), before, 'nothing re-sent');
      });

      let inv1: ReturnType<typeof invoice>;
      await t.step('#1 fair tanks: submit → analyse (no flags) → approve → pay on chain', async () => {
        inv1 = invoice('blue', 'BB-001', [{ description: '10,000 L tank', category: 'water_storage', reference_sku: 'TANK-10000L', quantity: 8, unit_price_cents: R(14_800) }]);
        const { review } = await submitAndAnalyse(inv1);
        eq(review.recommendation, 'APPROVE', 'AI recommendation');
        eq((await chainRequest(inv1.payload.id)).invoiceHash, '0x' + inv1.payload.document_sha256, 'document hash anchored on chain');
        // deno-lint-ignore no-explicit-any
        const approved: any = await chainDecide(deps, U.municipality, inv1.payload.id, 'approve', null);
        eq(approved.status, 'approved', 'approve');
        // deno-lint-ignore no-explicit-any
        const paid: any = await chainExecutePayment(deps, U.municipality, inv1.payload.id);
        eq(paid.chain_status, 'confirmed', 'release'); eq(await invoiceStatus(inv1.payload.id), 'paid', 'invoice paid');
        eq(await token.balanceOf(supplierAddr.blue), R(118_400), 'supplier received dZAR on chain');
        eq((await adapter.balance(walletAddress)).balanceCents, R(1_881_600), 'on-chain balance');
        eq((await dashboard()).balance_cents, R(1_881_600), 'dashboard balance');
      });

      await t.step('paying #1 again returns the same release and sends nothing', async () => {
        const before = await nonce();
        // deno-lint-ignore no-explicit-any
        const again: any = await chainExecutePayment(deps, U.municipality, inv1.payload.id);
        eq(again.chain_status, 'confirmed', 'status'); eq(await nonce(), before, 'no second transaction');
        eq(await token.balanceOf(supplierAddr.blue), R(118_400), 'paid exactly once');
      });

      await t.step('#2 inflated pipes: approving without a reason is refused BEFORE the chain; hold stays off-chain', async () => {
        const inv2 = invoice('pipes', 'PD-0147', [{ description: '250mm HDPE pipe 12m', category: 'pipes', reference_sku: 'PIPE-HDPE-250-12', quantity: 20, unit_price_cents: R(12_000) }]);
        const { review } = await submitAndAnalyse(inv2);
        assert(review.flags.includes('PRICE_ABOVE_BENCHMARK'), 'price flag');
        eq(review.potential_excess_cents, R(136_000), 'potential excess');
        const before = await nonce();
        await expectError(chainDecide(deps, U.municipality, inv2.payload.id, 'approve', null), 'REASON_REQUIRED');
        eq(await nonce(), before, 'refused without sending');
        eq(await one('select count(*)::int as n from public.transactions where invoice_id=$1 and status=$2', [inv2.payload.id, 'pending']).then((r) => r?.n), 0, 'no pending row left');
        // deno-lint-ignore no-explicit-any
        const held: any = await chainDecide(deps, U.municipality, inv2.payload.id, 'hold', 'Price 131% above benchmark; supplier 21 days old.');
        eq(held.status, 'on_hold', 'held'); eq(await nonce(), before, 'hold sends nothing');
        eq((await chainRequest(inv2.payload.id)).status, 1n, 'still Pending on chain: money stays');
      });

      await t.step('#3 bakkie: reject is recorded on chain', async () => {
        const inv3 = invoice('summit', 'SM-785', [{ description: '4x4 double-cab bakkie', category: 'vehicles', reference_sku: null, quantity: 1, unit_price_cents: R(785_000) }]);
        const { review } = await submitAndAnalyse(inv3);
        eq(review.recommendation, 'REJECT', 'AI recommendation');
        // deno-lint-ignore no-explicit-any
        const rejected: any = await chainDecide(deps, U.municipality, inv3.payload.id, 'reject', 'Vehicle is outside the water project purpose.');
        eq(rejected.status, 'rejected', 'rejected'); eq((await chainRequest(inv3.payload.id)).status, 3n, 'Rejected on chain');
      });

      await t.step('#4 installation linked to M1: blocked until verified, then paid', async () => {
        const inv4 = invoice('blue', 'BB-002', [{ description: 'Tank installation', category: 'installation', reference_sku: 'INSTALL-TANK', quantity: 8, unit_price_cents: R(8_000) }], M1);
        await submitAndAnalyse(inv4);
        await chainDecide(deps, U.municipality, inv4.payload.id, 'approve', null);
        const before = await nonce();
        await expectError(chainExecutePayment(deps, U.municipality, inv4.payload.id), 'MILESTONE_NOT_VERIFIED');
        eq(await nonce(), before, 'blocked without sending'); eq(await invoiceStatus(inv4.payload.id), 'approved', 'still approved');
        // deno-lint-ignore no-explicit-any
        const verified: any = await chainMilestone(deps, U.auditor, M1, 'verify');
        eq(verified.chain_status, 'confirmed', 'verified on chain');
        eq((await one('select status from public.milestones where id=$1', [M1]))?.status, 'verified', 'milestone verified in DB');
        eq((await one(`select actor_id from public.verifications where milestone_id=$1 and kind='official'`, [M1]))?.actor_id, U.auditor, 'verifier recorded');
        await chainExecutePayment(deps, U.municipality, inv4.payload.id);
        eq(await invoiceStatus(inv4.payload.id), 'paid', 'paid');
      });

      await t.step('close: R1,817,600.00 on chain and on the dashboard', async () => {
        eq((await adapter.balance(walletAddress)).balanceCents, R(1_817_600), 'on-chain');
        const d = await dashboard();
        eq(d.balance_cents, R(1_817_600), 'dashboard'); eq(d.paid_cents, R(182_400), 'paid');
        eq(await token.balanceOf(supplierAddr.blue), R(182_400), 'Blue Basin received #1 + #4');
        eq(await token.balanceOf(supplierAddr.pipes), 0, 'Pipeworks received nothing');
        eq(await token.balanceOf(supplierAddr.summit), 0, 'Summit received nothing');
        const hashes = d.transactions.filter((x: { mode: string }) => x.mode === 'fuji').map((x: { tx_hash: string }) => x.tx_hash);
        assert(hashes.every((h: string) => /^0x[0-9a-f]{64}$/.test(h)), 'every dashboard row has a real tx hash');
      });

      await t.step('chain refusal rolls back cleanly: submit of a request id that already exists on chain', async () => {
        const inv = invoice('blue', 'BB-dupe', [{ description: 'tank', category: 'water_storage', reference_sku: 'TANK-10000L', quantity: 1, unit_price_cents: R(14_500) }]);
        await adapter.submitRequest(walletAddress, { invoiceId: inv.payload.id, supplier: supplierAddr.blue, amountCents: 1, documentSha256: inv.payload.document_sha256 });
        await expectError(chainSubmitInvoice(deps, U.supplier, inv.payload, inv.items), 'INVALID_STATE');
        eq(await one('select count(*)::int as n from public.invoices where id=$1', [inv.payload.id]).then((r) => r?.n), 0, 'invoice rolled back');
      });

      await t.step('network down before sending: CHAIN_UNAVAILABLE, approval undone, retry works', async () => {
        const inv = invoice('blue', 'BB-003', [{ description: 'tank', category: 'water_storage', reference_sku: 'TANK-10000L', quantity: 1, unit_price_cents: R(14_500) }]);
        await submitAndAnalyse(inv);
        const down: ChainDeps = { ...deps, chain: () => new ChainAdapter({ mode: 'fuji', rpcUrl: 'http://127.0.0.1:9', privateKey: KEY, chainId: 31337 }) };
        await expectError(chainDecide(down, U.municipality, inv.payload.id, 'approve', null), 'CHAIN_UNAVAILABLE');
        eq(await invoiceStatus(inv.payload.id), 'analysed', 'invoice unchanged');
        eq(await one('select count(*)::int as n from public.approvals where invoice_id=$1', [inv.payload.id]).then((r) => r?.n), 0, 'approval removed');
        // deno-lint-ignore no-explicit-any
        const ok: any = await chainDecide(deps, U.municipality, inv.payload.id, 'approve', null);
        eq(ok.status, 'approved', 'retry succeeds');
      });

      await t.step('timeout: payment stays pending with its hash, then reconcile settles it', async () => {
        const inv = invoice('blue', 'BB-004', [{ description: 'tank', category: 'water_storage', reference_sku: 'TANK-10000L', quantity: 1, unit_price_cents: R(14_500) }]);
        await submitAndAnalyse(inv);
        await chainDecide(deps, U.municipality, inv.payload.id, 'approve', null);
        await provider.send('evm_setAutomine', [false]);
        const slow: ChainDeps = { ...deps, chain: () => new ChainAdapter({ mode: 'fuji', rpcUrl: RPC, privateKey: KEY, chainId: 31337, timeoutMs: 1500 }) };
        // deno-lint-ignore no-explicit-any
        const pending: any = await chainExecutePayment(slow, U.municipality, inv.payload.id);
        eq(pending.chain_status, 'pending', 'pending'); assert(/^0x[0-9a-f]{64}$/.test(pending.tx_hash), 'hash stored before confirmation');
        eq(await invoiceStatus(inv.payload.id), 'payment_pending', 'payment_pending, not failed');
        const before = await nonce();
        // deno-lint-ignore no-explicit-any
        const retried: any = await chainExecutePayment(slow, U.municipality, inv.payload.id);
        eq(retried.chain_status, 'pending', 'retry only checks the receipt'); eq(await nonce(), before, 'never sent twice');
        await provider.send('evm_mine', []);
        await provider.send('evm_setAutomine', [true]);
        // deno-lint-ignore no-explicit-any
        const rec: any = await chainReconcile(deps);
        assert(rec.results.some((r: { status: string }) => r.status === 'confirmed'), 'reconciled');
        eq(await invoiceStatus(inv.payload.id), 'paid', 'paid after reconcile');
      });

      await t.step('sender claims, pending reservations and rollback work as service_role', async () => {
        const inv = invoice('blue', 'BB-guards', [{ description: 'tank', category: 'water_storage', reference_sku: 'TANK-10000L', quantity: 1, unit_price_cents: R(14_500) }]);
        await submitAndAnalyse(inv);
        const before = await rpc('cp_available', { p_project: CP001, p_mode: 'fuji' });
        await db.exec('set role service_role');
        try {
          const prepared = await rpc('cp_chain_prepare', { p_actor: U.municipality, p_op: 'approve', p_ref: inv.payload.id }) as { tx: { id: string } };
          eq(await rpc('cp_available', { p_project: CP001, p_mode: 'fuji' }), Number(before) - R(14_500), 'pending approval reserves budget');
          const owner = crypto.randomUUID();
          eq(await rpc('cp_chain_claim', { p_tx_id: prepared.tx.id, p_owner: owner }), true, 'first sender owns claim');
          eq(await rpc('cp_chain_claim', { p_tx_id: prepared.tx.id, p_owner: crypto.randomUUID() }), false, 'second sender refused');
          await expectError(rpc('cp_chain_record_hash', { p_tx_id: prepared.tx.id, p_owner: crypto.randomUUID(), p_hash: '0x' + '1'.repeat(64) }), 'INVALID_STATE');
          await rpc('cp_chain_settle', { p_tx_id: prepared.tx.id, p_status: 'failed', p_error: 'CHAIN_UNAVAILABLE' });
          await rpc('cp_chain_release_claim', { p_tx_id: prepared.tx.id });
          eq(await invoiceStatus(inv.payload.id), 'analysed', 'rollback preserves invoice');
          eq(await one('select count(*)::int as n from public.approvals where invoice_id=$1', [inv.payload.id]).then(r => r?.n), 0, 'service role removes tentative approval');
          eq(await rpc('cp_available', { p_project: CP001, p_mode: 'fuji' }), before, 'reservation released');
        } finally { await db.exec('reset role'); }
      });

      await t.step('hash persistence failure never broadcasts and unknown hashes remain pending', async () => {
        const before = await nonce();
        const result = await adapter.submitRequest(walletAddress, { invoiceId: crypto.randomUUID(), supplier: supplierAddr.blue, amountCents: 100, documentSha256: 'a'.repeat(64) }, () => Promise.reject(new Error('database connection lost')));
        eq(result.status, 'pending', 'uncertain persistence stays pending');
        eq(await nonce(), before, 'nothing broadcast');
        eq((await adapter.receipt('0x' + 'f'.repeat(64))).status, 'pending', 'missing receipt does not prove failure');
      });

      await t.step('public project milestones and authorised approval names match P1 contract', async () => {
        const d = await dashboard();
        eq(d.milestones.length, 1, 'one milestone');
        eq(d.milestones[0].id, M1, 'correct project milestone');
        eq(d.milestones[0].status, 'verified', 'delivery state');
        eq(Object.keys(d.milestones[0]).sort().join(','), 'code,description,id,status,title,verified_at', 'only public milestone fields');
        await db.exec('set role service_role');
        try {
          for (const actor of [U.municipality,U.auditor,U.supplier]) {
            const approvals = await rpc('cp_invoice_approvals',{p_actor:actor,p_invoice_id:inv1.payload.id}) as {actor_display_name:string}[];
            eq(approvals[0].actor_display_name, 'municipality', 'approver name');
          }
          await expectError(rpc('cp_invoice_approvals',{p_actor:U.citizen,p_invoice_id:inv1.payload.id}),'FORBIDDEN');
        } finally { await db.exec('reset role'); }
        const privilege = await one("select has_function_privilege('authenticated','public.cp_invoice_approvals(uuid,uuid)','execute') as allowed");
        eq(privilege?.allowed, false, 'browser cannot impersonate an actor via RPC');
      });

      await t.step('delivery answers are constrained community evidence and never verify a milestone', async () => {
        for (const answer of ['yes','no','not_sure',null]) {
          const milestone = crypto.randomUUID();
          await db.query("insert into public.milestones(id,project_id,code,title) values($1,$2,$3,'Answer test')",[milestone,CP001,`answer-${answer}`]);
          await db.query("insert into public.verifications(milestone_id,actor_id,kind,answer,note) values($1,$2,'community',$3,'Evidence only')",[milestone,U.citizen,answer]);
          eq((await one('select answer from public.verifications where milestone_id=$1',[milestone]))?.answer,answer,'answer preserved');
          eq((await one('select status from public.milestones where id=$1',[milestone]))?.status,'pending','not officially verified');
        }
        for (const [kind,answer] of [['community','maybe'],['official','yes']]) {
          let rejected=false;
          try { await db.query('insert into public.verifications(milestone_id,actor_id,kind,answer) values($1,$2,$3,$4)',[M1,U.citizen,kind,answer]); }
          catch {rejected=true;}
          assert(rejected,'invalid answer or official answer refused');
        }
      });

      await t.step('simulated mode is untouched: chain-mode invoices cannot be decided there', async () => {
        await db.exec(`update private.runtime_config set wallet_mode='simulated'`);
        const anyFuji = await one(`select id from public.invoices where ledger_mode='fuji' and status='on_hold'`);
        await expectError(rpc('cp_decide', { p_actor: U.municipality, p_invoice_id: anyFuji!.id, p_decision: 'approve', p_reason: 'x' }), 'CHAIN_NOT_READY');
        await db.exec(`update private.runtime_config set wallet_mode='fuji'`);
      });
    } finally {
      node.kill();
      await db?.close();
    }
  },
});
