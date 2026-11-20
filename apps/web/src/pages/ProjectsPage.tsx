import { Link } from 'react-router-dom'
import { Money } from '../components/Money'
import { useProjects } from '../lib/queries'
import type { Project } from '../types'

export function ProjectsPage() {
  const projects = useProjects()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Public projects</h1>
        <p className="mt-1 text-slate-500">See every rand allocated, paid and still in the wallet.</p>
      </div>

      {projects.isPending && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="h-64 animate-pulse rounded-card bg-white shadow-card" />
          <div className="h-64 animate-pulse rounded-card bg-white shadow-card" />
        </div>
      )}

      {projects.error && (
        <div className="rounded-card bg-white p-6 shadow-card">
          <p className="font-semibold text-red-700">Could not load projects</p>
          <p className="mt-1 text-sm text-slate-500">{projects.error.message}</p>
          <button
            onClick={() => projects.refetch()}
            className="mt-4 rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Try again
          </button>
        </div>
      )}

      {projects.data?.length === 0 && (
        <div className="rounded-card bg-white p-10 text-center text-slate-500 shadow-card">
          No projects yet.
        </div>
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
      className="group block rounded-card bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{p.code}</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900 group-hover:text-brand-700">{p.name}</h2>
          <p className="text-sm text-slate-500">{p.location}</p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
          Fictional
        </span>
      </div>

      <div className="mt-6">
        <p className="text-sm text-slate-500">Balance in wallet</p>
        <Money cents={p.balance_cents} className="text-3xl text-slate-900 sm:text-4xl" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 rounded-2xl bg-slate-50 p-4">
        <div>
          <p className="text-xs text-slate-500">Allocated</p>
          <Money cents={p.budget_cents} className="text-lg text-slate-800" />
        </div>
        <div>
          <p className="text-xs text-slate-500">Paid</p>
          <Money cents={p.paid_cents} className="text-lg text-brand-700" />
        </div>
      </div>

      <div className="mt-5">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Spent</span>
          <span className="font-semibold text-slate-800">{pctSpent.toFixed(1)}%</span>
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={Math.round(pctSpent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(pctSpent, 100)}%` }} />
        </div>
      </div>

      <p className="mt-5 text-sm font-medium text-brand-700">Follow the money →</p>
    </Link>
  )
}
