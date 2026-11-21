import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RequireRole } from '../components/RequireRole'
import { StatusBadge } from '../components/StatusBadge'
import { useViewAs } from '../context/ViewAsContext'
import { api, ApiError } from '../lib/api'
import { EXTRACT_PATH, EXTRACT_UPLOAD_PARTS, INVOICE_UPLOAD_PARTS, MAX_PDF_BYTES } from '../lib/apiContract'
import { formatMoney, parseRandsToCents } from '../lib/money'
import { useProjects, useSuppliers } from '../lib/queries'
import type { ExtractedInvoice, Invoice, NewInvoicePayload } from '../types'

export function NewInvoicePage() {
  return (
    <RequireRole role="supplier">
      <NewInvoiceForm />
    </RequireRole>
  )
}

interface LineDraft {
  key: number
  description: string
  category: string
  quantity: string
  unitPrice: string
  ai: boolean // filled by the AI and not edited since
}

type Errors = Record<string, string>

let nextKey = 1
const emptyLine = (): LineDraft => ({ key: nextKey++, description: '', category: '', quantity: '', unitPrice: '', ai: false })

const categoryLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ')

// The API accepts quantities with up to four decimals (e.g. 12.5 m of pipe).
function parseQuantity(s: string): number | null {
  const clean = s.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,4})?$/.test(clean)) return null
  const q = Number(clean)
  return q > 0 ? q : null
}

// Same rounding as the API's arithmetic check: quantity × unit price, to the nearest cent.
const lineTotalCents = (qty: number, unitCents: number) => Math.round((Math.round(qty * 10000) * unitCents) / 10000)

function pdfError(file: File | null): string | undefined {
  if (!file) return 'Attach the invoice PDF.'
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'The file must be a PDF.'
  if (file.size > MAX_PDF_BYTES) return 'The PDF must be 10 MB or smaller.'
}

const todayIso = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function NewInvoiceForm() {
  const queryClient = useQueryClient()

  const [projectId, setProjectId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()])
  const [file, setFile] = useState<File | null>(null)
  // After the first submit attempt, errors update live as the user fixes fields.
  const [attempted, setAttempted] = useState(false)
  const [aiNotes, setAiNotes] = useState<{ confidence?: number; warnings: string[]; filled: number } | null>(null)

  // POST /invoices needs supplier_id: one of the companies /me says this user may invoice for.
  const { user } = useViewAs()
  const { nameOf } = useSuppliers()
  const ownSupplierIds = user?.supplier_ids ?? []
  const [chosenSupplier, setChosenSupplier] = useState('')
  const supplierId = chosenSupplier || (ownSupplierIds.length === 1 ? ownSupplierIds[0] : '')

  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId)
  const milestones = project?.milestones ?? []
  const today = todayIso()

  const submit = useMutation({
    mutationFn: (form: FormData) => api.post<Invoice>('/invoices', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project'] })
    },
  })

  // ---------- AI reads the PDF ----------

  const extract = useMutation({
    mutationFn: (form: FormData) => api.post<ExtractedInvoice>(EXTRACT_PATH, form),
    onSuccess: (draft) => applyDraft(draft),
  })

  function readWithAi() {
    if (pdfError(file) || !projectId || !supplierId) return
    const hasTyped = lines.some((l) => l.description.trim() || l.quantity || l.unitPrice)
    if (hasTyped && !window.confirm('Replace the line items you typed with what the AI reads from the PDF?')) return
    const form = new FormData()
    form.append(EXTRACT_UPLOAD_PARTS.file, file!)
    form.append(EXTRACT_UPLOAD_PARTS.project_id, projectId)
    form.append(EXTRACT_UPLOAD_PARTS.supplier_id, supplierId)
    extract.mutate(form)
  }

  function applyDraft(draft: ExtractedInvoice) {
    const cats = project?.permitted_categories ?? []
    const warnings = [...(draft.warnings ?? [])]
    if (draft.is_invoice === false) warnings.unshift("This PDF doesn't look like an invoice. Check you attached the right file.")
    if (draft.invoice_number) setInvoiceNumber(draft.invoice_number)
    if (draft.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(draft.invoice_date)) {
      if (draft.invoice_date <= today) setInvoiceDate(draft.invoice_date)
      else warnings.push(`The invoice date (${draft.invoice_date}) is in the future, so it was left empty.`)
    }
    const drafted = draft.line_items.map(
      (l): LineDraft => ({
        key: nextKey++,
        description: l.description,
        category: l.category && cats.includes(l.category) ? l.category : '',
        quantity: String(l.quantity),
        unitPrice: (l.unit_price_cents / 100).toFixed(2),
        ai: true,
      }),
    )
    if (drafted.length) setLines(drafted)
    else warnings.push('The AI found no line items. Please add them yourself.')
    const sum = draft.line_items.reduce((s, l) => s + lineTotalCents(l.quantity, l.unit_price_cents), 0)
    if (draft.total_cents !== null && drafted.length && Math.abs(sum - draft.total_cents) > 1) {
      warnings.push(`The lines add up to ${formatMoney(sum)}, but the invoice total says ${formatMoney(draft.total_cents)}.`)
    }
    setAiNotes({ confidence: draft.confidence, warnings, filled: drafted.length })
  }

  // Friendly message for each way the AI step can fail; the form always stays usable.
  let extractProblem: string | null = null
  if (extract.error) {
    const code = extract.error instanceof ApiError ? extract.error.code : ''
    extractProblem =
      code === 'NOT_FOUND' || code === 'NOT_MOCKED'
        ? "Reading invoices with AI isn't switched on yet. Please fill in the details below."
        : code === 'EXTRACTION_FAILED'
          ? 'The AI could not read this invoice. Please fill in the details below.'
          : `The AI step failed (${extract.error.message}). Please fill in the details below.`
  }

  // ---------- form helpers ----------

  const lineTotals = lines.map((l) => {
    const qty = parseQuantity(l.quantity)
    const unit = parseRandsToCents(l.unitPrice)
    return qty !== null && unit !== null ? lineTotalCents(qty, unit) : null
  })
  const totalCents = lineTotals.reduce<number>((sum, t) => sum + (t ?? 0), 0)

  // Editing an AI-filled line means the supplier has checked it, so the tag goes.
  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch, ai: false } : l)))
  }

  function chooseProject(id: string) {
    setProjectId(id)
    setMilestoneId('')
    // Categories depend on the project, so clear any that no longer fit.
    const cats = projects.data?.find((p) => p.id === id)?.permitted_categories ?? []
    setLines((ls) => ls.map((l) => (cats.includes(l.category) ? l : { ...l, category: '' })))
  }

  function chooseFile(f: File | null) {
    setFile(f)
    extract.reset()
    setAiNotes(null)
  }

  function validate(): Errors {
    const e: Errors = {}
    if (ownSupplierIds.length === 0) e.supplier = 'Your account is not linked to a supplier, so invoices cannot be submitted.'
    else if (!supplierId) e.supplier = 'Choose which company is invoicing.'
    if (!projectId) e.project = 'Choose a project.'
    if (!invoiceNumber.trim()) e.invoiceNumber = 'Enter the invoice number.'
    if (!invoiceDate) e.invoiceDate = 'Enter the invoice date.'
    lines.forEach((l) => {
      if (!l.description.trim()) e[`desc-${l.key}`] = 'Required'
      if (!l.category) e[`cat-${l.key}`] = 'Required'
      if (parseQuantity(l.quantity) === null) e[`qty-${l.key}`] = 'A number above 0'
      const unit = parseRandsToCents(l.unitPrice)
      if (unit === null || unit <= 0) e[`price-${l.key}`] = 'Enter an amount, e.g. 12000.00'
    })
    const fileProblem = pdfError(file)
    if (fileProblem) e.file = fileProblem
    return e
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setAttempted(true)
    if (Object.keys(validate()).length > 0) return

    const payload: NewInvoicePayload = {
      project_id: projectId,
      supplier_id: supplierId,
      invoice_number: invoiceNumber.trim(),
      invoice_date: invoiceDate,
      milestone_id: milestoneId || null,
      line_items: lines.map((l, i) => ({
        description: l.description.trim(),
        category: l.category,
        reference_sku: null, // the API matches lines to the price catalogue itself
        quantity: parseQuantity(l.quantity)!,
        unit_price_cents: parseRandsToCents(l.unitPrice)!,
        line_total_cents: lineTotals[i]!,
      })),
      total_cents: totalCents,
    }
    const form = new FormData()
    form.append(INVOICE_UPLOAD_PARTS.file, file!)
    form.append(INVOICE_UPLOAD_PARTS.invoice, JSON.stringify(payload))
    submit.mutate(form)
  }

  function reset() {
    setChosenSupplier('')
    setProjectId('')
    setInvoiceNumber('')
    setInvoiceDate('')
    setMilestoneId('')
    setLines([emptyLine()])
    setFile(null)
    setAttempted(false)
    setAiNotes(null)
    extract.reset()
    submit.reset()
  }

  if (submit.isSuccess) return <SubmittedCard invoice={submit.data} onAnother={reset} />

  const errors = attempted ? validate() : {}
  const hasErrors = Object.keys(errors).length > 0
  const aiBlocker = pdfError(file)
    ? 'Choose the invoice PDF first.'
    : !supplierId
      ? 'Choose your company first.'
      : !projectId
        ? 'Choose the project first.'
        : null
  const pendingAiLines = lines.filter((l) => l.ai).length

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Submit an invoice</h1>
        <p className="mt-1 text-slate-500">
          Upload your invoice and let the AI fill in the details. Check them, then submit. A municipality officer then
          approves, holds or rejects it.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {/* Step 1: upload */}
        <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
          <StepTitle n={1} title="Upload the invoice" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {ownSupplierIds.length > 1 && (
              <Field label="Submitting as" error={errors.supplier}>
                <select
                  value={chosenSupplier}
                  onChange={(e) => setChosenSupplier(e.target.value)}
                  className={inputCls(errors.supplier)}
                >
                  <option value="">Choose your company</option>
                  {ownSupplierIds.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(id)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              label="Project"
              error={errors.project ?? (projects.error ? `Could not load projects: ${projects.error.message}` : undefined)}
            >
              <select
                value={projectId}
                onChange={(e) => chooseProject(e.target.value)}
                className={inputCls(errors.project)}
                disabled={projects.isPending || !!projects.error}
              >
                <option value="">
                  {projects.isPending ? 'Loading…' : projects.error ? 'Projects unavailable' : 'Choose a project'}
                </option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
              errors.file ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-brand-600 hover:bg-brand-50'
            }`}
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <span className="font-medium text-slate-900">{file.name}</span>
                <span className="text-xs text-slate-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · click to change
                </span>
              </>
            ) : (
              <>
                <span className="font-medium text-slate-700">Click to choose the invoice PDF</span>
                <span className="text-xs text-slate-500">PDF only, up to 10 MB</span>
              </>
            )}
          </label>
          {errors.file && <p className="mt-2 text-sm text-red-600">{errors.file}</p>}
          <p className="mt-2 text-xs text-slate-500">
            Its fingerprint (hash) is recorded on the ledger, so it can't be quietly changed later.
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={readWithAi}
              disabled={!!aiBlocker || extract.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-navy-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {extract.isPending ? <Spinner /> : <span aria-hidden="true">✨</span>}
              {extract.isPending ? 'Reading your invoice…' : 'Read invoice with AI'}
            </button>
            <p className="text-sm text-slate-500">
              {extract.isPending
                ? 'This takes a few seconds.'
                : (aiBlocker ?? 'The AI fills in the details below. You can also type them yourself.')}
            </p>
          </div>

          {extractProblem && (
            <p role="alert" className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
              {extractProblem}
            </p>
          )}

          {aiNotes && (
            <div role="status" className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm">
              <p className="font-semibold text-violet-900">
                The AI filled in {aiNotes.filled} line{aiNotes.filled === 1 ? '' : 's'}
                {aiNotes.confidence !== undefined && <> (confidence {Math.round(aiNotes.confidence * 100)}%)</>}.
              </p>
              <p className="mt-1 text-violet-800">
                Check every field against your invoice before submitting. The AI can make mistakes.
              </p>
              {aiNotes.warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900">
                  {aiNotes.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Step 2: details */}
        <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
          <StepTitle n={2} title="Check the details" />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Invoice number" error={errors.invoiceNumber}>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="e.g. BB-1040"
                className={inputCls(errors.invoiceNumber)}
              />
            </Field>
            <Field label="Invoice date" error={errors.invoiceDate}>
              <input
                type="date"
                value={invoiceDate}
                max={today}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={inputCls(errors.invoiceDate)}
              />
            </Field>
            <Field label="Linked milestone (optional)">
              <select
                value={milestoneId}
                onChange={(e) => setMilestoneId(e.target.value)}
                className={inputCls()}
                disabled={!projectId || milestones.length === 0}
              >
                <option value="">
                  {!projectId ? 'Choose a project first' : milestones.length ? 'None' : 'No milestones'}
                </option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        {/* Step 3: line items */}
        <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
          <StepTitle n={3} title="Check the line items" />
          {pendingAiLines > 0 && (
            <p className="mt-1 text-xs text-violet-700">
              Lines marked “AI filled” come from the PDF. Editing a line marks it as checked.
            </p>
          )}

          <div className="mt-4 hidden grid-cols-[1fr_10rem_6rem_9rem_8rem_2rem] gap-3 px-1 text-xs font-semibold text-slate-500 uppercase md:grid">
            <span>Description</span>
            <span>Category</span>
            <span>Qty</span>
            <span>Unit price (R)</span>
            <span className="text-right">Line total</span>
            <span />
          </div>

          <ul className="mt-2 space-y-4 md:space-y-2">
            {lines.map((l, i) => (
              <li
                key={l.key}
                className={`grid grid-cols-2 gap-3 rounded-2xl p-3 md:grid-cols-[1fr_10rem_6rem_9rem_8rem_2rem] md:items-start md:p-0 ${
                  l.ai ? 'bg-violet-50/60 md:bg-transparent' : 'bg-slate-50 md:bg-transparent'
                }`}
              >
                <CellField className="col-span-2 md:col-span-1" label="Description" error={errors[`desc-${l.key}`]}>
                  <input
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    placeholder="e.g. 10,000 L water tank"
                    className={inputCls(errors[`desc-${l.key}`])}
                  />
                  {l.ai && (
                    <span className="mt-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                      AI filled · please check
                    </span>
                  )}
                </CellField>
                <CellField className="col-span-2 md:col-span-1" label="Category" error={errors[`cat-${l.key}`]}>
                  <select
                    value={l.category}
                    onChange={(e) => updateLine(l.key, { category: e.target.value })}
                    disabled={!project}
                    className={inputCls(errors[`cat-${l.key}`])}
                  >
                    <option value="">{project ? 'Choose' : 'Project first'}</option>
                    {project?.permitted_categories.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </select>
                </CellField>
                <CellField label="Qty" error={errors[`qty-${l.key}`]}>
                  <input
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                    placeholder="8"
                    className={inputCls(errors[`qty-${l.key}`])}
                  />
                </CellField>
                <CellField label="Unit price (R)" error={errors[`price-${l.key}`]}>
                  <input
                    inputMode="decimal"
                    value={l.unitPrice}
                    onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                    placeholder="14800.00"
                    className={inputCls(errors[`price-${l.key}`])}
                  />
                </CellField>
                <div className="flex items-center justify-between md:block md:pt-2.5 md:text-right">
                  <span className="text-xs text-slate-500 md:hidden">Line total</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {lineTotals[i] !== null ? formatMoney(lineTotals[i]!) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-end md:pt-1.5">
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    disabled={lines.length === 1}
                    aria-label="Remove line"
                    className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, emptyLine()])}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              + Add line
            </button>
            <div className="text-right">
              <p className="text-xs text-slate-500">Invoice total</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{formatMoney(totalCents)}</p>
            </div>
          </div>
        </section>

        {/* Submit */}
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
          {hasErrors && (
            <p className="text-sm text-red-600 sm:mr-auto">{errors.supplier ?? 'Please fix the fields marked in red.'}</p>
          )}
          {!hasErrors && pendingAiLines > 0 && (
            <p className="text-sm text-violet-800 sm:mr-auto">
              {pendingAiLines} AI-filled line{pendingAiLines === 1 ? '' : 's'} not edited yet. Make sure they match your
              invoice.
            </p>
          )}
          {submit.error && (
            <p className="text-sm text-red-600 sm:mr-auto">Could not submit: {submit.error.message}</p>
          )}
          <button
            type="submit"
            disabled={submit.isPending}
            className="rounded-full bg-brand-600 px-8 py-3 font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            {submit.isPending ? 'Submitting…' : `Submit invoice · ${formatMoney(totalCents)}`}
          </button>
        </div>
      </form>
    </div>
  )
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-lg font-bold">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-sm text-white">{n}</span>
      {title}
    </h2>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function SubmittedCard({ invoice, onAnother }: { invoice: Invoice; onAnother: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-card bg-white p-8 text-center shadow-card">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-700">
        ✓
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-900">Invoice {invoice.invoice_number} submitted</h1>
      <p className="mt-1 text-3xl font-bold text-slate-900 tabular-nums">{formatMoney(invoice.total_cents)}</p>
      <div className="mt-3">
        <StatusBadge status={invoice.status} />
      </div>
      <p className="mt-4 text-sm text-slate-500">
        Your document's fingerprint is recorded on the ledger. Next, the AI checks it and a municipality officer
        decides.
      </p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Link
          to="/supplier/invoices"
          className="rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          View my invoices
        </Link>
        <button
          onClick={onAnother}
          className="rounded-full border border-slate-200 px-6 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Submit another
        </button>
      </div>
    </div>
  )
}

function inputCls(error?: string) {
  return `w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 ${
    error ? 'border-red-300 focus:ring-red-200' : 'border-slate-200 focus:border-brand-600 focus:ring-brand-600/20'
  }`
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

// Label only shows on mobile; the table header covers it on wider screens.
function CellField({
  label,
  error,
  className = '',
  children,
}: {
  label: string
  error?: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500 md:sr-only">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}
