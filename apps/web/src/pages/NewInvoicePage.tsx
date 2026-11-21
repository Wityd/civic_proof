import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RequireRole } from '../components/RequireRole'
import { StatusBadge } from '../components/StatusBadge'
import { api } from '../lib/api'
import { INVOICE_UPLOAD_PARTS, MAX_PDF_BYTES } from '../lib/apiContract'
import { formatMoney, parseRandsToCents } from '../lib/money'
import { useViewAs } from '../context/ViewAsContext'
import { useProjects, useSuppliers } from '../lib/queries'
import type { Invoice, NewInvoicePayload } from '../types'

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
}

type Errors = Record<string, string>

let nextKey = 1
const emptyLine = (): LineDraft => ({ key: nextKey++, description: '', category: '', quantity: '', unitPrice: '' })

const categoryLabel =(c: string) => c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ')

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

  // POST /invoices needs supplier_id: one of the companies /me says this user may invoice for.
  const { user } = useViewAs()
  const { nameOf } = useSuppliers()
  const ownSupplierIds = user?.supplier_ids ?? []
  const [chosenSupplier, setChosenSupplier] = useState('')
  const supplierId = chosenSupplier || (ownSupplierIds.length === 1 ? ownSupplierIds[0] : '')

  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId)
  const milestones = project?.milestones ?? []

  const submit = useMutation({
    mutationFn: (form: FormData) => api.post<Invoice>('/invoices', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project'] })
    },
  })

  const lineTotals = lines.map((l) => {
    const qty = Number(l.quantity)
    const unit = parseRandsToCents(l.unitPrice)
    return Number.isInteger(qty) && qty > 0 && unit !== null ? qty * unit : null
  })
  const totalCents = lineTotals.reduce<number>((sum, t) => sum + (t ?? 0), 0)

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function chooseProject(id: string) {
    setProjectId(id)
    setMilestoneId('')
    // Categories depend on the project, so clear any that no longer fit.
    const cats = projects.data?.find((p) => p.id === id)?.permitted_categories ?? []
    setLines((ls) => ls.map((l) => (cats.includes(l.category) ? l : { ...l, category: '' })))
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
      const qty = Number(l.quantity)
      if (!Number.isInteger(qty) || qty <= 0) e[`qty-${l.key}`] = 'Whole number above 0'
      const unit = parseRandsToCents(l.unitPrice)
      if (unit === null || unit <= 0) e[`price-${l.key}`] = 'Enter an amount, e.g. 12000.00'
    })
    if (!file) e.file = 'Attach the invoice PDF.'
    else if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
      e.file = 'The file must be a PDF.'
    else if (file.size > MAX_PDF_BYTES) e.file = 'The PDF must be 10 MB or smaller.'
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
        reference_sku: null,
        quantity: Number(l.quantity),
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
    submit.reset()
  }

  if (submit.isSuccess) return <SubmittedCard invoice={submit.data} onAnother={reset} />

  const errors = attempted ? validate() : {}
  const hasErrors = Object.keys(errors).length > 0
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Submit an invoice</h1>
        <p className="mt-1 text-slate-500">
          The AI checks it first. A municipality officer then approves, holds or rejects it.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {/* Details */}
        <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-bold">Details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {ownSupplierIds.length > 1 && (
              <div className="sm:col-span-2">
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
              </div>
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
          </div>
        </section>

        {/* Line items */}
        <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-bold">Line items</h2>

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
                className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3 md:grid-cols-[1fr_10rem_6rem_9rem_8rem_2rem] md:items-start md:bg-transparent md:p-0"
              >
                <CellField className="col-span-2 md:col-span-1" label="Description" error={errors[`desc-${l.key}`]}>
                  <input
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    placeholder="e.g. 10,000 L water tank"
                    className={inputCls(errors[`desc-${l.key}`])}
                  />
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
                    inputMode="numeric"
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

        {/* PDF */}
        <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-bold">Invoice PDF</h2>
          <p className="text-sm text-slate-500">
            Its fingerprint (hash) is recorded on the ledger, so it can't be quietly changed later.
          </p>
          <label
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
              errors.file ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-brand-600 hover:bg-brand-50'
            }`}
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
                <span className="font-medium text-slate-700">Click to choose a PDF</span>
                <span className="text-xs text-slate-500">PDF only, up to 10 MB</span>
              </>
            )}
          </label>
          {errors.file && <p className="mt-2 text-sm text-red-600">{errors.file}</p>}
        </section>

        {/* Submit */}
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
          {hasErrors && (
            <p className="text-sm text-red-600 sm:mr-auto">{errors.supplier ?? 'Please fix the fields marked in red.'}</p>
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
