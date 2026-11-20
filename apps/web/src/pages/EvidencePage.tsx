import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { RequireRole } from '../components/RequireRole'
import { api, ApiError } from '../lib/api'
import { EVIDENCE_UPLOAD_PARTS, MAX_PHOTO_BYTES } from '../lib/apiContract'
import { useMilestone } from '../lib/useMilestone'
import type { Evidence } from '../types'

export function EvidencePage() {
  return (
    <RequireRole role="supplier">
      <EvidenceForm />
    </RequireRole>
  )
}

function EvidenceForm() {
  const { milestoneId = '' } = useParams()
  const queryClient = useQueryClient()
  const { milestone, project, isPending, error } = useMilestone(milestoneId)

  const [photo, setPhoto] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [photoError, setPhotoError] = useState('')

  // Show a preview of the chosen photo, and free the memory when it changes.
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const upload = useMutation({
    mutationFn: (form: FormData) => api.post<Evidence>(`/milestones/${milestoneId}/evidence`, form),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project'] }),
  })

  const isDuplicate =
    (upload.error instanceof ApiError && upload.error.code === 'DUPLICATE_EVIDENCE') ||
    !!upload.data?.flags.includes('DUPLICATE_EVIDENCE')

  function choosePhoto(f: File | null) {
    upload.reset()
    setPhotoError('')
    if (f && !f.type.startsWith('image/')) {
      setPhotoError('Please choose a photo (JPG or PNG).')
      return setPhoto(null)
    }
    if (f && f.size > MAX_PHOTO_BYTES) {
      setPhotoError('The photo must be 10 MB or smaller.')
      return setPhoto(null)
    }
    setPhoto(f)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!photo) return setPhotoError('Choose a photo of the delivery first.')
    const form = new FormData()
    form.append(EVIDENCE_UPLOAD_PARTS.file, photo)
    form.append(EVIDENCE_UPLOAD_PARTS.data, JSON.stringify({ note: note.trim() || null }))
    upload.mutate(form)
  }

  if (isPending) return <div className="mx-auto h-96 max-w-2xl animate-pulse rounded-card bg-white shadow-card" />
  if (error || !milestone) {
    return (
      <div className="mx-auto max-w-2xl rounded-card bg-white p-8 shadow-card">
        <p className="font-semibold text-red-700">{error ? 'Could not load the milestone' : 'Milestone not found'}</p>
        <p className="mt-1 text-sm text-slate-500">{error?.message ?? `There is no milestone "${milestoneId}".`}</p>
        <Link to="/supplier/invoices" className="mt-4 inline-block text-sm font-medium text-brand-700">
          ← My invoices
        </Link>
      </div>
    )
  }

  // Success (and not flagged as duplicate)
  if (upload.isSuccess && !isDuplicate) {
    return (
      <div className="mx-auto max-w-lg rounded-card bg-white p-8 text-center shadow-card">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-700">
          ✓
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">Evidence submitted</h1>
        <p className="mt-2 text-sm text-slate-500">
          The photo for <b>{milestone.id}</b> (“{milestone.title}”) is recorded. Next, the municipality and residents
          confirm the delivery.
        </p>
        <p className="mt-3 font-mono text-xs break-all text-slate-400">Photo fingerprint: {upload.data.photo_hash}</p>
        <Link
          to="/supplier/invoices"
          className="mt-6 inline-block rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Back to my invoices
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/supplier/invoices" className="text-sm font-medium text-slate-500 hover:text-brand-700">
        ← My invoices
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Upload delivery evidence</h1>
        <p className="mt-1 text-slate-500">
          {project?.name} · <b>{milestone.id}</b>: {milestone.title}
        </p>
      </div>

      {milestone.status === 'verified' ? (
        <div className="rounded-card bg-white p-6 shadow-card">
          <p className="font-semibold text-brand-700">This milestone is already verified</p>
          <p className="mt-1 text-sm text-slate-500">No more evidence is needed.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-6 rounded-card bg-white p-5 shadow-card sm:p-6">
          {milestone.status === 'evidence_submitted' && (
            <p className="rounded-2xl bg-sky-50 p-3 text-sm text-sky-800">
              Evidence was already submitted for this milestone. You can add another photo.
            </p>
          )}

          <div>
            <p className="text-sm font-medium text-slate-700">Photo of the delivery</p>
            <label
              className={`mt-1.5 flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed text-center transition ${
                photoError ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-brand-600 hover:bg-brand-50'
              } ${preview ? 'p-2' : 'p-8'}`}
            >
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
              />
              {preview ? (
                <>
                  <img src={preview} alt="Chosen delivery photo" className="max-h-72 w-full rounded-xl object-contain" />
                  <span className="mt-2 text-xs text-slate-500">{photo?.name} · click to change</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-slate-700">Click to choose a photo</span>
                  <span className="text-xs text-slate-500">
                    JPG or PNG, up to 10 MB. Show the installed tanks clearly.
                  </span>
                </>
              )}
            </label>
            {photoError && <p className="mt-2 text-sm text-red-600">{photoError}</p>}
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Note <span className="text-slate-400">(optional)</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Site 2 of 4: 2 tanks installed and connected"
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 focus:outline-none"
            />
          </label>

          {isDuplicate && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="font-semibold text-red-800">Duplicate evidence</p>
              <p className="mt-1 text-sm text-red-700">
                This exact photo was already submitted before. Reused photos cannot prove a new delivery. Please take
                a new photo at the site.
              </p>
            </div>
          )}
          {upload.error && !isDuplicate && (
            <p className="text-sm text-red-600">Could not upload: {upload.error.message}</p>
          )}

          <button
            type="submit"
            disabled={upload.isPending}
            className="w-full rounded-full bg-brand-600 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {upload.isPending ? 'Uploading…' : 'Submit evidence'}
          </button>
        </form>
      )}
    </div>
  )
}
