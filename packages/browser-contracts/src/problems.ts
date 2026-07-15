import { z } from 'zod';

import { taxWidgetSnapshotReceiptV1Schema } from './contracts';
import { safeReferenceSchema } from './primitives';

const setupProblemSchema = z.object({
  version: z.literal('tax-browser-problem-v1'),
  code: z.enum(['TAX_SNAPSHOT_NOT_FOUND', 'TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED']),
  status: z.literal(404),
  state: z.literal('setup_required'),
  retryable: z.literal(false),
  traceRef: safeReferenceSchema.nullable(),
}).strict();

const syncingProblemSchema = z.object({
  version: z.literal('tax-browser-problem-v1'),
  code: z.enum([
    'TAX_SNAPSHOT_STALE',
    'TAX_EVIDENCE_SOURCE_STALE',
    'TAX_SNAPSHOT_PROJECTION_CONFIG_MISMATCH',
    'TAX_SNAPSHOT_CONFIG_VERSION_CONFLICT',
    'TAX_EVIDENCE_GENERATION_CONFLICT',
    'TAX_PROFILE_VERSION_CONFLICT',
  ]),
  status: z.literal(409),
  state: z.literal('syncing'),
  retryable: z.literal(true),
  traceRef: safeReferenceSchema.nullable(),
}).strict();

const expiredProblemSchema = z.object({
  version: z.literal('tax-browser-problem-v1'),
  code: z.literal('TAX_SNAPSHOT_EXPIRED'),
  status: z.literal(410),
  state: z.literal('refresh_required'),
  retryable: z.literal(true),
  traceRef: safeReferenceSchema.nullable(),
}).strict();

export const taxSnapshotProblemV1Schema = z.union([
  setupProblemSchema,
  syncingProblemSchema,
  expiredProblemSchema,
]);

export const TAX_SNAPSHOT_PROBLEM_STATUS_V1 = {
  TAX_SNAPSHOT_NOT_FOUND: 404,
  TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED: 404,
  TAX_SNAPSHOT_STALE: 409,
  TAX_EVIDENCE_SOURCE_STALE: 409,
  TAX_SNAPSHOT_PROJECTION_CONFIG_MISMATCH: 409,
  TAX_SNAPSHOT_CONFIG_VERSION_CONFLICT: 409,
  TAX_EVIDENCE_GENERATION_CONFLICT: 409,
  TAX_PROFILE_VERSION_CONFLICT: 409,
  TAX_SNAPSHOT_EXPIRED: 410,
} as const;

export type TaxSnapshotProblemCodeV1 = keyof typeof TAX_SNAPSHOT_PROBLEM_STATUS_V1;

export function buildTaxSnapshotProblemV1(
  code: TaxSnapshotProblemCodeV1,
  traceRef: string | null = null,
): TaxSnapshotProblemV1 {
  const status = TAX_SNAPSHOT_PROBLEM_STATUS_V1[code];
  return taxSnapshotProblemV1Schema.parse({
    version: 'tax-browser-problem-v1',
    code,
    status,
    state: status === 404 ? 'setup_required' : status === 409 ? 'syncing' : 'refresh_required',
    retryable: status !== 404,
    traceRef,
  });
}

export const taxSnapshotReadResultV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    data: taxWidgetSnapshotReceiptV1Schema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    problem: taxSnapshotProblemV1Schema,
  }).strict(),
]);

export type TaxSnapshotProblemV1 = z.infer<typeof taxSnapshotProblemV1Schema>;
export type TaxSnapshotReadResultV1 = z.infer<typeof taxSnapshotReadResultV1Schema>;
