import type { LedgerMode } from '../types'

function shorten(hash: string) {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash
}

export function SimulatedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-violet-800">
      Simulated ledger
    </span>
  )
}

// Only link to Snowtrace for real Fuji transactions. Simulated hashes are plain text.
export function TxHash({ hash, mode }: { hash: string | null; mode: LedgerMode | null }) {
  if (!hash) return <span className="text-slate-400">—</span>

  if (mode === 'fuji' && !hash.startsWith('sim_')) {
    return (
      <a
        href={`https://testnet.snowtrace.io/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        title={hash}
        className="font-mono text-xs text-brand-700 underline decoration-brand-600/30 underline-offset-2 hover:decoration-brand-600"
      >
        {shorten(hash)} ↗
      </a>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span title={hash} className="font-mono text-xs text-slate-600">
        {shorten(hash)}
      </span>
      <SimulatedBadge />
    </span>
  )
}
