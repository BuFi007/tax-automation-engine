import { describe, expect, test } from 'bun:test';

import {
  ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1,
  ACCOUNTANT_REVIEW_POLICY_VERSION_V1,
  ACCOUNTANT_REVIEW_REASON_CODES_V1,
  accountantReviewQueueV1Schema,
} from './accountant-review';

const item = {
  version: 'accountant-review-queue-item-v1' as const,
  workspaceId: 'workspace:client-1',
  mandateId: 'mandate:review-1',
  caseRef: 'case:opaque-1',
  subject: { kind: 'tax_obligation' as const, ref: 'obligation:opaque-1' },
  title: 'Federal information return review',
  dueAt: '2026-07-20T12:00:00.000Z',
  reviewState: 'ready_for_review' as const,
  snapshotRevision: 'snapshot:abcdefghijklmnop',
  caseRevision: 3,
  evidenceHashes: ['a'.repeat(64)],
  ruleVersionIds: ['rule:opaque-1'],
  policyVersionIds: [ACCOUNTANT_REVIEW_POLICY_VERSION_V1],
  limitationCodes: ['ACCOUNTANT_REVIEW_REQUIRED'],
  allowedOutcomes: [...ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1],
  allowedReasonCodes: [...ACCOUNTANT_REVIEW_REASON_CODES_V1],
};

describe('AccountantReviewQueueV1', () => {
  test('accepts only the closed, privacy-minimized review shape', () => {
    expect(accountantReviewQueueV1Schema.parse({
      version: 'accountant-review-queue-v1',
      accountantActorId: 'accountant:opaque-1',
      accountantOrganizationId: 'firm:opaque-1',
      asOf: '2026-07-17T12:00:00.000Z',
      items: [item],
      unavailableClients: [],
    }).items).toHaveLength(1);
  });

  test('rejects free text, raw tax data, duplicate subjects and missing commitments', () => {
    const queue = {
      version: 'accountant-review-queue-v1' as const,
      accountantActorId: 'accountant:opaque-1',
      accountantOrganizationId: 'firm:opaque-1',
      asOf: '2026-07-17T12:00:00.000Z',
      items: [item],
      unavailableClients: [],
    };
    expect(accountantReviewQueueV1Schema.safeParse({ ...queue, note: 'approved' }).success)
      .toBe(false);
    expect(accountantReviewQueueV1Schema.safeParse({
      ...queue,
      items: [{ ...item, evidenceHashes: [], amount: '1000.00', ein: '12-3456789' }],
    }).success).toBe(false);
    expect(accountantReviewQueueV1Schema.safeParse({
      ...queue,
      items: [item, { ...item }],
    }).success).toBe(false);
    expect(accountantReviewQueueV1Schema.safeParse({
      ...queue,
      accountantActorId: '20965240390',
    }).success).toBe(false);
  });
});
