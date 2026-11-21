// Small shared building blocks for the dashboard look (refs: pastel stat tiles,
// tinted info tiles, frame-in-frame cards, segmented tabs).
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useViewAs } from '../context/ViewAsContext'
import { ArrowUpRightIcon } from './landing/icons'

export type Tone = 'mint' | 'sky' | 'lavender' | 'amber' | 'rose' | 'navy' | 'plain'

const TONES: Record<Tone, { tile: string; icon: string; label: string; caption: string }> = {
  mint: { tile: 'bg-emerald-50 ring-1 ring-emerald-100', icon: 'bg-white text-brand-700', label: 'text-slate-600', caption: 'text-slate-500' },
  sky: { tile: 'bg-sky-50 ring-1 ring-sky-100', icon: 'bg-white text-sky-700', label: 'text-slate-600', caption: 'text-slate-500' },
  lavender: { tile: 'bg-violet-50 ring-1 ring-violet-100', icon: 'bg-white text-violet-700', label: 'text-slate-600', caption: 'text-slate-500' },
  amber: { tile: 'bg-amber-50 ring-1 ring-amber-100', icon: 'bg-white text-amber-700', label: 'text-slate-600', caption: 'text-slate-500' },
  rose: { tile: 'bg-rose-50 ring-1 ring-rose-100', icon: 'bg-white text-rose-700', label: 'text-slate-600', caption: 'text-slate-500' },
  navy: { tile: 'bg-navy-900 text-white', icon: 'bg-white/10 text-white', label: 'text-white/70', caption: 'text-white/60' },
  plain: { tile: 'bg-white shadow-card', icon: 'bg-slate-100 text-slate-700', label: 'text-slate-600', caption: 'text-slate-500' },
}

// Pastel figure tile: icon pill + label, big value, one-line caption, optional round arrow link.
export function StatTile({
  label,
  value,
  caption,
  icon,
  tone = 'plain',
  to,
}: {
  label: string
  value: ReactNode
  caption?: ReactNode
  icon?: ReactNode
  tone?: Tone
  to?: string
}) {
  const t = TONES[tone]
  return (
    <div className={`relative rounded-card p-5 ${t.tile}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`inline-flex items-center gap-2 text-sm font-medium ${t.label}`}>
          {icon && <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full shadow-sm ${t.icon}`}>{icon}</span>}
          {label}
        </p>
        {to && (
          <Link
            to={to}
            aria-label={`Open ${label}`}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition ${
              tone === 'navy' ? 'bg-white/10 text-white hover:bg-white hover:text-navy-900' : 'bg-white text-slate-700 shadow-sm hover:bg-navy-900 hover:text-white'
            }`}
          >
            <ArrowUpRightIcon size={16} />
          </Link>
        )}
      </div>
      <div className="mt-4 font-heading text-2xl font-bold tracking-tight tabular-nums sm:text-[1.7rem]">{value}</div>
      {caption && <p className={`mt-1 text-xs ${t.caption}`}>{caption}</p>}
    </div>
  )
}

// Small tinted detail box: tiny icon + label, value underneath (ref: "Type / Extracted date").
export function InfoTile({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-slate-50 px-3.5 py-3 ring-1 ring-slate-100">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        {icon && <span className="text-slate-400">{icon}</span>}
        {label}
      </p>
      <div className="mt-1 truncate text-sm font-semibold text-slate-800">{value}</div>
    </div>
  )
}

// Frame-in-frame card: white frame with a small icon + title, holding a tinted inner panel.
export function FrameCard({
  title,
  icon,
  action,
  panel = 'bg-slate-50',
  className = '',
  children,
}: {
  title: ReactNode
  icon?: ReactNode
  action?: ReactNode
  panel?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`flex flex-col rounded-[28px] bg-white p-2 shadow-card ${className}`}>
      <header className="flex items-center gap-2.5 px-3 pt-2 pb-3">
        {icon && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">{icon}</span>
        )}
        <h2 className="min-w-0 flex-1 truncate text-base text-slate-900">{title}</h2>
        {action}
      </header>
      <div className={`flex-1 rounded-[22px] p-5 ${panel}`}>{children}</div>
    </section>
  )
}

// Segmented pill tabs with count badges (ref: "All offers 9 · Pending review 54").
export function SegmentedTabs<K extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { key: K; label: string; count?: number }[]
  active: K
  onChange: (key: K) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-slate-100 p-1">
      {tabs.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition ${
              on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={`min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold ${
                  on ? 'bg-brand-600 text-white' : t.count ? 'bg-slate-200 text-slate-700' : 'bg-slate-200/60 text-slate-400'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// Page title with an optional personal greeting line (ref: "Hello, Barbara 👋").
export function PageHeader({
  title,
  subtitle,
  greet = false,
  action,
}: {
  title: string
  subtitle?: ReactNode
  greet?: boolean
  action?: ReactNode
}) {
  const { user } = useViewAs()
  const first = user?.display_name?.split(' ')[0]
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {greet && first && (
          <p className="text-sm font-medium text-brand-700">
            {greeting()}, {first} <span aria-hidden="true">👋</span>
          </p>
        )}
        <h1 className="mt-1 text-[1.75rem] leading-tight text-slate-900 sm:text-[2rem]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
