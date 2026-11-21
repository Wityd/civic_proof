import type { InvoiceStatus } from '../types'

// Pill with a leading dot. Green = approved/paid, amber = on hold, red = rejected/failed,
// grey/blue = pending steps (CLAUDE.md).
const STYLES: Record<InvoiceStatus, { label: string; pill: string; dot: string }> = {
  submitted: { label: 'Submitted', pill: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  analysed: { label: 'Analysed', pill: 'bg-sky-50 text-sky-800 ring-1 ring-sky-100', dot: 'bg-sky-500' },
  approved: { label: 'Approved', pill: 'bg-brand-50 text-brand-700 ring-1 ring-brand-100', dot: 'bg-brand-500' },
  on_hold: { label: 'On hold', pill: 'bg-amber-50 text-amber-800 ring-1 ring-amber-100', dot: 'bg-amber-500' },
  rejected: { label: 'Rejected', pill: 'bg-red-50 text-red-700 ring-1 ring-red-100', dot: 'bg-red-500' },
  payment_pending: { label: 'Payment pending', pill: 'bg-sky-50 text-sky-800 ring-1 ring-sky-100', dot: 'bg-sky-500 animate-pulse' },
  paid: { label: 'Paid', pill: 'bg-brand-600 text-white', dot: 'bg-white' },
  payment_failed: { label: 'Payment failed', pill: 'bg-red-50 text-red-700 ring-1 ring-red-100', dot: 'bg-red-500' },
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STYLES[status] ?? { label: status, pill: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${s.pill}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}
