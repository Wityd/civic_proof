import { Link, NavLink } from 'react-router-dom'
import { useViewAs } from '../context/ViewAsContext'
import type { Role } from '../types'
import { ViewAsSwitcher } from './ViewAsSwitcher'

const NAV: { to: string; label: string; roles: Role[] | 'all' }[] = [
  { to: '/projects', label: 'Projects', roles: 'all' },
  { to: '/supplier/invoices', label: 'My invoices', roles: ['supplier'] },
  { to: '/supplier/invoices/new', label: 'New invoice', roles: ['supplier'] },
  { to: '/review', label: 'Review queue', roles: ['municipality'] },
  { to: '/audit', label: 'Audit log', roles: ['auditor'] },
]

export function Header() {
  const { user } = useViewAs()
  const links = NAV.filter((n) => n.roles === 'all' || (user && n.roles.includes(user.role)))

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            C
          </span>
          <span className="leading-tight">
            <span className="block font-heading font-bold text-slate-900">CivicProof</span>
            <span className="block text-xs text-slate-500">Follow the money. Prove the service.</span>
          </span>
        </Link>

        <nav className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
          {links.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end
              className={({ isActive }) =>
                `rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto">
          <ViewAsSwitcher />
        </div>
      </div>
    </header>
  )
}
