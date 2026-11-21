import { USE_MOCKS } from '../lib/api'
import { MOCK_SCENARIO } from '../mocks'

// Developer-only reminder of which API the app is using. Never shown in a production build.
export function DevBadge() {
  if (!import.meta.env.DEV) return null
  return (
    <span
      className={`pointer-events-none fixed bottom-3 left-3 z-50 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${
        USE_MOCKS ? 'bg-amber-400 text-slate-900' : 'bg-emerald-400 text-slate-900'
      }`}
    >
      {USE_MOCKS ? `Mock API · ${MOCK_SCENARIO}` : 'Live API'} · dev only
    </span>
  )
}
