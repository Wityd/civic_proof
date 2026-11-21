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

const ROLE_LABEL: Record<Role, string> = {
  citizen: 'Resident',
  supplier: 'Supplier',
  municipality: 'Municipality',
  auditor: 'Auditor',
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export function Header() {
  const { user } = useViewAs()
  const links = NAV.filter((n) => n.roles === 'all' || (user && n.roles.includes(user.role)))

  return (
    <header className="border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 font-heading text-lg font-bold text-white">
            C
          </span>
          <span className="leading-tight">
            <span className="block font-heading font-bold text-slate-900">CivicProof</span>
            <span className="block text-[11px] text-slate-500">Follow the money. See the work.</span>
          </span>
        </Link>

        <nav
          aria-label="App"
          className="order-last flex w-full gap-1 overflow-x-auto rounded-full bg-slate-100 p-1 md:order-none md:w-auto"
        >
          {links.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end
              className={({ isActive }) =>
                `rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                  isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user && (
            <div className="hidden items-center gap-2.5 sm:flex">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-navy-900 text-xs font-semibold text-white">
                {initials(user.display_name || ROLE_LABEL[user.role])}
              </span>
              <span className="leading-tight">
                <span className="block max-w-[10rem] truncate text-sm font-semibold text-slate-900">
                  {user.display_name || ROLE_LABEL[user.role]}
                </span>
                <span className="block text-[11px] text-slate-500">{ROLE_LABEL[user.role]}</span>
              </span>
            </div>
          )}
          <ViewAsSwitcher />
        </div>
      </div>
    </header>
  )
}
