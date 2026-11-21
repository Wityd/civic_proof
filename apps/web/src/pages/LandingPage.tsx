// Public landing page at "/". Copy: landing-copy.md. Layout refs: Travexa & LucenAI
// (pill nav, gradient hero, chips, bento), Arquivo & Balad (dark bands, arches, footer).
// Figures are the fixed Kgotso Valley story (not live data).
import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { DevBadge } from '../components/DevBadge'
import { Money } from '../components/Money'
import { HeroPreview } from '../components/landing/HeroPreview'
import {
  AlertIcon,
  ArrowRightIcon,
  BuildingIcon,
  CameraIcon,
  ChatIcon,
  CheckIcon,
  GavelIcon,
  HomeIcon,
  LinkIcon,
  ScanIcon,
  SearchIcon,
  TruckIcon,
  WalletIcon,
} from '../components/landing/icons'
import { LandingFooter } from '../components/landing/LandingFooter'
import { LandingNav } from '../components/landing/LandingNav'
import { CP001_PATH, scrollToSection } from '../components/landing/scroll'
import { formatMoney } from '../lib/money'

export function LandingPage() {
  // Arriving from another page via "/#section" (e.g. "How it works" on /team): scroll there.
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const el = document.getElementById(hash.slice(1))
    if (el) el.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <DevBadge />
      <div className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-sky-50 to-white pt-5">
        <div aria-hidden="true" className="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-brand-100/60 blur-3xl" />
        <div aria-hidden="true" className="absolute -top-16 right-0 h-72 w-72 rounded-full bg-sky-100 blur-3xl" />
        <LandingNav />
        <Hero />
      </div>

      <main>
        <WatchList />
        <Intro />
        <Helps />
        <Numbers />
        <HowItWorks />
        <Featured />
        <Who />
        <ResidentsSay />
        <WhatItDoes />
        <BuiltWith />
        <ClosingCta />
      </main>

      <LandingFooter />
    </div>
  )
}

// ---------- shared bits ----------

function Section({ id, className = '', children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-24 px-4 py-16 sm:py-24 ${className}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  )
}

function SectionHeading({ title, sub, light = false }: { title: ReactNode; sub?: string; light?: boolean }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className={`text-3xl font-semibold tracking-tight sm:text-4xl ${light ? 'text-white' : 'text-slate-900'}`}>
        {title}
      </h2>
      {sub && <p className={`mt-3 text-lg ${light ? 'text-white/70' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  )
}

const btnDark =
  'inline-flex items-center justify-center gap-2 rounded-full bg-navy-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-navy-800'
const btnLight =
  'inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50'

// ---------- 1. Hero ----------

function Hero() {
  return (
    <div className="relative px-4 pt-14 pb-20 text-center sm:pt-20 sm:pb-24">
      <Link
        to={CP001_PATH}
        className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white/80 p-1.5 pl-4 text-xs leading-none font-medium whitespace-nowrap text-slate-600 shadow-sm backdrop-blur hover:bg-white"
      >
        Made for BACISS 2026
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 leading-none font-semibold text-white">
          Explore a project <ArrowRightIcon size={12} />
        </span>
      </Link>

      <h1 className="mx-auto mt-6 max-w-3xl text-5xl leading-[1.05] font-semibold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
        <span className="block">Follow the Money</span>
        <span className="block font-serif font-normal text-brand-700 italic">See the work</span>
      </h1>

      <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
        When a public project gets funded, you should be able to see who got paid, what they were paid for, and whether
        the job was actually done. CivicProof shows you all of it in one place.
      </p>

      {/* "Watch the demo" is hidden until a demo video exists. */}
      <div className="mt-8 flex justify-center">
        <Link to="/projects" className={btnDark}>
          Go to dashboard <ArrowRightIcon size={16} />
        </Link>
      </div>

      <HeroPreview />
    </div>
  )
}

// ---------- 2. Things we check for ----------

// Each check gets its own small coloured icon tile (ref: stacked integration chips).
const WATCH: { label: string; icon: ReactNode; tile: string }[] = [
  { label: 'Prices that are too high', icon: <AlertIcon size={15} />, tile: 'bg-red-500' },
  { label: 'The same bill sent twice', icon: <ScanIcon size={15} />, tile: 'bg-amber-500' },
  { label: 'Spending that has nothing to do with the project', icon: <SearchIcon size={15} />, tile: 'bg-violet-500' },
  { label: 'Brand-new suppliers', icon: <BuildingIcon size={15} />, tile: 'bg-sky-500' },
  { label: 'Spending more than the budget', icon: <WalletIcon size={15} />, tile: 'bg-rose-500' },
  { label: 'The same delivery photo used twice', icon: <CameraIcon size={15} />, tile: 'bg-orange-500' },
  { label: 'Residents saying it never arrived', icon: <ChatIcon size={15} />, tile: 'bg-brand-600' },
]

function WatchList() {
  return (
    <section aria-labelledby="watch-heading" className="border-y border-slate-100 bg-white px-4 py-12">
      <p id="watch-heading" className="text-center text-sm font-medium text-slate-500">
        What CivicProof looks out for
      </p>
      {/* Stacked, wrapping cluster of chips. */}
      <ul className="mx-auto mt-6 flex max-w-4xl flex-wrap justify-center gap-3">
        {WATCH.map((w) => (
          <li
            key={w.label}
            className="inline-flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white py-2 pr-4 pl-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none"
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white ${w.tile}`}>{w.icon}</span>
            {w.label}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------- 3. Intro statement ----------

function Intro() {
  return (
    <Section>
      <p className="mx-auto max-w-4xl text-center font-heading text-3xl leading-tight font-bold tracking-tight text-slate-900 sm:text-5xl">
        If it's public money, <span className="text-slate-400">people should be able to see where it went.</span>
      </p>
      <p className="mx-auto mt-6 max-w-2xl text-center text-lg text-slate-600">
        Right now, problems with public spending usually come out long after the money is gone. CivicProof puts every
        payment and decision where anyone can see it, so problems get spotted before anyone is paid.
      </p>
    </Section>
  )
}

// ---------- 4. How CivicProof helps (bento, ref: LucenAI) ----------

function BentoCard({
  icon,
  title,
  body,
  className = '',
  children,
}: {
  icon: ReactNode
  title: string
  body: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={`flex flex-col rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card ${className}`}>
      <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700">{icon}</span>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-600">{body}</p>
      {children}
    </div>
  )
}

function Helps() {
  return (
    <Section className="bg-slate-50">
      <SectionHeading
        title="One place to see where the money goes"
        sub="You can follow a project from the day it gets its money to the day the work is finished."
      />
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        <div className="grid gap-5">
          <BentoCard
            icon={<WalletIcon />}
            title="Its own wallet."
            body="Every project gets a separate wallet, and all of its payments come out of that wallet."
          >
            <div className="mt-4 rounded-2xl bg-navy-900 p-3 text-white">
              <p className="text-[11px] text-white/60">CP001 wallet</p>
              <Money cents={200000000} className="text-xl" />
            </div>
          </BentoCard>
          <BentoCard
            icon={<GavelIcon />}
            title="A person makes the call."
            body="An official approves the invoice, puts it on hold, or turns it down. The AI only gives advice."
          >
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-700">Approve</span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Hold</span>
              <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">Turn down</span>
            </div>
          </BentoCard>
        </div>

        <BentoCard
          icon={<ScanIcon />}
          title="Invoices get checked."
          body="Before anyone is paid, AI compares each invoice with what those items normally cost."
          className="bg-gradient-to-b from-brand-50 to-white"
        >
          <div className="mt-6 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase">Invoice PD-0147 · line 1</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">250mm HDPE pipe, 12 m</p>
            <div className="mt-4 space-y-3 text-xs">
              <div>
                <div className="flex justify-between text-slate-600">
                  <span>Usual price</span>
                  <span className="font-semibold tabular-nums">{formatMoney(520000)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className="h-2 w-[43%] rounded-full bg-brand-500" />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-slate-600">
                  <span>Invoice price</span>
                  <span className="font-semibold text-red-700 tabular-nums">{formatMoney(1200000)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className="h-2 w-full rounded-full bg-red-500" />
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">+131% above the usual price</p>
              <p className="mt-0.5">Possible overcharge {formatMoney(13600000)}. AI suggests: hold for review.</p>
            </div>
          </div>
        </BentoCard>

        <div className="grid gap-5">
          <BentoCard
            icon={<CameraIcon />}
            title="Proof the work was done."
            body="Final payment waits for photos of the work and a thumbs-up from people who live there."
          >
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700">
                <CameraIcon size={18} />
              </span>
              <span>
                <b className="text-slate-800">8 tanks installed</b>
                <br />
                Photo uploaded · residents confirm
              </span>
            </div>
          </BentoCard>
          <BentoCard
            icon={<LinkIcon />}
            title="Records that can't be secretly changed."
            body="Every payment is saved on a blockchain, a shared record that nobody can quietly edit later."
          >
            <p className="mt-4 truncate rounded-xl bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-500">
              0xa9e1172889bddfa3846e9e448dd4…
            </p>
          </BentoCard>
        </div>
      </div>
    </Section>
  )
}

// ---------- 5. The demo in numbers (dark band, refs: Arquivo/Balad) ----------

function Numbers() {
  const stats: { value: ReactNode; label: string }[] = [
    { value: <Money cents={200000000} />, label: 'Given to the project' },
    {
      value: <Money cents={102500000} />,
      label: 'Stayed in the wallet because the invoices were held or turned down',
    },
    { value: <Money cents={13600000} />, label: 'Possible overcharging spotted on one invoice' },
    { value: '100%', label: 'Of payments anyone can look up' },
  ]
  return (
    <section className="relative overflow-hidden bg-navy-900 px-4 py-16 text-white sm:py-24">
      <div aria-hidden="true" className="absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-brand-600/30 blur-3xl" />
      <div className="relative mx-auto max-w-6xl">
        <SectionHeading title="What happened in Kgotso Valley" light />
        <dl className="mt-12 grid gap-px overflow-hidden rounded-3xl bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-navy-900 p-6">
              <dt className="sr-only">{s.label}</dt>
              <dd className="text-3xl font-bold text-white sm:text-4xl">{s.value}</dd>
              <p className="mt-2 text-sm text-white/70">{s.label}</p>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

// ---------- 6. How it works (arches, ref: Arquivo) ----------

const STEPS = [
  { icon: <WalletIcon size={22} />, title: 'Fund it.', body: "The project's money goes into its own wallet." },
  { icon: <SearchIcon size={22} />, title: 'Check it.', body: 'AI looks over each invoice for warning signs.' },
  {
    icon: <GavelIcon size={22} />,
    title: 'Decide.',
    body: 'An official looks at the invoice and makes a decision, and the decision is saved.',
  },
  {
    icon: <CheckIcon size={22} />,
    title: 'Confirm it.',
    body: 'Residents and officials say the work was done before the last payment goes out.',
  },
]

function HowItWorks() {
  return (
    <section id="how-it-works" className="relative scroll-mt-24 px-4 py-16 sm:py-24">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-72 bg-brand-600" />
      <div className="relative mx-auto max-w-6xl">
        <SectionHeading title="Four steps from funding to proof" light />
        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="flex flex-col items-center rounded-t-[999px] rounded-b-3xl border border-slate-200/80 bg-white px-6 pt-10 pb-8 text-center shadow-card"
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-navy-900 text-white">{s.icon}</span>
              <span className="mt-4 text-xs font-semibold tracking-widest text-brand-700 uppercase">Step {i + 1}</span>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ---------- 7. Featured project (ref: Balad split panel) ----------

function Featured() {
  return (
    <Section className="pt-0 sm:pt-0">
      <div className="grid overflow-hidden rounded-3xl bg-navy-900 text-white shadow-float md:grid-cols-2">
        <div className="p-8 sm:p-12">
          <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide uppercase">
            Example project
          </span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Kgotso Valley Water Access</h2>
          <p className="mt-4 text-white/75">
            This {formatMoney(200000000)} water project is putting water tanks and pipes in four villages. You can see
            every invoice, including the fair ones that got paid and the overpriced ones that were stopped.
          </p>
          <Link
            to={CP001_PATH}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-navy-900 hover:bg-slate-100"
          >
            Open the project <ArrowRightIcon size={16} />
          </Link>
        </div>
        <div className="relative bg-gradient-to-br from-brand-600 to-brand-800 p-8 sm:p-12">
          <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-float">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">CP001 · Project figures</p>
            <dl className="mt-3 space-y-3">
              {[
                { k: 'Allocated', v: 200000000, cls: 'text-slate-900' },
                { k: 'Paid for fair invoices', v: 18240000, cls: 'text-brand-700' },
                { k: 'Held or turned down', v: 102500000, cls: 'text-amber-700' },
              ].map((r) => (
                <div key={r.k} className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-3 last:border-0">
                  <dt className="text-sm text-slate-500">{r.k}</dt>
                  <dd className={`text-lg font-bold tabular-nums ${r.cls}`}>{formatMoney(r.v)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-slate-400">4 invoices · 4 village sites</p>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ---------- 8. Who it's for (ref: Balad departments) ----------

const WHO = [
  {
    icon: <HomeIcon size={22} />,
    name: 'Residents',
    body: "can see where their community's money goes and speak up when something looks wrong.",
    cls: 'bg-brand-50 text-brand-700',
  },
  {
    icon: <TruckIcon size={22} />,
    name: 'Suppliers',
    body: 'can send invoices and see exactly where each one stands.',
    cls: 'bg-sky-100 text-sky-700',
  },
  {
    icon: <BuildingIcon size={22} />,
    name: 'Officials',
    body: 'can spend their time on the invoices that need a closer look.',
    cls: 'bg-amber-100 text-amber-700',
  },
  {
    icon: <SearchIcon size={22} />,
    name: 'Auditors',
    body: 'can check decisions as they happen, without waiting for the year-end report.',
    cls: 'bg-navy-900 text-white',
  },
]

function Who() {
  return (
    <Section id="who" className="bg-slate-50">
      <SectionHeading title="Made for everyone with a stake in public money" />
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {WHO.map((w) => (
          <div key={w.name} className="rounded-3xl border border-slate-200/80 bg-white p-6 text-center shadow-card">
            <span className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${w.cls}`}>{w.icon}</span>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">{w.name}</h3>
            <p className="mt-2 text-sm text-slate-600">
              {w.name} {w.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---------- 9. Residents have a say (ref: Balad CTA panel) ----------

function ResidentsSay() {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-3xl bg-brand-600 p-8 text-white sm:p-12">
        <div aria-hidden="true" className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10" />
        <div aria-hidden="true" className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-navy-900/20" />
        <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <div className="flex gap-5">
            <span className="hidden h-14 w-14 shrink-0 place-items-center rounded-full bg-white/15 sm:grid">
              <ChatIcon size={24} />
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Did the work actually happen?</h2>
              <p className="mt-3 max-w-2xl text-white/85">
                If you live near a project, you can say whether the delivery really happened, or ask a question about
                any payment. Every question gets a public answer, and your name is never shown.
              </p>
            </div>
          </div>
          {/* The question form isn't built yet; this opens the demo project, where residents confirm deliveries. */}
          <Link
            to={CP001_PATH}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Ask a question <ArrowRightIcon size={16} />
          </Link>
        </div>
      </div>
    </Section>
  )
}

// ---------- 10. What CivicProof does ----------

const DOES = [
  { title: 'Flags risky invoices', body: 'The AI checks every invoice against normal prices and the project budget before anyone is paid.' },
  { title: 'Puts a person in charge', body: 'Every warning goes to an authorised official, who approves, holds or rejects it.' },
  { title: 'Keeps a permanent record', body: 'Every payment and decision is saved on the blockchain, where nobody can quietly change it.' },
  { title: 'Lets residents confirm', body: 'People who live there say whether the work really happened before the last payment goes out.' },
]

function WhatItDoes() {
  return (
    <Section id="about" className="bg-slate-50">
      <SectionHeading
        title="What CivicProof does"
        sub="It catches problems before money moves, and keeps proof of every payment for anyone to see."
      />
      <ul className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2">
        {DOES.map((d) => (
          <li key={d.title} className="flex gap-4 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
              <CheckIcon size={20} />
            </span>
            <div>
              <h3 className="font-semibold text-slate-900">{d.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{d.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------- 11. Built with (ref: LucenAI logo row) ----------

// Logos live in public/logos. Each file has different empty space around its artwork, so each
// gets its own height (and Gemini a small nudge up, because its sparkle sits above the word)
// to look the same size and sit on one centre line.
const STACK: { name: string; logo: string; size: string }[] = [
  { name: 'React', logo: '/logos/react.svg', size: 'h-9 sm:h-10' },
  { name: 'Supabase', logo: '/logos/supabase.svg', size: 'h-7 sm:h-8' },
  { name: 'Avalanche', logo: '/logos/avalanche.svg', size: 'h-6 sm:h-7' },
  { name: 'Gemini', logo: '/logos/gemini.svg', size: 'h-9 sm:h-10 -translate-y-1' },
]
// Enough copies that one half of the track is wider than the screen, so the loop never shows a gap.
const STACK_HALF = [...STACK, ...STACK, ...STACK]

function BuiltWith() {
  return (
    <section aria-labelledby="built-heading" className="border-y border-slate-100 py-10">
      <p id="built-heading" className="text-center text-base font-medium tracking-[0.18em] text-slate-500 uppercase sm:text-lg">
        Built with
      </p>
      {/* Right-to-left endless loop (one pass = 90 s). Hovering pauses it; reduced motion shows one still, centred row. */}
      <div className="relative mt-7 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <ul className="flex w-max animate-marquee items-center [animation-duration:90s] hover:[animation-play-state:paused] motion-reduce:w-full motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-y-6">
          {[...STACK_HALF, ...STACK_HALF].map((s, i) => {
            const copy = i >= STACK.length
            return (
              <li
                key={i}
                aria-hidden={copy}
                className={`group flex h-16 shrink-0 items-center justify-center px-12 sm:px-16 ${copy ? 'motion-reduce:hidden' : ''}`}
              >
                <img
                  src={s.logo}
                  alt={copy ? '' : s.name}
                  loading="lazy"
                  className={`${s.size} w-auto opacity-60 grayscale transition duration-300 group-hover:opacity-100 group-hover:grayscale-0`}
                />
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

// ---------- 12. Closing call to action ----------

function ClosingCta() {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-50 via-sky-50 to-white px-6 py-14 text-center ring-1 ring-slate-200/70 sm:px-12">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          Go see where the money <span className="font-serif font-normal text-brand-700 italic">went</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
          Open the Kgotso Valley project and follow each payment from the wallet to the finished work.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/projects" className={btnDark}>
            Go to dashboard <ArrowRightIcon size={16} />
          </Link>
          <a href="#how-it-works" onClick={scrollToSection('how-it-works')} className={btnLight}>
            How it works
          </a>
        </div>
      </div>
    </Section>
  )
}
