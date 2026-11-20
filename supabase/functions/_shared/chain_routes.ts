// P3: chain-mode handlers for civicproof-api. Each money action is
//   prepare (SQL: same rules as simulated mode, pending row)  →  chain  →  settle (SQL).
// Responses mirror the simulated routes, plus `chain_status` and `explorer_url`.
import { ChainAdapter, type ChainMode, type ChainResult } from './chain.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

export interface ChainDeps {
  /** Calls a Postgres RPC with the service role (throws the API's own error type). */
  rpc: (name: string, args: Record<string, unknown>) => Promise<Json>;
  /** Builds the API's error type, so failures render like every other route. */
  fail: (code: string, message: string, status: number) => Error;
  /** The adapter for a mode (default: from Edge Function secrets). */
  chain?: (mode: ChainMode) => ChainAdapter;
}

const adapters = new Map<ChainMode, ChainAdapter>();
const defaultChain = (mode: ChainMode) => {
  if (!adapters.has(mode)) adapters.set(mode, ChainAdapter.fromEnv(mode));
  return adapters.get(mode)!;
};

async function requireConfiguration(deps: ChainDeps) {
  const mode = await deps.rpc('cp_wallet_mode', {}) as ChainMode;
  try { return (deps.chain ?? defaultChain)(mode); }
  catch { throw deps.fail('CHAIN_NOT_READY', 'Configure the correct testnet deployer signing secret before preparing chain actions.', 503); }
}

export async function chainStatus(deps: ChainDeps, mode: ChainMode, wallet: string, project: string) {
  try { return await (deps.chain ?? defaultChain)(mode).readiness(wallet,project); }
  catch { throw deps.fail('CHAIN_NOT_READY','Signing configuration or read-only chain preflight is not ready.',503); }
}

/** Chain error → the API's existing codes, so the frontend handles both modes the same way. */
const API_ERRORS: Record<string, [string, number]> = {
  MILESTONE_NOT_VERIFIED: ['MILESTONE_NOT_VERIFIED', 409],
  INSUFFICIENT_AVAILABLE: ['BUDGET_EXCEEDED', 409],
  INVALID_STATUS: ['INVALID_STATE', 409],
  REQUEST_NOT_FOUND: ['INVALID_STATE', 409],
  REQUEST_ALREADY_EXISTS: ['INVALID_STATE', 409],
  MILESTONE_NOT_FOUND: ['INVALID_STATE', 409],
  MILESTONE_ALREADY_REGISTERED: ['INVALID_STATE', 409],
  MILESTONE_ALREADY_VERIFIED: ['INVALID_STATE', 409],
  INVALID_ADDRESS: ['VALIDATION', 400],
  INVALID_AMOUNT: ['VALIDATION', 400],
  INVALID_HASH: ['VALIDATION', 400],
  CHAIN_UNAUTHORIZED: ['CHAIN_MISCONFIGURED', 500],
};

async function execute(deps: ChainDeps, prepared: Json) {
  const { tx, chain: a } = prepared;
  const adapter = (deps.chain ?? defaultChain)(a.mode as ChainMode);
  const explorer = (hash?: string | null) => (hash ? adapter.txUrl(hash) : null);
  if (tx.status === 'confirmed') return { ...prepared, chain_status: 'confirmed', explorer_url: explorer(tx.tx_hash) };
  if (!a.project_wallet) throw deps.fail('CHAIN_NOT_READY', `Project has no ${a.mode} wallet.`, 503);

  let r: ChainResult;
  if (tx.tx_hash) {
    r = await adapter.receipt(tx.tx_hash); // retry of a timed-out call: never send twice
  } else {
    const owner = crypto.randomUUID();
    const claimed = await deps.rpc('cp_chain_claim', { p_tx_id: tx.id, p_owner: owner });
    if (!claimed) return { ...prepared, chain_status: 'pending', explorer_url: null };
    const onSent = (hash: string) => deps.rpc('cp_chain_record_hash', { p_tx_id: tx.id, p_owner: owner, p_hash: hash });
    try {
      r = await call(adapter, a, onSent);
    } catch (e) {
      // The RPC failed before anything was broadcast: undo prepare so the user can retry.
      await deps.rpc('cp_chain_settle', { p_tx_id: tx.id, p_status: 'failed', p_error: 'CHAIN_UNAVAILABLE' });
      await deps.rpc('cp_chain_release_claim', { p_tx_id: tx.id });
      throw deps.fail('CHAIN_UNAVAILABLE', `The ${a.mode} network could not be reached before broadcasting; retry later.`, 502);
    }
  }

  const settled = await deps.rpc('cp_chain_settle', {
    p_tx_id: tx.id, p_status: r.status, p_tx_hash: r.txHash ?? null, p_block: r.blockNumber ?? null, p_error: r.error ?? null,
  });
  if (r.status !== 'pending') await deps.rpc('cp_chain_release_claim', { p_tx_id: tx.id });
  if (r.status === 'failed') {
    const [code, status] = API_ERRORS[r.error ?? ''] ?? ['CHAIN_REVERTED', 502];
    throw deps.fail(code, `Refused on-chain by the ProjectWallet contract (${r.detail ?? r.error}).`, status);
  }
  return { ...settled, chain_status: r.status, explorer_url: explorer(r.txHash) };
}

function call(adapter: ChainAdapter, a: Json, onSent: (h: string) => Promise<unknown>): Promise<ChainResult> {
  switch (a.op) {
    case 'submit_request':
      if (!a.supplier_address) throw new Error('supplier has no wallet address');
      return adapter.submitRequest(a.project_wallet, {
        invoiceId: a.invoice_id, supplier: a.supplier_address, amountCents: a.amount_cents,
        documentSha256: a.document_sha256, milestoneId: a.milestone_id,
      }, onSent);
    case 'approve': return adapter.approve(a.project_wallet, a.invoice_id, onSent);
    case 'reject': return adapter.reject(a.project_wallet, a.invoice_id, onSent);
    case 'release': return adapter.release(a.project_wallet, a.invoice_id, onSent);
    case 'register_milestone': return adapter.registerMilestone(a.project_wallet, a.milestone_id, onSent);
    case 'verify_milestone': return adapter.verifyMilestone(a.project_wallet, a.milestone_id, onSent);
    default: throw new Error(`Unknown chain operation ${a.op}`);
  }
}

/** HTTP status for a result: 202 while the chain is still confirming. */
export const chainHttpStatus = (data: Json, okStatus = 200) => (data?.chain_status === 'pending' ? 202 : okStatus);

// ── routes ───────────────────────────────────────────────────────────────────

/** POST /invoices in chain mode. The caller has already stored the PDF. */
export async function chainSubmitInvoice(deps: ChainDeps, actor: string, invoice: Json, items: Json[]) {
  await requireConfiguration(deps);
  const prepared = await deps.rpc('cp_chain_submit_invoice', { p_actor: actor, p_invoice: invoice, p_items: items });
  const done = await execute(deps, prepared);
  return { ...prepared.invoice, chain_tx: done.tx, chain_status: done.chain_status, explorer_url: done.explorer_url };
}

/** POST /invoices/:id/approve|hold|reject in chain mode. Hold never touches the chain. */
export async function chainDecide(deps: ChainDeps, actor: string, invoiceId: string, decision: 'approve' | 'hold' | 'reject', reason: string | null) {
  if (decision === 'hold') return deps.rpc('cp_decide', { p_actor: actor, p_invoice_id: invoiceId, p_decision: 'hold', p_reason: reason });
  await requireConfiguration(deps);
  const prepared = await deps.rpc('cp_chain_prepare', { p_actor: actor, p_op: decision, p_ref: invoiceId, p_reason: reason });
  const done = await execute(deps, prepared);
  const status = done.chain_status === 'confirmed' ? (decision === 'approve' ? 'approved' : 'rejected') : 'pending_chain';
  return { invoice_id: invoiceId, status, tx: done.tx, chain_status: done.chain_status, explorer_url: done.explorer_url };
}

/** POST /payments/:invoiceId/execute in chain mode. Idempotent: never pays twice. */
export async function chainExecutePayment(deps: ChainDeps, actor: string, invoiceId: string) {
  await requireConfiguration(deps);
  const prepared = await deps.rpc('cp_chain_prepare', { p_actor: actor, p_op: 'release', p_ref: invoiceId });
  const done = await execute(deps, prepared);
  return { ...done.tx, chain_status: done.chain_status, explorer_url: done.explorer_url };
}

/** POST /milestones/:id/register|verify in chain mode. */
export async function chainMilestone(deps: ChainDeps, actor: string, milestoneId: string, action: 'register' | 'verify') {
  await requireConfiguration(deps);
  const op = action === 'register' ? 'register_milestone' : 'verify_milestone';
  const prepared = await deps.rpc('cp_chain_prepare', { p_actor: actor, p_op: op, p_ref: milestoneId });
  const done = await execute(deps, prepared);
  return { ...done.tx, chain_status: done.chain_status, explorer_url: done.explorer_url };
}

/** POST /chain/reconcile: settles every pending transaction that has a hash. */
export async function chainReconcile(deps: ChainDeps) {
  const pending: Json[] = await deps.rpc('cp_chain_pending', {});
  const results = [];
  for (const p of pending) {
    const adapter = (deps.chain ?? defaultChain)(p.tx.mode as ChainMode);
    const r = await adapter.receipt(p.tx.tx_hash);
    if (r.status !== 'pending') {
      await deps.rpc('cp_chain_settle', { p_tx_id: p.tx.id, p_status: r.status, p_tx_hash: p.tx.tx_hash, p_block: r.blockNumber ?? null, p_error: r.error ?? null });
      await deps.rpc('cp_chain_release_claim', { p_tx_id: p.tx.id });
    }
    results.push({ tx_id: p.tx.id, operation: p.tx.operation, tx_hash: p.tx.tx_hash, status: r.status, explorer_url: adapter.txUrl(p.tx.tx_hash) });
  }
  return { checked: results.length, results };
}
