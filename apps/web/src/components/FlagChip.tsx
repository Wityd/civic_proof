import { flagLabel, flagSeverity } from '../lib/flags'
import type { FlagCode } from '../types'

const CLS = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-800',
  info: 'bg-slate-100 text-slate-600',
}

export function FlagChip({ code }: { code: FlagCode }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${CLS[flagSeverity(code)]}`}
    >
      {flagLabel(code)}
    </span>
  )
}
