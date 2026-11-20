import { useState, type FormEvent } from 'react'
import { demoEmail, signIn } from '../lib/auth'
import type { Role } from '../types'

const LABEL: Record<Role, string> = {
  citizen: 'Citizen',
  supplier: 'Supplier',
  municipality: 'Municipality',
  auditor: 'Auditor',
}

// Asked once per role per browser; the session is then remembered.
export function SignInDialog({ role, onDone, onCancel }: { role: Role; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(role, password)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-title"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <form onSubmit={submit} className="w-full max-w-sm rounded-card bg-white p-6 shadow-card">
        <h2 id="signin-title" className="text-lg font-bold text-slate-900">
          Sign in as {LABEL[role]}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Demo account <span className="font-mono text-slate-700">{demoEmail(role)}</span>. You only need to do this
          once on this browser.
        </p>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 focus:outline-none"
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !password}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  )
}
