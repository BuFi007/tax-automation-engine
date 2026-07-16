import type { Period } from '../types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function taxYear(period: Period): number {
  const start = parseIsoDate(period.start);
  const end = parseIsoDate(period.end);
  if (start.getUTCFullYear() !== end.getUTCFullYear()) throw new Error('PERIOD_MUST_USE_ONE_CALENDAR_YEAR');
  return end.getUTCFullYear();
}

export function localEndOfDay(date: string, offset: '-03:00' | '-05:00' | '-04:00'): string {
  parseIsoDate(date);
  return `${date}T23:59:59${offset}`;
}

export function nextMonth(period: Period): Readonly<{ year: number; month: number }> {
  const end = parseIsoDate(period.end);
  const month = end.getUTCMonth() + 2;
  if (month === 13) return { year: end.getUTCFullYear() + 1, month: 1 };
  return { year: end.getUTCFullYear(), month };
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function parseIsoDate(value: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error('INVALID_ISO_DATE');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new Error('INVALID_ISO_DATE');
  return date;
}
