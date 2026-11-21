// Multipart part names, as read by supabase/functions/civicproof-api on main.

// POST /invoices
export const INVOICE_UPLOAD_PARTS = {
  file: 'file', // the PDF
  invoice: 'invoice', // JSON string: NewInvoicePayload
} as const

// POST /milestones/:id/evidence
export const EVIDENCE_UPLOAD_PARTS = {
  file: 'file', // JPEG, PNG or WebP
  caption: 'caption', // plain text, optional
} as const

// POST /invoices/extract: the AI reads the PDF and returns a draft. PROPOSED to P3/P4;
// not on the live API yet (the form falls back to manual entry until it is).
export const EXTRACT_PATH = '/invoices/extract'
export const EXTRACT_UPLOAD_PARTS = {
  file: 'file', // the PDF
  project_id: 'project_id', // limits categories to the project's permitted_categories
  supplier_id: 'supplier_id', // which of the user's companies issued it
} as const

export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
