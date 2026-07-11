import { describe, expect, test } from 'bun:test';

import { ArgentinaJurisdictionProvider, applyWorkflowCommand, argentinaProfile, demoSnapshot } from './index';
import type { ComplianceWorkspaceState, TaxAuthorityReceipt } from './index';

describe('manual tax workflow gates', () => {
  test('keeps preparation, approval, submission, receipt, and satisfaction separate', () => {
    const obligation = new ArgentinaJurisdictionProvider().buildObligations({
      profile: argentinaProfile(),
      period: { start: '2026-01-01', end: '2026-12-31' },
    })[0]!;
    let state: ComplianceWorkspaceState = {
      workspaceId: 'workspace:demo',
      obligations: [obligation],
      receipts: [],
      events: [],
      processedCommandKeys: [],
    };
    const apply = (command: Parameters<typeof applyWorkflowCommand>[1]) => {
      state = applyWorkflowCommand(state, command, 'user:1', '2026-07-10T00:00:00.000Z');
    };

    expect(() => apply({ kind: 'record_user_approved_submission', obligationId: obligation.id, idempotencyKey: 'early' })).toThrow('Submission is not approved');
    apply({ kind: 'start_preparation', obligationId: obligation.id, idempotencyKey: '1' });
    apply({ kind: 'request_accountant_review', obligationId: obligation.id, idempotencyKey: '2' });
    apply({ kind: 'approve_by_accountant', obligationId: obligation.id, idempotencyKey: '3' });
    apply({ kind: 'record_user_approved_submission', obligationId: obligation.id, idempotencyKey: '4' });
    const receipt: TaxAuthorityReceipt = {
      receiptId: 'receipt:1',
      workspaceId: state.workspaceId,
      providerId: 'arca',
      obligationId: obligation.id,
      submittedAt: '2026-07-10T00:00:00.000Z',
      verifiedAt: '2026-07-10T00:01:00.000Z',
      status: 'accepted',
      bodyHash: 'hash:receipt',
    };
    apply({ kind: 'ingest_verified_receipt', obligationId: obligation.id, receipt, idempotencyKey: '5' });
    apply({ kind: 'mark_satisfied', obligationId: obligation.id, idempotencyKey: '6' });
    expect(state.obligations[0]).toMatchObject({
      preparationState: 'accountant_approved',
      submissionState: 'accepted',
      satisfactionState: 'satisfied',
    });
    expect(state.events).toHaveLength(6);

    const repeated = applyWorkflowCommand(state, { kind: 'mark_satisfied', obligationId: obligation.id, idempotencyKey: '6' }, 'user:1', '2026-07-10T00:02:00.000Z');
    expect(repeated).toBe(state);
  });

  test('builds browser-safe AR and US snapshots in manual-only readiness states', async () => {
    for (const jurisdiction of ['AR', 'US'] as const) {
      const snapshot = await demoSnapshot(jurisdiction);
      expect(snapshot.profile.jurisdiction).toBe(jurisdiction);
      expect(snapshot.estimate.state).not.toBe('verified');
      expect(snapshot.estimate.warning).toContain('Planning estimate only');
      expect(snapshot.capabilityManifest.reads).toHaveLength(22);
      const serialized = JSON.stringify(snapshot).toLowerCase();
      expect(serialized).not.toContain('clave fiscal');
      expect(serialized).not.toContain('privatekey');
      expect(serialized).not.toContain('access_token');
    }
  });
});
