import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MenuIcon, XIcon } from './icons'
import { SectionLink } from './SectionLink'

// Floating pill nav (refs: Travexa, LucenAI). The app pages keep their own header.
const LINKS: { label: string; to?: string; section?: string }[] = [
  { label: 'Home', to: '/' },
  { label: 'How it works', section: 'how-it-works' },
  { label: 'Projects', to: '/projects' },
  { label: 'About', section: 'about' },
  { label: 'Team', to: '/team' },
]

export function LandingNav() {
  const [open, setOpen] = useState(false)

  const linkCls = 'rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'

  return (
    <div className="sticky top-3 z-40 px-4">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl items-center gap-4 rounded-full border border-white/70 bg-white/85 py-2 pr-2 pl-4 shadow-card backdrop-blur"
      >
        <Link to="/" className="flex items-center gap-2" aria-label="CivicProof home">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">C</span>
          <span className="font-bold text-slate-900">CivicProof</span>
        </Link>

        <div className="mx-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) =>
            l.to ? (
              <Link key={l.label} to={l.to} className={linkCls}>
                {l.label}
              </Link>
            ) : (
              <SectionLink key={l.label} section={l.section!} className={linkCls}>
                {l.label}
              </SectionLink>
            ),
          )}
        </div>

        <Link
          to="/projects"
          className="ml-auto hidden rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 md:ml-0 md:inline-block"
        >
          See the dashboard
        </Link>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="ml-auto grid h-10 w-10 place-items-center rounded-full text-slate-700 hover:bg-slate-100 md:hidden"
        >
          {open ? <XIcon /> : <MenuIcon />}
        </button>
      </nav>

      {open && (
        <div className="mx-auto mt-2 max-w-5xl rounded-3xl border border-white/70 bg-white p-3 shadow-float md:hidden">
          {LINKS.map((l) =>
            l.to ? (
              <Link key={l.label} to={l.to} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 font-medium text-slate-700 hover:bg-slate-50">
                {l.label}
              </Link>
            ) : (
              <SectionLink
                key={l.label}
                section={l.section!}
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 font-medium text-slate-700 hover:bg-slate-50"
              >
                {l.label}
              </SectionLink>
            ),
          )}
          <Link
            to="/projects"
            onClick={() => setOpen(false)}
            className="mt-2 block rounded-full bg-navy-900 px-4 py-3 text-center font-semibold text-white"
          >
            See the dashboard
          </Link>
        </div>
      )}
    </div>
  )
}
