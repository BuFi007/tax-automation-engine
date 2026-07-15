import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { classifyApiError } from './api-errors';

describe('safe API error classification', () => {
  test('keeps malformed client input permanent without exposing parser details', () => {
    const parseError = z.object({ value: z.string() }).safeParse({ value: 1 }).error;
    expect(classifyApiError(parseError)).toEqual({ code: 'INVALID_REQUEST', status: 400 });
    expect(classifyApiError(new SyntaxError('bad json'))).toEqual({ code: 'INVALID_REQUEST', status: 400 });
  });

  test('marks consent delivery reordering as retryable Too Early', () => {
    expect(classifyApiError(new Error('EVIDENCE_CONSENT_GRANT_NOT_FOUND'))).toEqual({
      code: 'EVIDENCE_CONSENT_GRANT_NOT_FOUND',
      status: 425,
    });
    expect(classifyApiError(new Error('EVIDENCE_CONSENT_SEQUENCE_GAP')).status).toBe(425);
  });

  test('classifies an active factoring fence as retryable Locked, not rejection', () => {
    expect(classifyApiError(new Error('FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE')))
      .toEqual({ code: 'FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE', status: 423 });
    expect(classifyApiError(new Error('FACTURA_E_FACTORING_CONSENT_MUTATION_FENCED_RETRYABLE')))
      .toEqual({
        code: 'FACTURA_E_FACTORING_CONSENT_MUTATION_FENCED_RETRYABLE',
        status: 423,
      });
  });

  test('never converts an unexpected storage failure into a permanent client nack', () => {
    expect(classifyApiError(new Error('database is locked'))).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
  });

  test('preserves the shared snapshot setup, syncing, and refresh statuses', () => {
    expect(classifyApiError(new Error('TAX_SNAPSHOT_NOT_FOUND')).status).toBe(404);
    expect(classifyApiError(new Error('TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED')).status).toBe(404);
    expect(classifyApiError(new Error('TAX_SNAPSHOT_STALE')).status).toBe(409);
    expect(classifyApiError(new Error('TAX_SNAPSHOT_PROJECTION_CONFIG_MISMATCH')).status).toBe(409);
    expect(classifyApiError(new Error('TAX_SNAPSHOT_EXPIRED')).status).toBe(410);
  });
});
