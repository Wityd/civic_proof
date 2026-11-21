import { splitMoney } from '../lib/money'

// Big bold rands with smaller cents, e.g. R2,000,000.00 (heading font for crisp figures).
export function Money({ cents, className = '' }: { cents: number; className?: string }) {
  const m = splitMoney(cents)
  return (
    <span className={`font-heading font-bold tracking-tight tabular-nums ${className}`}>
      {m.rands}
      <span className="text-[0.6em] font-semibold opacity-60">{m.cents}</span>
    </span>
  )
}
