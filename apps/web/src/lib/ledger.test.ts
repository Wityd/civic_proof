import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types'
import { flagLabel, flagSeverity } from './flags'
import { explorerUrl, latestReview, movesMoney, releaseTx } from './ledger'

const tx = (over: Partial<Transaction>): Transaction => ({
  id: crypto.randomUUID(), invoice_id: null, operation: 'release', amount_cents: 0, mode: 'fuji',
  status: 'confirmed', tx_hash: null, block_number: null, created_at: '2026-11-20T10:00:00Z', ...over,
})

describe('flags', () => {
  it('every flag that holds an invoice shows as high or medium, never info', () => {
    for (const code of ['PURPOSE_MISMATCH', 'PRICE_ABOVE_BENCHMARK', 'DUPLICATE_INVOICE', 'ARITHMETIC_MISMATCH', 'BUDGET_EXCEEDED', 'DUPLICATE_EVIDENCE', 'DOCUMENT_MISMATCH'] as const) {
      expect(flagSeverity(code)).toBe('high')
    }
    for (const code of ['SUPPLIER_REVIEW_REQUIRED', 'AI_CATEGORY_CONCERN', 'SUPPLIER_LINKED'] as const) {
      expect(flagSeverity(code)).toBe('medium')
    }
    expect(flagSeverity('NO_BENCHMARK')).toBe('info')
    expect(flagSeverity('DOCUMENT_NOT_READ')).toBe('info')
  })

  it('labels codes in plain words', () => {
    expect(flagLabel('PRICE_ABOVE_BENCHMARK')).toBe('Price above benchmark')
  })
})

describe('ledger', () => {
  it('only funding and payments move money', () => {
    expect(movesMoney(tx({ operation: 'fund_project' }))).toBe(true)
    expect(movesMoney(tx({ operation: 'release' }))).toBe(true)
    for (const operation of ['create_project', 'submit_request', 'approve', 'reject', 'register_milestone', 'verify_milestone'] as const) {
      expect(movesMoney(tx({ operation }))).toBe(false)
    }
  })

  it('finds the payment for an invoice, ignoring failed attempts and other invoices', () => {
    const failed = tx({ invoice_id: 'inv-1', status: 'failed' })
    const paid = tx({ invoice_id: 'inv-1', status: 'confirmed' })
    const other = tx({ invoice_id: 'inv-2' })
    expect(releaseTx([failed, other, paid], 'inv-1')).toBe(paid)
    expect(releaseTx([failed, other], 'inv-1')).toBeUndefined()
  })

  it('links real chain transactions to the right explorer; simulated hashes are never links', () => {
    expect(explorerUrl('fuji', '0xaeaa')).toBe('https://testnet.snowtrace.io/tx/0xaeaa')
    expect(explorerUrl('bsc', '0xaeaa')).toBe('https://testnet.bscscan.com/tx/0xaeaa')
    expect(explorerUrl('simulated', 'sim_123')).toBeNull()
    expect(explorerUrl('fuji', 'sim_123')).toBeNull()
    expect(explorerUrl(null, '0xaeaa')).toBeNull()
  })

  it('uses the newest AI review', () => {
    const r = (created_at: string) => ({ created_at }) as never
    expect(latestReview({ ai_reviews: [r('2026-11-20T10:00:00Z'), r('2026-11-21T09:00:00Z'), r('2026-11-19T08:00:00Z')] })).toEqual({ created_at: '2026-11-21T09:00:00Z' })
    expect(latestReview({ ai_reviews: [] })).toBeUndefined()
  })
})
