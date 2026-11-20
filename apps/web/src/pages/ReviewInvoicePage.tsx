import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AiFindingsCard } from '../components/ai/AiFindingsCard'
import { RequireRole } from '../components/RequireRole'
import { StatusBadge } from '../components/StatusBadge'
import { TxHash } from '../components/TxHash'
import { api, ApiError, USE_MOCKS } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { Approval, InvoiceDetail, Milestone, ProjectDetail, Supplier } from '../types'

export function ReviewInvoicePage() {
  return (
    <RequireRole role="municipality">
      <ReviewInvoice />
    </RequireRole>
  )
}

const POLL_MS = 1500

function ReviewInvoice() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  // Any action changes money/status shown on other pages too, so refetch everything.
  const refreshAll = () => queryClient.invalidateQueries()

  const invoice = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
    // While a payment is going through, keep checking until it is paid or failed.
    refetchInterval: (q) => (q.state.data?.status === 'payment_pending' ? POLL_MS : false),
  })
  const inv = invoice.data

  const supplier = useQuery({
    queryKey: ['supplier', inv?.supplier_id],
    queryFn: () => api.get<Supplier>(`/suppliers/${inv!.supplier_id}`),
    enabled: !!inv,
  })
  const project = useQuery({
    queryKey: ['project', inv?.project_id],
    queryFn: () => api.get<ProjectDetail>(`/projects/${inv!.project_id}`),
    enabled: !!inv,
  })
  const milestone = inv?.milestone_id
    ? project.data?.milestones.find((m) => m.id === inv.milestone_id)
    : undefined

  // When polling sees the payment finish, refresh the other pages' data too.
  const prevStatus = useRef(inv?.status)
  useEffect(() => {
    if (prevStatus.current === 'payment_pending' && inv && inv.status !== 'payment_pending') refreshAll()
    prevStatus.current = inv?.status
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv?.status])

  if (invoice.isPending) return <div className="h-96 animate-pulse rounded-card bg-white shadow-card" />
  if (invoice.error || !inv) {
    return (
      <Card>
        <BackLink />
        <p className="mt-4 font-semibold text-red-700">Could not load this invoice</p>
        <p className="mt-1 text-sm text-slate-500">{invoice.error?.message}</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Invoice {inv.invoice_number}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <p className="mt-1 text-slate-600">
            {inv.supplier_name}
            {supplier.data && (
              <span className="text-slate-400">
                {' '}
                · Reg. {supplier.data.registration_no} · registered {formatDate(supplier.data.registered_on)}
              </span>
            )}
          </p>
          <p className="text-sm text-slate-500">
            <Link to={`/projects/${inv.project_id}`} className="hover:text-brand-700">
              {inv.project_id}
            </Link>{' '}
            · Invoice date {formatDate(inv.invoice_date)}
            {inv.milestone_id && <> · Linked to milestone {inv.milestone_id}</>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-500">Invoice total</p>
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatMoney(inv.total_cents)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        {/* Left: what was invoiced and what the AI found */}
        <div className="min-w-0 space-y-6">
          <LineItems inv={inv} />
          {inv.ai_review ? (
            <AiFindingsCard review={inv.ai_review} />
          ) : (
            <RunAnalysis invoiceId={inv.id} canRun={inv.status === 'submitted'} onDone={refreshAll} />
          )}
        </div>

        {/* Right: what the officer can do now */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          {(inv.status === 'analysed' || inv.status === 'on_hold') && (
            <DecisionPanel inv={inv} onDone={refreshAll} />
          )}
          {['approved', 'payment_pending', 'payment_failed', 'paid'].includes(inv.status) && (
            <PaymentPanel inv={inv} milestone={milestone} onDone={refreshAll} />
          )}
          {inv.status === 'rejected' && (
            <Card>
              <p className="font-semibold text-red-700">Rejected</p>
              <p className="mt-1 text-sm text-slate-500">This invoice will not be paid. The money stays in the wallet.</p>
            </Card>
          )}
          {inv.status === 'submitted' && (
            <Card>
              <p className="font-semibold text-slate-800">Next step: run analysis</p>
              <p className="mt-1 text-sm text-slate-500">
                The AI checks the invoice before you approve, hold or reject it.
              </p>
            </Card>
          )}
          <History inv={inv} />
        </div>
      </div>
    </div>
  )
}

// ---------- line items ----------

function LineItems({ inv }: { inv: InvoiceDetail }) {
  return (
    <section className="rounded-card bg-white shadow-card">
      <h2 className="px-6 pt-6 text-lg font-bold">Line items</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-6 py-3 font-semibold">Item</th>
              <th className="px-6 py-3 text-right font-semibold">Qty</th>
              <th className="px-6 py-3 text-right font-semibold">Unit price</th>
              <th className="px-6 py-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inv.line_items.map((l, i) => (
              <tr key={i}>
                <td className="px-6 py-4">
                  <p className="font-medium text-slate-900">{l.description}</p>
                  <p className="text-xs text-slate-500">
                    {l.category.replace(/_/g, ' ')}
                    {l.reference_sku && <> · {l.reference_sku}</>}
                  </p>
                </td>
                <td className="px-6 py-4 text-right tabular-nums">{l.quantity}</td>
                <td className="px-6 py-4 text-right whitespace-nowrap tabular-nums">{formatMoney(l.unit_price_cents)}</td>
                <td className="px-6 py-4 text-right font-semibold whitespace-nowrap tabular-nums">
                  {formatMoney(l.line_total_cents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200">
              <td colSpan={3} className="px-6 py-4 text-right font-semibold text-slate-600">
                Total
              </td>
              <td className="px-6 py-4 text-right text-lg font-bold whitespace-nowrap tabular-nums">
                {formatMoney(inv.total_cents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

// ---------- run analysis ----------

function RunAnalysis({ invoiceId, canRun, onDone }: { invoiceId: string; canRun: boolean; onDone: () => void }) {
  const analyse = useMutation({
    mutationFn: () => api.post(`/invoices/${invoiceId}/analyse`),
    onSuccess: onDone,
  })
  return (
    <Card>
      <h2 className="text-lg font-bold">AI findings</h2>
      <p className="mt-1 text-sm text-slate-500">
        The AI reads the invoice, compares prices with benchmarks and checks the supplier and the project purpose.
      </p>
      {canRun && (
        <button
          onClick={() => analyse.mutate()}
          disabled={analyse.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
        >
          {analyse.isPending && <Spinner />}
          {analyse.isPending ? 'Analysing…' : 'Run analysis'}
        </button>
      )}
      {analyse.error && <p className="mt-3 text-sm text-red-600">{analyse.error.message}</p>}
      <p className="mt-4 text-xs font-medium text-slate-500">AI recommends; authorised humans decide.</p>
    </Card>
  )
}

// ---------- decision ----------

function DecisionPanel({ inv, onDone }: { inv: InvoiceDetail; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [showReasonError, setShowReasonError] = useState(false)
  const [confirmOverride, setConfirmOverride] = useState(false)

  const reasonRequired = inv.flags.length > 0
  const reasonMissing = reasonRequired && !reason.trim()

  const decide = useMutation({
    mutationFn: (decision: Approval['decision']) =>
      api.post<Approval>(`/invoices/${inv.id}/${decision}`, { reason: reason.trim() || null }),
    onSuccess: () => {
      setReason('')
      setConfirmOverride(false)
      onDone()
    },
  })

  function act(decision: Approval['decision']) {
    if (reasonMissing) {
      setShowReasonError(true)
      return
    }
    // Approving against AI flags needs a second click, because it is recorded as an override.
    if (decision === 'approve' && inv.flags.length > 0 && !confirmOverride) {
      setConfirmOverride(true)
      return
    }
    decide.mutate(decision)
  }

  const busy = decide.isPending
  return (
    <Card>
      <h2 className="text-lg font-bold">Your decision</h2>
      <p className="mt-1 text-xs font-medium text-slate-500">AI recommends; authorised humans decide.</p>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">
          Reason{' '}
          {reasonRequired ? (
            <span className="text-red-600">(required: the AI flagged this invoice)</span>
          ) : (
            <span className="text-slate-400">(optional)</span>
          )}
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Explain your decision. This is shown in the audit log."
          className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-sm focus:ring-2 focus:outline-none ${
            showReasonError && reasonMissing
              ? 'border-red-300 focus:ring-red-200'
              : 'border-slate-200 focus:border-brand-600 focus:ring-brand-600/20'
          }`}
        />
        {showReasonError && reasonMissing && <span className="text-xs text-red-600">Please give a reason.</span>}
      </label>

      {confirmOverride && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You are approving against the AI's flags. This is recorded as an <b>override of the AI</b>. Click
          Approve again to confirm.
        </div>
      )}

      <div className="mt-4 grid gap-2">
        <button
          onClick={() => act('approve')}
          disabled={busy}
          className="rounded-full bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {confirmOverride ? 'Approve (override AI)' : 'Approve'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          {inv.status === 'analysed' && (
            <button
              onClick={() => act('hold')}
              disabled={busy}
              className="rounded-full bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              Hold
            </button>
          )}
          <button
            onClick={() => act('reject')}
            disabled={busy}
            className={`rounded-full bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 ${
              inv.status === 'analysed' ? '' : 'col-span-2'
            }`}
          >
            Reject
          </button>
        </div>
      </div>
      {busy && <p className="mt-3 text-sm text-slate-500">Saving decision…</p>}
      {decide.error && <p className="mt-3 text-sm text-red-600">{decide.error.message}</p>}
    </Card>
  )
}

// ---------- payment ----------

function PaymentPanel({
  inv,
  milestone,
  onDone,
}: {
  inv: InvoiceDetail
  milestone: Milestone | undefined
  onDone: () => void
}) {
  const pay = useMutation({
    mutationFn: () => api.post(`/payments/${inv.id}/execute`),
    onSuccess: onDone,
  })
  const verify = useMutation({
    mutationFn: (milestoneId: string) => api.post(`/milestones/${milestoneId}/verify`),
    onSuccess: onDone,
  })

  const blocked = milestone && milestone.status !== 'verified'
  const blockedError = pay.error instanceof ApiError && pay.error.code === 'MILESTONE_NOT_VERIFIED'

  if (inv.status === 'paid') {
    return (
      <Card>
        <p className="font-semibold text-brand-700">✓ Paid</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(inv.total_cents)}</p>
        <p className="mt-1 text-sm text-slate-500">Released from the project wallet.</p>
        <div className="mt-3">
          <TxHash hash={inv.tx_hash} mode={inv.tx_mode} />
        </div>
      </Card>
    )
  }

  if (inv.status === 'payment_pending') {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <Spinner className="h-5 w-5 text-brand-600" />
          <p className="font-semibold text-slate-800">Releasing payment…</p>
        </div>
        <p className="mt-2 text-sm text-slate-500">Waiting for the ledger to confirm. This page updates by itself.</p>
      </Card>
    )
  }

  // approved or payment_failed
  return (
    <Card>
      <h2 className="text-lg font-bold">Payment</h2>
      {inv.status === 'payment_failed' ? (
        <p className="mt-1 text-sm text-red-600">The last payment attempt failed. You can try again.</p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">Approved. Release the money from the project wallet.</p>
      )}

      {(blocked || blockedError) && milestone && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          Payment is blocked until <b>{milestone.id}</b> (“{milestone.title}”) is verified.
          {USE_MOCKS && (
            <button
              onClick={() => verify.mutate(milestone.id)}
              disabled={verify.isPending}
              className="mt-2 block text-xs font-semibold text-brand-700 underline disabled:opacity-60"
            >
              {verify.isPending ? 'Verifying…' : `Mark ${milestone.id} verified (mock only)`}
            </button>
          )}
        </div>
      )}

      <button
        onClick={() => pay.mutate()}
        disabled={pay.isPending}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pay.isPending && <Spinner />}
        {inv.status === 'payment_failed' ? 'Retry payment' : 'Execute payment'} · {formatMoney(inv.total_cents)}
      </button>
      {pay.error && !blockedError && <p className="mt-3 text-sm text-red-600">{pay.error.message}</p>}
    </Card>
  )
}

// ---------- history ----------

const DECISION_LABEL = { approve: 'Approved', hold: 'Put on hold', reject: 'Rejected' }
const TX_LABEL = {
  allocation: 'Budget allocated',
  invoice_submitted: 'Submitted (document hash recorded)',
  invoice_rejected: 'Rejection recorded',
  payment: 'Payment released',
}

function History({ inv }: { inv: InvoiceDetail }) {
  if (inv.approvals.length === 0 && inv.transactions.length === 0) return null
  return (
    <Card>
      <h2 className="text-lg font-bold">History</h2>
      <ul className="mt-3 space-y-4">
        {inv.approvals.map((a) => (
          <li key={a.id} className="text-sm">
            <p className="font-semibold text-slate-800">
              {DECISION_LABEL[a.decision]} by {a.decided_by_name}
              {a.overrode_ai && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">AI overridden</span>
              )}
            </p>
            <p className="text-xs text-slate-500">{formatDateTime(a.created_at)}</p>
            {a.reason && <p className="mt-1 text-slate-600">“{a.reason}”</p>}
          </li>
        ))}
        {inv.transactions.map((t) => (
          <li key={t.id} className="text-sm">
            <p className="font-semibold text-slate-800">
              {TX_LABEL[t.kind]}
              {t.moves_money && t.amount_cents !== null && <> · {formatMoney(t.amount_cents)}</>}
            </p>
            <p className="text-xs text-slate-500">{formatDateTime(t.created_at)}</p>
            <div className="mt-1">
              <TxHash hash={t.tx_hash} mode={t.mode} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------- small bits ----------

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-card bg-white p-5 shadow-card sm:p-6">{children}</section>
}

function BackLink() {
  return (
    <Link to="/review" className="text-sm font-medium text-slate-500 hover:text-brand-700">
      ← Review queue
    </Link>
  )
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
