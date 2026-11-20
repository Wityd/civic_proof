import { splitMoney } from '../lib/money'

// Big bold rands with smaller cents, e.g. R2,000,000.00
export function Money({ cents, className = '' }: { cents: number; className?: string }) {
  const m = splitMoney(cents)
  return (
    <span className={`font-bold tabular-nums ${className}`}>
      {m.rands}
      <span className="text-[0.6em] font-semibold opacity-70">{m.cents}</span>
    </span>
  )
}
