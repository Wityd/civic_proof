// "Follow the money": the steps one invoice goes through, built from data pages already have.
import type { DemoUser, InvoiceDetail, InvoiceStatus, Milestone, Recommendation, Transaction } from '../types'
import { approverName, latestReview, releaseTx } from './ledger'

// done = happened · current = happening / waiting on someone · stopped = blocked or refused
// skipped = will not happen (e.g. no payment after a rejection) · todo = later step
export type StepState = 'done' | 'current' | 'stopped' | 'skipped' | 'todo'

export interface TimelineStep {
  key: string
  title: string
  detail?: string
  at?: string
  tx?: Transaction
  state: StepState
}

const REC: Record<Recommendation, string> = {
  APPROVE: 'approve',
  HOLD_FOR_REVIEW: 'hold for review',
  REJECT: 'reject',
}

const findTx = (txs: Transaction[], invoiceId: string, op: Transaction['operation']) =>
  txs.find((t) => t.invoice_id === invoiceId && t.operation === op)

function paymentStep(status: InvoiceStatus, pay: Transaction | undefined, waitingFor?: string): TimelineStep {
  const base = { key: 'paid', title: 'Paid' }
  if (pay && pay.status === 'confirmed') return { ...base, state: 'done', tx: pay, at: pay.created_at, detail: 'Money left the project wallet.' }
  if (status === 'payment_pending' || pay?.status === 'pending') return { ...base, state: 'current', tx: pay, detail: 'Payment is confirming on the ledger.' }
  if (status === 'payment_failed') return { ...base, state: 'stopped', detail: 'The payment failed and can be retried.' }
  if (status === 'rejected') return { ...base, title: 'Not paid', state: 'skipped', detail: 'The money stayed in the project wallet.' }
  if (status === 'on_hold') return { ...base, state: 'todo', detail: 'Nothing is paid while the invoice is on hold.' }
  if (status === 'approved') return { ...base, state: 'todo', detail: waitingFor ?? 'Approved, but the payment has not been released yet.' }
  return { ...base, state: 'todo', detail: waitingFor }
}

// Public version: only what the public dashboard shows (status + on-chain events).
export function publicTimeline(inv: { id: string; status: InvoiceStatus }, txs: Transaction[]): TimelineStep[] {
  const submit = findTx(txs, inv.id, 'submit_request')
  const approve = findTx(txs, inv.id, 'approve')
  const reject = findTx(txs, inv.id, 'reject')

  let decision: TimelineStep
  if (approve || ['approved', 'payment_pending', 'payment_failed', 'paid'].includes(inv.status)) {
    decision = { key: 'decision', title: 'Approved', state: 'done', tx: approve, at: approve?.created_at, detail: 'An official approved it.' }
  } else if (reject || inv.status === 'rejected') {
    decision = { key: 'decision', title: 'Rejected', state: 'stopped', tx: reject, at: reject?.created_at, detail: 'An official turned it down.' }
  } else if (inv.status === 'on_hold') {
    decision = { key: 'decision', title: 'On hold', state: 'current', detail: 'An official asked for more checks. Holds are not recorded on chain.' }
  } else {
    decision = { key: 'decision', title: 'Being checked', state: 'current', detail: 'The AI and an official are reviewing it.' }
  }

  return [
    { key: 'submitted', title: 'Submitted', state: 'done', tx: submit, at: submit?.created_at, detail: 'The invoice fingerprint was recorded.' },
    decision,
    paymentStep(inv.status, releaseTx(txs, inv.id) ?? findTx(txs, inv.id, 'release')),
  ]
}

// Full version for signed-in staff/suppliers: adds the AI check, who decided, and delivery.
export function fullTimeline(inv: InvoiceDetail, milestone: Milestone | undefined, users: DemoUser[]): TimelineStep[] {
  const txs = inv.transactions
  const submit = findTx(txs, inv.id, 'submit_request')
  const review = latestReview(inv)
  const last = [...inv.approvals].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1)
  const steps: TimelineStep[] = [
    { key: 'submitted', title: 'Submitted', state: 'done', tx: submit, at: submit?.created_at ?? inv.created_at, detail: 'The invoice fingerprint was recorded.' },
  ]

  steps.push(
    review
      ? {
          key: 'ai',
          title: 'AI checked',
          state: 'done',
          at: review.created_at,
          detail: `AI suggests: ${REC[review.recommendation]}${review.flags.length ? ` · ${review.flags.length} flag${review.flags.length > 1 ? 's' : ''}` : ' · no flags'}`,
        }
      : { key: 'ai', title: 'AI check', state: 'current', detail: 'Waiting for the AI check.' },
  )

  if (!last) {
    steps.push({ key: 'decision', title: 'Decision', state: review ? 'current' : 'todo', detail: review ? 'Waiting for an official to decide.' : undefined })
  } else {
    const who = approverName(last, users)
    const reason = last.reason ? ` “${last.reason}”` : ''
    if (last.decision === 'approve') {
      steps.push({ key: 'decision', title: last.overrode_ai ? 'Approved (AI overridden)' : 'Approved', state: 'done', at: last.created_at, tx: findTx(txs, inv.id, 'approve'), detail: `By ${who}.${reason}` })
    } else if (last.decision === 'hold') {
      steps.push({ key: 'decision', title: 'On hold', state: 'current', at: last.created_at, detail: `By ${who}.${reason}` })
    } else {
      steps.push({ key: 'decision', title: 'Rejected', state: 'stopped', at: last.created_at, tx: findTx(txs, inv.id, 'reject'), detail: `By ${who}.${reason}` })
    }
  }

  let waitingFor: string | undefined
  if (inv.milestone_id) {
    const code = milestone?.code ?? 'the milestone'
    if (milestone?.status === 'verified') {
      steps.push({ key: 'delivery', title: `${code} verified`, state: 'done', at: milestone.verified_at ?? undefined, detail: 'The delivery was officially confirmed.' })
    } else if (inv.status === 'rejected') {
      steps.push({ key: 'delivery', title: 'Delivery check', state: 'skipped', detail: 'Not needed: the invoice was rejected.' })
    } else {
      const ready = inv.status === 'approved' || inv.status === 'payment_failed'
      steps.push({ key: 'delivery', title: 'Delivery check', state: ready ? 'current' : 'todo', detail: `Payment waits until ${code} is verified.` })
      waitingFor = `Waiting for ${code} to be verified.`
    }
  }

  steps.push(paymentStep(inv.status, releaseTx(txs, inv.id) ?? findTx(txs, inv.id, 'release'), waitingFor))
  return steps
}
