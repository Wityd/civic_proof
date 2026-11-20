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

export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
