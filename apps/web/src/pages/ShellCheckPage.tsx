// TEMPORARY home page to prove the shell works (API client → mocks → badge + money).
// Page 1 (project cards) replaces this.
import { useQuery } from '@tanstack/react-query'
import { Money } from '../components/Money'
import { StatusBadge } from '../components/StatusBadge'
import { useViewAs } from '../context/ViewAsContext'
import { api } from '../lib/api'
import { formatMoney } from '../lib/money'
import type { InvoiceSummary, Wallet } from '../types'

export function ShellCheckPage() {
  const { user } = useViewAs()
  const wallet = useQuery({
    queryKey: ['wallet', 'CP001'],
    queryFn: () => api.get<Wallet>('/projects/CP001/wallet'),
  })
  const invoices = useQuery({
    queryKey: ['invoices', 'CP001'],
    queryFn: () => api.get<InvoiceSummary[]>('/invoices?project_id=CP001'),
  })

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Viewing as: <b>{user ? `${user.name} (${user.role})` : 'Public'}</b>
      </p>

      <section className="rounded-card bg-white p-6 shadow-card">
        <p className="text-sm text-slate-500">CP001 wallet balance</p>
        {wallet.data ? (
          <>
            <Money cents={wallet.data.balance_cents} className="text-4xl text-slate-900" />
            <p className="mt-1 text-sm text-slate-500">
              Available: {formatMoney(wallet.data.available_cents)} · {wallet.data.mode}
            </p>
          </>
        ) : (
          <p className="text-slate-400">{wallet.error ? wallet.error.message : 'Loading…'}</p>
        )}
      </section>

      <section className="rounded-card bg-white p-6 shadow-card">
        <h2 className="mb-4 font-semibold">Invoices</h2>
        {invoices.isPending && <p className="text-slate-400">Loading…</p>}
        {invoices.error && <p className="text-red-600">{invoices.error.message}</p>}
        <ul className="divide-y divide-slate-100">
          {invoices.data?.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span>
                <span className="font-medium">{inv.invoice_number}</span>
                <span className="ml-2 text-sm text-slate-500">{inv.supplier_name}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-semibold tabular-nums">{formatMoney(inv.total_cents)}</span>
                <StatusBadge status={inv.status} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
