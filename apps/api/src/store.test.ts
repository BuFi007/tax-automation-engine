import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  argentinaProfile,
  buildEvidenceGraph,
  createFacturaEAgentRun,
  demoSnapshot,
  hashCanonical,
  hashTaxEvidenceConsentScope,
} from '@tax-engine/core';
import type {
  ComplianceWorkspaceState,
  TaxEvidenceBatchV1,
  TaxEvidenceConsentEventV1,
  TaxEvidencePresentationProjectionV1,
  TaxEvidenceRecord,
  TaxSnapshotProjectionConfigurationV1,
  TaxWidgetSnapshotV1,
} from '@tax-engine/core';

import { resolveTaxEngineDatabasePath, TaxProfileStore } from './store';
import { TaxEvidenceWorkspaceService } from './evidence-workspace';
import {
  createConsentRevokedTaxDomainEvent,
  createFacturaEAgentTaxDomainEvents,
} from './tax-domain-event-factory';

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

  test('atomically rebuilds both pre-BU-234 and interrupted nullable source-id schemas', () => {
    for (const interrupted of [false, true]) {
      const directory = mkdtempSync(join(tmpdir(), `tax-engine-migration-${interrupted ? 'interrupted' : 'legacy'}-`));
      const databasePath = join(directory, 'tax.sqlite');
      try {
        createLegacyEvidenceDatabase(databasePath, interrupted);
        const store = new TaxProfileStore(databasePath);
        expect(store.listEvidenceForSource('workspace:1', 'bank:1')).toEqual([evidenceRecord()]);
        store.close();

        const verified = new Database(databasePath);
        const sourceColumn = verified.query<{ name: string; notnull: number }, []>('PRAGMA table_info(evidence_records)')
          .all().find(column => column.name === 'source_id');
        expect(sourceColumn?.notnull).toBe(1);
        expect(verified.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM evidence_records WHERE source_id IS NULL').get()?.count).toBe(0);
        expect(verified.query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 'bu234-evidence-source-id-v1'",
        ).get()?.count).toBe(1);
        verified.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  test('migrates legacy unnamed snapshot authority into the default projection without changing its receipt', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tax-engine-named-snapshot-migration-'));
    const databasePath = join(directory, 'tax.sqlite');
    try {
      const snapshot = await demoSnapshot();
      const configuration: TaxSnapshotProjectionConfigurationV1 = {
        version: 'tax-snapshot-projection-configuration-v1',
        workspaceId: snapshot.workspaceId,
        period: snapshot.period,
        displayCurrency: snapshot.displayCurrency,
        dataScope: { mode: 'all_connected' },
      };
      const projection = {
        version: 'test-projection',
        asOf: '2026-07-10T00:00:00.000Z',
        validUntil: null,
      } as unknown as TaxEvidencePresentationProjectionV1;
      createLegacySnapshotDatabase(databasePath, snapshot, configuration, projection);

      const store = new TaxProfileStore(databasePath);
      const configured = store.getSnapshotProjectionConfiguration(snapshot.workspaceId);
      expect(configured).toEqual({
        configuration,
        projectionKey: 'default',
        configHash: hashCanonical(configuration),
      });
      const receipt = store.getLatestTaxWidgetSnapshot(
        snapshot.workspaceId,
        '2026-07-10T00:00:01.000Z',
      );
      expect(receipt).toEqual(expect.objectContaining({
        version: 'tax-widget-snapshot-receipt-v1',
        projectionKey: 'default',
        snapshotHash: hashCanonical(snapshot),
        inputHash: snapshot.inputHash,
        configHash: hashCanonical(configuration),
        evidenceGeneration: 0,
        generatedAt: '2026-07-10T00:00:00.000Z',
        asOf: '2026-07-10T00:00:00.000Z',
        expiresAt: null,
        validity: { state: 'current', checkedAt: '2026-07-10T00:00:01.000Z' },
        snapshot,
      }));

      const named = store.configureSnapshotProjection({
        configuration,
        projectionKey: 'annual:2026',
        expectedConfigHash: null,
        actorId: 'user:1',
        configuredAt: '2026-07-10T00:00:02.000Z',
      });
      expect(store.saveTaxWidgetSnapshot({
        snapshot,
        projection,
        projectionKey: named.projectionKey,
        expectedEvidenceGeneration: 0,
        expectedProjectionConfigHash: named.configHash,
        generatedAt: '2026-07-10T00:00:02.000Z',
      }).projectionKey).toBe('annual:2026');
      store.close();

      const verified = new Database(databasePath);
      expect(verified.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM tax_snapshot_projection_configurations WHERE projection_key IN ('default', 'annual:2026')",
      ).get()?.count).toBe(2);
      expect(verified.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 'bu250-named-tax-snapshot-projections-v1'",
      ).get()?.count).toBe(1);
      verified.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('removes the legacy browser fingerprint uniqueness without losing historical revisions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tax-engine-browser-snapshot-migration-'));
    const databasePath = join(directory, 'tax.sqlite');
    try {
      const legacy = new Database(databasePath, { create: true });
      legacy.exec(`
        CREATE TABLE tax_browser_snapshots (
          workspace_id TEXT NOT NULL,
          projection_key TEXT NOT NULL,
          case_ref TEXT NOT NULL,
          case_revision INTEGER NOT NULL CHECK (case_revision > 0),
          source_fingerprint TEXT NOT NULL,
          browser_snapshot_hash TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, projection_key, case_revision),
          UNIQUE (workspace_id, projection_key, source_fingerprint)
        );
        INSERT INTO tax_browser_snapshots (
          workspace_id, projection_key, case_ref, case_revision, source_fingerprint,
          browser_snapshot_hash, snapshot_json, generated_at
        ) VALUES (
          'workspace:1', 'annual:2026', 'case:1', 1, 'source-fingerprint-1',
          'snapshot-hash-1', '{}', '2026-07-10T00:00:00.000Z'
        );
      `);
      legacy.close();

      const migrated = new TaxProfileStore(databasePath);
      migrated.close();
      const restarted = new TaxProfileStore(databasePath);
      restarted.close();

      const verified = new Database(databasePath);
      verified.query(`
        INSERT INTO tax_browser_snapshots (
          workspace_id, projection_key, case_ref, case_revision, source_fingerprint,
          browser_snapshot_hash, snapshot_json, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'workspace:1',
        'annual:2026',
        'case:1',
        2,
        'source-fingerprint-1',
        'snapshot-hash-2',
        '{}',
        '2026-07-10T00:01:00.000Z',
      );
      expect(verified.query<{ count: number }, []>(
        'SELECT COUNT(*) AS count FROM tax_browser_snapshots',
      ).get()?.count).toBe(2);
      expect(verified.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 'bu234-browser-tax-snapshot-append-only-v2'",
      ).get()?.count).toBe(1);
      verified.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
    expect(store.confirm({
      profile: argentinaProfile(),
      expectedVersion: null,
      actorId: 'user:1',
      occurredAt: '2026-07-10T00:00:30.000Z',
    })).toEqual(profile);
    expect(() => store.confirm({
      profile: { ...profile, profileId: 'profile:changed' },
      expectedVersion: null,
      actorId: 'user:1',
      occurredAt: '2026-07-10T00:01:00.000Z',
    })).toThrow('PROFILE_VERSION_CONFLICT');

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

  test('never reactivates revoked evidence by reusing a consent version with a broader scope', () => {
    const store = new TaxProfileStore(':memory:');
    const granted = consentLifecycleEvent(1, 'grant', ['bank:1'], '00000000-0000-4000-8000-000000000001');
    const revoked = consentLifecycleEvent(2, 'revoke', ['bank:1'], '00000000-0000-4000-8000-000000000002');
    store.appendEvidenceConsentEvent(granted);
    store.appendEvidenceConsentEvent(revoked);

    expect(store.listPendingTaxDomainEvents()).toEqual([
      expect.objectContaining({
        kind: 'consent.revoked',
        workspaceId: 'workspace:1',
        state: 'revoked',
        consent: expect.objectContaining({ state: 'revoked' }),
      }),
    ]);

    expect(() => store.appendEvidenceConsentEvent(consentLifecycleEvent(
      3,
      'grant',
      ['bank:1', 'fx-provider'],
      '00000000-0000-4000-8000-000000000003',
    ))).toThrow('EVIDENCE_CONSENT_VERSION_SCOPE_CONFLICT');
    expect(store.listEvidenceConsentGrants('workspace:1')).toEqual([
      expect.objectContaining({ version: 'consent-v1', revokedAt: revoked.occurredAt }),
    ]);
  });

  test('rolls back consent revocation when its domain outbox append conflicts', () => {
    const commitmentSecret = 'atomic-tax-domain-event-commitment-secret-v1';
    const store = new TaxProfileStore(':memory:', commitmentSecret);
    const granted = consentLifecycleEvent(1, 'grant', ['bank:1'], '00000000-0000-4000-8000-000000000011');
    const revoked = consentLifecycleEvent(2, 'revoke', ['bank:1'], '00000000-0000-4000-8000-000000000012');
    store.appendEvidenceConsentEvent(granted);
    const conflicting = createConsentRevokedTaxDomainEvent({
      event: revoked,
      commitmentSecret,
      eventId: '00000000-0000-4000-8000-000000000013',
    });
    if (!conflicting) throw new Error('Expected revocation domain event');
    store.appendTaxDomainEvent(conflicting, revoked.occurredAt);

    expect(() => store.appendEvidenceConsentEvent(revoked))
      .toThrow('TAX_DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
    expect(store.listEvidenceConsentGrants('workspace:1')).toEqual([
      expect.objectContaining({ version: 'consent-v1', revokedAt: null }),
    ]);
  });

  test('rotates consent into a new full baseline without reviving old-version evidence', () => {
    const store = new TaxProfileStore(':memory:');
    const sourceIds = ['bank:1'];
    store.appendEvidenceConsentEvent(consentLifecycleEvent(
      1,
      'grant',
      sourceIds,
      '00000000-0000-4000-8000-000000000001',
      'consent-v1',
    ));
    store.appendEvidenceBatch(
      { ...evidenceBatch(1, [evidenceRecord()]), mode: 'full_snapshot' },
      '2026-07-10T00:00:01.000Z',
    );
    store.appendEvidenceConsentEvent(consentLifecycleEvent(
      2,
      'revoke',
      sourceIds,
      '00000000-0000-4000-8000-000000000002',
      'consent-v1',
    ));
    store.appendEvidenceConsentEvent(consentLifecycleEvent(
      3,
      'grant',
      sourceIds,
      '00000000-0000-4000-8000-000000000003',
      'consent-v2',
    ));
    const rotatedRecord = {
      ...evidenceRecord(),
      evidenceId: 'evidence:consent-v2',
      revision: 'consent-v2',
      artifactHash: 'artifact:consent-v2',
      consentVersion: 'consent-v2',
      idempotencyKey: 'workspace:1:bank:1:consent-v2:event:hash:1',
    };
    const rotatedBatch = evidenceBatch(2, [rotatedRecord]);
    store.appendEvidenceBatch({
      ...rotatedBatch,
      batchId: 'batch:consent-v2:2',
      mode: 'full_snapshot',
      producedAt: '2026-07-12T00:00:00.000Z',
      consent: {
        ...rotatedBatch.consent,
        version: 'consent-v2',
        scopeHash: hashTaxEvidenceConsentScope('consent-v2', sourceIds),
      },
    }, '2026-07-12T00:00:01.000Z');

    expect(store.listEvidence('workspace:1')).toEqual([rotatedRecord]);
    expect(store.listEvidenceConsentGrants('workspace:1')).toEqual([
      expect.objectContaining({ version: 'consent-v1', revokedAt: expect.any(String) }),
      expect.objectContaining({ version: 'consent-v2', revokedAt: null }),
    ]);
  });

  test('converges out-of-order batches and pending supersession targets', () => {
    const store = new TaxProfileStore(':memory:');
    grantConsent(store, ['bank:1']);
    const first = evidenceRecord();
    const successor = {
      ...first,
      evidenceId: 'evidence:2',
      revision: '2',
      artifactHash: 'artifact:hash:2',
      idempotencyKey: 'workspace:1:bank:1:event:hash:2',
      supersedesIdempotencyKey: first.idempotencyKey,
    };
    const secondBatch = evidenceBatch(2, [successor]);
    expect(store.appendEvidenceBatch(secondBatch, '2026-07-10T00:02:00.000Z').replayed).toBe(false);
    expect(store.listEvidenceSourceManifests(first.workspaceId)[0]?.capabilities[0]).toEqual(expect.objectContaining({
      state: 'partial',
      safeErrorCode: 'EVIDENCE_CHECKPOINT_GAP',
    }));
    expect(store.appendEvidenceBatch(
      { ...evidenceBatch(1, [first]), mode: 'full_snapshot' },
      '2026-07-10T00:03:00.000Z',
    ).replayed).toBe(false);
    expect(store.listEvidence(first.workspaceId)).toEqual([successor]);
    expect(store.listEvidenceSourceManifests(first.workspaceId)[0]?.checkpoint.sequence).toBe(2);
    expect(store.listEvidenceSourceManifests(first.workspaceId)[0]?.capabilities[0]?.state).toBe('available');
    expect(store.appendEvidenceBatch(secondBatch, '2026-07-10T00:04:00.000Z')).toEqual(expect.objectContaining({ replayed: true, appendedRecords: 0 }));
    expect(() => store.appendEvidenceBatch({ ...evidenceBatch(2, []), batchId: 'different-batch' }, '2026-07-10T00:05:00.000Z'))
      .toThrow('EVIDENCE_CHECKPOINT_SEQUENCE_CONFLICT');
  });

  test('converges an out-of-order settlement reversal without restoring finality', () => {
    const store = new TaxProfileStore(':memory:');
    grantConsent(store, ['bufi-invoice']);
    const invoice = invoiceEvidenceRecord('invoice', 'invoice', 'active', null);
    const finalized = invoiceEvidenceRecord('settlement-finalized', 'settlement', 'active', null);
    const reversed = invoiceEvidenceRecord('settlement-reversed', 'settlement', 'withdrawn', finalized.idempotencyKey);

    store.appendEvidenceBatch(invoiceEvidenceBatch(2, [invoice, reversed]), '2026-07-10T00:02:00.000Z');
    expect(store.listEvidenceSourceManifests(invoice.workspaceId)[0]?.capabilities[0]).toEqual(expect.objectContaining({
      state: 'partial',
      safeErrorCode: 'EVIDENCE_CHECKPOINT_GAP',
    }));
    store.appendEvidenceBatch(
      { ...invoiceEvidenceBatch(1, [finalized]), mode: 'full_snapshot' },
      '2026-07-10T00:03:00.000Z',
    );

    const active = store.listEvidence(invoice.workspaceId);
    expect(active.map(record => record.evidenceId).sort()).toEqual(['invoice', 'settlement-reversed']);
    const graph = buildEvidenceGraph(invoice.workspaceId, active);
    expect(graph.edges.map(edge => edge.kind)).not.toContain('settles');
    expect(graph.gaps.map(gap => gap.kind)).toContain('factura_e_without_collection_evidence');
    expect(store.listEvidenceSourceManifests(invoice.workspaceId)[0]?.capabilities[0]?.state).toBe('available');
  });

  test('requires the exact stored cash predecessor and never accepts an orphan tombstone', () => {
    const active: TaxEvidenceRecord = {
      ...evidenceRecord(),
      evidenceId: 'cash-active',
      economicEventId: 'bank-transaction:1',
      economicRole: 'cash_movement',
      countingDimension: 'cash',
      idempotencyKey: 'workspace:1:bank:1:cash-active',
    };
    const withdrawn: TaxEvidenceRecord = {
      ...active,
      evidenceId: 'cash-withdrawn',
      revision: '2',
      countingDimension: 'none',
      direction: 'neutral',
      money: null,
      normalizedMoney: null,
      validityState: 'withdrawn',
      idempotencyKey: 'workspace:1:bank:1:cash-withdrawn',
      supersedesIdempotencyKey: active.idempotencyKey,
    };

    const store = new TaxProfileStore(':memory:');
    grantConsent(store, ['bank:1']);
    store.appendEvidenceBatch(
      { ...evidenceBatch(1, [active]), mode: 'full_snapshot' },
      '2026-07-10T00:01:00.000Z',
    );
    store.appendEvidenceBatch(
      evidenceBatch(2, [withdrawn]),
      '2026-07-10T00:02:00.000Z',
    );
    expect(store.listEvidence('workspace:1')).toEqual([withdrawn]);

    const orphanStore = new TaxProfileStore(':memory:');
    grantConsent(orphanStore, ['bank:1']);
    expect(() => orphanStore.appendEvidenceBatch(
      { ...evidenceBatch(1, [withdrawn]), mode: 'full_snapshot' },
      '2026-07-10T00:01:00.000Z',
    )).toThrow('EVIDENCE_SUPERSESSION_TARGET_NOT_FOUND');

    const mismatchStore = new TaxProfileStore(':memory:');
    grantConsent(mismatchStore, ['bank:1']);
    mismatchStore.appendEvidenceBatch(
      { ...evidenceBatch(1, [active]), mode: 'full_snapshot' },
      '2026-07-10T00:01:00.000Z',
    );
    expect(() => mismatchStore.appendEvidenceBatch(
      evidenceBatch(2, [{ ...withdrawn, economicEventId: 'bank-transaction:different' }]),
      '2026-07-10T00:02:00.000Z',
    )).toThrow('EVIDENCE_CASH_SUPERSESSION_MISMATCH');
  });

  test('resolves the latest full snapshot baseline plus later increments regardless of arrival order', () => {
    const store = new TaxProfileStore(':memory:');
    grantConsent(store, ['bank:1']);
    const oldRecord = evidenceRecord();
    const legacyBeforeBaseline = {
      ...oldRecord,
      evidenceId: 'evidence:legacy-before',
      revision: 'legacy-before',
      artifactHash: 'artifact:legacy-before',
      idempotencyKey: 'workspace:1:bank:1:legacy-before',
    };
    const laterRecord = {
      ...oldRecord,
      evidenceId: 'evidence:later',
      revision: '3',
      artifactHash: 'artifact:later',
      idempotencyKey: 'workspace:1:bank:1:event:later:3',
    };
    store.appendEvidence([legacyBeforeBaseline], '2026-07-10T00:00:00.000Z');
    store.appendEvidenceBatch(evidenceBatch(1, [oldRecord]), '2026-07-10T00:01:00.000Z');
    store.appendEvidenceBatch(evidenceBatch(3, [laterRecord]), '2026-07-10T00:03:00.000Z');
    expect(store.listEvidence(oldRecord.workspaceId)).toEqual([oldRecord, laterRecord]);
    store.appendEvidenceBatch({ ...evidenceBatch(2, []), mode: 'full_snapshot' }, '2026-07-10T00:04:00.000Z');
    expect(store.listEvidence(oldRecord.workspaceId)).toEqual([laterRecord]);

    const legacyAfterBaseline = {
      ...legacyBeforeBaseline,
      evidenceId: 'evidence:legacy-after',
      revision: 'legacy-after',
      artifactHash: 'artifact:legacy-after',
      idempotencyKey: 'workspace:1:bank:1:legacy-after',
    };
    store.appendEvidence([legacyAfterBaseline], '2026-07-10T00:05:00.000Z');
    expect(store.listEvidence(oldRecord.workspaceId)).toEqual([laterRecord]);
  });

  test('quarantines the retired append writer and keeps an incremental-only source partial', () => {
    const store = new TaxProfileStore(':memory:');
    grantConsent(store, ['bank:1']);
    const legacy = {
      ...evidenceRecord(),
      evidenceId: 'evidence:legacy',
      revision: 'legacy',
      artifactHash: 'artifact:legacy',
      idempotencyKey: 'workspace:1:bank:1:legacy',
    };
    const canonical = evidenceRecord();
    store.appendEvidence([legacy], '2026-07-10T00:00:00.000Z');
    store.appendEvidenceBatch(evidenceBatch(1, [canonical]), '2026-07-10T00:01:00.000Z');

    expect(store.listEvidence('workspace:1')).toEqual([canonical]);
    expect(store.listEvidenceSourceManifests('workspace:1')[0]?.capabilities[0]).toEqual(expect.objectContaining({
      state: 'partial',
      safeErrorCode: 'EVIDENCE_FULL_SNAPSHOT_REQUIRED',
    }));
  });

  test('bootstraps an authoritative full snapshot whose tip references pruned history', () => {
    const store = new TaxProfileStore(':memory:');
    grantConsent(store, ['bank:1']);
    const tip = {
      ...evidenceRecord(),
      evidenceId: 'evidence:baseline-tip',
      revision: 'baseline-tip',
      artifactHash: 'artifact:baseline-tip',
      idempotencyKey: 'workspace:1:bank:1:baseline-tip',
      supersedesIdempotencyKey: 'workspace:1:bank:1:pruned-predecessor',
    };

    store.appendEvidenceBatch({ ...evidenceBatch(1, [tip]), mode: 'full_snapshot' }, '2026-07-10T00:01:00.000Z');

    expect(store.listEvidence('workspace:1')).toEqual([tip]);
    expect(store.listEvidenceSourceManifests('workspace:1')[0]?.capabilities[0]).toEqual(expect.objectContaining({
      state: 'available',
      safeErrorCode: null,
    }));
  });

  test('lets an authoritative full snapshot replace a conflicting below-baseline orphan successor', () => {
    const store = new TaxProfileStore(':memory:');
    grantConsent(store, ['bank:1']);
    const missingPredecessor = 'workspace:1:bank:1:pruned-predecessor';
    const belowBaseline = {
      ...evidenceRecord(),
      evidenceId: 'evidence:below-baseline',
      revision: 'below-baseline',
      artifactHash: 'artifact:below-baseline',
      idempotencyKey: 'workspace:1:bank:1:below-baseline',
      supersedesIdempotencyKey: missingPredecessor,
    };
    const authoritativeTip = {
      ...belowBaseline,
      evidenceId: 'evidence:authoritative-tip',
      revision: 'authoritative-tip',
      artifactHash: 'artifact:authoritative-tip',
      idempotencyKey: 'workspace:1:bank:1:authoritative-tip',
    };
    store.appendEvidenceBatch(evidenceBatch(2, [belowBaseline]), '2026-07-10T00:02:00.000Z');

    store.appendEvidenceBatch(
      { ...evidenceBatch(3, [authoritativeTip]), mode: 'full_snapshot' },
      '2026-07-10T00:03:00.000Z',
    );

    expect(store.listEvidence('workspace:1')).toEqual([authoritativeTip]);
    expect(store.listEvidenceSourceManifests('workspace:1')[0]?.capabilities[0]?.state).toBe('available');
  });

  test('lets an authoritative full snapshot replace a stored-target fork below its baseline', () => {
    const store = new TaxProfileStore(':memory:');
    grantConsent(store, ['bank:1']);
    const original = evidenceRecord();
    const incrementalSuccessor = {
      ...original,
      evidenceId: 'evidence:incremental-successor',
      revision: '2',
      artifactHash: 'artifact:incremental-successor',
      idempotencyKey: 'workspace:1:bank:1:incremental-successor',
      supersedesIdempotencyKey: original.idempotencyKey,
    };
    const authoritativeSuccessor = {
      ...incrementalSuccessor,
      evidenceId: 'evidence:authoritative-successor',
      revision: '3',
      artifactHash: 'artifact:authoritative-successor',
      idempotencyKey: 'workspace:1:bank:1:authoritative-successor',
    };
    store.appendEvidenceBatch(
      { ...evidenceBatch(1, [original]), mode: 'full_snapshot' },
      '2026-07-10T00:01:00.000Z',
    );
    store.appendEvidenceBatch(evidenceBatch(2, [incrementalSuccessor]), '2026-07-10T00:02:00.000Z');
    store.appendEvidenceBatch(
      { ...evidenceBatch(3, [authoritativeSuccessor]), mode: 'full_snapshot' },
      '2026-07-10T00:03:00.000Z',
    );

    expect(store.listEvidence('workspace:1')).toEqual([authoritativeSuccessor]);
  });

  test('rejects a latest widget snapshot after evidence generation advances', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot();
    store.confirm({
      profile: snapshot.profile,
      expectedVersion: null,
      actorId: 'user:1',
      occurredAt: '2026-07-10T00:00:00.000Z',
    });
    const configured = store.configureSnapshotProjection({
      configuration: {
        version: 'tax-snapshot-projection-configuration-v1',
        workspaceId: snapshot.workspaceId,
        period: snapshot.period,
        displayCurrency: snapshot.displayCurrency,
        dataScope: { mode: 'all_connected' },
      },
      expectedConfigHash: null,
      actorId: 'user:1',
      configuredAt: '2026-07-10T00:00:00.000Z',
    });
    store.saveTaxWidgetSnapshot({
      snapshot,
      projection: { version: 'test-projection', asOf: '2026-07-10T00:00:00.000Z', validUntil: null } as unknown as TaxEvidencePresentationProjectionV1,
      expectedEvidenceGeneration: store.getEvidenceGeneration(snapshot.workspaceId),
      expectedProjectionConfigHash: configured.configHash,
      generatedAt: '2026-07-10T00:00:00.000Z',
    });
    expect(() => store.saveTaxWidgetSnapshot({
      snapshot,
      projection: { version: 'test-projection', asOf: '2026-07-09T23:59:59.000Z', validUntil: null } as unknown as TaxEvidencePresentationProjectionV1,
      expectedEvidenceGeneration: store.getEvidenceGeneration(snapshot.workspaceId),
      expectedProjectionConfigHash: configured.configHash,
      generatedAt: '2026-07-10T00:00:01.000Z',
    })).toThrow('TAX_SNAPSHOT_AS_OF_REGRESSION');
    expect(store.getLatestTaxWidgetSnapshot(snapshot.workspaceId)?.snapshot).toEqual(snapshot);
    store.appendEvidence([{ ...evidenceRecord(), workspaceId: snapshot.workspaceId }], '2026-07-10T00:01:00.000Z');
    expect(() => store.getLatestTaxWidgetSnapshot(snapshot.workspaceId)).toThrow('TAX_SNAPSHOT_STALE');
  });

  test('rejects a latest widget snapshot after its weakest evidence expires', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot();
    store.confirm({
      profile: snapshot.profile,
      expectedVersion: null,
      actorId: 'user:1',
      occurredAt: '2026-07-10T00:00:00.000Z',
    });
    const configured = store.configureSnapshotProjection({
      configuration: {
        version: 'tax-snapshot-projection-configuration-v1',
        workspaceId: snapshot.workspaceId,
        period: snapshot.period,
        displayCurrency: snapshot.displayCurrency,
        dataScope: { mode: 'all_connected' },
      },
      expectedConfigHash: null,
      actorId: 'user:1',
      configuredAt: '2026-07-10T00:00:00.000Z',
    });
    store.saveTaxWidgetSnapshot({
      snapshot,
      projection: {
        version: 'test-projection',
        asOf: '2026-07-10T00:00:00.000Z',
        validUntil: '2026-07-10T00:00:01.000Z',
      } as unknown as TaxEvidencePresentationProjectionV1,
      expectedEvidenceGeneration: store.getEvidenceGeneration(snapshot.workspaceId),
      expectedProjectionConfigHash: configured.configHash,
      generatedAt: '2026-07-10T00:00:00.000Z',
    });

    expect(() => store.getLatestTaxWidgetSnapshot(snapshot.workspaceId)).toThrow('TAX_SNAPSHOT_EXPIRED');
  });

  test('isolates named projection configuration, snapshot identity, and stale reads', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot();
    store.confirm({
      profile: snapshot.profile,
      expectedVersion: null,
      actorId: 'user:1',
      occurredAt: '2026-07-10T00:00:00.000Z',
    });
    const configuration: TaxSnapshotProjectionConfigurationV1 = {
      version: 'tax-snapshot-projection-configuration-v1',
      workspaceId: snapshot.workspaceId,
      period: snapshot.period,
      displayCurrency: snapshot.displayCurrency,
      dataScope: { mode: 'all_connected' },
    };
    const defaultConfiguration = store.configureSnapshotProjection({
      configuration,
      expectedConfigHash: null,
      actorId: 'user:1',
      configuredAt: '2026-07-10T00:00:00.000Z',
    });
    const annualConfiguration = store.configureSnapshotProjection({
      configuration,
      projectionKey: 'annual:2026',
      expectedConfigHash: null,
      actorId: 'user:1',
      configuredAt: '2026-07-10T00:00:01.000Z',
    });
    expect(defaultConfiguration.configHash).toBe(annualConfiguration.configHash);
    expect(store.getEvidenceGeneration(snapshot.workspaceId)).toBe(0);
    const projection = {
      version: 'test-projection',
      asOf: '2026-07-10T00:00:00.000Z',
      validUntil: null,
    } as unknown as TaxEvidencePresentationProjectionV1;
    const defaultReceipt = store.saveTaxWidgetSnapshot({
      snapshot,
      projection,
      expectedEvidenceGeneration: 0,
      expectedProjectionConfigHash: defaultConfiguration.configHash,
      generatedAt: '2026-07-10T00:00:00.000Z',
    });
    const annualReceipt = store.saveTaxWidgetSnapshot({
      snapshot,
      projection,
      projectionKey: 'annual:2026',
      expectedEvidenceGeneration: 0,
      expectedProjectionConfigHash: annualConfiguration.configHash,
      generatedAt: '2026-07-10T00:00:01.000Z',
    });
    expect(defaultReceipt.snapshotHash).toBe(annualReceipt.snapshotHash);
    expect(defaultReceipt.projectionKey).toBe('default');
    expect(annualReceipt.projectionKey).toBe('annual:2026');

    const replacement = store.configureSnapshotProjection({
      configuration: { ...configuration, dataScope: { mode: 'selected', sourceIds: ['bank:1'], includeKnowledgeGraph: false } },
      expectedConfigHash: defaultConfiguration.configHash,
      actorId: 'user:1',
      configuredAt: '2026-07-10T00:00:02.000Z',
    });
    expect(replacement.projectionKey).toBe('default');
    expect(store.getEvidenceGeneration(snapshot.workspaceId)).toBe(0);
    expect(store.getLatestTaxWidgetSnapshot(snapshot.workspaceId, '2026-07-10T00:00:03.000Z')).toBeNull();
    expect(store.getLatestTaxWidgetSnapshot(
      snapshot.workspaceId,
      '2026-07-10T00:00:03.000Z',
      'annual:2026',
    )?.snapshotHash).toBe(annualReceipt.snapshotHash);

    store.appendEvidence([{ ...evidenceRecord(), workspaceId: snapshot.workspaceId }], '2026-07-10T00:00:04.000Z');
    expect(() => store.getLatestTaxWidgetSnapshot(
      snapshot.workspaceId,
      '2026-07-10T00:00:05.000Z',
      'annual:2026',
    )).toThrow('TAX_SNAPSHOT_STALE');
  });

  test('reopens durable evidence checkpoints and the latest widget snapshot from disk', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tax-engine-evidence-'));
    const databasePath = join(directory, 'tax.sqlite');
    try {
      const first = new TaxProfileStore(databasePath);
      grantConsent(first, ['bank:1']);
      first.confirm({
        profile: { ...argentinaProfile(), workspaceId: 'workspace:1', profileId: 'profile:durable' },
        expectedVersion: null,
        actorId: 'user:1',
        occurredAt: '2026-07-10T00:00:00.000Z',
      });
      const evidenceService = new TaxEvidenceWorkspaceService(first, () => new Date('2026-07-10T12:00:00.000Z'));
      evidenceService.configureSnapshotProjection({
        workspaceId: 'workspace:1',
        actorId: 'user:1',
        expectedConfigHash: null,
        period: { start: '2026-01-01', end: '2026-12-31' },
        displayCurrency: 'ARS',
        dataScope: { mode: 'all_connected' },
      });
      first.appendEvidenceBatch(evidenceBatch(1, [evidenceRecord()]), '2026-07-10T00:00:01.000Z');
      const projected = await evidenceService.projectSnapshot({
        workspaceId: 'workspace:1',
        actorId: 'user:1',
        period: { start: '2026-01-01', end: '2026-12-31' },
        displayCurrency: 'ARS',
        asOf: '2026-07-10T12:00:00.000Z',
        dataScope: { mode: 'all_connected' },
      });
      first.close();

      const reopened = new TaxProfileStore(databasePath);
      expect(reopened.listEvidenceSourceManifests('workspace:1')[0]?.checkpoint.sequence).toBe(1);
      expect(reopened.getLatestTaxWidgetSnapshot('workspace:1', '2026-07-10T12:00:00.000Z')?.inputHash).toBe(projected.snapshot.inputHash);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('commits Factura E truth and its domain outbox event atomically', () => {
    const createStore = () => {
      const store = new TaxProfileStore(
        ':memory:',
        'test-tax-domain-event-commitment-secret-v1',
      );
      grantConsent(store, ['bufi-invoice']);
      const created = createFacturaEAgentRun({
        runId: 'taxcase:factura-e:1',
        workspaceId: 'workspace:1',
        issuancePath: 'wsfex_delegated',
        actorId: 'agent:1',
        occurredAt: '2026-07-10T00:00:00.000Z',
        idempotencyKey: 'create-run',
      });
      store.appendFacturaEAgentRevision({
        ...created,
        stateHash: hashCanonical(created.run),
        commandHash: hashCanonical({ operation: 'create-run' }),
        appendedAt: created.event.occurredAt,
      });
      return { store, created };
    };
    const transition = (created: ReturnType<typeof createFacturaEAgentRun>) => {
      const event = {
        eventId: '70000000-0000-4000-8000-000000000001',
        runId: created.run.runId,
        workspaceId: created.run.workspaceId,
        actorId: 'wsfex:verifier',
        actorKind: 'wsfex' as const,
        action: 'wsfex_accepted',
        occurredAt: '2026-07-10T00:01:00.000Z',
        idempotencyKey: 'authority-accepted',
        safeMetadata: {
          receiptHash: 'a'.repeat(64),
        },
      };
      const run = {
        ...created.run,
        revision: created.run.revision + 1,
        updatedAt: event.occurredAt,
        issuanceState: 'arca_authorized' as const,
        authority: {
          ...created.run.authority,
          receiptHash: 'a'.repeat(64),
          authorizedAt: event.occurredAt,
        },
        eventIds: [...created.run.eventIds, event.eventId],
      };
      return { run, event };
    };

    const successful = createStore();
    const accepted = transition(successful.created);
    successful.store.appendFacturaEAgentRevision({
      ...accepted,
      stateHash: hashCanonical(accepted.run),
      commandHash: hashCanonical({ operation: 'authority-accepted' }),
      appendedAt: accepted.event.occurredAt,
    });
    expect(successful.store.listPendingTaxDomainEvents()).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace:1',
        caseRef: 'taxcase:factura-e:1',
        kind: 'factura_e.authority_verified',
        state: 'verified',
      }),
    ]);
    successful.store.close();

    const conflicted = createStore();
    const rejected = transition(conflicted.created);
    const [derived] = createFacturaEAgentTaxDomainEvents({
      ...rejected,
      consent: {
        version: 'consent-v1',
        scopeHash: hashTaxEvidenceConsentScope('consent-v1', ['bufi-invoice']),
      },
      commitmentSecret: 'test-tax-domain-event-commitment-secret-v1',
    });
    if (!derived) throw new Error('FACTURA_E_DOMAIN_EVENT_REQUIRED');
    conflicted.store.appendTaxDomainEvent(
      { ...derived, state: 'blocked' },
      rejected.event.occurredAt,
    );
    expect(() => conflicted.store.appendFacturaEAgentRevision({
      ...rejected,
      stateHash: hashCanonical(rejected.run),
      commandHash: hashCanonical({ operation: 'authority-accepted' }),
      appendedAt: rejected.event.occurredAt,
    })).toThrow('TAX_DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
    expect(conflicted.store.getFacturaEAgentRun(rejected.run.runId)?.revision).toBe(1);
    conflicted.store.close();
  });

  test('rolls back an accountant decision unless its exact mandate is active', () => {
    const store = new TaxProfileStore(
      ':memory:',
      'test-tax-domain-event-commitment-secret-v1',
    );
    grantConsent(store, ['accountant-workspace']);
    const created = createFacturaEAgentRun({
      runId: 'taxcase:accountant-decision:1',
      workspaceId: 'workspace:1',
      issuancePath: 'wsfex_delegated',
      actorId: 'agent:1',
      occurredAt: '2026-07-10T00:00:00.000Z',
      idempotencyKey: 'create-accountant-run',
    });
    store.appendFacturaEAgentRevision({
      ...created,
      stateHash: hashCanonical(created.run),
      commandHash: hashCanonical({ operation: 'create-accountant-run' }),
      appendedAt: created.event.occurredAt,
    });
    const event = {
      eventId: '71000000-0000-4000-8000-000000000001',
      runId: created.run.runId,
      workspaceId: created.run.workspaceId,
      actorId: 'accountant:1',
      actorKind: 'accountant' as const,
      action: 'factura_e_fx_ingress_verified',
      occurredAt: '2026-07-10T00:02:00.000Z',
      idempotencyKey: 'accountant-fx-decision',
      safeMetadata: { evidenceHash: 'f'.repeat(64) },
    };
    const run = {
      ...created.run,
      revision: 2,
      updatedAt: event.occurredAt,
      fxIngressState: 'verified' as const,
      fxIngressEvidenceHash: 'f'.repeat(64),
      eventIds: [...created.run.eventIds, event.eventId],
    };
    const append = () => store.appendFacturaEAgentRevision({
      run,
      event,
      stateHash: hashCanonical(run),
      commandHash: hashCanonical({ operation: 'accountant-fx-decision' }),
      appendedAt: event.occurredAt,
    });

    expect(append).toThrow('ACCOUNTANT_MANDATE_REQUIRED_FOR_DOMAIN_EVENT');
    expect(store.getFacturaEAgentRun(run.runId)?.revision).toBe(1);

    store.grantAccountantMandate({
      version: 'accountant-mandate-v1',
      mandateId: 'mandate:accountant-fx:1',
      workspaceId: run.workspaceId,
      accountantActorId: event.actorId,
      accountantOrganizationId: 'accounting-firm:1',
      scopes: ['verify_fx_ingress'],
      grantedByActorId: 'user:1',
      grantedAt: '2026-07-10T00:01:00.000Z',
      expiresAt: '2026-07-11T00:00:00.000Z',
      revokedAt: null,
    });
    expect(append().revision).toBe(2);
    expect(store.listPendingTaxDomainEvents()).toEqual([
      expect.objectContaining({
        kind: 'accountant.decision_recorded',
        state: 'recorded',
        workspaceId: run.workspaceId,
        caseRef: run.runId,
      }),
    ]);
    expect(JSON.stringify(store.listPendingTaxDomainEvents()))
      .not.toContain('mandate:accountant-fx:1');
    store.close();
  });
});

function evidenceBatch(sequence: number, records: readonly TaxEvidenceRecord[]): TaxEvidenceBatchV1 {
  const sourceIds = ['bank:1'];
  return {
    version: 'tax-evidence-batch-v1',
    batchId: `batch:${sequence}`,
    workspaceId: 'workspace:1',
    source: { sourceId: 'bank:1', sourceKind: 'bank', canonicalProviderId: null, adapterSchemaVersion: 'test-v1' },
    checkpoint: { sequence, revision: `revision:${sequence}`, observedAt: '2026-07-10T00:00:00.000Z' },
    mode: 'incremental',
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent-v1',
      sourceIds,
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
    },
    capabilities: [{ capability: 'transactions', state: 'available', observedAt: '2026-07-10T00:00:00.000Z', safeErrorCode: null }],
    records,
    producedAt: '2026-07-10T00:00:01.000Z',
  };
}

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
    economicRole: 'invoice',
    invoiceDocumentKind: null,
    invoiceAdjustmentKind: null,
    adjustsEconomicEventId: null,
    countingDimension: 'revenue',
    direction: 'inflow',
    money: { decimal: '100', currency: 'ARS' },
    normalizedMoney: { decimal: '100', currency: 'ARS' },
    fxReferenceId: null,
    partyClaimHash: 'party:hash',
    accountReferenceHash: 'account:hash',
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted',
    validityState: 'active',
    consentVersion: 'consent-v1',
    idempotencyKey: 'workspace:1:bank:1:event:hash:1',
    supersedesIdempotencyKey: null,
  };
}

function invoiceEvidenceBatch(sequence: number, records: readonly TaxEvidenceRecord[]): TaxEvidenceBatchV1 {
  const sourceIds = ['bufi-invoice'];
  return {
    version: 'tax-evidence-batch-v1',
    batchId: `invoice-batch:${sequence}`,
    workspaceId: 'workspace:1',
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
      sourceIds,
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
    },
    capabilities: [{ capability: 'invoices', state: 'available', observedAt: '2026-07-10T00:00:00.000Z', safeErrorCode: null }],
    records,
    producedAt: '2026-07-10T00:00:01.000Z',
  };
}

function invoiceEvidenceRecord(
  evidenceId: string,
  economicRole: 'invoice' | 'settlement',
  validityState: TaxEvidenceRecord['validityState'],
  supersedesIdempotencyKey: string | null,
): TaxEvidenceRecord {
  const carriesMoney = economicRole === 'invoice';
  return {
    ...evidenceRecord(),
    evidenceId,
    sourceId: 'bufi-invoice',
    sourceKind: 'bufi_invoice',
    canonicalProviderId: 'bufi',
    revision: evidenceId,
    externalReferenceHash: `external:${evidenceId}`,
    sourceEventHash: `event:${evidenceId}`,
    artifactHash: `artifact:${evidenceId}`,
    economicEventId: 'economic:invoice:1',
    economicRole,
    invoiceDocumentKind: economicRole === 'invoice' ? 'arca_factura_e' : null,
    countingDimension: carriesMoney ? 'revenue' : 'none',
    money: carriesMoney ? { decimal: '100', currency: 'ARS' } : null,
    normalizedMoney: carriesMoney ? { decimal: '100', currency: 'ARS' } : null,
    idempotencyKey: `workspace:1:bufi-invoice:${evidenceId}`,
    supersedesIdempotencyKey,
    validityState,
  };
}

function grantConsent(store: TaxProfileStore, sourceIds: readonly string[]): void {
  const event = consentLifecycleEvent(1, 'grant', sourceIds, '00000000-0000-4000-8000-000000000001');
  expect(store.appendEvidenceConsentEvent(event)).toEqual(expect.objectContaining({ replayed: false }));
}

function consentLifecycleEvent(
  sequence: number,
  action: 'grant' | 'revoke',
  sourceIds: readonly string[],
  eventId: string,
  consentVersion = 'consent-v1',
): TaxEvidenceConsentEventV1 {
  return {
    version: 'tax-evidence-consent-event-v1',
    eventId,
    workspaceId: 'workspace:1',
    sequence,
    action,
    authoritySource: 'desk_subscription',
    actorReferenceHash: hashTaxEvidenceConsentScope('actor-v1', ['user:owner']),
    consent: {
      purpose: 'tax_workspace_processing',
      version: consentVersion,
      scopeHash: hashTaxEvidenceConsentScope(consentVersion, sourceIds),
      sourceIds,
    },
    occurredAt: `2026-07-${String(8 + sequence).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function createLegacyEvidenceDatabase(path: string, interrupted: boolean): void {
  const database = new Database(path, { create: true });
  database.exec(`
    CREATE TABLE evidence_records (
      workspace_id TEXT NOT NULL,
      ${interrupted ? 'source_id TEXT,' : ''}
      idempotency_key TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      artifact_hash TEXT NOT NULL,
      record_json TEXT NOT NULL,
      appended_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, idempotency_key)
    )
  `);
  const currentRecord = evidenceRecord();
  const {
    invoiceAdjustmentKind: _invoiceAdjustmentKind,
    adjustsEconomicEventId: _adjustsEconomicEventId,
    ...record
  } = currentRecord;
  const columns = interrupted
    ? '(workspace_id, source_id, idempotency_key, evidence_id, revision, artifact_hash, record_json, appended_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)'
    : '(workspace_id, idempotency_key, evidence_id, revision, artifact_hash, record_json, appended_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
  database.query(`INSERT INTO evidence_records ${columns}`).run(
    record.workspaceId,
    record.idempotencyKey,
    record.evidenceId,
    record.revision,
    record.artifactHash,
    JSON.stringify(record),
    '2026-07-10T00:00:00.000Z',
  );
  database.close();
}

function createLegacySnapshotDatabase(
  path: string,
  snapshot: TaxWidgetSnapshotV1,
  configuration: TaxSnapshotProjectionConfigurationV1,
  projection: TaxEvidencePresentationProjectionV1,
): void {
  const database = new Database(path, { create: true });
  database.exec(`
    CREATE TABLE tax_profiles (
      workspace_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      profile_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tax_evidence_generations (
      workspace_id TEXT PRIMARY KEY,
      generation INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tax_snapshot_projection_configurations (
      workspace_id TEXT PRIMARY KEY,
      config_hash TEXT NOT NULL,
      config_json TEXT NOT NULL,
      configured_at TEXT NOT NULL
    );
    CREATE TABLE tax_widget_snapshots (
      workspace_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      projection_json TEXT NOT NULL,
      projection_config_hash TEXT NOT NULL,
      evidence_generation INTEGER NOT NULL,
      as_of TEXT NOT NULL,
      valid_until TEXT,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, snapshot_hash, evidence_generation)
    );
  `);
  const configHash = hashCanonical(configuration);
  database.query(`
    INSERT INTO tax_profiles (workspace_id, version, profile_json, updated_at)
    VALUES (?, 1, ?, '2026-07-10T00:00:00.000Z')
  `).run(snapshot.workspaceId, JSON.stringify(snapshot.profile));
  database.query(`
    INSERT INTO tax_evidence_generations (workspace_id, generation, updated_at)
    VALUES (?, 0, '2026-07-10T00:00:00.000Z')
  `).run(snapshot.workspaceId);
  database.query(`
    INSERT INTO tax_snapshot_projection_configurations (workspace_id, config_hash, config_json, configured_at)
    VALUES (?, ?, ?, '2026-07-10T00:00:00.000Z')
  `).run(snapshot.workspaceId, configHash, JSON.stringify(configuration));
  database.query(`
    INSERT INTO tax_widget_snapshots (
      workspace_id, snapshot_hash, input_hash, snapshot_json, projection_json, projection_config_hash,
      evidence_generation, as_of, valid_until, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, '2026-07-10T00:00:00.000Z', NULL, '2026-07-10T00:00:00.000Z')
  `).run(
    snapshot.workspaceId,
    hashCanonical(snapshot),
    snapshot.inputHash,
    JSON.stringify(snapshot),
    JSON.stringify(projection),
    configHash,
  );
  database.close();
}
