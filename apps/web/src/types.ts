// API shapes, matching supabase/functions/civicproof-api on main.
// LedgerMode/TxStatus mirror packages/shared/types.ts. They are copied, not imported, on
// purpose: deploy/web/Dockerfile only copies apps/web into the build, so an import from
// ../packages would break the Northflank build.

export type Role = 'citizen' | 'supplier' | 'municipality' | 'auditor'

export type ApiResponse<T> = { data: T } | { error: { code: string; message: string } }

export type LedgerMode = 'simulated' | 'fuji' | 'bsc'
export type TxStatus = 'pending' | 'confirmed' | 'failed'

// ---------- users ----------

// GET /me
export interface Me {
  id: string
  display_name: string
  role: Role
  wallet_mode: LedgerMode
  supplier_ids: string[] // companies this user may invoice for (empty unless supplier)
  suppliers: { id: string; name: string }[]
}

// A seeded demo account for the "View as" switcher (frontend only).
export interface DemoUser {
  id: string
  display_name: string
  role: Role
  title: string
  supplier_ids: string[]
}

// ---------- projects ----------

export interface Milestone {
  id: string
  project_id?: string // not sent inside the project response
  code: string
  title: string
  description: string
  status: 'pending' | 'verified'
  verified_at: string | null
}

// Redacted invoice inside the public dashboard
export interface PublicInvoice {
  id: string
  invoice_number: string
  supplier_name: string
  total_cents: number
  status: InvoiceStatus
  invoice_date: string
}

export type TxOperation =
  | 'create_project'
  | 'fund_project'
  | 'submit_request'
  | 'approve'
  | 'reject'
  | 'register_milestone'
  | 'verify_milestone'
  | 'release'

export interface Transaction {
  id: string
  invoice_id: string | null
  operation: TxOperation
  amount_cents: number
  mode: LedgerMode
  status: TxStatus
  tx_hash: string | null
  block_number: number | null
  created_at: string
}

// GET /projects (array) and GET /projects/:id
export interface Project {
  id: string
  code: string
  name: string
  description: string
  location: string
  budget_cents: number
  permitted_categories: string[]
  mode: LedgerMode
  paid_cents: number
  balance_cents: number
  available_cents: number
  wallet_address: string | null
  invoices: PublicInvoice[]
  transactions: Transaction[]
  milestones?: Milestone[] // optional so older API responses still type-check
}

// GET /projects/:id/wallet
export interface Wallet {
  balance_cents: number
  available_cents: number
  paid_cents: number
  mode: LedgerMode
  wallet_address: string | null
}

// GET /suppliers, GET /suppliers/:id
export interface Supplier {
  id: string
  name: string
  registration_no: string
  registered_on: string
  verified: boolean
}

// ---------- invoices ----------

export type InvoiceStatus =
  | 'submitted'
  | 'analysed'
  | 'approved'
  | 'on_hold'
  | 'rejected'
  | 'payment_pending'
  | 'paid'
  | 'payment_failed'

// GET /invoices rows (raw table row)
export interface Invoice {
  id: string
  project_id: string
  supplier_id: string
  submitted_by: string
  milestone_id: string | null
  invoice_number: string
  invoice_date: string
  total_cents: number
  document_path: string
  document_sha256: string
  status: InvoiceStatus
  ledger_mode: LedgerMode
  created_at: string
  updated_at: string
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  line_index: number
  description: string
  category: string
  reference_sku: string | null
  quantity: number
  unit_price_cents: number
  line_total_cents: number
}

export type FlagCode =
  | 'PURPOSE_MISMATCH'
  | 'PRICE_ABOVE_BENCHMARK'
  | 'DUPLICATE_INVOICE'
  | 'ARITHMETIC_MISMATCH'
  | 'BUDGET_EXCEEDED'
  | 'SUPPLIER_REVIEW_REQUIRED'
  | 'NO_BENCHMARK'
  | 'DUPLICATE_EVIDENCE'
  | 'AI_CATEGORY_CONCERN'

export type Recommendation = 'APPROVE' | 'HOLD_FOR_REVIEW' | 'REJECT'

export interface AiReview {
  id: string
  invoice_id: string
  extraction: {
    supplier_name: string
    registration_no: string
    invoice_number: string
    invoice_date: string
    line_items: Omit<InvoiceItem, 'id' | 'invoice_id' | 'line_index'>[]
    total_cents: number
    confidence: number
  }
  checks: { code: FlagCode; severity: 'high' | 'medium' | 'info'; line?: number; detail: string }[]
  flags: FlagCode[]
  benchmarks: {
    line: number
    sku: string
    benchmark_unit_cents: number
    invoice_unit_cents: number
    benchmark_total_cents: number
    excess_cents: number
    source: string
  }[]
  potential_excess_cents: number
  recommendation: Recommendation
  explanation: string
  mode: 'rules' | 'llm'
  created_at: string
}

export interface Approval {
  id: string
  invoice_id: string
  actor_id: string
  decision: 'approve' | 'hold' | 'reject'
  reason: string | null
  overrode_ai: boolean
  ai_review_id: string | null
  created_at: string
  actor_display_name?: string
  actor_name?: string // legacy/mock responses
}

// GET /invoices/:id
export interface InvoiceDetail extends Invoice {
  items: InvoiceItem[]
  ai_reviews: AiReview[]
  approvals: Approval[]
  transactions: Transaction[]
}

// JSON in the "invoice" multipart part of POST /invoices
export interface NewInvoicePayload {
  project_id: string
  supplier_id: string
  milestone_id: string | null
  invoice_number: string
  invoice_date: string
  total_cents: number
  line_items: {
    description: string
    category: string
    reference_sku: string | null
    quantity: number
    unit_price_cents: number
    line_total_cents: number
  }[]
}

// POST /invoices/:id/approve | hold | reject
export interface DecisionResult {
  invoice_id: string
  status: InvoiceStatus
  approval: Approval
}

// ---------- milestones ----------

// POST /milestones/:id/evidence
export interface Evidence {
  id: string
  milestone_id: string
  uploaded_by: string
  object_path: string
  document_sha256: string
  caption: string
  duplicate_of: string | null
  created_at: string
  flags: FlagCode[]
}

// POST /milestones/:id/confirm. Historical note-only records have a null answer.
export type DeliveryAnswer = 'yes' | 'no' | 'not_sure'
export interface Verification {
  id: string
  milestone_id: string
  actor_id: string
  kind: 'community' | 'official'
  answer: DeliveryAnswer | null
  note: string
  created_at: string
}
