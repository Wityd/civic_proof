import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Money } from '../components/Money'
import { MoneyTimeline } from '../components/MoneyTimeline'
import { StatusBadge } from '../components/StatusBadge'
import { SimulatedBadge, TxHash } from '../components/TxHash'
import { useViewAs } from '../context/ViewAsContext'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/dates'
import { movesMoney, releaseTx, TX_LABEL } from '../lib/ledger'
import { formatMoney } from '../lib/money'
import { useProject } from '../lib/queries'
import { publicTimeline } from '../lib/timeline'
import type { LedgerMode, Milestone, PublicInvoice, Transaction, Wallet } from '../types'

export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const { user } = useViewAs()

  const detail = useProject(id)
  const wallet = useQuery({
    queryKey: ['wallet', id],
    queryFn: () => api.get<Wallet>(`/projects/${id}/wallet`),
  })

  if (detail.isPending) return <PageSkeleton />

  if (detail.error) {
    // The real API answers VALIDATION for an id that isn't a UUID.
    const notFound = detail.error instanceof ApiError && ['NOT_FOUND', 'VALIDATION'].includes(detail.error.code)
    return (
      <Card>
        <BackLink />
        <p className="mt-4 font-semibold text-red-700">{notFound ? 'Project not found' : 'Could not load this project'}</p>
        <p className="mt-1 text-sm text-slate-500">{detail.error.message}</p>
      </Card>
    )
  }

  const project = detail.data
  const { invoices, transactions } = project
  const milestones = project.milestones
  const notPaidCents = invoices
    .filter((i) => i.status === 'on_hold' || i.status === 'rejected')
    .reduce((sum, i) => sum + i.total_cents, 0)

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Title */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{project.code}</span>
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
            {wallet.data && <ModeBadge mode={wallet.data.mode} />}
          </div>
          {wallet.data ? (
            <>
              <Money cents={wallet.data.balance_cents} className="mt-1 block text-4xl text-slate-900" />
              <p className="mt-2 text-sm text-slate-500">
                Available to commit:{' '}
                <span className="font-semibold text-slate-700">{formatMoney(wallet.data.available_cents)}</span>
              </p>
              <p className="text-xs text-slate-400">Balance minus approved invoices not yet paid.</p>
              {wallet.data.wallet_address && (
                <p className="mt-2 font-mono text-xs break-all text-slate-400">{wallet.data.wallet_address}</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-slate-400">{wallet.error ? wallet.error.message : 'Loading…'}</p>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Figure label="Allocated" cents={project.budget_cents} />
          <Figure label="Paid out" cents={project.paid_cents} tone="text-brand-700" />
          <Figure label="Held or rejected" cents={notPaidCents} tone="text-amber-700" note="Never left the wallet" />
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
                  <th className="px-6 py-3 font-semibold">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <InvoiceRow key={inv.id} inv={inv} transactions={transactions} />
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
          {!milestones ? (
            <p className="mt-2 text-sm text-slate-500">Milestones are not available yet.</p>
          ) : milestones.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No milestones.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {milestones.map((m) => (
                <li key={m.id} className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-400">{m.code}</span>
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
            Newest first. Only funding and payments move money. Other events are recorded for proof.
          </p>
          {transactions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No ledger events yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {transactions.map((tx) => (
                <LedgerRow key={tx.id} tx={tx} invoices={invoices} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function ModeBadge({ mode }: { mode: LedgerMode }) {
  if (mode === 'simulated') return <SimulatedBadge />
  return (
    <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
      {mode === 'fuji' ? 'Avalanche Fuji' : 'BNB testnet'}
    </span>
  )
}

function InvoiceRow({ inv, transactions }: { inv: PublicInvoice; transactions: Transaction[] }) {
  const [open, setOpen] = useState(false)
  const payment = releaseTx(transactions, inv.id)
  return (
    <>
    <tr className="align-top">
      <td className="px-6 py-4">
        <p className="font-semibold text-slate-900">{inv.invoice_number}</p>
        <p className="text-xs text-slate-500">{formatDate(inv.invoice_date)}</p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 text-xs font-semibold text-brand-700 hover:underline"
        >
          {open ? 'Hide the money trail ▴' : 'Follow the money ▾'}
        </button>
      </td>
      <td className="px-6 py-4 text-slate-700">{inv.supplier_name}</td>
      <td className="px-6 py-4 text-right font-semibold whitespace-nowrap text-slate-900 tabular-nums">
        {formatMoney(inv.total_cents)}
      </td>
      <td className="px-6 py-4">
        <StatusBadge status={inv.status} />
      </td>
      <td className="px-6 py-4">
        <TxHash hash={payment?.tx_hash ?? null} mode={payment?.mode ?? null} />
      </td>
    </tr>
    {open && (
      <tr className="bg-slate-50/70">
        <td colSpan={5} className="px-6 pt-2 pb-5">
          <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Follow the money · {inv.invoice_number}
          </p>
          <MoneyTimeline steps={publicTimeline(inv, transactions)} />
        </td>
      </tr>
    )}
    </>
  )
}

function LedgerRow({ tx, invoices }: { tx: Transaction; invoices: PublicInvoice[] }) {
  const inv = tx.invoice_id ? invoices.find((i) => i.id === tx.invoice_id) : undefined
  const money = movesMoney(tx)
  const isOut = tx.operation === 'release'

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-4">
      <div className="flex min-w-0 gap-3">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            money ? 'bg-brand-600' : 'border-2 border-slate-300 bg-white'
          }`}
        />
        <div className="min-w-0">
          <p className="font-medium text-slate-800">
            {TX_LABEL[tx.operation] ?? tx.operation}
            {inv && <span className="text-slate-500"> · {inv.invoice_number}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {formatDateTime(tx.created_at)}
            {tx.status !== 'confirmed' && (
              <span className={`ml-2 font-semibold ${tx.status === 'failed' ? 'text-red-600' : 'text-sky-700'}`}>
                {tx.status === 'failed' ? 'Failed' : 'Pending'}
              </span>
            )}
          </p>
          <div className="mt-1">
            <TxHash hash={tx.tx_hash} mode={tx.mode} />
          </div>
        </div>
      </div>
      <div className="text-right">
        {money ? (
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
    <Link to="/projects" className="text-sm font-medium text-slate-500 hover:text-brand-700">
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
