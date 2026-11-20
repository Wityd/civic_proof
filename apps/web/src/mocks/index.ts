// Fake API used when VITE_USE_MOCKS=true. Same paths and shapes as the real API.
import { INVOICE_UPLOAD_PARTS } from '../lib/apiContract'
import { getViewAsId } from '../lib/viewAs'
import type {
  ApiResponse,
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

export const mockUsers = usersJson as User[]
const projects = projectsJson as Project[]
const milestones = milestonesJson as Milestone[]
const suppliers = suppliersJson as Supplier[]
const invoices = invoicesJson as unknown as Omit<InvoiceDetail, 'transactions'>[]
const wallets: Record<string, Wallet> = { CP001: walletCP001 as Wallet }
const transactions: Record<string, Transaction[]> = { CP001: transactionsCP001 as Transaction[] }

type MockResult = { status: number; body: ApiResponse<unknown> }

const ok = (data: unknown): MockResult => ({ status: 200, body: { data } })
const fail = (status: number, code: string, message: string): MockResult => ({
  status,
  body: { error: { code, message } },
})
const notFound = (what: string) => fail(404, 'NOT_FOUND', `${what} not found`)

function toSummary(inv: (typeof invoices)[number]): InvoiceSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { line_items, ai_review, approvals, ...summary } = inv
  return summary
}

function currentUser(): User | null {
  const id = getViewAsId()
  return mockUsers.find((u) => u.id === id) ?? null
}

function handleGet(path: string, query: URLSearchParams): MockResult {
  let m: RegExpMatchArray | null

  if (path === '/me') {
    const user = currentUser()
    return user ? ok(user) : fail(401, 'UNAUTHORIZED', 'Nobody is signed in')
  }

  if (path === '/projects') return ok(projects)

  if ((m = path.match(/^\/projects\/([^/]+)$/))) {
    const project = projects.find((p) => p.id === m![1])
    if (!project) return notFound('Project')
    const detail: ProjectDetail = {
      project,
      milestones: milestones.filter((x) => x.project_id === project.id),
      invoices: invoices.filter((i) => i.project_id === project.id).map(toSummary),
    }
    return ok(detail)
  }

  if ((m = path.match(/^\/projects\/([^/]+)\/wallet$/))) {
    return wallets[m[1]] ? ok(wallets[m[1]]) : notFound('Wallet')
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
  if (!projects.some((p) => p.id === payload.project_id)) return notFound('Project')

  const supplierId = user.supplier_id
  if (invoices.some((i) => i.supplier_id === supplierId && i.invoice_number === payload.invoice_number)) {
    return fail(409, 'DUPLICATE_INVOICE', `You already submitted invoice ${payload.invoice_number}`)
  }

  const id = `inv_${String(invoices.length + 1).padStart(3, '0')}`
  const inv: (typeof invoices)[number] = {
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
  const ledger = (transactions[payload.project_id] ??= [])
  ledger.unshift({
    id: `tx_${Date.now()}`,
    project_id: payload.project_id,
    invoice_id: id,
    kind: 'invoice_submitted',
    moves_money: false,
    amount_cents: null,
    tx_hash: `sim_${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
    mode: 'simulated',
    created_at: new Date().toISOString(),
  })

  return { status: 201, body: { data: toSummary(inv) } }
}

export async function mockRequest(
  method: 'GET' | 'POST',
  fullPath: string,
  body?: unknown,
): Promise<MockResult> {
  await new Promise((r) => setTimeout(r, 300)) // feel like a real network call
  const [path, qs = ''] = fullPath.split('?')
  if (method === 'GET') return handleGet(path, new URLSearchParams(qs))
  if (path === '/invoices') return createInvoice(body)
  // More POST mocks get added as each page needs them.
  return fail(501, 'NOT_MOCKED', `No mock yet for ${method} ${path}`)
}
