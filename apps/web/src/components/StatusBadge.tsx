import type { InvoiceStatus } from '../types'

const STYLES: Record<InvoiceStatus, { label: string; className: string }> = {
  submitted: { label: 'Submitted', className: 'bg-slate-100 text-slate-700' },
  analysed: { label: 'Analysed', className: 'bg-sky-100 text-sky-800' },
  approved: { label: 'Approved', className: 'bg-brand-50 text-brand-700' },
  on_hold: { label: 'On hold', className: 'bg-amber-100 text-amber-800' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
  payment_pending: { label: 'Payment pending', className: 'bg-sky-100 text-sky-800' },
  paid: { label: 'Paid', className: 'bg-brand-600 text-white' },
  payment_failed: { label: 'Payment failed', className: 'bg-red-100 text-red-700' },
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STYLES[status] ?? { label: status, className: 'bg-slate-100 text-slate-700' }
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ${s.className}`}
    >
      {s.label}
    </span>
  )
}
