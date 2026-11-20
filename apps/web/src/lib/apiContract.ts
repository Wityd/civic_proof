// Names of the multipart parts for POST /invoices.
// PLACEHOLDERS until P2 confirms them. Change here only.
export const INVOICE_UPLOAD_PARTS = {
  file: 'file', // the PDF
  data: 'data', // JSON string: NewInvoicePayload
} as const

export const MAX_PDF_BYTES = 10 * 1024 * 1024

// Names of the multipart parts for POST /milestones/:id/evidence. PLACEHOLDERS until P2 confirms.
export const EVIDENCE_UPLOAD_PARTS = {
  file: 'file', // the photo
  data: 'data', // JSON string: { note }
} as const

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
