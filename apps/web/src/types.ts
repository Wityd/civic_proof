// TEMPORARY: replace with imports from packages/shared once it exists.
// Keep these in line with the API shapes in apps/web/CLAUDE.md.

export type Role = 'citizen' | 'supplier' | 'municipality' | 'auditor'

export type ApiResponse<T> = { data: T } | { error: { code: string; message: string } }

export interface User {
  id: string
  name: string
  email: string
  role: Role
  title: string
  supplier_id: string | null
}

export type InvoiceStatus =
  | 'submitted'
  | 'analysed'
  | 'approved'
  | 'on_hold'
  | 'rejected'
  | 'payment_pending'
  | 'paid'
  | 'payment_failed'

export type LedgerMode = 'fuji' | 'simulated'

export interface Project {
  id: string
  name: string
  description: string
  location: string
  categories: string[]
  budget_cents: number
  paid_cents: number
  balance_cents: number
}

export interface Milestone {
  id: string
  project_id: string
  title: string
  status: 'pending' | 'evidence_submitted' | 'verified'
}

export interface LineItem {
  description: string
  category: string
  reference_sku: string | null
  quantity: number
  unit_price_cents: number
  line_total_cents: number
}

export interface InvoiceSummary {
  id: string
  project_id: string
  supplier_id: string
  supplier_name: string
  invoice_number: string
  invoice_date: string
  total_cents: number
  status: InvoiceStatus
  flags: FlagCode[]
  milestone_id: string | null
  tx_hash: string | null
  tx_mode: LedgerMode | null
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

export type Recommendation = 'APPROVE' | 'HOLD_FOR_REVIEW' | 'REJECT'

export interface AiReview {
  extraction: {
    supplier_name: string
    registration_no: string
    invoice_number: string
    invoice_date: string
    line_items: LineItem[]
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
  mode: string
}

export interface Approval {
  id: string
  invoice_id: string
  decision: 'approve' | 'hold' | 'reject'
  reason: string | null
  decided_by_name: string
  overrode_ai: boolean
  created_at: string
}

export interface Transaction {
  id: string
  project_id: string
  invoice_id: string | null
  kind: 'allocation' | 'invoice_submitted' | 'invoice_rejected' | 'payment'
  moves_money: boolean
  amount_cents: number | null
  tx_hash: string
  mode: LedgerMode
  created_at: string
}

// JSON part of POST /invoices (sent next to the PDF)
export interface NewInvoicePayload {
  project_id: string
  invoice_number: string
  invoice_date: string
  milestone_id: string | null
  line_items: Omit<LineItem, 'reference_sku'>[]
  total_cents: number
}

export interface InvoiceDetail extends InvoiceSummary {
  line_items: LineItem[]
  ai_review: AiReview | null
  approvals: Approval[]
  transactions: Transaction[]
}

export interface ProjectDetail {
  project: Project
  milestones: Milestone[]
  invoices: InvoiceSummary[]
}

export interface Wallet {
  project_id: string
  balance_cents: number
  available_cents: number
  mode: LedgerMode
  contract_address: string | null
}

// Response of POST /milestones/:id/evidence
export interface Evidence {
  id: string
  milestone_id: string
  photo_hash: string
  note: string | null
  flags: FlagCode[]
  created_at: string
}

export interface Supplier {
  id: string
  name: string
  registration_no: string
  registered_on: string
  city: string
}
