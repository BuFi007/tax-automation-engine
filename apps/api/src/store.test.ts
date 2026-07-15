import { describe, expect, test } from 'bun:test';

import { argentinaProfile } from '@tax-engine/core';
import type { ComplianceWorkspaceState, TaxEvidenceRecord } from '@tax-engine/core';

import { resolveTaxEngineDatabasePath, TaxProfileStore } from './store';

describe('tax storage durability configuration', () => {
  test('keeps the in-memory default for local development and tests', () => {
    expect(resolveTaxEngineDatabasePath(null, 'development')).toBe(':memory:');
    expect(resolveTaxEngineDatabasePath('', 'test')).toBe(':memory:');
  });

  test('refuses missing or in-memory SQLite storage in production', () => {
    for (const path of [null, '', ':memory:', 'file::memory:?cache=shared', 'file:tax?mode=memory&cache=shared']) {
      expect(() => resolveTaxEngineDatabasePath(path, 'production')).toThrow(
        'TAX_ENGINE_DB_PATH_REQUIRED_IN_PRODUCTION',
      );
    }
  });

  test('accepts an explicit durable SQLite path in production', () => {
    expect(resolveTaxEngineDatabasePath('/data/tax-engine.sqlite', 'production')).toBe(
      '/data/tax-engine.sqlite',
    );
  });
});

describe('append-only tax storage', () => {
  test('uses optimistic profile versions and records immutable evidence', () => {
    const store = new TaxProfileStore(':memory:');
    const profile = store.confirm({
      profile: argentinaProfile(),
      expectedVersion: null,
      actorId: 'user:1',
      occurredAt: '2026-07-10T00:00:00.000Z',
    });
    expect(profile.version).toBe('profile-v1');
    expect(() => store.confirm({ profile, expectedVersion: null, actorId: 'user:1', occurredAt: '2026-07-10T00:01:00.000Z' })).toThrow('PROFILE_VERSION_CONFLICT');

    const record = evidenceRecord();
    expect(store.appendEvidence([record], '2026-07-10T00:00:00.000Z')).toBe(1);
    expect(store.appendEvidence([record], '2026-07-10T00:01:00.000Z')).toBe(0);
    expect(() => store.appendEvidence([{ ...record, artifactHash: 'different' }], '2026-07-10T00:02:00.000Z')).toThrow('EVIDENCE_IDEMPOTENCY_CONFLICT');
    expect(store.listEvidence(record.workspaceId)).toEqual([record]);
  });

  test('keeps workflow revisions append-only', () => {
    const store = new TaxProfileStore(':memory:');
    const state: ComplianceWorkspaceState = {
      workspaceId: 'workspace:1',
      obligations: [],
      receipts: [],
      events: [],
      processedCommandKeys: [],
    };
    expect(store.appendWorkflowRevision(state, 'hash:1', '2026-07-10T00:00:00.000Z')).toBe(1);
    expect(store.appendWorkflowRevision({ ...state, processedCommandKeys: ['1'] }, 'hash:2', '2026-07-10T00:01:00.000Z')).toBe(2);
    expect(store.getWorkflowRevision(state.workspaceId, 1)?.processedCommandKeys).toEqual([]);
    expect(store.getWorkflowRevision(state.workspaceId)?.processedCommandKeys).toEqual(['1']);
  });
});

function evidenceRecord(): TaxEvidenceRecord {
  return {
    evidenceId: 'evidence:1',
    workspaceId: 'workspace:1',
    revision: '1',
    sourceId: 'bank:1',
    sourceKind: 'bank',
    canonicalProviderId: null,
    externalReferenceHash: 'external:hash',
    sourceEventHash: 'event:hash',
    artifactHash: 'artifact:hash',
    jurisdiction: 'AR',
    period: { start: '2026-01-01', end: '2026-12-31' },
    observedAt: '2026-07-10T00:00:00.000Z',
    expiresAt: null,
    economicEventId: 'economic:1',
    economicRole: 'settlement',
    countingDimension: 'cash',
    direction: 'inflow',
    money: { decimal: '100', currency: 'ARS' },
    normalizedMoney: { decimal: '100', currency: 'ARS' },
    fxReferenceId: null,
    partyClaimHash: 'party:hash',
    accountReferenceHash: 'account:hash',
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted',
    consentVersion: 'consent-v1',
    idempotencyKey: 'workspace:1:bank:1:event:hash:1',
  };
}
