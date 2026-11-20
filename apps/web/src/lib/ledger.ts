// Small helpers that turn raw API data into what the pages show.
import type { AiReview, Approval, DemoUser, FlagCode, InvoiceDetail, Transaction, TxOperation } from '../types'

// Only funding and release move money; everything else is a recorded event.
export const movesMoney = (tx: Transaction) => tx.operation === 'fund_project' || tx.operation === 'release'

export const TX_LABEL: Record<TxOperation, string> = {
  create_project: 'Project wallet created',
  fund_project: 'Budget allocated to wallet',
  submit_request: 'Invoice submitted (document hash recorded)',
  approve: 'Approval recorded',
  reject: 'Rejection recorded',
  register_milestone: 'Milestone registered',
  verify_milestone: 'Milestone verified',
  release: 'Payment released',
}

// The confirmed payment for an invoice, if any.
export function releaseTx(transactions: Transaction[], invoiceId: string): Transaction | undefined {
  return transactions.find((t) => t.invoice_id === invoiceId && t.operation === 'release' && t.status !== 'failed')
}

// An invoice can be analysed more than once in theory; use the newest review.
export function latestReview(inv: Pick<InvoiceDetail, 'ai_reviews'>): AiReview | undefined {
  return [...inv.ai_reviews].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
}

export const invoiceFlags = (inv: Pick<InvoiceDetail, 'ai_reviews'>): FlagCode[] => latestReview(inv)?.flags ?? []

// Explorer link for real chains only. Simulated hashes are never links.
export function explorerUrl(mode: string | null, hash: string): string | null {
  if (hash.startsWith('sim_')) return null
  if (mode === 'fuji') return `https://testnet.snowtrace.io/tx/${hash}`
  if (mode === 'bsc') return `https://testnet.bscscan.com/tx/${hash}`
  return null
}

// Prefer the API field; preserve legacy/mock names and the existing fallback.
export function approverName(a: Approval, demoUsers: DemoUser[]): string {
  return a.actor_display_name ?? a.actor_name ?? demoUsers.find((u) => u.id === a.actor_id)?.display_name ?? 'Municipality officer'
}
