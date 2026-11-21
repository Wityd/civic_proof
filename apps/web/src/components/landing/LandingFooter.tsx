import { Link } from 'react-router-dom'
import { SectionLink } from './SectionLink'

// Dark multi-column footer (ref: Balad).
type FooterLink = { label: string; to?: string; section?: string; href?: string }

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Dashboard', to: '/projects' },
      { label: 'How it works', section: 'how-it-works' },
      { label: 'Projects', to: '/projects' },
    ],
  },
  {
    title: 'For',
    links: [
      { label: 'Residents', section: 'who' },
      { label: 'Suppliers', section: 'who' },
      { label: 'Officials', section: 'who' },
      { label: 'Auditors', section: 'who' },
    ],
  },
  {
    title: 'About',
    links: [
      { label: 'The team', to: '/team' },
      { label: 'BACISS 2026', href: 'https://blockchain.uj.ac.za/baciss/2026/ai-agent/' },
    ],
  },
]

export function LandingFooter() {
  const linkCls = 'text-sm text-white/70 hover:text-white'
  return (
    <footer className="bg-navy-950 text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 font-bold">C</span>
            <span className="font-heading text-lg font-bold">CivicProof</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-white/70">CivicProof. Follow the money, see the work.</p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-sm font-semibold">{col.title}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.href ? (
                    <a href={l.href} target="_blank" rel="noreferrer" className={linkCls}>
                      {l.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : l.to ? (
                    <Link to={l.to} className={linkCls}>
                      {l.label}
                    </Link>
                  ) : (
                    <SectionLink section={l.section!} className={linkCls}>
                      {l.label}
                    </SectionLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-white/60">
          © 2026 CivicProof · Built for BACISS 2026
        </p>
      </div>
    </footer>
  )
}
