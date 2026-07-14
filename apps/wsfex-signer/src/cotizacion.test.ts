import { afterEach, describe, expect, test } from 'bun:test';

import {
  buenosAiresToday,
  cotizacionResponseSchema,
  ctzValueSchema,
  isArgentineBusinessDay,
  isWithinCtzBand,
  monIdSchema,
  previousBusinessDay,
} from './cotizacion';

afterEach(() => {
  delete process.env.WSFEX_CTZ_BAND_TOLERANCE;
  delete process.env.WSFEX_AR_HOLIDAYS;
});

describe('cotización value + monId schemas', () => {
  test('accepts up to 4 integer + 6 fractional digits, > 0', () => {
    expect(ctzValueSchema.parse('1200.250000')).toBe('1200.250000');
    expect(ctzValueSchema.parse('1')).toBe('1');
    expect(() => ctzValueSchema.parse('12000.25')).toThrow(); // 5 integer digits
    expect(() => ctzValueSchema.parse('1200.2500001')).toThrow(); // 7 fractional digits
    expect(() => ctzValueSchema.parse('0')).toThrow('CTZ_MUST_BE_POSITIVE');
  });

  test('monId is 1-3 uppercase alphanumerics', () => {
    expect(monIdSchema.parse('DOL')).toBe('DOL');
    expect(() => monIdSchema.parse('dol')).toThrow();
    expect(() => monIdSchema.parse('DOLLAR')).toThrow();
  });

  test('the ctz response requires a provenance source label', () => {
    const parsed = cotizacionResponseSchema.parse({ monId: 'DOL', ctz: '1200.25', date: '2026-07-10', referenceDate: '2026-07-10', source: 'arca_orientativo' });
    expect(parsed.source).toBe('arca_orientativo');
    expect(() => cotizacionResponseSchema.parse({ monId: 'DOL', ctz: '1200.25', date: '2026-07-10', referenceDate: '2026-07-10' })).toThrow();
  });
});

describe('error-1667 band guardrail', () => {
  test('accepts a quote within the default 10% band and rejects gross drift', () => {
    expect(isWithinCtzBand('1200.25', '1200.00')).toBe(true);
    expect(isWithinCtzBand('1300.00', '1200.00')).toBe(true); // ~8.3%
    expect(isWithinCtzBand('1400.00', '1200.00')).toBe(false); // ~16.7%
    expect(isWithinCtzBand('1.00', '1200.00')).toBe(false); // order-of-magnitude typo
    expect(isWithinCtzBand('1200.00', '0')).toBe(false); // no reference
  });

  test('honours the WSFEX_CTZ_BAND_TOLERANCE override', () => {
    process.env.WSFEX_CTZ_BAND_TOLERANCE = '0.20';
    expect(isWithinCtzBand('1400.00', '1200.00')).toBe(true); // ~16.7% now in band
    process.env.WSFEX_CTZ_BAND_TOLERANCE = 'not-a-number';
    expect(isWithinCtzBand('1400.00', '1200.00')).toBe(false); // falls back to 10%
  });
});

describe('Argentine business-day calendar', () => {
  test('weekends are not business days; weekdays are', () => {
    expect(isArgentineBusinessDay('2026-07-10')).toBe(true); // Friday
    expect(isArgentineBusinessDay('2026-07-11')).toBe(false); // Saturday
    expect(isArgentineBusinessDay('2026-07-12')).toBe(false); // Sunday
    expect(isArgentineBusinessDay('2026-07-13')).toBe(true); // Monday
  });

  test('previous business day skips the weekend: Monday → Friday', () => {
    expect(previousBusinessDay('2026-07-13')).toBe('2026-07-10'); // Monday → prior Friday
    expect(previousBusinessDay('2026-07-14')).toBe('2026-07-13'); // Tuesday → Monday
    expect(previousBusinessDay('2026-07-11')).toBe('2026-07-10'); // Saturday → Friday
  });

  test('WSFEX_AR_HOLIDAYS escape hatch removes a feriado from the business calendar', () => {
    process.env.WSFEX_AR_HOLIDAYS = '2026-07-10';
    expect(isArgentineBusinessDay('2026-07-10')).toBe(false);
    expect(previousBusinessDay('2026-07-13')).toBe('2026-07-09'); // Fri is a feriado → prior Thursday
  });
});

describe('Buenos Aires today', () => {
  test('resolves the AR calendar day, not the UTC one, past 21:00 local', () => {
    // 2026-07-14T01:00Z is 2026-07-13 22:00 in Buenos Aires (UTC-3).
    expect(buenosAiresToday('2026-07-14T01:00:00.000Z')).toBe('2026-07-13');
    expect(buenosAiresToday('2026-07-13T15:00:00.000Z')).toBe('2026-07-13');
  });
});
