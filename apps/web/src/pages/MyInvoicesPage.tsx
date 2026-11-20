import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { RequireRole } from '../components/RequireRole'
import { StatusBadge } from '../components/StatusBadge'
import { TxHash } from '../components/TxHash'
import { useViewAs } from '../context/ViewAsContext'
import { api } from '../lib/api'
import { formatDate } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { InvoiceStatus, InvoiceSummary } from '../types'

export function MyInvoicesPage() {
  return (
    <RequireRole role="supplier">
      <MyInvoices />
    </RequireRole>
  )
}

const TABS: { key: string; label: string; statuses: InvoiceStatus[] | null }[] = [
  { key: 'all', label: 'All', statuses: null },
  { key: 'review', label: 'In review', statuses: ['submitted', 'analysed', 'on_hold'] },
  { key: 'approved', label: 'Approved', statuses: ['approved', 'payment_pending', 'payment_failed'] },
  { key: 'paid', label: 'Paid', statuses: ['paid'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
]

function MyInvoices() {
  const { user } = useViewAs()
  const [tab, setTab] = useState('all')

  // The API returns only this supplier's invoices.
  const invoices = useQuery({
    queryKey: ['invoices', 'mine', user?.id],
    queryFn: () => api.get<InvoiceSummary[]>('/invoices'),
  })

  const all = invoices.data ?? []
  const inTab = (key: string) => {
    const statuses = TABS.find((t) => t.key === key)?.statuses
    return statuses ? all.filter((i) => statuses.includes(i.status)) : all
  }
  const shown = inTab(tab)
  const sum = (list: InvoiceSummary[]) => list.reduce((s, i) => s + i.total_cents, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">My invoices</h1>
          <p className="mt-1 text-slate-500">{user?.title}</p>
        </div>
        <Link
          to="/supplier/invoices/new"
          className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + New invoice
        </Link>
      </div>

      {/* Summary */}
      {invoices.data && all.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Submitted" value={formatMoney(sum(all))} note={`${all.length} invoices`} />
          <Stat label="In review" value={formatMoney(sum(inTab('review')))} note={`${inTab('review').length} invoices`} />
          <Stat
            label="Approved, not paid yet"
            value={formatMoney(sum(inTab('approved')))}
            note={`${inTab('approved').length} invoices`}
          />
          <Stat
            label="Paid to you"
            value={formatMoney(sum(inTab('paid')))}
            note={`${inTab('paid').length} invoices`}
            tone="text-brand-700"
          />
        </div>
      )}

      <section className="rounded-card bg-white shadow-card">
        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 pt-4 pb-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap ${
                tab === t.key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
              {invoices.data && <span className="ml-1.5 text-xs opacity-60">{inTab(t.key).length}</span>}
            </button>
          ))}
        </div>

        {invoices.isPending && (
          <div className="space-y-3 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        )}

        {invoices.error && (
          <div className="p-6">
            <p className="font-semibold text-red-700">Could not load your invoices</p>
            <p className="mt-1 text-sm text-slate-500">{invoices.error.message}</p>
            <button
              onClick={() => invoices.refetch()}
              className="mt-3 rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white"
            >
              Try again
            </button>
          </div>
        )}

        {invoices.data && all.length === 0 && (
          <div className="p-10 text-center">
            <p className="font-semibold text-slate-800">No invoices yet</p>
            <p className="mt-1 text-sm text-slate-500">When you submit an invoice it shows up here with its status.</p>
            <Link
              to="/supplier/invoices/new"
              className="mt-4 inline-block rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white"
            >
              Submit your first invoice
            </Link>
          </div>
        )}

        {invoices.data && all.length > 0 && shown.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">No invoices in this group.</p>
        )}

        {shown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-6 py-3 font-semibold">Invoice</th>
                  <th className="px-6 py-3 font-semibold">Project</th>
                  <th className="px-6 py-3 text-right font-semibold">Amount</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((inv) => (
                  <tr key={inv.id} className="align-top">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{inv.invoice_number}</p>
                      <p className="text-xs text-slate-500">{formatDate(inv.invoice_date)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <Link to={`/projects/${inv.project_id}`} className="text-slate-700 hover:text-brand-700">
                        {inv.project_id}
                      </Link>
                      {inv.milestone_id && (
                        <p className="text-xs text-slate-500">
                          Milestone {inv.milestone_id} ·{' '}
                          <Link
                            to={`/delivery/${inv.milestone_id}/evidence`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            Upload evidence →
                          </Link>
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold whitespace-nowrap text-slate-900 tabular-nums">
                      {formatMoney(inv.total_cents)}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={inv.status} />
                      <p className="mt-1 text-xs text-slate-500">{statusHint(inv)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <TxHash hash={inv.tx_hash} mode={inv.tx_mode} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// One plain sentence telling the supplier what happens next.
function statusHint(inv: InvoiceSummary): string {
  switch (inv.status) {
    case 'submitted':
      return 'Waiting for the AI check'
    case 'analysed':
      return 'Waiting for an officer to decide'
    case 'on_hold':
      return 'On hold while an officer checks it'
    case 'approved':
      return inv.milestone_id ? `Paid once ${inv.milestone_id} is verified` : 'Payment coming soon'
    case 'payment_pending':
      return 'Payment is being sent'
    case 'paid':
      return 'Paid'
    case 'payment_failed':
      return 'Payment failed; it will be retried'
    case 'rejected':
      return 'Will not be paid'
  }
}

function Stat({ label, value, note, tone = 'text-slate-900' }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="rounded-card bg-white p-5 shadow-card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums sm:text-2xl ${tone}`}>{value}</p>
      <p className="text-xs text-slate-400">{note}</p>
    </div>
  )
}
