import type { ReactNode } from 'react'
import { useViewAs } from '../context/ViewAsContext'
import type { Role } from '../types'

const LABEL: Record<Role, string> = {
  citizen: 'Citizen',
  supplier: 'Supplier',
  municipality: 'Municipality',
  auditor: 'Auditor',
}

// Shows the page only to the given role. Everyone else gets a friendly hint.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, users, setUserId } = useViewAs()
  if (user?.role === role) return <>{children}</>

  const demoUser = users.find((u) => u.role === role)
  return (
    <div className="mx-auto max-w-md rounded-card bg-white p-8 text-center shadow-card">
      <p className="text-lg font-semibold text-slate-900">This page is for {LABEL[role].toLowerCase()}s</p>
      <p className="mt-2 text-sm text-slate-500">
        Switch “View as” to {LABEL[role]} in the header to see it.
      </p>
      {demoUser && (
        <button
          onClick={() => setUserId(demoUser.id)}
          className="mt-5 rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          View as {demoUser.name}
        </button>
      )}
    </div>
  )
}
