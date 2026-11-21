// STUB for P4. Replace the inside freely, but keep the props: { review: AiReview }.
// The review page (/review/:id) renders <AiFindingsCard review={invoice.ai_review} />.
import { flagLabel } from '../../lib/flags'
import { formatMoney } from '../../lib/money'
import type { AiReview, Recommendation } from '../../types'
import { FlagChip } from '../FlagChip'

const REC: Record<Recommendation, { label: string; cls: string }> = {
  APPROVE: { label: 'Approve', cls: 'bg-brand-50 text-brand-700' },
  HOLD_FOR_REVIEW: { label: 'Hold for review', cls: 'bg-amber-100 text-amber-800' },
  REJECT: { label: 'Reject', cls: 'bg-red-100 text-red-700' },
}

const SEVERITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-500', info: 'bg-slate-400' }

export function AiFindingsCard({ review }: { review: AiReview }) {
  const rec = REC[review.recommendation]
  return (
    <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">AI findings</h2>
          <p className="text-xs text-slate-500">
            Confidence {Math.round(review.extraction.confidence * 100)}% · mode: {review.mode}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">AI recommends</p>
          <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-sm font-bold ${rec.cls}`}>{rec.label}</span>
        </div>
      </div>

      <p className="mt-4 text-slate-700">{review.explanation}</p>

      {review.extraction.document && (
        <p
          className={`mt-4 rounded-2xl p-3 text-sm font-medium ${
            review.extraction.document.matches_form ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
          }`}
        >
          📄 The AI read the attached invoice PDF:{' '}
          {review.extraction.document.matches_form
            ? 'it matches what the supplier submitted.'
            : 'it differs from what the supplier submitted (see below).'}
          <span className="block text-xs font-normal opacity-80">
            PDF total {formatMoney(review.extraction.document.total_cents)} · invoice{' '}
            {review.extraction.document.invoice_number || 'not printed'}
          </span>
        </p>
      )}

      {review.checks.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-brand-50 p-4 text-sm font-medium text-brand-700">No problems found.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {review.checks.map((c, i) => (
            <li key={i} className="flex gap-3 rounded-2xl bg-slate-50 p-3">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEVERITY_DOT[c.severity]}`} />
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {flagLabel(c.code)}
                  {c.line !== undefined && <span className="font-normal text-slate-500"> · line {c.line + 1}</span>}
                </p>
                <p className="text-sm text-slate-600">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {review.potential_excess_cents > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-800 uppercase">Possible overpayment</p>
          <p className="text-2xl font-bold text-amber-900 tabular-nums">{formatMoney(review.potential_excess_cents)}</p>
          {review.benchmarks.map((b) => (
            <p key={b.line} className="mt-1 text-xs text-amber-800">
              Line {b.line + 1}: {formatMoney(b.invoice_unit_cents)} per unit vs benchmark{' '}
              {formatMoney(b.benchmark_unit_cents)} ({b.source})
            </p>
          ))}
        </div>
      )}

      {review.flags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {review.flags.map((f) => (
            <FlagChip key={f} code={f} />
          ))}
        </div>
      )}

      <p className="mt-5 border-t border-slate-100 pt-3 text-xs font-medium text-slate-500">
        AI recommends; authorised humans decide.
      </p>
    </section>
  )
}
