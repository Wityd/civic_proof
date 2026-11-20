import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlagChip } from '../components/FlagChip'
import { RequireRole } from '../components/RequireRole'
import { StatusBadge } from '../components/StatusBadge'
import { api } from '../lib/api'
import { formatDate } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { InvoiceStatus, InvoiceSummary } from '../types'

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
const QUEUE_STATUSES = TABS.flatMap((t) => t.statuses).join(',')

function ReviewQueue() {
  const navigate = useNavigate()
  const queue = useQuery({
    queryKey: ['invoices', 'queue'],
    queryFn: () => api.get<InvoiceSummary[]>(`/invoices?status=${QUEUE_STATUSES}`),
  })

  const all = queue.data ?? []
  const inTab = (key: string) => all.filter((i) => TABS.find((t) => t.key === key)!.statuses.includes(i.status))

  // Open the first tab that has work in it.
  const [chosen, setChosen] = useState<string | null>(null)
  const tab = chosen ?? TABS.find((t) => inTab(t.key).length > 0)?.key ?? 'decide'
  const current = TABS.find((t) => t.key === tab)!
  const shown = inTab(tab)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Review queue</h1>
        <p className="mt-1 text-slate-500">AI recommends; authorised humans decide.</p>
      </div>

      <section className="rounded-card bg-white shadow-card">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 pt-4 pb-3">
          {TABS.map((t) => {
            const count = inTab(t.key).length
            return (
              <button
                key={t.key}
                onClick={() => setChosen(t.key)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap ${
                  tab === t.key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
                {queue.data && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 text-xs ${count ? 'bg-slate-800 text-white' : 'opacity-50'}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
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
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
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
                    className="cursor-pointer align-top hover:bg-slate-50"
                  >
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{inv.invoice_number}</p>
                      <p className="text-xs text-slate-500">
                        {inv.project_id} · {formatDate(inv.invoice_date)}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{inv.supplier_name}</td>
                    <td className="px-6 py-4 text-right font-semibold whitespace-nowrap text-slate-900 tabular-nums">
                      {formatMoney(inv.total_cents)}
                    </td>
                    <td className="px-6 py-4">
                      {inv.status === 'submitted' ? (
                        <span className="text-xs text-slate-400">Not analysed yet</span>
                      ) : inv.flags.length === 0 ? (
                        <span className="text-xs font-medium text-brand-700">No flags</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {inv.flags.map((f) => (
                            <FlagChip key={f} code={f} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-medium whitespace-nowrap text-brand-700">Open →</span>
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
