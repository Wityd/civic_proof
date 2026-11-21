import { Link } from 'react-router-dom'
import { ArrowUpRightIcon, ScanIcon, WalletIcon, CheckIcon } from '../components/landing/icons'
import { Money } from '../components/Money'
import { InfoTile, PageHeader } from '../components/ui'
import { formatMoney } from '../lib/money'
import { useProjects } from '../lib/queries'
import type { Project } from '../types'

export function ProjectsPage() {
  const projects = useProjects()

  return (
    <div className="space-y-8">
      <PageHeader title="Public projects" subtitle="See every rand allocated, paid and still in the wallet." />

      {projects.isPending && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="h-80 animate-pulse rounded-[28px] bg-white shadow-card" />
          <div className="h-80 animate-pulse rounded-[28px] bg-white shadow-card" />
        </div>
      )}

      {projects.error && (
        <div className="rounded-card bg-white p-6 shadow-card">
          <p className="font-semibold text-red-700">Could not load projects</p>
          <p className="mt-1 text-sm text-slate-500">{projects.error.message}</p>
          <button
            onClick={() => projects.refetch()}
            className="mt-4 rounded-full bg-navy-900 px-5 py-2 text-sm font-medium text-white hover:bg-navy-800"
          >
            Try again
          </button>
        </div>
      )}

      {projects.data?.length === 0 && (
        <div className="rounded-card bg-white p-10 text-center text-slate-500 shadow-card">No projects yet.</div>
      )}

      {projects.data && projects.data.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {projects.data.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project: p }: { project: Project }) {
  const pctSpent = p.budget_cents > 0 ? (p.paid_cents / p.budget_cents) * 100 : 0

  return (
    <Link
      to={`/projects/${p.id}`}
      className="group block rounded-[28px] bg-white p-2 shadow-card transition hover:-translate-y-0.5 hover:shadow-float"
    >
      {/* Frame header */}
      <div className="flex items-start justify-between gap-3 px-3 pt-2 pb-3">
        <div className="min-w-0">
          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-500">
            {p.code}
          </span>
          <h2 className="mt-2 truncate text-lg text-slate-900 group-hover:text-brand-700">{p.name}</h2>
          <p className="text-sm text-slate-500">{p.location}</p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 transition group-hover:bg-navy-900 group-hover:text-white">
          <ArrowUpRightIcon size={17} />
        </span>
      </div>

      {/* Inner panel: the balance */}
      <div className="rounded-[22px] bg-gradient-to-br from-navy-800 to-navy-950 p-5 text-white">
        <p className="text-xs text-white/60">Balance in wallet</p>
        <Money cents={p.balance_cents} className="mt-1 block text-3xl sm:text-4xl" />
        <div className="mt-5 flex justify-between text-xs">
          <span className="text-white/60">Spent of budget</span>
          <span className="font-semibold">{pctSpent.toFixed(1)}%</span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Share of budget spent"
          aria-valuenow={Math.round(pctSpent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(pctSpent, 100)}%` }} />
        </div>
      </div>

      {/* Detail tiles */}
      <div className="grid grid-cols-3 gap-2 p-2 pt-3">
        <InfoTile label="Allocated" icon={<WalletIcon size={13} />} value={formatMoney(p.budget_cents)} />
        <InfoTile label="Paid" icon={<CheckIcon size={13} />} value={<span className="text-brand-700">{formatMoney(p.paid_cents)}</span>} />
        <InfoTile label="Invoices" icon={<ScanIcon size={13} />} value={p.invoices.length} />
      </div>
    </Link>
  )
}
