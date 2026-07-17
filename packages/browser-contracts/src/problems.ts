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

export const TAX_COMMAND_PROBLEM_STATUS_V1 = {
  TAX_TENANT_SCOPE_FORBIDDEN: 403,
  TAX_ACTION_NOT_AUTHORIZED: 403,
  TAX_CASE_REVISION_CONFLICT: 409,
  TAX_COMMAND_IDEMPOTENCY_CONFLICT: 409,
  TAX_COMMAND_VALIDATION_FAILED: 422,
  TAX_EXTERNAL_EFFECT_AMBIGUOUS: 425,
  TAX_COMMAND_RATE_LIMITED: 429,
  TAX_EXTERNAL_EFFECT_CONFIGURATION_REQUIRED: 503,
} as const;

export type TaxCommandProblemCodeV1 = keyof typeof TAX_COMMAND_PROBLEM_STATUS_V1;

export const taxCommandProblemV1Schema = z.object({
  version: z.literal('tax-command-problem-v1'),
  code: z.enum(Object.keys(TAX_COMMAND_PROBLEM_STATUS_V1) as [
    TaxCommandProblemCodeV1,
    ...TaxCommandProblemCodeV1[],
  ]),
  status: z.union([
    z.literal(403), z.literal(409), z.literal(422), z.literal(425),
    z.literal(429), z.literal(503),
  ]),
  state: z.enum([
    'forbidden', 'refresh_required', 'reconcile_required', 'invalid',
    'retry_later', 'configuration_required',
  ]),
  retryable: z.boolean(),
  traceRef: safeReferenceSchema.nullable(),
  currentCaseRevision: z.number().int().positive().nullable(),
}).strict().superRefine((problem, context) => {
  if (problem.status !== TAX_COMMAND_PROBLEM_STATUS_V1[problem.code]) {
    context.addIssue({ code: 'custom', message: 'Command problem status does not match its stable code', path: ['status'] });
  }
  if (problem.state !== commandProblemState(problem.code)) {
    context.addIssue({ code: 'custom', message: 'Command problem state does not match its stable code', path: ['state'] });
  }
  const retryable = ['TAX_CASE_REVISION_CONFLICT', 'TAX_COMMAND_RATE_LIMITED'].includes(problem.code);
  if (problem.retryable !== retryable) {
    context.addIssue({ code: 'custom', message: 'Command problem retry policy does not match its stable code', path: ['retryable'] });
  }
  if ((problem.code === 'TAX_CASE_REVISION_CONFLICT') !== (problem.currentCaseRevision !== null)) {
    context.addIssue({ code: 'custom', message: 'Only a case revision conflict exposes the safe current revision', path: ['currentCaseRevision'] });
  }
});

export function buildTaxCommandProblemV1(
  code: TaxCommandProblemCodeV1,
  input: Readonly<{ traceRef?: string | null; currentCaseRevision?: number | null }> = {},
): TaxCommandProblemV1 {
  return taxCommandProblemV1Schema.parse({
    version: 'tax-command-problem-v1',
    code,
    status: TAX_COMMAND_PROBLEM_STATUS_V1[code],
    state: commandProblemState(code),
    retryable: ['TAX_CASE_REVISION_CONFLICT', 'TAX_COMMAND_RATE_LIMITED'].includes(code),
    traceRef: input.traceRef ?? null,
    currentCaseRevision: input.currentCaseRevision ?? null,
  });
}

function commandProblemState(code: TaxCommandProblemCodeV1): TaxCommandProblemV1['state'] {
  if (code === 'TAX_TENANT_SCOPE_FORBIDDEN' || code === 'TAX_ACTION_NOT_AUTHORIZED') return 'forbidden';
  if (code === 'TAX_CASE_REVISION_CONFLICT' || code === 'TAX_COMMAND_IDEMPOTENCY_CONFLICT') return 'refresh_required';
  if (code === 'TAX_EXTERNAL_EFFECT_AMBIGUOUS') return 'reconcile_required';
  if (code === 'TAX_COMMAND_VALIDATION_FAILED') return 'invalid';
  if (code === 'TAX_COMMAND_RATE_LIMITED') return 'retry_later';
  return 'configuration_required';
}

export type TaxSnapshotProblemV1 = z.infer<typeof taxSnapshotProblemV1Schema>;
export type TaxSnapshotReadResultV1 = z.infer<typeof taxSnapshotReadResultV1Schema>;
export type TaxCommandProblemV1 = z.infer<typeof taxCommandProblemV1Schema>;
