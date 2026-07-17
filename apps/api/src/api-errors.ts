import { ZodError } from 'zod';
import {
  TAX_SNAPSHOT_PROBLEM_STATUS_V1,
  type TaxSnapshotProblemCodeV1,
} from '@tax-engine/browser-contracts';

export type SafeApiError = Readonly<{ code: string; status: number }>;

export function classifyApiError(error: unknown): SafeApiError {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return { code: 'INVALID_REQUEST', status: 400 };
  }
  const message = error instanceof Error ? error.message : '';
  if (/^[A-Z0-9_]+$/.test(message)) return { code: message, status: statusForApiErrorCode(message) };
  return { code: 'INTERNAL_ERROR', status: 500 };
}

export function statusForApiErrorCode(code: string): number {
  if (Object.hasOwn(TAX_SNAPSHOT_PROBLEM_STATUS_V1, code)) {
    return TAX_SNAPSHOT_PROBLEM_STATUS_V1[code as TaxSnapshotProblemCodeV1];
  }
  if (['EVIDENCE_CONSENT_GRANT_NOT_FOUND', 'EVIDENCE_CONSENT_SEQUENCE_GAP', 'EVIDENCE_CONSENT_NOT_YET_GRANTED'].includes(code)) return 425;
  if ([
    'FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE',
    'FACTURA_E_FACTORING_CONSENT_MUTATION_FENCED_RETRYABLE',
  ].includes(code)) return 423;
  if (code.endsWith('_RETRYABLE')) return 425;
  if (code === 'INTERNAL_ERROR') return 500;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.endsWith('_UNAUTHORIZED')) return 403;
  if (code.endsWith('_CONFIGURATION_REQUIRED')) return 503;
  if (code.endsWith('_EXPIRED')) return 410;
  if (code.endsWith('_TOO_LARGE')) return 413;
  if (code.endsWith('_STALE')
    || code.endsWith('_REVOKED')
    || code.includes('CONFLICT')
    || code.includes('REPLAY')
    || code.includes('ALREADY_EXISTS')) return 409;
  if (code.includes('TRANSPORT_FAILED') || code.includes('UPSTREAM_UNAVAILABLE')) return 502;
  return 400;
}
