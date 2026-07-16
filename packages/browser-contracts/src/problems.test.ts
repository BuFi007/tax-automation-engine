import { describe, expect, test } from 'bun:test';

import {
  TAX_SNAPSHOT_PROBLEM_STATUS_V1,
  buildTaxCommandProblemV1,
  buildTaxSnapshotProblemV1,
  taxCommandProblemV1Schema,
  taxSnapshotProblemV1Schema,
  taxSnapshotReadResultV1Schema,
} from './problems';
import { argentinaTaxWidgetSnapshotReceiptV1Fixture, taxSnapshotProblemFixturesV1 } from './fixtures';

describe('Tax snapshot browser problem contract', () => {
  test('maps setup, syncing, and refresh states to stable HTTP semantics', () => {
    expect(TAX_SNAPSHOT_PROBLEM_STATUS_V1.TAX_SNAPSHOT_NOT_FOUND).toBe(404);
    expect(TAX_SNAPSHOT_PROBLEM_STATUS_V1.TAX_SNAPSHOT_STALE).toBe(409);
    expect(TAX_SNAPSHOT_PROBLEM_STATUS_V1.TAX_SNAPSHOT_EXPIRED).toBe(410);
    expect(taxSnapshotProblemFixturesV1.setupRequired).toMatchObject({ status: 404, state: 'setup_required', retryable: false });
    expect(taxSnapshotProblemFixturesV1.syncing).toMatchObject({ status: 409, state: 'syncing', retryable: true });
    expect(taxSnapshotProblemFixturesV1.refreshRequired).toMatchObject({ status: 410, state: 'refresh_required', retryable: true });
  });

  test('rejects a code/status mismatch and validates the shared result envelope', () => {
    const staleAs404 = { ...buildTaxSnapshotProblemV1('TAX_SNAPSHOT_STALE'), status: 404 };
    expect(taxSnapshotProblemV1Schema.safeParse(staleAs404).success).toBe(false);
    expect(taxSnapshotReadResultV1Schema.safeParse({ ok: true, data: argentinaTaxWidgetSnapshotReceiptV1Fixture }).success).toBe(true);
    expect(taxSnapshotReadResultV1Schema.safeParse({ ok: false, problem: taxSnapshotProblemFixturesV1.syncing }).success).toBe(true);
  });
});

describe('Tax command problem contract', () => {
  test('binds cross-tenant denial and OCC to stable safe envelopes', () => {
    expect(buildTaxCommandProblemV1('TAX_TENANT_SCOPE_FORBIDDEN')).toMatchObject({ status: 403, state: 'forbidden', retryable: false });
    expect(buildTaxCommandProblemV1('TAX_CASE_REVISION_CONFLICT', { currentCaseRevision: 4 })).toMatchObject({ status: 409, state: 'refresh_required', retryable: true, currentCaseRevision: 4 });
  });

  test('rejects status and revision leakage that do not match the code', () => {
    const conflict = buildTaxCommandProblemV1('TAX_CASE_REVISION_CONFLICT', { currentCaseRevision: 4 });
    expect(taxCommandProblemV1Schema.safeParse({ ...conflict, status: 403 }).success).toBe(false);
    expect(taxCommandProblemV1Schema.safeParse({ ...conflict, currentCaseRevision: null }).success).toBe(false);
    const denied = buildTaxCommandProblemV1('TAX_TENANT_SCOPE_FORBIDDEN');
    expect(taxCommandProblemV1Schema.safeParse({ ...denied, currentCaseRevision: 4 }).success).toBe(false);
  });
});
