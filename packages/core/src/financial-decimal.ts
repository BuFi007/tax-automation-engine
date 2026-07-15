import DecimalJs from 'decimal.js';

/**
 * Wire money is deliberately bounded so aggregate arithmetic remains exact.
 * The 256 significant-digit context leaves ample headroom above the largest
 * supported aggregate (500,000 records of 60 integer + 30 fractional digits).
 */
export const FINANCIAL_DECIMAL_MAX_INTEGER_DIGITS = 60;
export const FINANCIAL_DECIMAL_MAX_SCALE = 30;
export const FINANCIAL_DECIMAL_RE = /^-?(?:0|[1-9]\d{0,59})(?:\.\d{1,30})?$/;

export const FinancialDecimal = DecimalJs.clone({
  precision: 256,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -256,
  toExpPos: 256,
});

export function isFinancialDecimal(value: string): boolean {
  return FINANCIAL_DECIMAL_RE.test(value);
}
