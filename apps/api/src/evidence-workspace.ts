import {
  TaxEvidenceResolver,
  buildTaxWidgetSnapshot,
  hashCanonical,
  normalizeTaxSnapshotProjectionKey,
  parseTaxEvidenceBatchV1,
  parseTaxEvidenceConsentEventV1,
  type TaxEvidenceAdapterContext,
  type TaxEvidenceAdapterResult,
  type TaxEvidenceBatchReceiptV1,
  type TaxEvidenceConsentEventReceiptV1,
  type TaxEvidenceRecord,
  type DigitalAssetEventV1,
  type TaxEvidenceScope,
  type TaxEvidenceSourceAdapter,
  type TaxEvidenceSourceManifestV1,
  type TaxSourceCapability,
  type TaxSourceKind,
  type TaxSnapshotProjectionConfigurationV1,
  type TaxWidgetSnapshotReceiptV1,
} from '@tax-engine/core';

import type { TaxProfileStore } from './store';

export type TaxSnapshotProjectionInputV1 = Readonly<{
  workspaceId: string;
  projectionKey?: string;
  actorId: string;
  period: Readonly<{ start: string; end: string }>;
  displayCurrency: string;
  asOf: string;
  dataScope: TaxEvidenceScope;
}>;

export type TaxSnapshotProjectionResultV1 = TaxWidgetSnapshotReceiptV1 & Readonly<{
  replayed: boolean;
}>;

export class TaxEvidenceWorkspaceService {
  constructor(
    private readonly store: TaxProfileStore,
    private readonly now: () => Date = () => new Date(),
    private readonly sourceFreshnessMaxAgeMs: number = sourceFreshnessMaximumAgeMs(),
  ) {
    if (!Number.isSafeInteger(sourceFreshnessMaxAgeMs) || sourceFreshnessMaxAgeMs < 1) {
      throw new Error('TAX_EVIDENCE_FRESHNESS_CONFIGURATION_INVALID');
    }
  }

  ingestBatch(value: unknown, appendedAt: string): TaxEvidenceBatchReceiptV1 {
    const batch = parseTaxEvidenceBatchV1(value);
    return this.store.appendEvidenceBatch(batch, appendedAt);
  }

  ingestConsentEvent(value: unknown): TaxEvidenceConsentEventReceiptV1 {
    return this.store.appendEvidenceConsentEvent(parseTaxEvidenceConsentEventV1(value));
  }

  ingestDigitalAssetEvent(event: DigitalAssetEventV1): ReturnType<TaxProfileStore['appendDigitalAssetEvent']> {
    return this.store.appendDigitalAssetEvent(event, this.now().toISOString());
  }

  configureSnapshotProjection(input: Readonly<{
    workspaceId: string;
    projectionKey?: string;
    actorId: string;
    expectedConfigHash: string | null;
    period: Readonly<{ start: string; end: string }>;
    displayCurrency: string;
    dataScope: TaxEvidenceScope;
  }>): Readonly<{
    configuration: TaxSnapshotProjectionConfigurationV1;
    projectionKey: string;
    configHash: string;
    replayed: boolean;
  }> {
    const projectionKey = normalizeTaxSnapshotProjectionKey(input.projectionKey);
    const profile = this.store.get(input.workspaceId);
    if (!profile) throw new Error('TAX_PROFILE_NOT_FOUND');
    if (profile.confirmationState !== 'user_confirmed' && profile.confirmationState !== 'accountant_confirmed') {
      throw new Error('TAX_PROFILE_NOT_CONFIRMED');
    }
    if (input.period.start > input.period.end) throw new Error('TAX_SNAPSHOT_PERIOD_INVALID');
    const configuration: TaxSnapshotProjectionConfigurationV1 = {
      version: 'tax-snapshot-projection-configuration-v1',
      workspaceId: input.workspaceId,
      period: input.period,
      displayCurrency: input.displayCurrency,
      dataScope: normalizeScope(input.dataScope),
    };
    return this.store.configureSnapshotProjection({
      configuration,
      projectionKey,
      expectedConfigHash: input.expectedConfigHash,
      actorId: input.actorId,
      configuredAt: this.now().toISOString(),
    });
  }

  getSnapshotProjectionConfiguration(
    workspaceId: string,
    projectionKey?: string,
  ): Readonly<{
    configuration: TaxSnapshotProjectionConfigurationV1;
    projectionKey: string;
    configHash: string;
  }> {
    const configured = this.store.getSnapshotProjectionConfiguration(
      workspaceId,
      normalizeTaxSnapshotProjectionKey(projectionKey),
    );
    if (!configured) throw new Error('TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED');
    return configured;
  }

  async projectSnapshot(input: TaxSnapshotProjectionInputV1): Promise<TaxSnapshotProjectionResultV1> {
    const projectionKey = normalizeTaxSnapshotProjectionKey(input.projectionKey);
    const profile = this.store.get(input.workspaceId);
    if (!profile) throw new Error('TAX_PROFILE_NOT_FOUND');
    if (profile.confirmationState !== 'user_confirmed' && profile.confirmationState !== 'accountant_confirmed') {
      throw new Error('TAX_PROFILE_NOT_CONFIRMED');
    }
    if (input.period.start > input.period.end) throw new Error('TAX_SNAPSHOT_PERIOD_INVALID');
    const asOf = Date.parse(input.asOf);
    if (!Number.isFinite(asOf)) throw new Error('TAX_SNAPSHOT_AS_OF_INVALID');
    const currentInstant = this.now().getTime();
    if (Math.abs(asOf - currentInstant) > 300_000) throw new Error('TAX_SNAPSHOT_AS_OF_NOT_CURRENT');

    const configured = this.store.getSnapshotProjectionConfiguration(input.workspaceId, projectionKey);
    if (!configured) throw new Error('TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED');
    const requestedConfiguration: TaxSnapshotProjectionConfigurationV1 = {
      version: 'tax-snapshot-projection-configuration-v1',
      workspaceId: input.workspaceId,
      period: input.period,
      displayCurrency: input.displayCurrency,
      dataScope: normalizeScope(input.dataScope),
    };
    if (hashCanonical(requestedConfiguration) !== configured.configHash) {
      throw new Error('TAX_SNAPSHOT_PROJECTION_CONFIG_MISMATCH');
    }

    const evidenceGeneration = this.store.getEvidenceGeneration(input.workspaceId);
    const manifests = this.store.listEvidenceSourceManifests(input.workspaceId);
    const scope = normalizeScope(input.dataScope);
    const selectedManifests = manifests.filter(manifest => manifestSelected(manifest, scope));
    const sourceValidUntil = earliestIso(selectedManifests.map(manifest => new Date(
      Date.parse(manifest.checkpoint.observedAt) + this.sourceFreshnessMaxAgeMs,
    ).toISOString()));
    if (sourceValidUntil && currentInstant >= Date.parse(sourceValidUntil)) throw new Error('TAX_EVIDENCE_SOURCE_STALE');
    const adapters = manifests.map(manifest => new PersistedEvidenceAdapter(
      this.store,
      manifest,
      this.sourceFreshnessMaxAgeMs,
    ));
    const consentGrants = this.store.listEvidenceConsentGrants(input.workspaceId);
    const resolvedEvidence = await new TaxEvidenceResolver(adapters).resolve({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      connectionId: null,
      consentGrants,
      period: input.period,
      displayCurrency: input.displayCurrency,
      asOf: input.asOf,
      dataScope: scope,
    });
    const evidence = {
      ...resolvedEvidence,
      validUntil: earliestIso([resolvedEvidence.validUntil, sourceValidUntil].filter((value): value is string => value !== null)),
      ...(resolvedEvidence.evidenceQuality
        ? { evidenceQuality: {
            ...resolvedEvidence.evidenceQuality,
            validUntil: earliestIso([
              resolvedEvidence.evidenceQuality.validUntil,
              sourceValidUntil,
            ].filter((value): value is string => value !== null)),
          } }
        : {}),
    };
    const snapshot = buildTaxWidgetSnapshot({ workspaceId: input.workspaceId, profile, evidence });
    const persisted = this.store.saveTaxWidgetSnapshot({
      snapshot,
      projection: evidence,
      projectionKey,
      expectedEvidenceGeneration: evidenceGeneration,
      expectedProjectionConfigHash: configured.configHash,
      generatedAt: this.now().toISOString(),
    });
    return persisted;
  }

  /**
   * Recompute a user-configured projection without giving the unattended
   * projector authority to change period, currency, or source scope.
   */
  async projectConfiguredSnapshot(input: Readonly<{
    workspaceId: string;
    projectionKey?: string;
    actorId: string;
  }>): Promise<TaxSnapshotProjectionResultV1> {
    const projectionKey = normalizeTaxSnapshotProjectionKey(input.projectionKey);
    const configured = this.store.getSnapshotProjectionConfiguration(input.workspaceId, projectionKey);
    if (!configured) throw new Error('TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED');
    return this.projectSnapshot({
      workspaceId: input.workspaceId,
      projectionKey,
      actorId: input.actorId,
      period: configured.configuration.period,
      displayCurrency: configured.configuration.displayCurrency,
      dataScope: configured.configuration.dataScope,
      asOf: this.now().toISOString(),
    });
  }

  latestSnapshot(workspaceId: string, projectionKey?: string): TaxWidgetSnapshotReceiptV1 {
    const receipt = this.store.getLatestTaxWidgetSnapshot(
      workspaceId,
      this.now().toISOString(),
      normalizeTaxSnapshotProjectionKey(projectionKey),
    );
    if (!receipt) throw new Error('TAX_SNAPSHOT_NOT_FOUND');
    return receipt;
  }
}

class PersistedEvidenceAdapter implements TaxEvidenceSourceAdapter {
  readonly adapterId: string;
  readonly sourceKind: TaxSourceKind;
  readonly supportedCapabilities: readonly TaxSourceCapability[];
  #recordsSnapshot: readonly TaxEvidenceRecord[] | null = null;

  constructor(
    private readonly store: TaxProfileStore,
    private readonly manifest: TaxEvidenceSourceManifestV1,
    private readonly sourceFreshnessMaxAgeMs: number,
  ) {
    this.adapterId = manifest.source.sourceId;
    this.sourceKind = manifest.source.sourceKind;
    this.supportedCapabilities = manifest.capabilities.map(result => result.capability);
  }

  async readPage(
    context: TaxEvidenceAdapterContext,
    input: Readonly<{ cursor: Readonly<{ value: string; version: string }> | null; pageSize: number }>,
  ): Promise<TaxEvidenceAdapterResult> {
    if (context.workspaceId !== this.manifest.workspaceId) {
      return { ok: false, retryable: false, safeErrorCode: 'EVIDENCE_WORKSPACE_MISMATCH', capabilities: this.manifest.capabilities };
    }
    if (input.pageSize < 1 || input.pageSize > 500) {
      return { ok: false, retryable: false, safeErrorCode: 'INVALID_PAGE_SIZE', capabilities: this.manifest.capabilities };
    }
    const activeGrants = context.consentGrants.filter(grant => grant.purpose === 'tax_workspace_processing'
      && grant.revokedAt === null
      && grant.scopeIds.includes(this.manifest.source.sourceId));
    const manifestGrant = activeGrants.find(grant => grant.version === this.manifest.consent.version
      && grant.scopeHash === this.manifest.consent.scopeHash);
    if (!manifestGrant) {
      return { ok: false, retryable: false, safeErrorCode: 'EVIDENCE_CONSENT_MISSING', capabilities: this.manifest.capabilities };
    }
    if (input.cursor && input.cursor.version !== 'persisted-evidence-v1') {
      return { ok: false, retryable: false, safeErrorCode: 'INVALID_CURSOR_VERSION', capabilities: this.manifest.capabilities };
    }
    const offset = input.cursor ? Number.parseInt(input.cursor.value, 10) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return { ok: false, retryable: false, safeErrorCode: 'INVALID_CURSOR', capabilities: this.manifest.capabilities };
    }
    if (!this.#recordsSnapshot) {
      this.#recordsSnapshot = this.store.listEvidenceForSource(context.workspaceId, this.manifest.source.sourceId)
        .filter(record => activeGrants.some(grant => grant.version === record.consentVersion));
    }
    const records = this.#recordsSnapshot;
    const page = records.slice(offset, offset + input.pageSize);
    const nextOffset = offset + page.length;
    const checkpointStale = Date.parse(context.asOf) - Date.parse(this.manifest.checkpoint.observedAt) > this.sourceFreshnessMaxAgeMs;
    const capabilities = checkpointStale
      ? this.manifest.capabilities.map(capability => ({
          ...capability,
          state: capability.state === 'unsupported' ? 'unsupported' as const : 'stale' as const,
          safeErrorCode: capability.safeErrorCode ?? 'EVIDENCE_SOURCE_CHECKPOINT_STALE',
        }))
      : this.manifest.capabilities;
    return {
      ok: true,
      page: {
        adapterSchemaVersion: this.manifest.source.adapterSchemaVersion,
        sourceId: this.manifest.source.sourceId,
        canonicalProviderId: this.manifest.source.canonicalProviderId,
        records: page,
        capabilities,
        nextCursor: nextOffset < records.length
          ? { value: String(nextOffset), version: 'persisted-evidence-v1' }
          : null,
        sourceCheckpoint: {
          revision: hashCanonical({
            revision: this.manifest.checkpoint.revision,
            sequence: this.manifest.checkpoint.sequence,
            batchHash: this.manifest.batchHash,
            adapterSchemaVersion: this.manifest.source.adapterSchemaVersion,
            mode: this.manifest.mode,
            checkpointLineageHash: this.store.getEvidenceSourceLineageHash(
              this.manifest.workspaceId,
              this.manifest.source.sourceId,
            ),
          }),
          observedAt: this.manifest.checkpoint.observedAt,
        },
      },
    };
  }
}

function normalizeScope(scope: TaxEvidenceScope): TaxEvidenceScope {
  if (scope.mode === 'all_connected') return scope;
  return {
    mode: 'selected',
    sourceIds: [...new Set(scope.sourceIds)].sort(),
    includeKnowledgeGraph: scope.includeKnowledgeGraph,
  };
}

function manifestSelected(manifest: TaxEvidenceSourceManifestV1, scope: TaxEvidenceScope): boolean {
  if (scope.mode === 'all_connected') return true;
  if (manifest.source.sourceKind === 'knowledge_graph') return scope.includeKnowledgeGraph;
  return scope.sourceIds.includes(manifest.source.sourceId);
}

function earliestIso(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return [...values].sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

function sourceFreshnessMaximumAgeMs(): number {
  const configured = process.env.TAX_EVIDENCE_SOURCE_FRESHNESS_MAX_AGE_MS;
  if (configured === undefined) return 86_400_000;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('TAX_EVIDENCE_FRESHNESS_CONFIGURATION_INVALID');
  return value;
}
