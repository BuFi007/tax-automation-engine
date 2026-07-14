import Decimal from 'decimal.js';
import { z } from 'zod';

// Cotización (FX rate) surface for Factura E. RG 5616/2024 fixes the legal value of
// Moneda_ctz as the BNA "tipo de cambio divisa VENDEDOR" at the close of the día
// hábil cambiario ANTERIOR to issuance (WSFEX errors 1600/1601/2053). ARCA's own
// FEXGetPARAM_Ctz is ORIENTATIVO only — the ±band guardrail behind error 1667
// (WSFEX manual §2.13) — so it is used here as a sanity band, never as the truth.

// ARCA Moneda_ctz format: up to 4 integer + up to 6 fractional digits, strictly > 0.
export const ctzValueSchema = z.string().regex(/^\d{1,4}(?:\.\d{1,6})?$/).refine(value => new Decimal(value).gt(0), { message: 'CTZ_MUST_BE_POSITIVE' });

// ARCA currency ids are short alphanumerics (DOL, PES, …).
export const monIdSchema = z.string().regex(/^[A-Z0-9]{1,3}$/);

export const CTZ_SOURCE_BNA = 'bna_divisa_vendedor' as const;
export const CTZ_SOURCE_ARCA = 'arca_orientativo' as const;
export type CtzSource = typeof CTZ_SOURCE_BNA | typeof CTZ_SOURCE_ARCA;

export const cotizacionResponseSchema = z.object({
  monId: monIdSchema,
  ctz: ctzValueSchema,
  // The date the returned quote corresponds to (ARCA Fch_cotiz on the fallback path).
  date: z.iso.date(),
  // The día hábil cambiario anterior whose BNA divisa vendedor is the LEGAL value —
  // the day a verified BNA feed should be sourced for. Advisory, additive to the
  // pinned {monId,ctz,date} desk contract.
  referenceDate: z.iso.date(),
  // Provenance label so the desk never mistakes an ARCA ORIENTATIVO fallback for the
  // legal BNA rate. `arca_orientativo` until a verified machine-readable BNA feed is wired.
  source: z.enum([CTZ_SOURCE_BNA, CTZ_SOURCE_ARCA]),
}).strict();
export type CotizacionResponse = z.infer<typeof cotizacionResponseSchema>;

// ---------------------------------------------------------------------------
// Error-1667 pre-flight band. ARCA enforces the authoritative band server-side
// against FEXGetPARAM_Ctz; this client-side guardrail rejects gross data-entry
// errors (e.g. 1.0 vs 1200) before a wasted FEXAuthorize. Fractional tolerance,
// env-overridable (must stay ≤ ARCA's real band). Default 10%.
// ---------------------------------------------------------------------------
export const CTZ_BAND_TOLERANCE_DEFAULT = '0.10' as const;
export function ctzBandTolerance(): Decimal {
  const override = process.env.WSFEX_CTZ_BAND_TOLERANCE;
  if (override && /^\d+(?:\.\d+)?$/.test(override)) {
    const tolerance = new Decimal(override);
    if (tolerance.gte(0) && tolerance.lte(1)) return tolerance;
  }
  return new Decimal(CTZ_BAND_TOLERANCE_DEFAULT);
}
export function isWithinCtzBand(quote: string, orientativo: string, tolerance: Decimal = ctzBandTolerance()): boolean {
  const reference = new Decimal(orientativo);
  if (reference.lte(0)) return false;
  const drift = new Decimal(quote).sub(reference).abs().div(reference);
  return drift.lte(tolerance);
}

// ---------------------------------------------------------------------------
// Argentine business-day calendar. Weekends are encoded now; feriados (feriados
// cambiarios) are a documented TODO with a config escape hatch: WSFEX_AR_HOLIDAYS
// is a comma-separated YYYY-MM-DD allowlist of non-business days honored
// immediately. TODO(feriados): swap the env hatch for the official BCRA/ARCA
// feriado-cambiario calendar once a machine-readable source is verified.
// ---------------------------------------------------------------------------
export function argentineHolidays(): ReadonlySet<string> {
  const raw = process.env.WSFEX_AR_HOLIDAYS ?? '';
  return new Set(raw.split(',').map(entry => entry.trim()).filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry)));
}
export function isArgentineBusinessDay(iso: string, holidays: ReadonlySet<string> = argentineHolidays()): boolean {
  // Noon UTC keeps the weekday stable regardless of host timezone.
  const weekday = new Date(`${iso}T12:00:00.000Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false; // Sunday / Saturday
  return !holidays.has(iso);
}
export function previousBusinessDay(iso: string, holidays: ReadonlySet<string> = argentineHolidays()): string {
  let cursor = iso;
  for (let step = 0; step < 30; step += 1) {
    cursor = shiftIsoDate(cursor, -1);
    if (isArgentineBusinessDay(cursor, holidays)) return cursor;
  }
  throw new Error('WSFEX_CTZ_NO_BUSINESS_DAY_FOUND');
}

// "Today" in America/Argentina/Buenos_Aires so a UTC host past 21:00 does not read
// tomorrow's date when validating an ARCA cotización.
export function buenosAiresToday(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('WSFEX_CTZ_OCCURRED_AT_INVALID');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
