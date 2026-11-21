import { describe, expect, it } from 'vitest'
import { formatMoney, parseRandsToCents, splitMoney } from './money'

describe('formatMoney: integer cents → "R2,000,000.00"', () => {
  it.each([
    [200000000, 'R2,000,000.00'],
    [188160000, 'R1,881,600.00'],
    [13600000, 'R136,000.00'],
    [11840000, 'R118,400.00'],
    [5, 'R0.05'],
    [0, 'R0.00'],
    [-13600000, '-R136,000.00'],
  ])('%i cents → %s', (cents, text) => {
    expect(formatMoney(cents)).toBe(text)
  })

  it('splits rands and cents for display', () => {
    expect(splitMoney(181760000)).toEqual({ rands: 'R1,817,600', cents: '.00' })
  })
})

describe('parseRandsToCents: what a supplier types → integer cents', () => {
  it.each([
    ['12000', 1200000],
    ['12,000.00', 1200000],
    ['R12 000.5', 1200050],
    ['r 5200', 520000],
    ['0.05', 5],
  ])('"%s" → %i', (input, cents) => {
    expect(parseRandsToCents(input)).toBe(cents)
  })

  it.each(['', 'abc', '12.345', '-5', '1e5', '12..0', 'R'])('rejects "%s"', (input) => {
    expect(parseRandsToCents(input)).toBeNull()
  })

  it('never produces fractions of a cent (no floating-point money)', () => {
    for (const input of ['0.1', '0.2', '19.99', '1234567.89']) {
      expect(Number.isInteger(parseRandsToCents(input))).toBe(true)
    }
    expect(parseRandsToCents('19.99')).toBe(1999)
  })
})
