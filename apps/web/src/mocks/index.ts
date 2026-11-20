// Fake API used when VITE_USE_MOCKS=true. Same paths and shapes as the real API.
// It keeps state in memory, so actions (submit, analyse, approve, pay…) change what
// later GETs return. A page reload resets everything.
//
// VITE_MOCK_SCENARIO=start → all 4 demo invoices just submitted, wallet untouched.
// VITE_MOCK_SCENARIO=end (default) → the finished demo story.
import { EVIDENCE_UPLOAD_PARTS, INVOICE_UPLOAD_PARTS } from '../lib/apiContract'
import { getViewAsId } from '../lib/viewAs'
import type {
  AiReview,
  ApiResponse,
  Approval,
  Evidence,
  InvoiceDetail,
  InvoiceSummary,
  Milestone,
  NewInvoicePayload,
  Project,
  ProjectDetail,
  Supplier,
  Transaction,
  User,
  Wallet,
} from '../types'
import invoicesJson from './invoices.json'
import milestonesJson from './milestones.json'
import projectsJson from './projects.json'
import suppliersJson from './suppliers.json'
import transactionsCP001 from './transactions-CP001.json'
import usersJson from './users.json'
import walletCP001 from './wallet-CP001.json'

type StoredInvoice = Omit<InvoiceDetail, 'transactions'>

export const MOCK_SCENARIO: 'start' | 'end' = import.meta.env.VITE_MOCK_SCENARIO === 'start' ? 'start' : 'end'

export const mockUsers = usersJson as User[]
const suppliers = suppliersJson as Supplier[]
const projectsBase = projectsJson as Project[]
const milestones = structuredClone(milestonesJson) as Milestone[]
const walletMeta: Record<string, Pick<Wallet, 'mode' | 'contract_address'>> = {
  CP001: walletCP001 as Wallet,
}

const seededInvoices = structuredClone(invoicesJson) as unknown as StoredInvoice[]
// The AI output we "return" when someone presses Run analysis on a seeded invoice.
const seededReviews: Record<string, AiReview> = Object.fromEntries(
  seededInvoices.filter((i) => i.ai_review).map((i) => [i.id, i.ai_review!]),
)

const invoices: StoredInvoice[] =
  MOCK_SCENARIO === 'start'
    ? seededInvoices.map((i) => ({
        ...i,
        status: 'submitted',
        flags: [],
        ai_review: null,
        approvals: [],
        tx_hash: null,
        tx_mode: null,
      }))
    : seededInvoices

const transactions: Record<string, Transaction[]> = {
  CP001: (structuredClone(transactionsCP001) as Transaction[]).filter(
    (t) => MOCK_SCENARIO === 'end' || t.kind === 'allocation' || t.kind === 'invoice_submitted',
  ),
}

// ---------- helpers ----------

type MockResult = { status: number; body: ApiResponse<unknown> }

const ok = (data: unknown, status = 200): MockResult => ({ status, body: { data } })
const fail = (status: number, code: string, message: string): MockResult => ({
  status,
  body: { error: { code, message } },
})
const notFound = (what: string) => fail(404, 'NOT_FOUND', `${what} not found`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const simHash = () => `sim_${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
const now = () => new Date().toISOString()

function toSummary(inv: StoredInvoice): InvoiceSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { line_items, ai_review, approvals, ...summary } = inv
  return summary
}

function currentUser(): User | null {
  const id = getViewAsId()
  return mockUsers.find((u) => u.id === id) ?? null
}

const sumCents = (list: StoredInvoice[]) => list.reduce((s, i) => s + i.total_cents, 0)

// Paid and balance are worked out from the invoices, so paying one updates every page.
function projectView(p: Project): Project {
  const paid = sumCents(invoices.filter((i) => i.project_id === p.id && i.status === 'paid'))
  return { ...p, paid_cents: paid, balance_cents: p.budget_cents - paid }
}

function walletView(projectId: string): Wallet | null {
  const base = projectsBase.find((p) => p.id === projectId)
  if (!base) return null
  const { balance_cents } = projectView(base)
  // Approved but not yet paid money is committed, so it isn't "available".
  const committed = sumCents(
    invoices.filter(
      (i) =>
        i.project_id === projectId && ['approved', 'payment_pending', 'payment_failed'].includes(i.status),
    ),
  )
  return {
    project_id: projectId,
    balance_cents,
    available_cents: balance_cents - committed,
    mode: walletMeta[projectId]?.mode ?? 'simulated',
    contract_address: walletMeta[projectId]?.contract_address ?? null,
  }
}

function addLedger(tx: Omit<Transaction, 'id' | 'tx_hash' | 'mode' | 'created_at'>) {
  const list = (transactions[tx.project_id] ??= [])
  list.unshift({ ...tx, id: `tx_${Date.now()}_${list.length}`, tx_hash: simHash(), mode: 'simulated', created_at: now() })
  return list[0]
}

function requireRole(role: User['role']): MockResult | null {
  const user = currentUser()
  if (!user) return fail(401, 'UNAUTHORIZED', 'Sign in first')
  if (user.role !== role) return fail(403, 'FORBIDDEN', `Only the ${role} role can do this`)
  return null
}

// ---------- GET ----------

function handleGet(path: string, query: URLSearchParams): MockResult {
  let m: RegExpMatchArray | null

  if (path === '/me') {
    const user = currentUser()
    return user ? ok(user) : fail(401, 'UNAUTHORIZED', 'Nobody is signed in')
  }

  if (path === '/projects') return ok(projectsBase.map(projectView))

  if ((m = path.match(/^\/projects\/([^/]+)$/))) {
    const base = projectsBase.find((p) => p.id === m![1])
    if (!base) return notFound('Project')
    const detail: ProjectDetail = {
      project: projectView(base),
      milestones: milestones.filter((x) => x.project_id === base.id),
      invoices: invoices.filter((i) => i.project_id === base.id).map(toSummary),
    }
    return ok(detail)
  }

  if ((m = path.match(/^\/projects\/([^/]+)\/wallet$/))) {
    const wallet = walletView(m[1])
    return wallet ? ok(wallet) : notFound('Wallet')
  }

  if ((m = path.match(/^\/projects\/([^/]+)\/transactions$/))) {
    return transactions[m[1]] ? ok(transactions[m[1]]) : notFound('Project')
  }

  if ((m = path.match(/^\/suppliers\/([^/]+)$/))) {
    const supplier = suppliers.find((s) => s.id === m![1])
    return supplier ? ok(supplier) : notFound('Supplier')
  }

  if (path === '/invoices') {
    const user = currentUser()
    let list = invoices
    if (user?.role === 'supplier') list = list.filter((i) => i.supplier_id === user.supplier_id)
    const statuses = query.get('status')?.split(',').filter(Boolean)
    if (statuses?.length) list = list.filter((i) => statuses.includes(i.status))
    const projectId = query.get('project_id')
    if (projectId) list = list.filter((i) => i.project_id === projectId)
    return ok(list.map(toSummary))
  }

  if ((m = path.match(/^\/invoices\/([^/]+)$/))) {
    const inv = invoices.find((i) => i.id === m![1])
    if (!inv) return notFound('Invoice')
    const detail: InvoiceDetail = {
      ...inv,
      transactions: (transactions[inv.project_id] ?? []).filter((t) => t.invoice_id === inv.id),
    }
    return ok(detail)
  }

  return notFound(`Mock for GET ${path}`)
}

// ---------- POST /invoices ----------

function createInvoice(body: unknown): MockResult {
  const user = currentUser()
  if (!user) return fail(401, 'UNAUTHORIZED', 'Sign in to submit an invoice')
  if (user.role !== 'supplier' || !user.supplier_id) return fail(403, 'FORBIDDEN', 'Only suppliers can submit invoices')
  if (!(body instanceof FormData)) return fail(400, 'BAD_REQUEST', 'Expected multipart form data')

  const file = body.get(INVOICE_UPLOAD_PARTS.file)
  const raw = body.get(INVOICE_UPLOAD_PARTS.data)
  if (!(file instanceof File)) return fail(400, 'BAD_REQUEST', 'Invoice PDF is missing')
  if (typeof raw !== 'string') return fail(400, 'BAD_REQUEST', 'Invoice data is missing')

  let payload: NewInvoicePayload
  try {
    payload = JSON.parse(raw)
  } catch {
    return fail(400, 'BAD_REQUEST', 'Invoice data is not valid JSON')
  }
  if (!projectsBase.some((p) => p.id === payload.project_id)) return notFound('Project')

  const supplierId = user.supplier_id
  if (invoices.some((i) => i.supplier_id === supplierId && i.invoice_number === payload.invoice_number)) {
    return fail(409, 'DUPLICATE_INVOICE', `You already submitted invoice ${payload.invoice_number}`)
  }

  const id = `inv_${String(invoices.length + 1).padStart(3, '0')}`
  const inv: StoredInvoice = {
    id,
    project_id: payload.project_id,
    supplier_id: supplierId,
    supplier_name: suppliers.find((s) => s.id === supplierId)?.name ?? 'Unknown supplier',
    invoice_number: payload.invoice_number,
    invoice_date: payload.invoice_date,
    total_cents: payload.total_cents,
    status: 'submitted',
    flags: [],
    milestone_id: payload.milestone_id,
    tx_hash: null,
    tx_mode: null,
    line_items: payload.line_items.map((l) => ({ ...l, reference_sku: null })),
    ai_review: null,
    approvals: [],
  }
  invoices.push(inv)

  // Submitting anchors the document hash: a recorded event, no money moves.
  addLedger({ project_id: inv.project_id, invoice_id: id, kind: 'invoice_submitted', moves_money: false, amount_cents: null })

  return ok(toSummary(inv), 201)
}

// ---------- POST /invoices/:id/analyse ----------

// For invoices submitted during the demo there is no seeded review, so build a simple one.
function genericReview(inv: StoredInvoice): AiReview {
  const available = walletView(inv.project_id)?.available_cents ?? Infinity
  const overBudget = inv.total_cents > available
  const supplier = suppliers.find((s) => s.id === inv.supplier_id)
  return {
    extraction: {
      supplier_name: inv.supplier_name,
      registration_no: supplier?.registration_no ?? '',
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      line_items: inv.line_items,
      total_cents: inv.total_cents,
      confidence: 0.9,
    },
    checks: overBudget
      ? [{ code: 'BUDGET_EXCEEDED', severity: 'high', detail: 'Invoice total is more than the money still available' }]
      : [],
    flags: overBudget ? ['BUDGET_EXCEEDED'] : [],
    benchmarks: [],
    potential_excess_cents: 0,
    recommendation: overBudget ? 'HOLD_FOR_REVIEW' : 'APPROVE',
    explanation: overBudget
      ? 'This invoice is larger than the money still available in the project wallet.'
      : 'Mock review: no problems found.',
    mode: 'mock',
  }
}

async function analyse(id: string): Promise<MockResult> {
  const denied = requireRole('municipality')
  if (denied) return denied
  const inv = invoices.find((i) => i.id === id)
  if (!inv) return notFound('Invoice')
  if (!['submitted', 'analysed'].includes(inv.status)) {
    return fail(409, 'INVALID_STATE', `Cannot analyse an invoice that is ${inv.status}`)
  }
  await sleep(1500) // the "AI" thinking
  const review = seededReviews[inv.id] ?? genericReview(inv)
  inv.ai_review = review
  inv.flags = review.flags
  inv.status = 'analysed'
  return ok(review)
}

// ---------- POST /invoices/:id/approve | hold | reject ----------

const ALLOWED_FROM: Record<Approval['decision'], StoredInvoice['status'][]> = {
  approve: ['analysed', 'on_hold'],
  hold: ['analysed'],
  reject: ['analysed', 'on_hold'],
}
const RESULT_STATUS = { approve: 'approved', hold: 'on_hold', reject: 'rejected' } as const

function decide(id: string, decision: Approval['decision'], body: unknown): MockResult {
  const denied = requireRole('municipality')
  if (denied) return denied
  const inv = invoices.find((i) => i.id === id)
  if (!inv) return notFound('Invoice')
  if (!ALLOWED_FROM[decision].includes(inv.status)) {
    return fail(409, 'INVALID_STATE', `Cannot ${decision} an invoice that is ${inv.status}`)
  }
  const reason = (body as { reason?: string } | undefined)?.reason?.trim() || null
  if (inv.flags.length > 0 && !reason) {
    return fail(400, 'REASON_REQUIRED', 'A reason is required because the AI flagged this invoice')
  }

  const approval: Approval = {
    id: `apr_${Date.now()}`,
    invoice_id: inv.id,
    decision,
    reason,
    decided_by_name: currentUser()!.name,
    overrode_ai: decision === 'approve' && inv.flags.length > 0,
    created_at: now(),
  }
  inv.approvals.push(approval)
  inv.status = RESULT_STATUS[decision]

  // Reject is a recorded event; hold records nothing on chain.
  if (decision === 'reject') {
    addLedger({ project_id: inv.project_id, invoice_id: inv.id, kind: 'invoice_rejected', moves_money: false, amount_cents: null })
  }
  return ok(approval)
}

// ---------- POST /payments/:invoiceId/execute ----------

function executePayment(id: string): MockResult {
  const denied = requireRole('municipality')
  if (denied) return denied
  const inv = invoices.find((i) => i.id === id)
  if (!inv) return notFound('Invoice')
  if (inv.status === 'paid') return fail(409, 'ALREADY_PAID', 'This invoice is already paid')
  if (inv.status === 'payment_pending') return ok({ invoice_id: inv.id, status: inv.status }) // idempotent
  if (!['approved', 'payment_failed'].includes(inv.status)) {
    return fail(409, 'INVALID_STATE', `Cannot pay an invoice that is ${inv.status}`)
  }
  const milestone = inv.milestone_id ? milestones.find((m) => m.id === inv.milestone_id) : undefined
  if (milestone && milestone.status !== 'verified') {
    // PLACEHOLDER error code: confirm the real one with P2.
    return fail(409, 'MILESTONE_NOT_VERIFIED', `Payment is blocked until ${milestone.id} is verified`)
  }
  const wallet = walletView(inv.project_id)
  if (wallet && inv.total_cents > wallet.balance_cents) {
    return fail(409, 'INSUFFICIENT_FUNDS', 'Not enough money in the project wallet')
  }

  inv.status = 'payment_pending'
  setTimeout(() => {
    const tx = addLedger({
      project_id: inv.project_id,
      invoice_id: inv.id,
      kind: 'payment',
      moves_money: true,
      amount_cents: inv.total_cents,
    })
    inv.status = 'paid'
    inv.tx_hash = tx.tx_hash
    inv.tx_mode = tx.mode
  }, 3000)
  return ok({ invoice_id: inv.id, status: inv.status }, 202)
}

// ---------- POST /milestones/:id/verify ----------

function verifyMilestone(id: string): MockResult {
  const denied = requireRole('municipality')
  if (denied) return denied
  const milestone = milestones.find((m) => m.id === id)
  if (!milestone) return notFound('Milestone')
  milestone.status = 'verified'
  return ok(milestone)
}

// ---------- POST /milestones/:id/evidence ----------

const seenPhotoHashes = new Set<string>()

async function sha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function submitEvidence(id: string, body: unknown): Promise<MockResult> {
  const denied = requireRole('supplier')
  if (denied) return denied
  const milestone = milestones.find((m) => m.id === id)
  if (!milestone) return notFound('Milestone')
  if (milestone.status === 'verified') return fail(409, 'INVALID_STATE', 'This milestone is already verified')
  if (!(body instanceof FormData)) return fail(400, 'BAD_REQUEST', 'Expected multipart form data')

  const file = body.get(EVIDENCE_UPLOAD_PARTS.file)
  if (!(file instanceof File)) return fail(400, 'BAD_REQUEST', 'Photo is missing')
  const raw = body.get(EVIDENCE_UPLOAD_PARTS.data)
  let note: string | null
  try {
    note = typeof raw === 'string' ? (JSON.parse(raw).note ?? null) : null
  } catch {
    return fail(400, 'BAD_REQUEST', 'Evidence data is not valid JSON')
  }

  // Same photo uploaded before → likely reused evidence.
  const hash = await sha256(file)
  if (seenPhotoHashes.has(hash)) {
    return fail(409, 'DUPLICATE_EVIDENCE', 'This exact photo was already submitted as evidence')
  }
  seenPhotoHashes.add(hash)
  milestone.status = 'evidence_submitted'

  const evidence: Evidence = {
    id: `ev_${Date.now()}`,
    milestone_id: milestone.id,
    photo_hash: hash,
    note,
    flags: [],
    created_at: now(),
  }
  return ok(evidence, 201)
}

// ---------- router ----------

export async function mockRequest(
  method: 'GET' | 'POST',
  fullPath: string,
  body?: unknown,
): Promise<MockResult> {
  await sleep(300) // feel like a real network call
  const [path, qs = ''] = fullPath.split('?')
  if (method === 'GET') return handleGet(path, new URLSearchParams(qs))

  let m: RegExpMatchArray | null
  if (path === '/invoices') return createInvoice(body)
  if ((m = path.match(/^\/invoices\/([^/]+)\/analyse$/))) return analyse(m[1])
  if ((m = path.match(/^\/invoices\/([^/]+)\/(approve|hold|reject)$/))) {
    return decide(m[1], m[2] as Approval['decision'], body)
  }
  if ((m = path.match(/^\/payments\/([^/]+)\/execute$/))) return executePayment(m[1])
  if ((m = path.match(/^\/milestones\/([^/]+)\/verify$/))) return verifyMilestone(m[1])
  if ((m = path.match(/^\/milestones\/([^/]+)\/evidence$/))) return submitEvidence(m[1], body)

  return fail(501, 'NOT_MOCKED', `No mock yet for ${method} ${path}`)
}
