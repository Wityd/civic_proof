import { Link } from 'react-router-dom'
import { scrollToSection } from './scroll'

// Dark multi-column footer (ref: Balad).
type FooterLink = { label: string; to?: string; section?: string }

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
      // No team/contact pages yet: these go to the About section.
      { label: 'The team', section: 'about' },
      { label: 'BACISS 2026', section: 'about' },
      { label: 'Contact us', section: 'about' },
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
            <span className="text-lg font-bold">CivicProof</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-white/70">CivicProof. Follow the money, see the work.</p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-sm font-semibold">{col.title}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.to ? (
                    <Link to={l.to} className={linkCls}>
                      {l.label}
                    </Link>
                  ) : (
                    <a href={`#${l.section}`} onClick={scrollToSection(l.section!)} className={linkCls}>
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-white/60">
          © 2026 CivicProof · This is a demo. Every project, supplier and amount here is made up, and no real money is
          used.
        </p>
      </div>
    </footer>
  )
}
