import { useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { FlagChip } from '../components/FlagChip'
import { RequireRole } from '../components/RequireRole'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { Approval, InvoiceDetail, InvoiceSummary, Recommendation } from '../types'

export function AuditPage() {
  return (
    <RequireRole role="auditor">
      <AuditLog />
    </RequireRole>
  )
}

interface AuditRow {
  approval: Approval
  invoice: InvoiceDetail
}

const DECISION = {
  approve: { label: 'Approved', cls: 'bg-brand-50 text-brand-700' },
  hold: { label: 'On hold', cls: 'bg-amber-100 text-amber-800' },
  reject: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
}
const REC: Record<Recommendation, string> = {
  APPROVE: 'Approve',
  HOLD_FOR_REVIEW: 'Hold for review',
  REJECT: 'Reject',
}

function AuditLog() {
  const [overridesOnly, setOverridesOnly] = useState(false)

  // No audit endpoint yet: load every invoice, then each one's details (which hold the decisions).
  // TODO(P2): swap for a single GET /audit if the API adds one.
  const list = useQuery({
    queryKey: ['invoices', 'all'],
    queryFn: () => api.get<InvoiceSummary[]>('/invoices'),
  })
  const details = useQueries({
    queries: (list.data ?? []).map((inv) => ({
      queryKey: ['invoice', inv.id],
      queryFn: () => api.get<InvoiceDetail>(`/invoices/${inv.id}`),
    })),
  })

  const loading = list.isPending || details.some((d) => d.isPending)
  const error = list.error ?? details.find((d) => d.error)?.error

  const rows: AuditRow[] = details
    .flatMap((d) => (d.data ? d.data.approvals.map((approval) => ({ approval, invoice: d.data! })) : []))
    .sort((a, b) => b.approval.created_at.localeCompare(a.approval.created_at))
  const shown = overridesOnly ? rows.filter((r) => r.approval.overrode_ai) : rows

  const count = (d: Approval['decision']) => rows.filter((r) => r.approval.decision === d).length
  const overrides = rows.filter((r) => r.approval.overrode_ai).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Audit log</h1>
        <p className="mt-1 text-slate-500">
          Every decision on every invoice, newest first. Read-only. AI recommends; authorised humans decide.
        </p>
      </div>

      {!loading && !error && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Approved" value={count('approve')} />
          <Stat label="Held" value={count('hold')} tone="text-amber-700" />
          <Stat label="Rejected" value={count('reject')} tone="text-red-700" />
          <Stat label="AI overridden" value={overrides} tone={overrides ? 'text-amber-700' : 'text-slate-900'} />
        </div>
      )}

      <section className="rounded-card bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <p className="text-sm text-slate-500">
            {loading ? 'Loading…' : `${shown.length} decision${shown.length === 1 ? '' : 's'}`}
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={overridesOnly}
              onChange={(e) => setOverridesOnly(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            Only show AI overrides
          </label>
        </div>

        {loading && (
          <div className="space-y-3 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        )}

        {error && (
          <div className="p-6">
            <p className="font-semibold text-red-700">Could not load the audit log</p>
            <p className="mt-1 text-sm text-slate-500">{error.message}</p>
          </div>
        )}

        {!loading && !error && shown.length === 0 && (
          <p className="p-10 text-center text-sm text-slate-500">
            {overridesOnly ? 'No decisions went against the AI.' : 'No decisions yet.'}
          </p>
        )}

        {!loading && !error && shown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-6 py-3 font-semibold">When</th>
                  <th className="px-6 py-3 font-semibold">Invoice</th>
                  <th className="px-6 py-3 text-right font-semibold">Amount</th>
                  <th className="px-6 py-3 font-semibold">AI said</th>
                  <th className="px-6 py-3 font-semibold">Decision</th>
                  <th className="px-6 py-3 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(({ approval: a, invoice: inv }) => (
                  <tr key={a.id} className={`align-top ${a.overrode_ai ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-600">{formatDateTime(a.created_at)}</td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{inv.invoice_number}</p>
                      <p className="text-xs text-slate-500">
                        {inv.supplier_name} · {inv.project_id}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-right font-semibold whitespace-nowrap tabular-nums">
                      {formatMoney(inv.total_cents)}
                    </td>
                    <td className="px-6 py-4">
                      {inv.ai_review ? (
                        <>
                          <p className="font-medium text-slate-800">{REC[inv.ai_review.recommendation]}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {inv.ai_review.flags.map((f) => (
                              <FlagChip key={f} code={f} />
                            ))}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${DECISION[a.decision].cls}`}
                      >
                        {DECISION[a.decision].label}
                      </span>
                      <p className="mt-1 text-xs text-slate-500">by {a.decided_by_name}</p>
                      {a.overrode_ai && (
                        <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          AI overridden
                        </span>
                      )}
                    </td>
                    <td className="max-w-xs px-6 py-4 text-slate-600">
                      {a.reason ?? <span className="text-slate-400">No reason given</span>}
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

function Stat({ label, value, tone = 'text-slate-900' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-card bg-white p-5 shadow-card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}
