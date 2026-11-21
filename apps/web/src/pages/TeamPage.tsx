// Team page at /team. Layout ref: "Meet the Conicorn's Minds" (portrait row, names under,
// no roles). Photos stay black & white until hovered or focused.
import type { ReactNode } from 'react'
import { DevBadge } from '../components/DevBadge'
import { GitHubIcon, LinkedInIcon } from '../components/landing/icons'
import { LandingFooter } from '../components/landing/LandingFooter'
import { LandingNav } from '../components/landing/LandingNav'

interface Member {
  name: string
  photo: string | null // in public/team; null shows initials
  position?: string // CSS object-position to frame the face
  linkedin: string | null
  github: string | null
}

const TEAM: Member[] = [
  {
    name: 'Witness Lubisi',
    photo: '/team/witness-lubisi.jpg',
    position: '50% 30%',
    linkedin: 'https://www.linkedin.com/in/wiityprimeservicesonline076889',
    github: 'https://github.com/Wityd',
  },
  {
    name: 'Boipelo Pete',
    photo: null,
    linkedin: 'https://www.linkedin.com/in/boipelo-pete-61a561355',
    github: 'https://github.com/thabangthaba16-hash',
  },
  {
    name: 'Joshua I Ayoola',
    photo: '/team/joshua-ayoola.jpg',
    position: '50% 20%',
    linkedin: 'https://www.linkedin.com/in/jehohshua/',
    github: 'https://github.com/JehohshuaA',
  },
  {
    name: 'Ndivhuwo Magathe',
    photo: '/team/ndivhuwo-magathe.jpg',
    position: '60% 40%',
    linkedin: 'https://www.linkedin.com/in/ndivhuwo-m-958ba22b0',
    github: 'https://github.com/nastro-blip',
  },
  // Placeholder until the fifth member's details arrive.
  { name: 'Member 5', photo: null, linkedin: null, github: null },
]

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export function TeamPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <DevBadge />
      <div className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-sky-50 to-white pt-5">
        <div aria-hidden="true" className="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-brand-100/60 blur-3xl" />
        <div aria-hidden="true" className="absolute -top-16 right-0 h-72 w-72 rounded-full bg-sky-100 blur-3xl" />
        <LandingNav />

        <main className="relative px-4 pt-14 pb-20 sm:pt-20 sm:pb-28">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-600" /> Team
            </span>
            <h1 className="mx-auto mt-5 max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              Meet the brains behind{' '}
              <span className="font-serif font-normal text-brand-700 italic">CivicProof</span>
            </h1>
          </div>

          {/* Phones: swipe sideways. Desktop: one row; the hovered card widens and turns to colour. */}
          <ul className="mx-auto mt-12 flex max-w-6xl snap-x snap-mandatory gap-4 overflow-x-auto pb-4 sm:mt-16 lg:overflow-visible lg:pb-0">
            {TEAM.map((m) => (
              <MemberCard key={m.name} m={m} />
            ))}
          </ul>
        </main>
      </div>
      <LandingFooter />
    </div>
  )
}

function MemberCard({ m }: { m: Member }) {
  const links = [
    m.linkedin && { href: m.linkedin, label: `${m.name} on LinkedIn`, icon: <LinkedInIcon /> },
    m.github && { href: m.github, label: `${m.name} on GitHub`, icon: <GitHubIcon /> },
  ].filter(Boolean) as { href: string; label: string; icon: ReactNode }[]

  return (
    <li className="group w-60 shrink-0 snap-center transition-[flex-grow] duration-500 ease-out lg:w-auto lg:flex-1 lg:hover:flex-[1.35] lg:focus-within:flex-[1.35] motion-reduce:transition-none">
      <div className="relative h-80 overflow-hidden rounded-[28px] bg-slate-100 shadow-card ring-1 ring-slate-200/70 sm:h-96">
        {m.photo ? (
          <img
            src={m.photo}
            alt={`Photo of ${m.name}`}
            loading="lazy"
            style={{ objectPosition: m.position ?? '50% 50%' }}
            className="h-full w-full object-cover grayscale transition duration-500 ease-out group-focus-within:scale-[1.03] group-focus-within:grayscale-0 group-hover:scale-[1.03] group-hover:grayscale-0 motion-reduce:transition-none"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid h-full w-full place-items-center bg-gradient-to-br from-brand-500 to-navy-800 grayscale transition duration-500 group-focus-within:grayscale-0 group-hover:grayscale-0 motion-reduce:transition-none"
          >
            <span className="font-serif text-6xl text-white/90">{initials(m.name)}</span>
          </div>
        )}
      </div>

      <div className="mt-4 text-center">
        <p className="text-base font-semibold text-slate-900">{m.name}</p>
        {links.length > 0 ? (
          <div className="mt-2 flex justify-center gap-2">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                aria-label={l.label}
                title={l.label}
                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-navy-900 hover:bg-navy-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {l.icon}
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400">Links coming soon</p>
        )}
      </div>
    </li>
  )
}
