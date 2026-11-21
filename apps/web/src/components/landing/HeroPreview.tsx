// Hero visual: a mini CivicProof dashboard with floating cards (ref: LucenAI).
// Built from the app's own pieces, with the Kgotso Valley story figures.
import { formatMoney } from '../../lib/money'
import type { InvoiceStatus } from '../../types'
import { Money } from '../Money'
import { StatusBadge } from '../StatusBadge'
import { AlertIcon, CheckIcon, LinkIcon } from './icons'

const INVOICES: { no: string; supplier: string; cents: number; status: InvoiceStatus }[] = [
  { no: 'BB-1021', supplier: 'Blue Basin Tanks', cents: 11840000, status: 'paid' },
  { no: 'PD-0147', supplier: 'Pipeworks Direct', cents: 24000000, status: 'on_hold' },
  { no: 'SM-2290', supplier: 'Summit Motors', cents: 78500000, status: 'rejected' },
  { no: 'BB-1034', supplier: 'Blue Basin Tanks', cents: 6400000, status: 'paid' },
]

export function HeroPreview() {
  return (
    <div className="relative mx-auto mt-14 max-w-4xl px-4 sm:mt-16">
      {/* soft halo behind the card */}
      <div aria-hidden="true" className="absolute inset-x-8 top-10 -z-10 h-72 rounded-full bg-brand-100/70 blur-3xl" />

      {/* main card */}
      <div className="mx-auto max-w-md rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-float">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">CP001 · Water project</p>
            <p className="font-semibold text-slate-900">Kgotso Valley Water Access</p>
          </div>
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700">
            Public record
          </span>
        </div>

        <div className="mt-4 rounded-2xl bg-gradient-to-br from-navy-800 to-navy-950 p-4 text-white">
          <p className="text-xs text-white/70">Project wallet balance</p>
          <Money cents={181760000} className="text-3xl" />
          <div className="mt-3 flex justify-between text-xs text-white/70">
            <span>Allocated {formatMoney(200000000)}</span>
            <span>Paid {formatMoney(18240000)}</span>
          </div>
        </div>

        <ul className="mt-4 divide-y divide-slate-100">
          {INVOICES.map((i) => (
            <li key={i.no} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{i.no}</p>
                <p className="truncate text-xs text-slate-500">{i.supplier}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800 tabular-nums">{formatMoney(i.cents)}</span>
                <StatusBadge status={i.status} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* floating cards: beside the main card on wide screens, below it on phones */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:mt-0 lg:block">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-float lg:absolute lg:top-24 lg:left-0 lg:w-64">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-amber-700">
              <AlertIcon size={16} />
            </span>
            <p className="text-sm font-semibold text-slate-900">AI flag on PD-0147</p>
          </div>
          <p className="mt-2 text-xs text-slate-600">Price 131% above benchmark</p>
          <p className="mt-1 text-xs text-slate-500">
            Possible overcharge <span className="font-semibold text-amber-700">{formatMoney(13600000)}</span>
          </p>
          <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            Held by an official
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-float lg:absolute lg:right-0 lg:bottom-16 lg:w-64">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-brand-700">
              <CheckIcon size={16} />
            </span>
            <p className="text-sm font-semibold text-slate-900">Payment released</p>
          </div>
          <p className="mt-2 text-lg font-bold text-slate-900 tabular-nums">{formatMoney(11840000)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <LinkIcon size={14} /> Recorded on Avalanche
          </p>
        </div>
      </div>
    </div>
  )
}
