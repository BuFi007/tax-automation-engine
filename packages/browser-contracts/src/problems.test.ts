import { describe, expect, test } from 'bun:test';

import {
  TAX_SNAPSHOT_PROBLEM_STATUS_V1,
  buildTaxSnapshotProblemV1,
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
