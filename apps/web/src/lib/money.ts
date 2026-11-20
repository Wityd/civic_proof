// Money is always integer cents. We format by hand because Intl 'en-ZA'
// gives "R 2 000 000,00" and we want "R2,000,000.00".

export function splitMoney(cents: number): { rands: string; cents: string } {
  const negative = cents < 0
  const abs = Math.round(Math.abs(cents))
  const rands = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const c = (abs % 100).toString().padStart(2, '0')
  return { rands: `${negative ? '-' : ''}R${rands}`, cents: `.${c}` }
}

export function formatMoney(cents: number): string {
  const { rands, cents: c } = splitMoney(cents)
  return rands + c
}

// "12000", "12,000.00", "R12 000.5" → cents. Returns null if it isn't a valid amount.
export function parseRandsToCents(input: string): number | null {
  const clean = input.replace(/[R\s,]/gi, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  const [whole, frac = ''] = clean.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}
