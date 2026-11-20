// Fake API used when VITE_USE_MOCKS=true. Same paths, shapes, rules and error codes as
// supabase/functions/civicproof-api on main. It keeps state in memory, so actions change
// what later GETs return. A page reload resets everything.
//
// VITE_MOCK_SCENARIO=start → all 4 demo invoices just submitted, wallet untouched.
// VITE_MOCK_SCENARIO=end (default) → the finished demo story.
//
// Differences on purpose (things requested from P2, marked REQUESTED in types.ts):
// projects include `milestones`.
import { EVIDENCE_UPLOAD_PARTS, INVOICE_UPLOAD_PARTS } from '../lib/apiContract'
import { getViewAsId } from '../lib/viewAs'
import type {
  AiReview,
  ApiResponse,
  Approval,
  DecisionResult,
  DemoUser,
  Evidence,
  Invoice,
  InvoiceDetail,
  InvoiceItem,
  Me,
  Milestone,
  NewInvoicePayload,
  Project,
  PublicInvoice,
  Supplier,
  Transaction,
  TxOperation,
  Verification,
  Wallet,
} from '../types'
import invoicesJson from './invoices.json'
import milestonesJson from './milestones.json'
import projectsJson from './projects.json'
import suppliersJson from './suppliers.json'
import transactionsJson from './transactions.json'
import usersJson from './users.json'
import walletsJson from './wallets.json'

type StoredInvoice = Invoice & Pick<InvoiceDetail, 'items' | 'ai_reviews' | 'approvals'>
type StoredTx = Transaction & { project_id: string }
type BaseProject = Pick<
  Project,
  'id' | 'code' | 'name' | 'description' | 'location' | 'budget_cents' | 'permitted_categories'
>

export const MOCK_SCENARIO: 'start' | 'end' = import.meta.env.VITE_MOCK_SCENARIO === 'start' ? 'start' : 'end'

export const mockUsers = usersJson as DemoUser[]
const suppliers = suppliersJson as Supplier[]
const projectsBase = projectsJson as BaseProject[]
const milestones = structuredClone(milestonesJson) as Milestone[]
const wallets = walletsJson as Record<string, Pick<Wallet, 'mode' | 'wallet_address'>>

const seededInvoices = structuredClone(invoicesJson) as unknown as StoredInvoice[]
// The AI output we "return" when someone presses Run analysis on a seeded invoice.
const seededReviews: Record<string, AiReview> = Object.fromEntries(
  seededInvoices.filter((i) => i.ai_reviews.length).map((i) => [i.id, i.ai_reviews[0]]),
)

const invoices: StoredInvoice[] =
  MOCK_SCENARIO === 'start'
    ? seededInvoices.map((i) => ({ ...i, status: 'submitted', ai_reviews: [], approvals: [], updated_at: i.created_at }))
    : seededInvoices

const transactions: StoredTx[] = (structuredClone(transactionsJson) as StoredTx[]).filter(
  (t) => MOCK_SCENARIO === 'end' || ['create_project', 'fund_project', 'submit_request'].includes(t.operation),
)

// ---------- helpers ----------

type MockResult = { status: number; body: ApiResponse<unknown> }

const ok = (data: unknown, status = 200): MockResult => ({ status, body: { data } })
const fail = (status: number, code: string, message: string): MockResult => ({
  status,
  body: { error: { code, message } },
})
const notFound = (what: string) => fail(404, 'NOT_FOUND', `${what} not found.`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

function stripTx(t: StoredTx): Transaction {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { project_id, ...rest } = t
  return rest
}
function toRow(inv: StoredInvoice): Invoice {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { items, ai_reviews, approvals, ...row } = inv
  return row
}

function currentUser(): DemoUser | null {
  const id = getViewAsId()
  return mockUsers.find((u) => u.id === id) ?? null
}

const sumCents = (list: StoredInvoice[]) => list.reduce((s, i) => s + i.total_cents, 0)
const projectTx = (projectId: string) => transactions.filter((t) => t.project_id === projectId && t.status === 'confirmed')

function totals(projectId: string) {
  const txs = projectTx(projectId)
  const paid = txs.filter((t) => t.operation === 'release').reduce((s, t) => s + t.amount_cents, 0)
  const funded = txs.filter((t) => t.operation === 'fund_project').reduce((s, t) => s + t.amount_cents, 0)
  const balance = funded - paid
  // Approved but unpaid money is committed, so it isn't available.
  const committed = sumCents(
    invoices.filter((i) => i.project_id === projectId && ['approved', 'payment_pending', 'payment_failed'].includes(i.status)),
  )
  return { paid_cents: paid, balance_cents: balance, available_cents: balance - committed }
}

function projectView(p: BaseProject): Project {
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? ''
  const publicInvoices: PublicInvoice[] = invoices
    .filter((i) => i.project_id === p.id)
    .map((i) => ({
      id: i.id,
      invoice_number: i.invoice_number,
      supplier_name: supplierName(i.supplier_id),
      total_cents: i.total_cents,
      status: i.status,
      invoice_date: i.invoice_date,
    }))
  return {
    ...p,
    mode: wallets[p.id]?.mode ?? 'simulated',
    ...totals(p.id),
    wallet_address: wallets[p.id]?.wallet_address ?? null,
    invoices: publicInvoices,
    transactions: transactions.filter((t) => t.project_id === p.id).map(stripTx),
    milestones: milestones.filter((m) => m.project_id === p.id), // REQUESTED from P2
  }
}

function addTx(projectId: string, operation: TxOperation, invoiceId: string | null, amount = 0): StoredTx {
  const id = uuid()
  const tx: StoredTx = {
    id,
    project_id: projectId,
    invoice_id: invoiceId,
    operation,
    amount_cents: amount,
    mode: 'simulated',
    status: 'confirmed',
    tx_hash: `sim_${id}`,
    block_number: null,
    created_at: now(),
  }
  transactions.unshift(tx)
  return tx
}

function requireRole(...roles: DemoUser['role'][]): MockResult | null {
  const user = currentUser()
  if (!user) return fail(401, 'UNAUTHENTICATED', 'Sign in first.')
  if (!roles.includes(user.role)) return fail(403, 'FORBIDDEN', 'Your role cannot perform this action.')
  return null
}

// ---------- GET ----------

function handleGet(path: string, query: URLSearchParams): MockResult {
  let m: RegExpMatchArray | null

  if (path === '/health') return ok({ status: 'ok', architecture: 'mock' })
  if (path === '/projects') return ok(projectsBase.map(projectView))

  if ((m = path.match(/^\/projects\/([^/]+)(?:\/(wallet|transactions))?$/))) {
    const base = projectsBase.find((p) => p.id === m![1])
    if (!base) return notFound('Project')
    const project = projectView(base)
    if (m[2] === 'transactions') return ok(project.transactions)
    if (m[2] === 'wallet') {
      const { balance_cents, available_cents, paid_cents, mode, wallet_address } = project
      return ok({ balance_cents, available_cents, paid_cents, mode, wallet_address } satisfies Wallet)
    }
    return ok(project)
  }

  if (path === '/suppliers') return ok(suppliers)
  if ((m = path.match(/^\/suppliers\/([^/]+)$/))) {
    const supplier = suppliers.find((s) => s.id === m![1])
    return supplier ? ok(supplier) : notFound('Supplier')
  }

  // Everything below needs a signed-in user.
  const user = currentUser()
  if (!user) return fail(401, 'UNAUTHENTICATED', 'Sign in first.')

  if (path === '/me') {
    const me: Me = {
      id: user.id,
      display_name: user.display_name,
      role: user.role,
      wallet_mode: 'simulated',
      supplier_ids: user.supplier_ids,
      suppliers: suppliers.filter((s) => user.supplier_ids.includes(s.id)).map(({ id, name }) => ({ id, name })),
    }
    return ok(me)
  }

  if (path === '/invoices') {
    const denied = requireRole('supplier', 'municipality', 'auditor')
    if (denied) return denied
    const status = query.get('status')
    if (status && !['submitted', 'analysed', 'approved', 'on_hold', 'rejected', 'payment_pending', 'paid', 'payment_failed'].includes(status)) {
      return fail(400, 'VALIDATION', 'Invalid invoice status.') // the real API takes ONE status only
    }
    let list = [...invoices].sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (user.role === 'supplier') list = list.filter((i) => user.supplier_ids.includes(i.supplier_id)) // like RLS
    if (status) list = list.filter((i) => i.status === status)
    const projectId = query.get('project_id')
    if (projectId) list = list.filter((i) => i.project_id === projectId)
    return ok(list.map(toRow))
  }

  if ((m = path.match(/^\/invoices\/([^/]+)$/))) {
    const inv = invoices.find((i) => i.id === m![1])
    if (!inv || (user.role === 'supplier' && !user.supplier_ids.includes(inv.supplier_id)) || user.role === 'citizen') {
      return notFound('Invoice') // RLS hides it
    }
    const detail: InvoiceDetail = {
      ...inv,
      transactions: transactions.filter((t) => t.invoice_id === inv.id).map(stripTx),
    }
    return ok(detail)
  }

  return fail(404, 'NOT_FOUND', 'Route not found.')
}

// ---------- POST /invoices ----------

function createInvoice(body: unknown): MockResult {
  const denied = requireRole('supplier')
  if (denied) return denied
  if (!(body instanceof FormData)) return fail(400, 'VALIDATION', 'Use multipart/form-data.')

  let payload: NewInvoicePayload
  try {
    payload = JSON.parse(String(body.get(INVOICE_UPLOAD_PARTS.invoice) || ''))
  } catch {
    return fail(400, 'VALIDATION', 'The invoice form field must contain JSON.')
  }
  const file = body.get(INVOICE_UPLOAD_PARTS.file)
  if (!(file instanceof File) || file.size === 0) return fail(400, 'VALIDATION', 'A file of 1 byte to 10 MiB is required.')
  if (!payload.line_items?.length) return fail(400, 'VALIDATION', 'Provide 1-100 line items.')
  if (!projectsBase.some((p) => p.id === payload.project_id)) return fail(400, 'VALIDATION', 'Invalid fields or linked record.')
  const user = currentUser()!
  if (!user.supplier_ids.includes(payload.supplier_id)) return fail(403, 'FORBIDDEN', 'This action is not permitted.')
  if (invoices.some((i) => i.supplier_id === payload.supplier_id && i.invoice_number === payload.invoice_number)) {
    return fail(409, 'CONFLICT', 'This record already exists.')
  }

  const id = uuid()
  const time = now()
  const inv: StoredInvoice = {
    id,
    project_id: payload.project_id,
    supplier_id: payload.supplier_id,
    submitted_by: user.id,
    milestone_id: payload.milestone_id,
    invoice_number: payload.invoice_number,
    invoice_date: payload.invoice_date,
    total_cents: payload.total_cents,
    document_path: `${user.id}/${uuid()}.pdf`,
    document_sha256: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
    status: 'submitted',
    ledger_mode: 'simulated',
    created_at: time,
    updated_at: time,
    items: payload.line_items.map(
      (l, k): InvoiceItem => ({ id: uuid(), invoice_id: id, line_index: k, ...l }),
    ),
    ai_reviews: [],
    approvals: [],
  }
  invoices.push(inv)
  // Submitting anchors the document hash: a recorded event, no money moves.
  addTx(inv.project_id, 'submit_request', id, inv.total_cents)
  return ok(toRow(inv), 201)
}

// ---------- POST /invoices/:id/analyse ----------

// Same rules as supabase/functions/_shared/rules.ts, simplified, for invoices made during the demo.
function rulesReview(inv: StoredInvoice): AiReview {
  const supplier = suppliers.find((s) => s.id === inv.supplier_id)
  const project = projectsBase.find((p) => p.id === inv.project_id)
  const checks: AiReview['checks'] = []
  inv.items.forEach((l, line) => {
    if (!project?.permitted_categories.includes(l.category)) {
      checks.push({ code: 'PURPOSE_MISMATCH', severity: 'high', detail: 'Category is outside the project purpose.', line })
    }
    checks.push({ code: 'NO_BENCHMARK', severity: 'info', detail: 'No reference price matches this line.', line })
  })
  if (inv.total_cents > totals(inv.project_id).available_cents) {
    checks.push({ code: 'BUDGET_EXCEEDED', severity: 'high', detail: 'Invoice total exceeds currently available project funds.' })
  }
  const ageDays = supplier ? (Date.parse(inv.invoice_date) - Date.parse(supplier.registered_on)) / 86400000 : 0
  if (!supplier?.verified || ageDays < 90) {
    checks.push({ code: 'SUPPLIER_REVIEW_REQUIRED', severity: 'medium', detail: 'Supplier is unverified or registered less than 90 days before the invoice date.' })
  }
  const codes = [...new Set(checks.map((c) => c.code))]
  const recommendation = codes.includes('PURPOSE_MISMATCH')
    ? 'REJECT'
    : checks.some((c) => c.severity !== 'info')
      ? 'HOLD_FOR_REVIEW'
      : 'APPROVE'
  return {
    id: uuid(),
    invoice_id: inv.id,
    extraction: {
      supplier_name: supplier?.name ?? '',
      registration_no: supplier?.registration_no ?? '',
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      line_items: inv.items.map(({ description, category, reference_sku, quantity, unit_price_cents, line_total_cents }) => ({
        description, category, reference_sku, quantity, unit_price_cents, line_total_cents,
      })),
      total_cents: inv.total_cents,
      confidence: 1,
    },
    checks,
    flags: codes,
    benchmarks: [],
    potential_excess_cents: 0,
    recommendation,
    explanation: `${recommendation === 'APPROVE' ? 'The deterministic checks found no blocking flags.' : 'The deterministic checks require an authorised human decision.'} AI recommends; authorised humans decide.`,
    mode: 'rules',
    created_at: now(),
  }
}

async function analyse(id: string): Promise<MockResult> {
  const denied = requireRole('municipality')
  if (denied) return denied
  const inv = invoices.find((i) => i.id === id)
  if (!inv) return notFound('Invoice')
  if (inv.status !== 'submitted') return fail(409, 'INVALID_STATE', 'already analysed')
  await sleep(1500) // the "AI" thinking
  const seeded = seededReviews[inv.id]
  const review = seeded ? { ...seeded, id: uuid(), created_at: now() } : rulesReview(inv)
  inv.ai_reviews.push(review)
  inv.status = 'analysed'
  inv.updated_at = now()
  return ok(review)
}

// ---------- POST /invoices/:id/approve | hold | reject ----------

const ALLOWED_FROM: Record<Approval['decision'], Invoice['status'][]> = {
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
  if (!ALLOWED_FROM[decision].includes(inv.status)) return fail(409, 'INVALID_STATE', `cannot ${decision} a ${inv.status} invoice`)
  const review = [...inv.ai_reviews].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const flags = review?.flags ?? []
  const reason = (body as { reason?: string } | undefined)?.reason?.trim() || null
  if (flags.length > 0 && !reason) return fail(400, 'REASON_REQUIRED', 'a reason is required when the AI raised flags')
  if (decision === 'approve' && inv.total_cents > totals(inv.project_id).available_cents) {
    return fail(409, 'BUDGET_EXCEEDED', 'insufficient available funds')
  }

  const approval: Approval = {
    id: uuid(),
    invoice_id: inv.id,
    actor_id: currentUser()!.id,
    decision,
    reason,
    overrode_ai: decision === 'approve' && flags.length > 0,
    ai_review_id: review?.id ?? null,
    created_at: now(),
  }
  inv.approvals.push(approval)
  inv.status = RESULT_STATUS[decision]
  inv.updated_at = now()
  // Approve and reject are recorded events; hold records nothing on chain.
  if (decision === 'approve') addTx(inv.project_id, 'approve', inv.id, inv.total_cents)
  if (decision === 'reject') addTx(inv.project_id, 'reject', inv.id)
  return ok({ invoice_id: inv.id, status: inv.status, approval } satisfies DecisionResult)
}

// ---------- POST /payments/:invoiceId/execute ----------

function executePayment(id: string): MockResult {
  const denied = requireRole('municipality')
  if (denied) return denied
  const inv = invoices.find((i) => i.id === id)
  if (!inv) return notFound('Invoice')
  // Idempotent: a second call returns the same payment.
  const existing = transactions.find((t) => t.invoice_id === inv.id && t.operation === 'release')
  if (existing) return ok(stripTx(existing))
  if (!['approved', 'payment_failed'].includes(inv.status)) return fail(409, 'INVALID_STATE', 'approved invoice required')
  const milestone = inv.milestone_id ? milestones.find((m) => m.id === inv.milestone_id) : undefined
  if (milestone && milestone.status !== 'verified') return fail(409, 'MILESTONE_NOT_VERIFIED', 'delivery required')
  if (inv.total_cents > totals(inv.project_id).balance_cents) return fail(409, 'BUDGET_EXCEEDED', 'insufficient balance')

  // Real simulated mode pays instantly; chain mode goes pending first. Mock the chain
  // behaviour so the polling spinner gets exercised.
  inv.status = 'payment_pending'
  const tx = addTx(inv.project_id, 'release', inv.id, inv.total_cents)
  tx.status = 'pending'
  setTimeout(() => {
    tx.status = 'confirmed'
    inv.status = 'paid'
    inv.updated_at = now()
  }, 3000)
  return ok(stripTx(tx), 202)
}

// ---------- POST /milestones/:id/verify ----------

function verifyMilestone(id: string): MockResult {
  const denied = requireRole('municipality', 'auditor')
  if (denied) return denied
  const milestone = milestones.find((m) => m.id === id)
  if (!milestone) return notFound('milestone')
  const existing = transactions.find((t) => t.operation === 'verify_milestone' && t.project_id === milestone.project_id)
  if (milestone.status === 'verified' && existing) return ok(stripTx(existing))
  milestone.status = 'verified'
  milestone.verified_at = now()
  return ok(stripTx(addTx(milestone.project_id, 'verify_milestone', null)))
}

// ---------- POST /milestones/:id/evidence ----------

async function sha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

const evidenceRows: Evidence[] = []

async function submitEvidence(id: string, body: unknown): Promise<MockResult> {
  const denied = requireRole('supplier', 'citizen')
  if (denied) return denied
  if (!(body instanceof FormData)) return fail(400, 'VALIDATION', 'Use multipart/form-data.')
  const file = body.get(EVIDENCE_UPLOAD_PARTS.file)
  if (!(file instanceof File) || file.size === 0) return fail(400, 'VALIDATION', 'A file of 1 byte to 10 MiB is required.')
  if (!file.type.startsWith('image/')) return fail(400, 'VALIDATION', 'JPEG, PNG or WebP evidence is required.')
  const milestone = milestones.find((m) => m.id === id)
  if (!milestone) return notFound('milestone')

  // Same photo uploaded before → stored, but flagged as a duplicate (like the real API).
  const hash = await sha256(file)
  const prior = evidenceRows.find((e) => e.document_sha256 === hash)
  const caption = body.get(EVIDENCE_UPLOAD_PARTS.caption)
  const row: Evidence = {
    id: uuid(),
    milestone_id: id,
    uploaded_by: currentUser()!.id,
    object_path: `${currentUser()!.id}/${uuid()}.jpg`,
    document_sha256: hash,
    caption: typeof caption === 'string' ? caption : '',
    duplicate_of: prior?.id ?? null,
    created_at: now(),
    flags: prior ? ['DUPLICATE_EVIDENCE'] : [],
  }
  evidenceRows.push(row)
  return ok(row, 201)
}

// ---------- POST /milestones/:id/confirm ----------

function confirmDelivery(id: string, body: unknown): MockResult {
  const denied = requireRole('citizen')
  if (denied) return denied
  if (!milestones.some((m) => m.id === id)) return fail(400, 'VALIDATION', 'Invalid fields or linked record.')
  const note = (body as { note?: unknown } | undefined)?.note
  const answer = (body as { answer?: Verification['answer'] } | undefined)?.answer ?? null
  if (answer !== null && !['yes', 'no', 'not_sure'].includes(answer)) {
    return fail(400, 'VALIDATION', 'Answer must be yes, no or not_sure.')
  }
  const row: Verification = {
    id: uuid(),
    milestone_id: id,
    actor_id: currentUser()!.id,
    kind: 'community',
    answer,
    note: typeof note === 'string' ? note : '',
    created_at: now(),
  }
  return ok([row], 201) // PostgREST insert returns an array of rows
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
  if ((m = path.match(/^\/milestones\/([^/]+)\/confirm$/))) return confirmDelivery(m[1], body)

  return fail(404, 'NOT_FOUND', 'Route not found.')
}
