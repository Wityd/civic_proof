import { Link, useLocation } from 'react-router-dom'

export function ComingSoonPage() {
  const { pathname } = useLocation()
  return (
    <div className="rounded-card bg-white p-10 text-center shadow-card">
      <p className="font-semibold">Not built yet</p>
      <p className="mt-1 text-sm text-slate-500">
        <code>{pathname}</code> is coming soon.
      </p>
      <Link to="/" className="mt-4 inline-block rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white">
        Back to projects
      </Link>
    </div>
  )
}
