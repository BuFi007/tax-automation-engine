import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import {
  argentinaProfile,
  hashTaxEvidenceBatch,
  hashTaxEvidenceConsentScope,
  type TaxEvidenceBatchV1,
  type TaxEvidenceRecord,
} from '@tax-engine/core';

import { handleTaxEvidenceRoute } from './evidence-routes';
import { TaxEvidenceWorkspaceService } from './evidence-workspace';
import { TaxProfileStore } from './store';
import type { TaxTenantPrincipalV2 } from './tenant-principal';

const ownerPrincipal: TaxTenantPrincipalV2 = {
  version: 'tax-tenant-principal-v2',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  actorId: 'user:owner',
  capability: 'snapshot:project',
  expiresAt: '2026-07-11T00:00:00.000Z',
};
const evidencePublisherPrincipal: TaxTenantPrincipalV2 = {
  ...ownerPrincipal,
  actorId: 'desk:tax-evidence-publisher',
  capability: 'evidence:publish',
};
const consentAuthorityPrincipal: TaxTenantPrincipalV2 = {
  ...ownerPrincipal,
  actorId: 'desk:tax-consent-authority',
  capability: 'consent:publish',
};
const snapshotProjectorPrincipal: TaxTenantPrincipalV2 = {
  ...ownerPrincipal,
  actorId: 'desk:tax-snapshot-projector',
  capability: 'snapshot:project',
};

describe('tax evidence workspace routes', () => {
  test('locks canonical invoice and FX batch hashes across the Desk wire', () => {
    expect(hashTaxEvidenceBatch(evidenceBatch())).toBe('8ea6931f5c416d6d22191a94fce992aba164fee59177d6d173680827ebd79023');
    expect(hashTaxEvidenceBatch(fxEvidenceBatch())).toBe('e0541ad73351ae49f86bd3423fba0f8df25f2e60133f4dc1a5440c1146440b25');
  });

  test('uses scoped ingestion auth and exposes only a fresh durable latest snapshot', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const store = new TaxProfileStore(':memory:');
    store.confirm({
      profile: { ...argentinaProfile(), workspaceId, profileId: 'profile:workspace:1' },
      expectedVersion: null,
      actorId: 'user:owner',
      occurredAt: '2026-07-10T00:00:00.000Z',
    });
    const service = new TaxEvidenceWorkspaceService(store, () => new Date('2026-07-10T12:00:00.000Z'));
    const options = { evidenceIngestToken: 'scoped-ingest-token', consentEventToken: 'consent-event-token', snapshotProjectorToken: 'snapshot-projector-token', tenantPrincipal: ownerPrincipal };
    const publisherOptions = { ...options, tenantPrincipal: evidencePublisherPrincipal };
    const authorityOptions = { ...options, tenantPrincipal: consentAuthorityPrincipal };
    const projectorOptions = { ...options, tenantPrincipal: snapshotProjectorPrincipal };

    await expect(route(service, authorityOptions, 'POST', '/v1/evidence/consent-events', consentEvent('grant', 1))).rejects.toThrow(
      'EVIDENCE_CONSENT_EVENT_UNAUTHORIZED',
    );
    await expect(route(service, authorityOptions, 'POST', '/v1/evidence/consent-events', consentEvent('grant', 1), {
      'x-tax-evidence-ingest-token': 'scoped-ingest-token',
    })).rejects.toThrow('EVIDENCE_CONSENT_EVENT_UNAUTHORIZED');
    const consentReceipt = await route(service, authorityOptions, 'POST', '/v1/evidence/consent-events', consentEvent('grant', 1), {
      'x-tax-consent-event-token': 'consent-event-token',
    });
    expect(await consentReceipt.json()).toEqual({ data: expect.objectContaining({
      version: 'tax-evidence-consent-event-receipt-v1',
      sequence: 1,
      action: 'grant',
      replayed: false,
    }) });
    await expect(route(service, publisherOptions, 'POST', '/v1/evidence/batches', evidenceBatch())).rejects.toThrow(
      'EVIDENCE_INGEST_UNAUTHORIZED',
    );
    await expect(route(service, publisherOptions, 'POST', '/v1/evidence/batches', evidenceBatch(), {
      'x-tax-consent-event-token': 'consent-event-token',
    })).rejects.toThrow('EVIDENCE_INGEST_UNAUTHORIZED');
    await route(service, publisherOptions, 'POST', '/v1/evidence/batches', fxEvidenceBatch(), {
      'x-tax-evidence-ingest-token': 'scoped-ingest-token',
    });
    const ingested = await route(service, publisherOptions, 'POST', '/v1/evidence/batches', evidenceBatch(), {
      'x-tax-evidence-ingest-token': 'scoped-ingest-token',
    });
    expect(ingested.status).toBe(200);
    expect(await ingested.json()).toEqual({ data: expect.objectContaining({
      version: 'tax-evidence-batch-receipt-v1',
      sourceId: 'bufi-invoice',
      sequence: 1,
      replayed: false,
    }) });

    const snapshotRequest = {
      workspaceId,
      actorId: 'user:owner',
      period: { start: '2026-01-01', end: '2026-12-31' },
      displayCurrency: 'USD',
      asOf: '2026-07-10T12:00:00.000Z',
      dataScope: { mode: 'all_connected' as const },
    };
    const configured = await route(service, options, 'PUT', `/v1/snapshot-configurations/${workspaceId}`, {
      actorId: snapshotRequest.actorId,
      expectedConfigHash: null,
      period: snapshotRequest.period,
      displayCurrency: snapshotRequest.displayCurrency,
      dataScope: snapshotRequest.dataScope,
    });
    const configuredBody = await configured.json() as any;
    expect(configuredBody).toEqual({ data: expect.objectContaining({
      projectionKey: 'default',
      configHash: expect.any(String),
      replayed: false,
    }) });
    const readConfiguration = await route(
      service,
      options,
      'GET',
      `/v1/snapshot-configurations/${workspaceId}`,
    );
    expect(await readConfiguration.json()).toEqual({
      data: {
        configuration: {
          version: 'tax-snapshot-projection-configuration-v1',
          workspaceId,
          period: snapshotRequest.period,
          displayCurrency: snapshotRequest.displayCurrency,
          dataScope: snapshotRequest.dataScope,
        },
        projectionKey: 'default',
        configHash: configuredBody.data.configHash,
      },
    });
    await expect(route(service, options, 'POST', '/v1/snapshots', {
      ...snapshotRequest,
      dataScope: { mode: 'selected', sourceIds: ['bufi-invoice'], includeKnowledgeGraph: false },
    })).rejects.toThrow('TAX_SNAPSHOT_PROJECTION_CONFIG_MISMATCH');
    await expect(route(service, options, 'POST', '/v1/snapshots', {
      ...snapshotRequest,
      asOf: '2026-07-10T11:00:00.000Z',
    })).rejects.toThrow('TAX_SNAPSHOT_AS_OF_NOT_CURRENT');

    const projection = await route(service, options, 'POST', '/v1/snapshots', snapshotRequest);
    const projected = await projection.json() as any;
    expect(projected.data).toEqual(expect.objectContaining({
      version: 'tax-widget-snapshot-receipt-v1',
      projectionKey: 'default',
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      inputHash: projected.data.snapshot.inputHash,
      configHash: configuredBody.data.configHash,
      evidenceGeneration: 3,
      generatedAt: '2026-07-10T12:00:00.000Z',
      asOf: snapshotRequest.asOf,
      expiresAt: '2026-07-11T00:00:00.000Z',
      validity: { state: 'current', checkedAt: '2026-07-10T12:00:00.000Z' },
      replayed: false,
    }));
    expect(projected.data.snapshot.metrics.grossIncome).toEqual({ decimal: '1000.000001', currency: 'USD' });
    expect(projected.data.snapshot.metrics.taxPaid).toBeNull();

    await expect(route(
      service,
      options,
      'POST',
      `/v1/snapshot-projections/${workspaceId}`,
      undefined,
      { 'x-tax-snapshot-projector-token': 'snapshot-projector-token' },
    )).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    const configuredProjection = await route(
      service,
      projectorOptions,
      'POST',
      `/v1/snapshot-projections/${workspaceId}`,
      undefined,
      { 'x-tax-snapshot-projector-token': 'snapshot-projector-token' },
    );
    expect(await configuredProjection.json()).toEqual({
      data: expect.objectContaining({
        version: 'tax-snapshot-projection-ack-v1',
        workspaceId,
        projectionKey: 'default',
        snapshotHash: projected.data.snapshotHash,
        replayed: true,
      }),
    });

    const latest = await route(service, options, 'GET', `/v1/snapshots/${workspaceId}`);
    const latestBody = await latest.json() as any;
    expect(latestBody.data.inputHash).toBe(projected.data.snapshot.inputHash);
    expect(latestBody.data.snapshotHash).toBe(projected.data.snapshotHash);
    expect(latestBody.data.snapshot.inputHash).toBe(projected.data.snapshot.inputHash);

    const namedKey = 'annual:2026';
    const namedConfigured = await route(
      service,
      options,
      'PUT',
      `/v1/snapshot-configurations/${workspaceId}/${encodeURIComponent(namedKey)}`,
      {
        actorId: snapshotRequest.actorId,
        expectedConfigHash: null,
        period: snapshotRequest.period,
        displayCurrency: snapshotRequest.displayCurrency,
        dataScope: snapshotRequest.dataScope,
      },
    );
    expect(await namedConfigured.json()).toEqual({ data: expect.objectContaining({
      projectionKey: namedKey,
      configHash: configuredBody.data.configHash,
      replayed: false,
    }) });
    const namedProjection = await route(service, options, 'POST', '/v1/snapshots', {
      ...snapshotRequest,
      projectionKey: namedKey,
    });
    const namedProjected = await namedProjection.json() as any;
    expect(namedProjected.data.projectionKey).toBe(namedKey);
    expect(namedProjected.data.snapshotHash).toBe(projected.data.snapshotHash);
    const namedLatest = await route(
      service,
      options,
      'GET',
      `/v1/snapshots/${workspaceId}/${encodeURIComponent(namedKey)}`,
    );
    expect((await namedLatest.json() as any).data).toEqual(expect.objectContaining({
      projectionKey: namedKey,
      snapshotHash: namedProjected.data.snapshotHash,
      configHash: namedProjected.data.configHash,
    }));

    const staleService = new TaxEvidenceWorkspaceService(store, () => new Date('2026-07-12T12:00:00.000Z'));
    await expect(route(staleService, options, 'POST', '/v1/snapshots', {
      ...snapshotRequest,
      asOf: '2026-07-12T12:00:00.000Z',
    })).rejects.toThrow('TAX_EVIDENCE_SOURCE_STALE');

    await route(service, publisherOptions, 'POST', '/v1/evidence/batches', evidenceBatch(2, []), {
      'x-tax-evidence-ingest-token': 'scoped-ingest-token',
    });
    await expect(route(service, options, 'GET', `/v1/snapshots/${workspaceId}`)).rejects.toThrow('TAX_SNAPSHOT_STALE');
    await expect(route(
      service,
      options,
      'GET',
      `/v1/snapshots/${workspaceId}/${encodeURIComponent(namedKey)}`,
    )).rejects.toThrow('TAX_SNAPSHOT_STALE');
  });

  test('revokes durable consent monotonically and invalidates the latest snapshot', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const store = new TaxProfileStore(':memory:');
    store.confirm({
      profile: { ...argentinaProfile(), workspaceId, profileId: 'profile:workspace:1' },
      expectedVersion: null,
      actorId: 'user:owner',
      occurredAt: '2026-07-10T00:00:00.000Z',
    });
    const service = new TaxEvidenceWorkspaceService(store, () => new Date('2026-07-10T12:00:00.000Z'));
    const options = { evidenceIngestToken: 'scoped-ingest-token', consentEventToken: 'consent-event-token', snapshotProjectorToken: 'snapshot-projector-token', tenantPrincipal: ownerPrincipal };
    const publisherOptions = { ...options, tenantPrincipal: evidencePublisherPrincipal };
    const authorityOptions = { ...options, tenantPrincipal: consentAuthorityPrincipal };
    const headers = { 'x-tax-evidence-ingest-token': 'scoped-ingest-token' };
    const consentHeaders = { 'x-tax-consent-event-token': 'consent-event-token' };
    await route(service, authorityOptions, 'POST', '/v1/evidence/consent-events', consentEvent('grant', 1), consentHeaders);
    await route(service, publisherOptions, 'POST', '/v1/evidence/batches', fxEvidenceBatch(), headers);
    await route(service, publisherOptions, 'POST', '/v1/evidence/batches', evidenceBatch(), headers);
    const snapshotRequest = {
      workspaceId,
      actorId: 'user:owner',
      period: { start: '2026-01-01', end: '2026-12-31' },
      displayCurrency: 'USD',
      asOf: '2026-07-10T12:00:00.000Z',
      dataScope: { mode: 'all_connected' as const },
    };
    await route(service, options, 'PUT', `/v1/snapshot-configurations/${workspaceId}`, {
      actorId: snapshotRequest.actorId,
      expectedConfigHash: null,
      period: snapshotRequest.period,
      displayCurrency: snapshotRequest.displayCurrency,
      dataScope: snapshotRequest.dataScope,
    });
    await route(service, options, 'POST', '/v1/snapshots', snapshotRequest);

    const revoked = await route(service, authorityOptions, 'POST', '/v1/evidence/consent-events', consentEvent('revoke', 2), consentHeaders);
    expect(await revoked.json()).toEqual({ data: expect.objectContaining({ action: 'revoke', replayed: false }) });
    await expect(route(service, options, 'GET', `/v1/snapshots/${workspaceId}`)).rejects.toThrow('TAX_SNAPSHOT_STALE');
    await expect(route(service, publisherOptions, 'POST', '/v1/evidence/batches', evidenceBatch(2, []), headers))
      .rejects.toThrow('EVIDENCE_CONSENT_REVOKED');
    expect((await route(service, authorityOptions, 'POST', '/v1/evidence/consent-events', consentEvent('revoke', 2), consentHeaders).then(response => response.json()) as any).data.replayed)
      .toBe(true);
  });

  test('denies cross-tenant snapshot reads, writes, and forged audit actors', async () => {
    const store = new TaxProfileStore(':memory:');
    const service = new TaxEvidenceWorkspaceService(store, () => new Date('2026-07-10T12:00:00.000Z'));
    const baseOptions = {
      evidenceIngestToken: 'scoped-ingest-token',
      consentEventToken: 'consent-event-token',
      snapshotProjectorToken: 'snapshot-projector-token',
      tenantPrincipal: ownerPrincipal,
    };
    await expect(route(service, {
      ...baseOptions,
      tenantPrincipal: { ...ownerPrincipal, workspaceId: '00000000-0000-4000-8000-000000000002' },
    }, 'GET', `/v1/snapshots/${ownerPrincipal.workspaceId}`)).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    await expect(route(service, baseOptions, 'POST', '/v1/snapshots', {
      workspaceId: '00000000-0000-4000-8000-000000000002',
      actorId: ownerPrincipal.actorId,
      period: { start: '2026-01-01', end: '2026-12-31' },
      displayCurrency: 'USD',
      asOf: '2026-07-10T12:00:00.000Z',
      dataScope: { mode: 'all_connected' },
    })).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    await expect(route(service, baseOptions, 'PUT', `/v1/snapshot-configurations/${ownerPrincipal.workspaceId}`, {
      actorId: 'user:forged',
      expectedConfigHash: null,
      period: { start: '2026-01-01', end: '2026-12-31' },
      displayCurrency: 'USD',
      dataScope: { mode: 'all_connected' },
    })).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    await expect(route(service, {
      ...baseOptions,
      tenantPrincipal: { ...evidencePublisherPrincipal, workspaceId: '00000000-0000-4000-8000-000000000002' },
    }, 'POST', '/v1/evidence/batches', evidenceBatch(), {
      'x-tax-evidence-ingest-token': 'scoped-ingest-token',
    })).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    await expect(route(service, {
      ...baseOptions,
      tenantPrincipal: evidencePublisherPrincipal,
    }, 'POST', '/v1/evidence/consent-events', consentEvent('grant', 1), {
      'x-tax-consent-event-token': 'consent-event-token',
    })).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    expect(store.listEvidenceSourceManifests(ownerPrincipal.workspaceId)).toEqual([]);
    expect(store.listEvidenceConsentGrants(ownerPrincipal.workspaceId)).toEqual([]);
  });
});

async function route(
  service: TaxEvidenceWorkspaceService,
  options: Readonly<{
    evidenceIngestToken: string | null;
    consentEventToken: string | null;
    snapshotProjectorToken: string | null;
    tenantPrincipal: TaxTenantPrincipalV2 | null;
  }>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const request = new Request(`http://tax.test${path}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handleTaxEvidenceRoute(request, new URL(request.url), service, options);
  if (!response) throw new Error('ROUTE_NOT_HANDLED');
  return response;
}

function evidenceBatch(sequence = 1, records = evidenceRecords()): TaxEvidenceBatchV1 {
  const sourceIds = ['bufi-invoice', 'fx-provider'];
  return {
    version: 'tax-evidence-batch-v1',
    batchId: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    workspaceId: '00000000-0000-4000-8000-000000000001',
    source: {
      sourceId: 'bufi-invoice',
      sourceKind: 'bufi_invoice',
      canonicalProviderId: 'bufi',
      adapterSchemaVersion: 'desk-tax-evidence-v1',
    },
    checkpoint: { sequence, revision: `invoice-revision:${sequence}`, observedAt: '2026-07-10T00:00:00.000Z' },
    mode: 'incremental',
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent-v1',
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
      sourceIds,
    },
    capabilities: [{ capability: 'invoices', state: 'available', observedAt: '2026-07-10T00:00:00.000Z', safeErrorCode: null }],
    records,
    producedAt: '2026-07-10T00:00:01.000Z',
  };
}

function fxEvidenceBatch(): TaxEvidenceBatchV1 {
  const sourceIds = ['bufi-invoice', 'fx-provider'];
  return {
    version: 'tax-evidence-batch-v1',
    batchId: '20000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    source: {
      sourceId: 'fx-provider',
      sourceKind: 'fx',
      canonicalProviderId: 'fx-provider',
      adapterSchemaVersion: 'fx-tax-evidence-v1',
    },
    checkpoint: { sequence: 1, revision: 'fx-revision:1', observedAt: '2026-07-10T00:00:00.000Z' },
    mode: 'incremental',
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent-v1',
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
      sourceIds,
    },
    capabilities: [{ capability: 'fx_rates', state: 'available', observedAt: '2026-07-10T00:00:00.000Z', safeErrorCode: null }],
    records: [{
      evidenceId: 'fx:provider:1',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      revision: '1',
      sourceId: 'fx-provider',
      sourceKind: 'fx',
      canonicalProviderId: 'fx-provider',
      externalReferenceHash: hash('external:fx:1'),
      sourceEventHash: hash('source:fx:1'),
      artifactHash: hash('artifact:fx:1'),
      jurisdiction: null,
      period: { start: '2026-01-01', end: '2026-12-31' },
      observedAt: '2026-07-10T00:00:00.000Z',
      expiresAt: null,
      economicEventId: 'economic:fx:1',
      economicRole: 'accounting_entry',
      invoiceDocumentKind: null,
      invoiceAdjustmentKind: null,
      adjustsEconomicEventId: null,
      countingDimension: 'none',
      direction: 'neutral',
      money: { decimal: '1000.000001', currency: 'USDC' },
      normalizedMoney: { decimal: '1000.000001', currency: 'USD' },
      fxReferenceId: null,
      partyClaimHash: null,
      accountReferenceHash: null,
      confidence: { extraction: '1', classification: '1', matching: '1' },
      reviewState: 'accepted',
      validityState: 'active',
      consentVersion: 'consent-v1',
      idempotencyKey: hash('key:fx:1'),
      supersedesIdempotencyKey: null,
    }],
    producedAt: '2026-07-10T00:00:01.000Z',
  };
}

function consentEvent(action: 'grant' | 'revoke', sequence: number) {
  const sourceIds = ['bufi-invoice', 'fx-provider'];
  return {
    version: 'tax-evidence-consent-event-v1' as const,
    eventId: action === 'grant'
      ? '30000000-0000-4000-8000-000000000001'
      : '30000000-0000-4000-8000-000000000002',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    sequence,
    action,
    authoritySource: 'desk_subscription' as const,
    actorReferenceHash: hash('actor:user:owner'),
    consent: {
      purpose: 'tax_workspace_processing' as const,
      version: 'consent-v1',
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
      sourceIds,
    },
    occurredAt: action === 'grant' ? '2026-07-09T00:00:00.000Z' : '2026-07-11T00:00:00.000Z',
  };
}

function evidenceRecords(): TaxEvidenceRecord[] {
  const common = {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    revision: '1',
    sourceId: 'bufi-invoice',
    sourceKind: 'bufi_invoice' as const,
    canonicalProviderId: 'bufi',
    jurisdiction: 'AR' as const,
    period: { start: '2026-01-01', end: '2026-12-31' },
    observedAt: '2026-07-10T00:00:00.000Z',
    expiresAt: null,
    economicEventId: 'economic:invoice:1',
    invoiceDocumentKind: null,
    invoiceAdjustmentKind: null,
    adjustsEconomicEventId: null,
    fxReferenceId: hash('key:fx:1'),
    partyClaimHash: hash('party:1'),
    accountReferenceHash: hash('account:1'),
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted' as const,
    validityState: 'active' as const,
    consentVersion: 'consent-v1',
    supersedesIdempotencyKey: null,
  };
  return [
    {
      ...common,
      evidenceId: 'invoice:1',
      externalReferenceHash: hash('external:invoice:1'),
      sourceEventHash: hash('source:invoice:1'),
      artifactHash: hash('artifact:invoice:1'),
      economicRole: 'invoice',
      invoiceDocumentKind: 'arca_factura_e',
      countingDimension: 'revenue',
      direction: 'inflow',
      money: { decimal: '1000.000001', currency: 'USDC' },
      normalizedMoney: { decimal: '1000.000001', currency: 'USD' },
      idempotencyKey: hash('key:invoice:1'),
    },
    {
      ...common,
      evidenceId: 'settlement:1',
      externalReferenceHash: hash('external:settlement:1'),
      sourceEventHash: hash('source:settlement:1'),
      artifactHash: hash('artifact:settlement:1'),
      economicRole: 'settlement',
      countingDimension: 'none',
      direction: 'neutral',
      money: null,
      normalizedMoney: null,
      fxReferenceId: null,
      idempotencyKey: hash('key:settlement:1'),
    },
  ];
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
