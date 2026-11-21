import type { FlagCode } from '../types'

const HIGH: FlagCode[] = [
  'PURPOSE_MISMATCH',
  'PRICE_ABOVE_BENCHMARK',
  'DUPLICATE_INVOICE',
  'ARITHMETIC_MISMATCH',
  'BUDGET_EXCEEDED',
  'DUPLICATE_EVIDENCE',
  'DOCUMENT_MISMATCH',
]

export function flagSeverity(code: FlagCode): 'high' | 'medium' | 'info' {
  if (HIGH.includes(code)) return 'high'
  if (code === 'SUPPLIER_REVIEW_REQUIRED' || code === 'AI_CATEGORY_CONCERN' || code === 'SUPPLIER_LINKED') return 'medium'
  return 'info'
}

// PRICE_ABOVE_BENCHMARK → "Price above benchmark"
export const flagLabel = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ')
