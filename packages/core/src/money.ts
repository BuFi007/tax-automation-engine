import Decimal from 'decimal.js';

import type { EvidenceMoney } from './types';

const CURRENCY_RE = /^[A-Z]{3}$/;
const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function money(decimal: string, currency: string): EvidenceMoney {
  if (!DECIMAL_RE.test(decimal)) throw new Error(`Invalid decimal money: ${decimal}`);
  if (!CURRENCY_RE.test(currency)) throw new Error(`Invalid currency: ${currency}`);
  const value = new Decimal(decimal);
  if (!value.isFinite()) throw new Error('Money must be finite');
  return Object.freeze({ decimal: value.toFixed(), currency });
}

export function addMoney(left: EvidenceMoney, right: EvidenceMoney): EvidenceMoney {
  assertSameCurrency(left, right);
  return money(new Decimal(left.decimal).plus(right.decimal).toFixed(), left.currency);
}

export function subtractMoney(left: EvidenceMoney, right: EvidenceMoney): EvidenceMoney {
  assertSameCurrency(left, right);
  return money(new Decimal(left.decimal).minus(right.decimal).toFixed(), left.currency);
}

export function multiplyMoney(value: EvidenceMoney, multiplier: string): EvidenceMoney {
  if (!DECIMAL_RE.test(multiplier)) throw new Error(`Invalid decimal multiplier: ${multiplier}`);
  return money(new Decimal(value.decimal).times(multiplier).toFixed(), value.currency);
}

export function compareMoney(left: EvidenceMoney, right: EvidenceMoney): number {
  assertSameCurrency(left, right);
  return new Decimal(left.decimal).cmp(right.decimal);
}

export function sumMoney(values: readonly EvidenceMoney[], currency: string): EvidenceMoney {
  return values.reduce((total, value) => addMoney(total, value), money('0', currency));
}

function assertSameCurrency(left: EvidenceMoney, right: EvidenceMoney): void {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: ${left.currency} != ${right.currency}`);
  }
}
