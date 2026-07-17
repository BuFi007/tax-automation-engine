import { describe, expect, test } from 'bun:test';

import { hashScope } from '../consent';
import type { TaxConsentGrant } from '../types';
import { StaticEvidenceAdapter } from './adapter';
import type { StaticAdapterInput, TaxEvidenceAdapterContext, TaxEvidenceAdapterResult, TaxEvidenceRecord } from './index';

const SOURCE_ID = 'magic-inbox';
const AS_OF = '2026-07-15T12:00:00.000Z';

describe('static evidence adapter idempotency', () => {
  test('re-keys identical evidence after consent rotation and preserves exact replay within each consent', async () => {
    const adapter = new StaticEvidenceAdapter(input());
    const consentV1 = grant('consent:v1', null);
    const firstV1 = firstRecord(await adapter.readPage(context([consentV1]), { cursor: null, pageSize: 1 }));
    const replayV1 = firstRecord(await adapter.readPage(context([consentV1]), { cursor: null, pageSize: 1 }));

    const revokedV1 = grant('consent:v1', '2026-07-15T12:30:00.000Z');
    const consentV2 = grant('consent:v1:rotated', null);
    const firstV2 = firstRecord(await adapter.readPage(context([revokedV1, consentV2]), { cursor: null, pageSize: 1 }));
    const replayV2 = firstRecord(await adapter.readPage(context([revokedV1, consentV2]), { cursor: null, pageSize: 1 }));

    expect(firstV1.consentVersion).toBe('consent:v1');
    expect(firstV2.consentVersion).toBe('consent:v1:rotated');
    expect(replayV1.idempotencyKey).toBe(firstV1.idempotencyKey);
    expect(replayV2.idempotencyKey).toBe(firstV2.idempotencyKey);
    expect(firstV2.idempotencyKey).not.toBe(firstV1.idempotencyKey);
    expect(withoutConsentLineage(firstV2)).toEqual(withoutConsentLineage(firstV1));
  });
});

function input(): StaticAdapterInput {
  return {
    adapterId: 'magic-inbox-static',
    sourceKind: 'magic_inbox',
    canonicalProviderId: 'bufi',
    displaySourceId: SOURCE_ID,
    capabilities: ['receipts'],
    records: [{
      evidenceId: 'receipt:attachment-1',
      revision: 'revision-1',
      sourceId: SOURCE_ID,
      sourceKind: 'magic_inbox',
      canonicalProviderId: 'bufi',
      externalReferenceHash: hash('external-reference'),
      sourceEventHash: hash('source-event'),
      artifactHash: hash('artifact'),
      jurisdiction: 'AR',
      period: { start: '2026-07-01', end: '2026-07-31' },
      observedAt: AS_OF,
      expiresAt: null,
      economicEventId: 'transaction:1',
      economicRole: 'receipt',
      invoiceAdjustmentKind: null,
      adjustsEconomicEventId: null,
      countingDimension: 'none',
      direction: 'neutral',
      money: null,
      normalizedMoney: null,
      fxReferenceId: null,
      partyClaimHash: null,
      accountReferenceHash: null,
      confidence: { extraction: '1', classification: '1', matching: '1' },
      reviewState: 'accepted',
    }],
  };
}

function grant(version: string, revokedAt: string | null): TaxConsentGrant {
  return {
    purpose: 'tax_workspace_processing',
    version,
    scopeIds: [SOURCE_ID],
    scopeHash: hashScope([SOURCE_ID]),
    grantedAt: '2026-07-15T11:00:00.000Z',
    revokedAt,
  };
}

function context(consentGrants: readonly TaxConsentGrant[]): TaxEvidenceAdapterContext {
  return {
    workspaceId: 'workspace:1',
    actorId: 'user:1',
    connectionId: null,
    consentGrants,
    period: { start: '2026-07-01', end: '2026-07-31' },
    displayCurrency: 'ARS',
    asOf: AS_OF,
    dataScope: { mode: 'all_connected' },
  };
}

function firstRecord(result: TaxEvidenceAdapterResult): TaxEvidenceRecord {
  if (!result.ok) throw new Error(result.safeErrorCode);
  const record = result.page.records[0];
  if (!record) throw new Error('MISSING_TEST_RECORD');
  return record;
}

function withoutConsentLineage(record: TaxEvidenceRecord): Omit<TaxEvidenceRecord, 'consentVersion' | 'idempotencyKey'> {
  const { consentVersion: _consentVersion, idempotencyKey: _idempotencyKey, ...stable } = record;
  return stable;
}

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
