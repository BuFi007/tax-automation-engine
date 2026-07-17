import { describe, expect, test } from 'bun:test';

import type {
  TaxEvidencePresentationProjectionV1,
  TaxSnapshotProjectionConfigurationV1,
  TaxWidgetSnapshotReceiptV1,
  TaxWidgetSnapshotV1,
} from '@tax-engine/core';
import { demoSnapshot, hashCanonical } from '@tax-engine/core';

import { TaxBrowserSnapshotProjector } from './browser-snapshot';
import { handleAccountantReviewRoute } from './accountant-review-routes';
import { TaxProfileStore } from './store';
import type { TaxTenantPrincipalV2 } from './tenant-principal';

const NOW = new Date('2026-07-17T12:00:00.000Z');
const VALID_UNTIL = '2026-07-25T12:00:00.000Z';
const SECRET = 'accountant-review-browser-reference-secret-v1';
const principal: TaxTenantPrincipalV2 = {
  version: 'tax-tenant-principal-v2',
  workspaceId: 'firm:1',
  actorId: 'accountant:1',
  capability: 'accountant:review-queue',
  expiresAt: '2026-07-17T12:05:00.000Z',
};

describe('accountant review queue route', () => {
  test('projects only current review subjects under the exact active mandate', async () => {
    const store = new TaxProfileStore(':memory:');
    const base = await demoSnapshot('US');
    const rawObligationId = base.obligations[0]!.id;
    const snapshot: TaxWidgetSnapshotV1 = {
      ...base,
      obligations: base.obligations.map((obligation, index) => (
        index === 0
          ? { ...obligation, preparationState: 'under_accountant_review' as const }
          : obligation
      )),
    };
    persistCurrentBrowserSnapshot(store, snapshot, NOW.toISOString());
    grantReviewMandate(store);

    const response = await handleAccountantReviewRoute(
      new Request('https://tax.test/v1/accountant-review-queue'),
      new URL('https://tax.test/v1/accountant-review-queue'),
      store,
      principal,
      NOW,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toBe('private, no-store');
    const body = await response!.json() as any;
    expect(body.data).toMatchObject({
      accountantActorId: principal.actorId,
      accountantOrganizationId: principal.workspaceId,
      unavailableClients: [],
    });
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      workspaceId: snapshot.workspaceId,
      mandateId: 'mandate:review',
      reviewState: 'ready_for_review',
      subject: { kind: 'tax_obligation' },
      evidenceHashes: [expect.stringMatching(/^[a-f0-9]{64}$/)],
      policyVersionIds: ['external-accountant-decision-policy-v1'],
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(rawObligationId);
    expect(serialized).not.toContain(snapshot.profile.profileId);
    expect(serialized).not.toContain('12-3456789');
    store.close();
  });

  test('omits revoked and differently bound mandates', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('US');
    persistCurrentBrowserSnapshot(store, snapshot, NOW.toISOString());
    grantReviewMandate(store, { revokedAt: '2026-07-17T11:59:00.000Z' });
    store.grantAccountantMandate({
      ...reviewMandate(),
      mandateId: 'mandate:other-firm',
      accountantOrganizationId: 'firm:other',
    });

    const response = await handleAccountantReviewRoute(
      new Request('https://tax.test/v1/accountant-review-queue'),
      new URL('https://tax.test/v1/accountant-review-queue'),
      store,
      principal,
      NOW,
    );
    expect((await response!.json() as any).data).toMatchObject({
      items: [],
      unavailableClients: [],
    });
    store.close();
  });

  test('reports a stale projection without exposing the stale subject', async () => {
    const store = new TaxProfileStore(':memory:');
    const base = await demoSnapshot('US');
    persistCurrentBrowserSnapshot(store, base, NOW.toISOString());
    grantReviewMandate(store);
    persistCoreSnapshot(
      store,
      { ...base, warnings: [...base.warnings, 'RULE_REFRESH_REQUIRED'] },
      '2026-07-17T12:01:00.000Z',
      true,
    );

    const response = await handleAccountantReviewRoute(
      new Request('https://tax.test/v1/accountant-review-queue'),
      new URL('https://tax.test/v1/accountant-review-queue'),
      store,
      principal,
      new Date('2026-07-17T12:02:00.000Z'),
    );
    expect((await response!.json() as any).data).toEqual(expect.objectContaining({
      items: [],
      unavailableClients: [{
        workspaceId: base.workspaceId,
        code: 'ACCOUNTANT_REVIEW_SNAPSHOT_STALE',
      }],
    }));
    store.close();
  });
});

function reviewMandate(overrides: Record<string, unknown> = {}) {
  return {
    version: 'accountant-mandate-v1' as const,
    mandateId: 'mandate:review',
    workspaceId: 'workspace:demo',
    accountantActorId: principal.actorId,
    accountantOrganizationId: principal.workspaceId,
    scopes: ['review_tax_obligation' as const],
    grantedByActorId: 'user:owner',
    grantedAt: '2026-07-17T11:00:00.000Z',
    expiresAt: '2026-08-17T12:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

function grantReviewMandate(store: TaxProfileStore, overrides: Record<string, unknown> = {}) {
  store.grantAccountantMandate(reviewMandate(overrides));
}

function persistCurrentBrowserSnapshot(
  store: TaxProfileStore,
  snapshot: TaxWidgetSnapshotV1,
  generatedAt: string,
) {
  const receipt = persistCoreSnapshot(store, snapshot, generatedAt, false);
  const projector = new TaxBrowserSnapshotProjector(SECRET);
  const sourceFingerprint = projector.sourceFingerprint(receipt);
  return store.stampBrowserTaxSnapshot({
    receipt,
    sourceFingerprint,
    caseRef: projector.caseReference(snapshot.workspaceId, 'default'),
    buildSnapshot: durable => projector.project(receipt, {
      ...durable,
      sourceFingerprint,
    }),
  });
}

function persistCoreSnapshot(
  store: TaxProfileStore,
  snapshot: TaxWidgetSnapshotV1,
  generatedAt: string,
  alreadyConfigured: boolean,
): TaxWidgetSnapshotReceiptV1 {
  if (!alreadyConfigured) {
    store.confirm({
      profile: snapshot.profile,
      expectedVersion: null,
      actorId: 'user:owner',
      occurredAt: generatedAt,
    });
  }
  const configuration: TaxSnapshotProjectionConfigurationV1 = {
    version: 'tax-snapshot-projection-configuration-v1',
    workspaceId: snapshot.workspaceId,
    period: snapshot.period,
    displayCurrency: snapshot.displayCurrency,
    dataScope: { mode: 'all_connected' },
  };
  const configured = alreadyConfigured
    ? store.getSnapshotProjectionConfiguration(snapshot.workspaceId, 'default')
    : store.configureSnapshotProjection({
        configuration,
        projectionKey: 'default',
        expectedConfigHash: null,
        actorId: 'user:owner',
        configuredAt: generatedAt,
      });
  if (!configured) throw new Error('TEST_CONFIGURATION_REQUIRED');
  const projection = {
    version: 'tax-evidence-presentation-v1',
    upstreamBundleHash: hashCanonical({ snapshot: snapshot.inputHash, generatedAt }),
    period: snapshot.period,
    resolvedScope: { mode: 'all_connected' },
    displayCurrency: snapshot.displayCurrency,
    asOf: generatedAt,
    validUntil: VALID_UNTIL,
    capabilityManifest: snapshot.capabilityManifest,
    sources: snapshot.sourceCoverage,
    safeFacts: snapshot.facts,
    evidenceCoverage: snapshot.evidenceCoverage,
    limitations: snapshot.warnings,
  } as TaxEvidencePresentationProjectionV1;
  const stored = store.saveTaxWidgetSnapshot({
    snapshot,
    projection,
    projectionKey: 'default',
    expectedEvidenceGeneration: store.getEvidenceGeneration(snapshot.workspaceId),
    expectedProjectionConfigHash: configured.configHash,
    generatedAt,
  });
  const { replayed: _replayed, ...receipt } = stored;
  return receipt;
}
