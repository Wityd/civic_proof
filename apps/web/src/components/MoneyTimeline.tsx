import { formatDateTime } from '../lib/dates'
import type { StepState, TimelineStep } from '../lib/timeline'
import { TxHash } from './TxHash'

const DOT: Record<StepState, string> = {
  done: 'bg-brand-600 ring-brand-100',
  current: 'bg-amber-500 ring-amber-100',
  stopped: 'bg-red-600 ring-red-100',
  skipped: 'bg-slate-300 ring-slate-100',
  todo: 'bg-white ring-slate-200 border-2 border-slate-300',
}
const TITLE: Record<StepState, string> = {
  done: 'text-slate-900',
  current: 'text-amber-800',
  stopped: 'text-red-700',
  skipped: 'text-slate-500',
  todo: 'text-slate-400',
}
const LABEL: Record<StepState, string> = {
  done: 'Done',
  current: 'In progress',
  stopped: 'Stopped',
  skipped: 'Not needed',
  todo: 'Not yet',
}

// Vertical "follow the money" timeline for one invoice.
export function MoneyTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && (
            <span aria-hidden="true" className="absolute top-4 left-[7px] h-full w-px bg-slate-200" />
          )}
          <span className={`relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full ring-4 ${DOT[s.state]}`}>
            <span className="sr-only">{LABEL[s.state]}</span>
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${TITLE[s.state]}`}>{s.title}</p>
            {s.detail && <p className="text-sm text-slate-600">{s.detail}</p>}
            {s.at && <p className="text-xs text-slate-400">{formatDateTime(s.at)}</p>}
            {s.tx?.tx_hash && (
              <div className="mt-1">
                <TxHash hash={s.tx.tx_hash} mode={s.tx.mode} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
