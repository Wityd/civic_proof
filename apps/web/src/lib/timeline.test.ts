import { describe, expect, it } from 'vitest'
import type { InvoiceStatus, Transaction } from '../types'
import { publicTimeline } from './timeline'

const tx = (operation: Transaction['operation'], status: Transaction['status'] = 'confirmed'): Transaction => ({
  id: crypto.randomUUID(), invoice_id: 'inv', operation, amount_cents: 0, mode: 'fuji', status,
  tx_hash: '0xabc', block_number: 1, created_at: '2026-11-20T10:00:00Z',
})
const steps = (status: InvoiceStatus, txs: Transaction[] = []) =>
  publicTimeline({ id: 'inv', status }, txs).map((s) => `${s.title}:${s.state}`)

describe('public "follow the money" timeline', () => {
  it('paid: submitted → approved → paid, with the on-chain payment attached', () => {
    const pay = tx('release')
    const t = publicTimeline({ id: 'inv', status: 'paid' }, [tx('submit_request'), tx('approve'), pay])
    expect(t.map((s) => `${s.title}:${s.state}`)).toEqual(['Submitted:done', 'Approved:done', 'Paid:done'])
    expect(t[2].tx).toBe(pay)
  })

  it('rejected: the money stays in the wallet and is never shown as paid', () => {
    expect(steps('rejected', [tx('submit_request'), tx('reject')])).toEqual(['Submitted:done', 'Rejected:stopped', 'Not paid:skipped'])
  })

  it('on hold: nothing is paid while checks continue', () => {
    expect(steps('on_hold')).toEqual(['Submitted:done', 'On hold:current', 'Paid:todo'])
  })

  it('a payment still confirming is "current", never "done" (no success before confirmation)', () => {
    expect(steps('payment_pending', [tx('approve'), tx('release', 'pending')])).toEqual(['Submitted:done', 'Approved:done', 'Paid:current'])
  })

  it('a failed payment is shown as stopped and retryable', () => {
    expect(steps('payment_failed', [tx('approve'), tx('release', 'failed')])).toEqual(['Submitted:done', 'Approved:done', 'Paid:stopped'])
  })

  it('a just-submitted invoice is being checked', () => {
    expect(steps('submitted', [tx('submit_request')])).toEqual(['Submitted:done', 'Being checked:current', 'Paid:todo'])
  })
})
