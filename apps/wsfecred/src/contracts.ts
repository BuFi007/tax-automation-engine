// isValidCuit is the shared CUIT/CUIL check-digit validator; imported (not
// forked) so every ARCA client agrees on the algorithm.
import { isValidCuit } from '@tax-engine/wsfex-signer/contracts';
import { z } from 'zod';

export { isValidCuit };

// ---------------------------------------------------------------------------
// Comprobante coordinates. FCE MiPyMEs uses the RG 4367 comprobante-type codes
// (FEParamGetTiposCbte): Factura/ND/NC de Crédito Electrónica MiPyMEs in the A,
// B and C classes. This read-only client only speaks lifecycle for those types.
// ---------------------------------------------------------------------------
export const FCE_COMPROBANTE_TYPES = [201, 202, 203, 206, 207, 208, 211, 212, 213] as const;
export type FceComprobanteType = (typeof FCE_COMPROBANTE_TYPES)[number];

const cuitSchema = z.string().regex(/^\d{11}$/).refine(isValidCuit, { message: 'CUIT_CHECK_DIGIT_INVALID' });
const pointOfSaleSchema = z.number().int().positive().max(99998);
const invoiceNumberSchema = z.string().regex(/^[1-9]\d{0,7}$/);
const comprobanteTypeSchema = z
  .number()
  .int()
  .refine((value): value is FceComprobanteType => (FCE_COMPROBANTE_TYPES as readonly number[]).includes(value), {
    message: 'FCE_COMPROBANTE_TYPE_UNSUPPORTED',
  });

// The pinned path is /v1/wsfecred/invoices/{cuitEmisor}/{ptoVta}/{cbteTipo}/{cbteNro}/lifecycle.
export const lifecycleCoordinatesSchema = z.object({
  cuitEmisor: cuitSchema,
  pointOfSale: pointOfSaleSchema,
  comprobanteType: comprobanteTypeSchema,
  invoiceNumber: invoiceNumberSchema,
}).strict();
export type LifecycleCoordinates = z.infer<typeof lifecycleCoordinatesSchema>;

// Parse the four raw path segments into validated coordinates. Kept here so the
// HTTP layer stays a thin router.
export function parseLifecycleCoordinates(segments: Readonly<{ cuitEmisor: string; pointOfSale: string; comprobanteType: string; invoiceNumber: string }>): LifecycleCoordinates {
  return lifecycleCoordinatesSchema.parse({
    cuitEmisor: segments.cuitEmisor,
    pointOfSale: toInteger(segments.pointOfSale, 'WSFECRED_POINT_OF_SALE_INVALID'),
    comprobanteType: toInteger(segments.comprobanteType, 'WSFECRED_COMPROBANTE_TYPE_INVALID'),
    invoiceNumber: segments.invoiceNumber,
  });
}

function toInteger(value: string, code: string): number {
  if (!/^\d+$/.test(value)) throw new Error(code);
  return Number(value);
}

// ---------------------------------------------------------------------------
// Desk-facing lifecycle state. ARCA does NOT expose a single estado covering the
// whole lifecycle: acceptance form is a separate `tipoAcep` field, cancellation
// lives on the cuenta corriente, and there is no `cedida` estado at all (a
// cesión is executed outside AFIP; wsfecred only reports the transfer *option*).
// This client derives one desk state from the ARCA tuple. `cedida` is reserved
// in the contract but never emitted — see mapLifecycleState.
// ---------------------------------------------------------------------------
export const LIFECYCLE_STATES = ['emitida', 'aceptada_expresa', 'aceptada_tacita', 'rechazada', 'cancelada', 'cedida', 'unknown'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];
export const lifecycleStateSchema = z.enum(LIFECYCLE_STATES);

// Verbatim ARCA simple-type values (WSFECRED manual v2.0.3 §3.1).
export const ESTADO_CMP = ['PendienteRecepcion', 'Recepcionado', 'Aceptado', 'Rechazado', 'InformadaAgDpto'] as const;
export const ESTADO_CTA_CTE = ['Modificable', 'Aceptada', 'Rechazada', 'CanceladaTotal', 'InformadaAgDpto'] as const;
export const TIPO_ACEPTACION = ['Tacita', 'Expresa'] as const;
export const OPCION_TRANSFERENCIA = ['ADC', 'SCA'] as const;

// The safe subset published to Motora. Document coordinates + amounts + ARCA's
// own raw estado strings — never the receptor CUIT/DocNro or any counterparty PII.
export const lifecycleRawSchema = z.object({
  estadoComprobante: z.string().nullable(),
  estadoCtaCte: z.string().nullable(),
  tipoAceptacion: z.string().nullable(),
  opcionTransferencia: z.string().nullable(),
  fechaEmision: z.string().nullable(),
  codMoneda: z.string().nullable(),
  importeTotal: z.string().nullable(),
  saldoAceptado: z.string().nullable(),
  codCtaCte: z.string().nullable(),
  // Derived countdown anchor: emission + FCE_ACCEPTANCE_WINDOW_DAYS días corridos.
  // A fallback only — ARCA's top-level `fchVtoAceptacion` is authoritative when
  // present. Null when there is no usable emission date.
  fchVtoAceptacionEstimado: z.string().nullable(),
}).strict();
export type LifecycleRaw = z.infer<typeof lifecycleRawSchema>;

export const lifecycleResponseSchema = z.object({
  schema: z.literal('motora-wsfecred-lifecycle-v1'),
  cuitEmisor: cuitSchema,
  pointOfSale: pointOfSaleSchema,
  comprobanteType: comprobanteTypeSchema,
  invoiceNumber: invoiceNumberSchema,
  estado: lifecycleStateSchema,
  // ARCA `fechaVenAcep`: the authoritative tacit-acceptance due date when present.
  fchVtoAceptacion: z.string().nullable(),
  // ARCA `fechaHoraAcep`: timestamp of an express acceptance or a rejection.
  fchAceptacion: z.string().nullable(),
  // ARCA cuenta-corriente `saldoAceptado`.
  montoAceptado: z.string().nullable(),
  raw: lifecycleRawSchema,
}).strict();
export type LifecycleResponse = z.infer<typeof lifecycleResponseSchema>;

// Normalized fields lifted out of the ARCA SOAP tuple (soap.ts owns decoding).
export type NormalizedLifecycle = Readonly<{
  estadoComprobante: string | null;
  estadoCtaCte: string | null;
  tipoAceptacion: string | null;
  opcionTransferencia: string | null;
  fechaEmision: string | null;
  fechaHoraAcep: string | null;
  fechaVenAcep: string | null;
  codMoneda: string | null;
  importeTotal: string | null;
  saldoAceptado: string | null;
  codCtaCte: string | null;
}>;

// Pure ARCA-tuple -> desk-state mapping. Priority runs most-terminal first so a
// cancelled or rejected credit never reads as merely "accepted".
export function mapLifecycleState(input: NormalizedLifecycle): LifecycleState {
  const ctaCte = input.estadoCtaCte;
  const comprobante = input.estadoComprobante;
  // A full cancellation is a cuenta-corriente estado (`CanceladaTotal`).
  if (ctaCte === 'CanceladaTotal') return 'cancelada';
  if (comprobante === 'Rechazado' || ctaCte === 'Rechazada') return 'rechazada';
  if (comprobante === 'Aceptado' || ctaCte === 'Aceptada') {
    if (input.tipoAceptacion === 'Expresa') return 'aceptada_expresa';
    if (input.tipoAceptacion === 'Tacita') return 'aceptada_tacita';
    // Accepted but ARCA did not qualify the form — fail closed rather than
    // assert express vs tacit; `raw.estadoComprobante` still carries 'Aceptado'.
    return 'unknown';
  }
  // Emitted / awaiting reception / still modifiable == inside the acceptance window.
  if (comprobante === 'PendienteRecepcion' || comprobante === 'Recepcionado' || ctaCte === 'Modificable') return 'emitida';
  // `cedida`: reserved. ARCA's wsfecred has no cesión estado — `opcionTransferencia`
  // (ADC/SCA) is only the chosen circulation mechanism, not proof a cesión
  // occurred (that happens outside AFIP), so we never derive `cedida` from it.
  // SCA is surfaced in `raw.opcionTransferencia` instead.
  return 'unknown';
}

export function buildLifecycleResponse(
  coordinates: LifecycleCoordinates,
  normalized: NormalizedLifecycle,
  windowDays: number = DEFAULT_ACCEPTANCE_WINDOW_DAYS
): LifecycleResponse {
  return {
    schema: 'motora-wsfecred-lifecycle-v1',
    cuitEmisor: coordinates.cuitEmisor,
    pointOfSale: coordinates.pointOfSale,
    comprobanteType: coordinates.comprobanteType,
    invoiceNumber: coordinates.invoiceNumber,
    estado: mapLifecycleState(normalized),
    fchVtoAceptacion: normalized.fechaVenAcep,
    fchAceptacion: normalized.fechaHoraAcep,
    montoAceptado: normalized.saldoAceptado,
    raw: {
      estadoComprobante: normalized.estadoComprobante,
      estadoCtaCte: normalized.estadoCtaCte,
      tipoAceptacion: normalized.tipoAceptacion,
      opcionTransferencia: normalized.opcionTransferencia,
      fechaEmision: normalized.fechaEmision,
      codMoneda: normalized.codMoneda,
      importeTotal: normalized.importeTotal,
      saldoAceptado: normalized.saldoAceptado,
      codCtaCte: normalized.codCtaCte,
      fchVtoAceptacionEstimado: estimateTacitDeadline(normalized.fechaEmision, windowDays),
    },
  };
}

// Read-only resilience: an unusable emission date yields null rather than throwing.
function estimateTacitDeadline(fechaEmision: string | null, windowDays: number): string | null {
  if (!fechaEmision || !/^\d{4}-\d{2}-\d{2}$/.test(fechaEmision)) return null;
  try {
    return computeTacitAcceptanceDeadline(fechaEmision, windowDays);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Acceptance-window math. Tacit acceptance currently occurs 21 días CORRIDOS
// (calendar days) after the FCE is received in the Domicilio Fiscal Electrónico
// — Resolución 219/2025 SEPYME (BO 2026-10-28... i.e. 28/10/2025), vigente
// 2025-11-01 → 2026-10-31, suspending the 15/30-day plazos of Ley 27.440 art. 8.
// The value is resolution-driven and renewed periodically, so it is CONFIG, not
// a constant. ARCA's own `fchVtoAceptacion` (fechaVenAcep) is authoritative when
// the response carries it; this helper is the desk's countdown fallback when it
// does not, anchored on the date the desk supplies (emission or reception).
// ---------------------------------------------------------------------------
export const DEFAULT_ACCEPTANCE_WINDOW_DAYS = 21;

export function resolveAcceptanceWindowDays(rawValue: string | undefined): number {
  if (rawValue === undefined || rawValue.trim() === '') return DEFAULT_ACCEPTANCE_WINDOW_DAYS;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 365) throw new Error('FCE_ACCEPTANCE_WINDOW_DAYS_INVALID');
  return parsed;
}

// Add `windowDays` calendar days (días corridos) to an ISO yyyy-mm-dd anchor.
export function computeTacitAcceptanceDeadline(anchorDate: string, windowDays = DEFAULT_ACCEPTANCE_WINDOW_DAYS): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) throw new Error('WSFECRED_ANCHOR_DATE_INVALID');
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new Error('FCE_ACCEPTANCE_WINDOW_DAYS_INVALID');
  return shiftIsoDate(anchorDate, windowDays);
}

// Whole calendar days remaining until the tacit-acceptance deadline (negative
// once elapsed). `today` is resolved in Buenos Aires so a UTC host past 21:00
// does not report tomorrow.
export function daysUntilTacitAcceptance(anchorDate: string, occurredAt: string, windowDays = DEFAULT_ACCEPTANCE_WINDOW_DAYS): number {
  const deadline = computeTacitAcceptanceDeadline(anchorDate, windowDays);
  const today = buenosAiresToday(occurredAt);
  return isoDateDiffDays(today, deadline);
}

export function buenosAiresToday(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('WSFECRED_OCCURRED_AT_INVALID');
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

function isoDateDiffDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number];
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}
