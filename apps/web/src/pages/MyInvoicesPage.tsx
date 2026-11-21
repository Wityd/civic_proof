import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckIcon, ScanIcon, SearchIcon, WalletIcon } from '../components/landing/icons'
import { Money } from '../components/Money'
import { RequireRole } from '../components/RequireRole'
import { PageHeader, SegmentedTabs, StatTile } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { TxHash } from '../components/TxHash'
import { useViewAs } from '../context/ViewAsContext'
import { api } from '../lib/api'
import { formatDate } from '../lib/dates'
import { releaseTx } from '../lib/ledger'
import { formatMoney } from '../lib/money'
import { useProjectCodes, useSuppliers } from '../lib/queries'
import type { Invoice, InvoiceStatus } from '../types'

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
    queryFn: () => api.get<Invoice[]>('/invoices'),
  })
  // Invoice rows carry only IDs; project data gives the code, milestone code and payment hash.
  const { byId: projectById, codeOf } = useProjectCodes()
  const { nameOf } = useSuppliers()
  const milestoneCode = (inv: Invoice) =>
    projectById.get(inv.project_id)?.milestones?.find((m) => m.id === inv.milestone_id)?.code ?? 'the milestone'
  const paymentOf = (inv: Invoice) => releaseTx(projectById.get(inv.project_id)?.transactions ?? [], inv.id)

  const all = invoices.data ?? []
  const inTab = (key: string) => {
    const statuses = TABS.find((t) => t.key === key)?.statuses
    return statuses ? all.filter((i) => statuses.includes(i.status)) : all
  }
  const shown = inTab(tab)
  const sum = (list: Invoice[]) => list.reduce((s, i) => s + i.total_cents, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        greet
        title="My invoices"
        subtitle="Every invoice you've sent, and exactly where each one stands."
        action={
          <Link
            to="/supplier/invoices/new"
            className="rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
          >
            + New invoice
          </Link>
        }
      />

      {/* Summary */}
      {invoices.data && all.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile tone="plain" icon={<ScanIcon size={15} />} label="Submitted" value={<Money cents={sum(all)} />} caption={`${all.length} invoices`} />
          <StatTile tone="sky" icon={<SearchIcon size={15} />} label="In review" value={<Money cents={sum(inTab('review'))} />} caption={`${inTab('review').length} invoices`} />
          <StatTile tone="lavender" icon={<CheckIcon size={15} />} label="Approved, not paid yet" value={<Money cents={sum(inTab('approved'))} />} caption={`${inTab('approved').length} invoices`} />
          <StatTile tone="mint" icon={<WalletIcon size={15} />} label="Paid to you" value={<Money cents={sum(inTab('paid'))} className="text-brand-700" />} caption={`${inTab('paid').length} invoices`} />
        </div>
      )}

      <section className="rounded-card bg-white shadow-card">
        {/* Tabs */}
        <div className="border-b border-slate-100 px-4 pt-4 pb-4">
          <SegmentedTabs
            label="Filter invoices"
            active={tab}
            onChange={setTab}
            tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: invoices.data ? inTab(t.key).length : undefined }))}
          />
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
              <thead className="text-[11px] tracking-wider text-slate-400 uppercase">
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
                      <p className="text-xs text-slate-500">
                        {(user?.supplier_ids.length ?? 0) > 1 && <>{nameOf(inv.supplier_id)} · </>}
                        {formatDate(inv.invoice_date)}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <Link to={`/projects/${inv.project_id}`} className="text-slate-700 hover:text-brand-700">
                        {codeOf(inv.project_id)}
                      </Link>
                      {inv.milestone_id && (
                        <p className="text-xs text-slate-500">
                          Milestone {milestoneCode(inv)} ·{' '}
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
                      <p className="mt-1 text-xs text-slate-500">{statusHint(inv, milestoneCode(inv))}</p>
                    </td>
                    <td className="px-6 py-4">
                      <TxHash hash={paymentOf(inv)?.tx_hash ?? null} mode={paymentOf(inv)?.mode ?? null} />
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
function statusHint(inv: Invoice, milestoneCode: string): string {
  switch (inv.status) {
    case 'submitted':
      return 'Waiting for the AI check'
    case 'analysed':
      return 'Waiting for an officer to decide'
    case 'on_hold':
      return 'On hold while an officer checks it'
    case 'approved':
      return inv.milestone_id ? `Paid once ${milestoneCode} is verified` : 'Payment coming soon'
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

