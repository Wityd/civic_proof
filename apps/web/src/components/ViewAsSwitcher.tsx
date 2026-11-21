import { useViewAs } from '../context/ViewAsContext'

const ROLE_LABEL = {
  citizen: 'Citizen',
  supplier: 'Supplier',
  municipality: 'Municipality',
  auditor: 'Auditor',
} as const

export function ViewAsSwitcher() {
  const { selectedId, users, setUserId } = useViewAs()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-slate-500 sm:inline">View as</span>
      <select
        value={selectedId ?? ''}
        onChange={(e) => setUserId(e.target.value || null)}
        className="rounded-full border border-slate-200 bg-white py-2 pr-8 pl-4 font-medium text-slate-800 shadow-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 focus:outline-none"
      >
        <option value="">Public (not signed in)</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {ROLE_LABEL[u.role]}
            {u.display_name && `: ${u.display_name}`}
          </option>
        ))}
      </select>
    </label>
  )
}
