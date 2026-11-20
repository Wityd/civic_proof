const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-11-18" or an ISO timestamp → "18 Nov 2026"
export function formatDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return value
  return `${d} ${MONTHS[m - 1]} ${y}`
}

// ISO timestamp → "18 Nov 2026, 11:00" (local time)
export function formatDateTime(value: string): string {
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}, ${hh}:${mm}`
}
