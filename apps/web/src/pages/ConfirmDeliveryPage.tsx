import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { RequireRole } from '../components/RequireRole'
import { api, ApiError } from '../lib/api'
import { useMilestone } from '../lib/useMilestone'
import { ANSWER_PREFIX } from '../lib/ledger'
import type { DeliveryAnswer, Verification } from '../types'

export function ConfirmDeliveryPage() {
  return (
    <RequireRole role="citizen">
      <ConfirmDelivery />
    </RequireRole>
  )
}

const ANSWERS: { value: DeliveryAnswer; label: string; sub: string; cls: string; active: string }[] = [
  {
    value: 'yes',
    label: 'Yes',
    sub: 'I saw it happen',
    cls: 'hover:border-brand-600 hover:bg-brand-50',
    active: 'border-brand-600 bg-brand-50 ring-2 ring-brand-600/20',
  },
  {
    value: 'no',
    label: 'No',
    sub: 'It did not happen',
    cls: 'hover:border-red-400 hover:bg-red-50',
    active: 'border-red-500 bg-red-50 ring-2 ring-red-500/20',
  },
  {
    value: 'not_sure',
    label: 'Not sure',
    sub: "I don't know",
    cls: 'hover:border-slate-400 hover:bg-slate-50',
    active: 'border-slate-500 bg-slate-50 ring-2 ring-slate-400/20',
  },
]

const THANKS: Record<DeliveryAnswer, string> = {
  yes: 'Thank you for confirming the delivery.',
  no: 'Thank you. Your answer will be checked by the municipality and the auditor.',
  not_sure: 'Thank you. Every answer helps.',
}

function ConfirmDelivery() {
  const { milestoneId = '' } = useParams()
  const { milestone, project, isPending, error } = useMilestone(milestoneId)
  const [answer, setAnswer] = useState<DeliveryAnswer | null>(null)
  const [comment, setComment] = useState('')

  // The API stores only { note } for now (answer field REQUESTED from P2), so the answer leads the note.
  const confirm = useMutation({
    mutationFn: (a: DeliveryAnswer) =>
      api.post<Verification[]>(`/milestones/${milestoneId}/confirm`, {
        note: [ANSWER_PREFIX[a], comment.trim()].filter(Boolean).join(' '),
      }),
  })
  const alreadyAnswered =
    confirm.error instanceof ApiError && ['ALREADY_CONFIRMED', 'CONFLICT'].includes(confirm.error.code)

  if (isPending) return <div className="mx-auto h-80 max-w-xl animate-pulse rounded-card bg-white shadow-card" />
  if (error || !milestone) {
    return (
      <div className="mx-auto max-w-xl rounded-card bg-white p-8 shadow-card">
        <p className="font-semibold text-red-700">{error ? 'Could not load the delivery' : 'Delivery not found'}</p>
        <p className="mt-1 text-sm text-slate-500">{error?.message ?? `There is no milestone "${milestoneId}".`}</p>
        <Link to="/projects" className="mt-4 inline-block text-sm font-medium text-brand-700">
          ← All projects
        </Link>
      </div>
    )
  }

  if (confirm.isSuccess || alreadyAnswered) {
    return (
      <div className="mx-auto max-w-lg rounded-card bg-white p-8 text-center shadow-card">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-700">
          ✓
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">
          {alreadyAnswered ? 'You already answered' : 'Answer received'}
        </h1>
        <p className="mt-2 text-slate-600">
          {confirm.isSuccess && answer ? THANKS[answer] : 'Your earlier answer is already recorded.'}
        </p>
        <p className="mt-3 text-xs text-slate-400">Your name is never shown on public pages.</p>
        {project && (
          <Link
            to={`/projects/${project.id}`}
            className="mt-6 inline-block rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Back to {project.name}
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {project && (
        <Link to={`/projects/${project.id}`} className="text-sm font-medium text-slate-500 hover:text-brand-700">
          ← {project.name}
        </Link>
      )}

      <section className="rounded-card bg-white p-6 shadow-card sm:p-8">
        <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          {project?.code} · {milestone.code}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Did the delivery happen?</h1>
        <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-lg font-medium text-slate-800">“{milestone.title}”</p>
        {project && <p className="mt-2 text-sm text-slate-500">{project.location}</p>}

        <div className="mt-6 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Did the delivery happen?">
          {ANSWERS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={answer === a.value}
              onClick={() => setAnswer(a.value)}
              className={`rounded-2xl border-2 p-4 text-left transition sm:text-center ${
                answer === a.value ? a.active : `border-slate-200 ${a.cls}`
              }`}
            >
              <span className="block text-lg font-bold text-slate-900">{a.label}</span>
              <span className="block text-xs text-slate-500">{a.sub}</span>
            </button>
          ))}
        </div>

        <label className="mt-6 block">
          <span className="text-sm font-medium text-slate-700">
            Anything to add? <span className="text-slate-400">(optional)</span>
          </span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="e.g. I saw two tanks installed near the school"
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 focus:outline-none"
          />
        </label>

        {confirm.error && !alreadyAnswered && (
          <p className="mt-4 text-sm text-red-600">Could not send your answer: {confirm.error.message}</p>
        )}

        <button
          onClick={() => answer && confirm.mutate(answer)}
          disabled={!answer || confirm.isPending}
          className="mt-6 w-full rounded-full bg-brand-600 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {confirm.isPending ? 'Sending…' : answer ? 'Send my answer' : 'Choose an answer above'}
        </button>
        <p className="mt-3 text-center text-xs text-slate-400">
          Your name is never shown on public pages.
        </p>
      </section>
    </div>
  )
}
