import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Money } from '../components/Money'
import { StatusBadge } from '../components/StatusBadge'
import { SimulatedBadge, TxHash } from '../components/TxHash'
import { useViewAs } from '../context/ViewAsContext'
import { api } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { InvoiceSummary, Milestone, ProjectDetail, Transaction, Wallet } from '../types'

export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const { user } = useViewAs()

  const detail = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
  })
  const wallet = useQuery({
    queryKey: ['wallet', id],
    queryFn: () => api.get<Wallet>(`/projects/${id}/wallet`),
  })
  const ledger = useQuery({
    queryKey: ['transactions', id],
    queryFn: () => api.get<Transaction[]>(`/projects/${id}/transactions`),
  })

  if (detail.isPending) return <PageSkeleton />

  if (detail.error) {
    return (
      <Card>
        <BackLink />
        <p className="mt-4 font-semibold text-red-700">
          {detail.error.message.includes('not found') ? 'Project not found' : 'Could not load this project'}
        </p>
        <p className="mt-1 text-sm text-slate-500">{detail.error.message}</p>
      </Card>
    )
  }

  const { project, milestones, invoices } = detail.data
  const notPaidCents = invoices
    .filter((i) => i.status === 'on_hold' || i.status === 'rejected')
    .reduce((sum, i) => sum + i.total_cents, 0)

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Title */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{project.id}</span>
          <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            Fictional
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">{project.name}</h1>
        <p className="mt-1 text-slate-500">
          {project.location} · {project.description}
        </p>
      </div>

      {/* Money figures */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-slate-500">Wallet balance</p>
            {wallet.data?.mode === 'simulated' && <SimulatedBadge />}
            {wallet.data?.mode === 'fuji' && (
              <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                Avalanche Fuji
              </span>
            )}
          </div>
          {wallet.data ? (
            <>
              <Money cents={wallet.data.balance_cents} className="mt-1 block text-4xl text-slate-900" />
              <p className="mt-2 text-sm text-slate-500">
                Available to commit:{' '}
                <span className="font-semibold text-slate-700">{formatMoney(wallet.data.available_cents)}</span>
              </p>
              <p className="text-xs text-slate-400">Balance minus approved invoices not yet paid.</p>
            </>
          ) : (
            <p className="mt-2 text-slate-400">{wallet.error ? wallet.error.message : 'Loading…'}</p>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Figure label="Allocated" cents={project.budget_cents} />
          <Figure label="Paid out" cents={project.paid_cents} tone="text-brand-700" />
          <Figure
            label="Held or rejected"
            cents={notPaidCents}
            tone="text-amber-700"
            note="Never left the wallet"
          />
          <Figure
            label="Spent"
            text={`${project.budget_cents ? ((project.paid_cents / project.budget_cents) * 100).toFixed(1) : '0.0'}%`}
            note="Of the allocated budget"
          />
        </div>
      </div>

      {/* Expenditure table */}
      <section className="rounded-card bg-white shadow-card">
        <div className="px-6 pt-6">
          <h2 className="text-lg font-bold">Expenditure</h2>
          <p className="text-sm text-slate-500">Every invoice, including ones that were held or rejected.</p>
        </div>
        {invoices.length === 0 ? (
          <p className="p-6 text-slate-500">No invoices yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-y border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-6 py-3 font-semibold">Invoice</th>
                  <th className="px-6 py-3 font-semibold">Supplier</th>
                  <th className="px-6 py-3 text-right font-semibold">Amount</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <InvoiceRow key={inv.id} inv={inv} milestones={milestones} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Milestones */}
        <Card>
          <h2 className="text-lg font-bold">Milestones</h2>
          {milestones.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No milestones.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {milestones.map((m) => (
                <li key={m.id} className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-400">{m.id}</span>
                    <MilestoneBadge status={m.status} />
                  </div>
                  <p className="mt-1 font-medium text-slate-800">{m.title}</p>
                  {user?.role === 'citizen' && (
                    <Link
                      to={`/delivery/${m.id}/confirm`}
                      className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline"
                    >
                      Did this happen? Tell us →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Ledger */}
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-bold">Ledger</h2>
          <p className="text-sm text-slate-500">
            Newest first. Only payments reduce the balance. Other events are recorded for proof.
          </p>
          {ledger.isPending && <p className="mt-4 text-slate-400">Loading…</p>}
          {ledger.error && <p className="mt-4 text-red-600">{ledger.error.message}</p>}
          {ledger.data && (
            <ul className="mt-4 divide-y divide-slate-100">
              {ledger.data.map((tx) => (
                <LedgerRow key={tx.id} tx={tx} invoices={invoices} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function InvoiceRow({ inv, milestones }: { inv: InvoiceSummary; milestones: Milestone[] }) {
  const milestone = inv.milestone_id ? milestones.find((m) => m.id === inv.milestone_id) : undefined
  const waitingOnMilestone = inv.status === 'approved' && milestone && milestone.status !== 'verified'

  return (
    <tr className="align-top">
      <td className="px-6 py-4">
        <p className="font-semibold text-slate-900">{inv.invoice_number}</p>
        <p className="text-xs text-slate-500">{formatDate(inv.invoice_date)}</p>
      </td>
      <td className="px-6 py-4 text-slate-700">{inv.supplier_name}</td>
      <td className="px-6 py-4 text-right font-semibold whitespace-nowrap text-slate-900 tabular-nums">
        {formatMoney(inv.total_cents)}
      </td>
      <td className="px-6 py-4">
        <StatusBadge status={inv.status} />
        {waitingOnMilestone && (
          <p className="mt-1 text-xs text-slate-500">Payment waits for {milestone.id} to be verified</p>
        )}
      </td>
      <td className="px-6 py-4">
        <TxHash hash={inv.tx_hash} mode={inv.tx_mode} />
      </td>
    </tr>
  )
}

const KIND_LABEL: Record<Transaction['kind'], string> = {
  allocation: 'Budget allocated to wallet',
  payment: 'Payment released',
  invoice_submitted: 'Invoice submitted (document hash anchored)',
  invoice_rejected: 'Invoice rejected',
}

function LedgerRow({ tx, invoices }: { tx: Transaction; invoices: InvoiceSummary[] }) {
  const inv = tx.invoice_id ? invoices.find((i) => i.id === tx.invoice_id) : undefined
  const isOut = tx.kind === 'payment'

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-4">
      <div className="flex min-w-0 gap-3">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            tx.moves_money ? 'bg-brand-600' : 'border-2 border-slate-300 bg-white'
          }`}
        />
        <div className="min-w-0">
          <p className="font-medium text-slate-800">
            {KIND_LABEL[tx.kind] ?? tx.kind}
            {inv && <span className="text-slate-500"> · {inv.invoice_number}</span>}
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(tx.created_at)}</p>
          <div className="mt-1">
            <TxHash hash={tx.tx_hash} mode={tx.mode} />
          </div>
        </div>
      </div>
      <div className="text-right">
        {tx.moves_money && tx.amount_cents !== null ? (
          <span className={`font-bold tabular-nums ${isOut ? 'text-slate-900' : 'text-brand-700'}`}>
            {isOut ? '−' : '+'}
            {formatMoney(tx.amount_cents)}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            Recorded
          </span>
        )}
      </div>
    </li>
  )
}

function MilestoneBadge({ status }: { status: Milestone['status'] }) {
  const s = {
    pending: { label: 'Not verified yet', cls: 'bg-slate-100 text-slate-600' },
    evidence_submitted: { label: 'Evidence submitted', cls: 'bg-sky-100 text-sky-800' },
    verified: { label: 'Verified', cls: 'bg-brand-50 text-brand-700' },
  }[status]
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>
}

function Figure({
  label,
  cents,
  text,
  tone = 'text-slate-900',
  note,
}: {
  label: string
  cents?: number
  text?: string
  tone?: string
  note?: string
}) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      {cents !== undefined ? (
        <Money cents={cents} className={`mt-1 block text-xl sm:text-2xl ${tone}`} />
      ) : (
        <p className={`mt-1 text-xl font-bold sm:text-2xl ${tone}`}>{text}</p>
      )}
      {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
    </Card>
  )
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-card bg-white p-5 shadow-card sm:p-6 ${className}`}>{children}</section>
}

function BackLink() {
  return (
    <Link to="/" className="text-sm font-medium text-slate-500 hover:text-brand-700">
      ← All projects
    </Link>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-32 animate-pulse rounded-full bg-slate-200" />
      <div className="h-10 w-2/3 animate-pulse rounded-full bg-slate-200" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-40 animate-pulse rounded-card bg-white shadow-card" />
        <div className="h-40 animate-pulse rounded-card bg-white shadow-card lg:col-span-2" />
      </div>
      <div className="h-72 animate-pulse rounded-card bg-white shadow-card" />
    </div>
  )
}
