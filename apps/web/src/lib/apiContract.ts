// Names of the multipart parts for POST /invoices.
// PLACEHOLDERS until P2 confirms them. Change here only.
export const INVOICE_UPLOAD_PARTS = {
  file: 'file', // the PDF
  data: 'data', // JSON string: NewInvoicePayload
} as const

export const MAX_PDF_BYTES = 10 * 1024 * 1024
