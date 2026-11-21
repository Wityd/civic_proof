import { useQueries, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlagChip } from '../components/FlagChip'
import { ArrowUpRightIcon, FlagIcon, GavelIcon, ScanIcon, WalletIcon } from '../components/landing/icons'
import { RequireRole } from '../components/RequireRole'
import { PageHeader, SegmentedTabs, StatTile, type Tone } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { api } from '../lib/api'
import { formatDate } from '../lib/dates'
import { invoiceFlags } from '../lib/ledger'
import { formatMoney } from '../lib/money'
import { useProjectCodes, useSuppliers } from '../lib/queries'
import type { Invoice, InvoiceDetail, InvoiceStatus } from '../types'

export function ReviewQueuePage() {
  return (
    <RequireRole role="municipality">
      <ReviewQueue />
    </RequireRole>
  )
}

const TABS: { key: string; label: string; hint: string; statuses: InvoiceStatus[] }[] = [
  { key: 'analysis', label: 'Needs analysis', hint: 'Run the AI check first.', statuses: ['submitted'] },
  { key: 'decide', label: 'Ready to decide', hint: 'AI has checked these. Approve, hold or reject.', statuses: ['analysed'] },
  { key: 'hold', label: 'On hold', hint: 'Waiting on more checks. Approve or reject.', statuses: ['on_hold'] },
  { key: 'pay', label: 'Ready to pay', hint: 'Approved. Release the payment.', statuses: ['approved', 'payment_failed'] },
]
const QUEUE_STATUSES = TABS.flatMap((t) => t.statuses)

const TILE: Record<string, { tone: Tone; icon: ReactNode }> = {
  analysis: { tone: 'plain', icon: <ScanIcon size={15} /> },
  decide: { tone: 'sky', icon: <GavelIcon size={15} /> },
  hold: { tone: 'amber', icon: <FlagIcon size={15} /> },
  pay: { tone: 'mint', icon: <WalletIcon size={15} /> },
}

function ReviewQueue() {
  const navigate = useNavigate()
  // The API filters by one status only, so load all invoices and filter here.
  const queue = useQuery({
    queryKey: ['invoices', 'all'],
    queryFn: () => api.get<Invoice[]>('/invoices'),
    select: (rows) => rows.filter((i) => QUEUE_STATUSES.includes(i.status)),
  })
  const { nameOf } = useSuppliers()
  const { codeOf } = useProjectCodes()

  // Flags live on the AI review in each invoice's details; load those for analysed invoices.
  const analysedIds = (queue.data ?? []).filter((i) => i.status !== 'submitted').map((i) => i.id)
  const details = useQueries({
    queries: analysedIds.map((id) => ({
      queryKey: ['invoice', id],
      queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
    })),
  })
  const flagsOf = (id: string) => {
    const d = details[analysedIds.indexOf(id)]?.data
    return d ? invoiceFlags(d) : null
  }
  const flagsFailed = (id: string) => !!details[analysedIds.indexOf(id)]?.error

  const all = queue.data ?? []
  const inTab = (key: string) => all.filter((i) => TABS.find((t) => t.key === key)!.statuses.includes(i.status))

  // Open the first tab that has work in it.
  const [chosen, setChosen] = useState<string | null>(null)
  const tab = chosen ?? TABS.find((t) => inTab(t.key).length > 0)?.key ?? 'decide'
  const current = TABS.find((t) => t.key === tab)!
  const shown = inTab(tab)

  return (
    <div className="space-y-6">
      <PageHeader greet title="Review queue" subtitle="Here's what needs your attention. AI recommends; authorised humans decide." />

      {/* One tile per stage: how many invoices and how much money is waiting there. */}
      {queue.data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {TABS.map((t) => (
            <StatTile
              key={t.key}
              tone={TILE[t.key].tone}
              icon={TILE[t.key].icon}
              label={t.label}
              value={inTab(t.key).length}
              caption={formatMoney(inTab(t.key).reduce((s, i) => s + i.total_cents, 0))}
            />
          ))}
        </div>
      )}

      <section className="rounded-card bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 pt-4 pb-4">
          <SegmentedTabs
            label="Review stages"
            active={tab}
            onChange={setChosen}
            tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: queue.data ? inTab(t.key).length : undefined }))}
          />
        </div>

        <p className="px-6 pt-4 text-sm text-slate-500">{current.hint}</p>

        {queue.isPending && (
          <div className="space-y-3 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        )}

        {queue.error && (
          <div className="p-6">
            <p className="font-semibold text-red-700">Could not load the queue</p>
            <p className="mt-1 text-sm text-slate-500">{queue.error.message}</p>
            <button
              onClick={() => queue.refetch()}
              className="mt-3 rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white"
            >
              Try again
            </button>
          </div>
        )}

        {queue.data && shown.length === 0 && (
          <p className="p-10 text-center text-sm text-slate-500">Nothing here. All caught up.</p>
        )}

        {shown.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] tracking-wider text-slate-400 uppercase">
                <tr>
                  <th className="px-6 py-3 font-semibold">Invoice</th>
                  <th className="px-6 py-3 font-semibold">Supplier</th>
                  <th className="px-6 py-3 text-right font-semibold">Amount</th>
                  <th className="px-6 py-3 font-semibold">AI flags</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => navigate(`/review/${inv.id}`)}
                    className="group cursor-pointer align-top transition hover:bg-slate-50/80"
                  >
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{inv.invoice_number}</p>
                      <p className="text-xs text-slate-500">
                        {codeOf(inv.project_id)} · {formatDate(inv.invoice_date)}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{nameOf(inv.supplier_id)}</td>
                    <td className="px-6 py-4 text-right font-semibold whitespace-nowrap text-slate-900 tabular-nums">
                      {formatMoney(inv.total_cents)}
                    </td>
                    <td className="px-6 py-4">
                      {inv.status === 'submitted' ? (
                        <span className="text-xs text-slate-400">Not analysed yet</span>
                      ) : flagsOf(inv.id) === null ? (
                        <span className="text-xs text-slate-400">
                          {flagsFailed(inv.id) ? 'Could not load. Open the invoice to see them.' : 'Loading…'}
                        </span>
                      ) : flagsOf(inv.id)!.length === 0 ? (
                        <span className="text-xs font-medium text-brand-700">No flags</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {flagsOf(inv.id)!.map((f) => (
                            <FlagChip key={f} code={f} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="inline-grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-700 transition group-hover:bg-navy-900 group-hover:text-white">
                        <ArrowUpRightIcon size={15} />
                        <span className="sr-only">Open</span>
                      </span>
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
