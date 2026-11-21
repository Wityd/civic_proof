import { flagLabel, flagSeverity } from '../lib/flags'
import type { FlagCode } from '../types'

// Severity chip with a small flag icon (ref: "Medium 5/10" chips).
const CLS = {
  high: 'bg-red-50 text-red-700 ring-1 ring-red-100',
  medium: 'bg-amber-50 text-amber-800 ring-1 ring-amber-100',
  info: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200',
}

export function FlagChip({ code }: { code: FlagCode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${CLS[flagSeverity(code)]}`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
      </svg>
      {flagLabel(code)}
    </span>
  )
}
