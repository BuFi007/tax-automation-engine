import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

import type { TaxWidgetSnapshotV1 as BrowserTaxWidgetSnapshotV1 } from '@tax-engine/browser-contracts';

import type {
  ArcaOnboardingEventV1,
  AccountantMandateV1,
  AccountantMandateScope,
  ArcaOnboardingReclaimSessionV1,
  ArcaOnboardingRunV1,
  ComplianceWorkspaceState,
  FacturaEAgentEventV1,
  FacturaEAgentRunV1,
  ReclaimSessionReferenceV1,
  TaxConsentGrant,
  TaxEvidenceBatchReceiptV1,
  TaxEvidenceBatchV1,
  TaxEvidenceConsentEventReceiptV1,
  TaxEvidenceConsentEventV1,
  TaxEvidencePresentationProjectionV1,
  TaxEvidenceRecord,
  TaxEvidenceSourceManifestV1,
  TaxProfile,
  TaxSnapshotProjectionConfigurationV1,
  TaxWidgetSnapshotReceiptV1,
  TaxWidgetSnapshotV1,
  TaxDomainEventV1,
} from '@tax-engine/core';
import {
  assertTaxEvidenceBatchV1,
  assertActiveAccountantMandate,
  hashCanonical,
  assertTaxDomainEventV1,
  hashTaxDomainEventV1,
  hashTaxEvidenceBatch,
  normalizeTaxSnapshotProjectionKey,
  resolveActiveEvidenceRecords,
} from '@tax-engine/core';

import { assertCatalogueSafeProfile } from './profile-validation';
import {
  accountantMandateScopeForFacturaEEvent,
  createArcaOnboardingTaxDomainEvent,
  createConsentRevokedTaxDomainEvent,
  createFacturaEAgentTaxDomainEvents,
  createSnapshotTaxDomainEvents,
  resolveTaxDomainEventCommitmentSecret,
} from './tax-domain-event-factory';

export function resolveTaxEngineDatabasePath(
  configuredPath: string | null | undefined = process.env.TAX_ENGINE_DB_PATH,
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
): string {
  const path = configuredPath?.trim() || ':memory:';
  if (nodeEnvironment === 'production' && isInMemorySqlitePath(path)) {
    throw new Error('TAX_ENGINE_DB_PATH_REQUIRED_IN_PRODUCTION');
  }
  return path;
}

function isInMemorySqlitePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized === ':memory:'
    || normalized.startsWith('file::memory:')
    || /(?:\?|&)mode=memory(?:&|$)/.test(normalized);
}

type StoredTaxWidgetSnapshotRow = Readonly<{
  workspace_id: string;
  projection_key: string;
  snapshot_hash: string;
  input_hash: string;
  snapshot_json: string;
  projection_json: string;
  projection_config_hash: string;
  evidence_generation: number;
  as_of: string;
  valid_until: string | null;
  generated_at: string;
}>;

type StoredBrowserTaxCaseRow = Readonly<{
  case_ref: string;
  revision: number;
  source_fingerprint: string;
}>;

type StoredBrowserTaxSnapshotRow = Readonly<{
  case_ref: string;
  case_revision: number;
  source_fingerprint: string;
  browser_snapshot_hash: string;
  snapshot_json: string;
}>;

export class TaxProfileStore {
  readonly #db: Database;
  readonly #domainEventCommitmentSecret: string;

  constructor(
    path = process.env.TAX_ENGINE_DB_PATH,
    domainEventCommitmentSecret = resolveTaxDomainEventCommitmentSecret(),
  ) {
    const databasePath = resolveTaxEngineDatabasePath(path);
    this.#domainEventCommitmentSecret = domainEventCommitmentSecret;
    this.#db = new Database(databasePath, { create: true });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tax_profiles (
        workspace_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        safe_metadata_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accountant_mandates (
        mandate_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        accountant_actor_id TEXT NOT NULL,
        mandate_json TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS accountant_mandates_workspace_actor
        ON accountant_mandates (workspace_id, accountant_actor_id, expires_at);
      CREATE TABLE IF NOT EXISTS evidence_records (
        workspace_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        record_json TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS tax_domain_event_outbox (
        event_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        event_json TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        leased_until TEXT,
        lease_token TEXT,
        delivery_attempts INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT,
        last_error_code TEXT,
        UNIQUE (workspace_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS tax_domain_event_outbox_pending
        ON tax_domain_event_outbox (delivered_at, leased_until, appended_at);
      CREATE INDEX IF NOT EXISTS evidence_records_workspace_revision
        ON evidence_records (workspace_id, revision);
      CREATE TABLE IF NOT EXISTS evidence_supersessions (
        workspace_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        superseded_idempotency_key TEXT NOT NULL,
        successor_idempotency_key TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, superseded_idempotency_key),
        UNIQUE (workspace_id, successor_idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS evidence_batches (
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        batch_hash TEXT NOT NULL,
        batch_json TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, batch_id)
      );
      CREATE TABLE IF NOT EXISTS evidence_source_checkpoints (
        workspace_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('incremental', 'full_snapshot')),
        revision TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        batch_hash TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, source_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS evidence_source_checkpoints_latest
        ON evidence_source_checkpoints (workspace_id, source_id, sequence DESC);
      CREATE TABLE IF NOT EXISTS evidence_batch_records (
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        PRIMARY KEY (workspace_id, batch_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS evidence_batch_records_lookup
        ON evidence_batch_records (workspace_id, source_id, idempotency_key, sequence);
      CREATE TABLE IF NOT EXISTS evidence_consent_events (
        event_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
        event_hash TEXT NOT NULL,
        event_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (workspace_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS evidence_consent_grants (
        workspace_id TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose = 'tax_workspace_processing'),
        version TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        source_ids_json TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        revoked_at TEXT,
        grant_event_id TEXT NOT NULL,
        revoke_event_id TEXT,
        PRIMARY KEY (workspace_id, purpose, version, scope_hash),
        UNIQUE (workspace_id, purpose, version)
      );
      CREATE TABLE IF NOT EXISTS tax_evidence_generations (
        workspace_id TEXT PRIMARY KEY,
        generation INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tax_snapshot_projection_configurations (
        workspace_id TEXT NOT NULL,
        projection_key TEXT NOT NULL DEFAULT 'default',
        config_hash TEXT NOT NULL,
        config_json TEXT NOT NULL,
        configured_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, projection_key)
      );
      CREATE TABLE IF NOT EXISTS tax_widget_snapshots (
        workspace_id TEXT NOT NULL,
        projection_key TEXT NOT NULL DEFAULT 'default',
        snapshot_hash TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        projection_json TEXT NOT NULL,
        projection_config_hash TEXT NOT NULL,
        evidence_generation INTEGER NOT NULL,
        as_of TEXT NOT NULL,
        valid_until TEXT,
        generated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, projection_key, snapshot_hash, evidence_generation)
      );
      CREATE TABLE IF NOT EXISTS tax_browser_cases (
        workspace_id TEXT NOT NULL,
        projection_key TEXT NOT NULL,
        case_ref TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        source_fingerprint TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, projection_key),
        UNIQUE (case_ref)
      );
      CREATE TABLE IF NOT EXISTS tax_browser_snapshots (
        workspace_id TEXT NOT NULL,
        projection_key TEXT NOT NULL,
        case_ref TEXT NOT NULL,
        case_revision INTEGER NOT NULL CHECK (case_revision > 0),
        source_fingerprint TEXT NOT NULL,
        browser_snapshot_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, projection_key, case_revision)
      );
      CREATE TABLE IF NOT EXISTS workflow_revisions (
        workspace_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, revision)
      );
      CREATE TABLE IF NOT EXISTS factura_e_agent_revisions (
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        event_json TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (run_id, revision),
        UNIQUE (run_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS factura_e_agent_workspace
        ON factura_e_agent_revisions (workspace_id, run_id, revision);
      CREATE TABLE IF NOT EXISTS factura_e_agent_idempotency_commands (
        run_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (run_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS arca_onboarding_revisions (
        onboarding_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        event_json TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (onboarding_id, revision),
        UNIQUE (onboarding_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS arca_onboarding_workspace
        ON arca_onboarding_revisions (workspace_id, onboarding_id, revision);
      CREATE TABLE IF NOT EXISTS reclaim_session_bindings (
        session_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_version TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        bound_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reclaim_request_artifacts (
        session_id TEXT PRIMARY KEY,
        request_url TEXT NOT NULL,
        request_config TEXT NOT NULL,
        status_url TEXT NOT NULL,
        stored_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arca_onboarding_reclaim_bindings (
        session_id TEXT PRIMARY KEY,
        onboarding_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_version TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        bound_at TEXT NOT NULL
      );
    `);
    const taxDomainOutboxColumns = this.#db
      .query<{ name: string }, []>('PRAGMA table_info(tax_domain_event_outbox)')
      .all();
    if (!taxDomainOutboxColumns.some(column => column.name === 'lease_token')) {
      this.#db.exec('ALTER TABLE tax_domain_event_outbox ADD COLUMN lease_token TEXT');
    }
    this.#db.transaction(() => {
      const evidenceColumns = this.#db.query<{ name: string; notnull: number }, []>('PRAGMA table_info(evidence_records)').all();
      const sourceColumn = evidenceColumns.find(column => column.name === 'source_id');
      const nullSources = sourceColumn
        ? this.#db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM evidence_records WHERE source_id IS NULL').get()?.count ?? 0
        : 0;
      if (!sourceColumn || sourceColumn.notnull !== 1 || nullSources > 0) {
        this.#db.exec(`
          DROP TABLE IF EXISTS evidence_records_bu234_migration;
          CREATE TABLE evidence_records_bu234_migration (
            workspace_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            evidence_id TEXT NOT NULL,
            revision TEXT NOT NULL,
            artifact_hash TEXT NOT NULL,
            record_json TEXT NOT NULL,
            appended_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, idempotency_key)
          );
        `);
        const legacyRows = this.#db.query<{
          workspace_id: string;
          idempotency_key: string;
          evidence_id: string;
          revision: string;
          artifact_hash: string;
          record_json: string;
          appended_at: string;
        }, []>(`
          SELECT workspace_id, idempotency_key, evidence_id, revision, artifact_hash, record_json, appended_at
          FROM evidence_records
          ORDER BY rowid ASC
        `).all();
        const insertMigrated = this.#db.query(`
          INSERT INTO evidence_records_bu234_migration (
            workspace_id, source_id, idempotency_key, evidence_id, revision, artifact_hash, record_json, appended_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of legacyRows) {
          const record = normalizeEvidenceRecord(JSON.parse(row.record_json) as TaxEvidenceRecord);
          if (!record.sourceId) throw new Error('EVIDENCE_SOURCE_MIGRATION_INVALID');
          insertMigrated.run(
            row.workspace_id,
            record.sourceId,
            row.idempotency_key,
            row.evidence_id,
            row.revision,
            row.artifact_hash,
            JSON.stringify(record),
            row.appended_at,
          );
        }
        const migratedCount = this.#db.query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM evidence_records_bu234_migration',
        ).get()?.count ?? 0;
        if (migratedCount !== legacyRows.length) throw new Error('EVIDENCE_SOURCE_MIGRATION_INCOMPLETE');
        this.#db.exec(`
          DROP TABLE evidence_records;
          ALTER TABLE evidence_records_bu234_migration RENAME TO evidence_records;
        `);
      }
      this.#db.exec(`
        CREATE INDEX IF NOT EXISTS evidence_records_workspace_revision
          ON evidence_records (workspace_id, revision);
        CREATE INDEX IF NOT EXISTS evidence_records_workspace_source
          ON evidence_records (workspace_id, source_id);
      `);
      this.#db.query(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES ('bu234-evidence-source-id-v1', ?)
        ON CONFLICT(version) DO NOTHING
      `).run(new Date().toISOString());
    })();
    this.#db.transaction(() => {
      const configurationColumns = this.#db.query<{ name: string; pk: number }, []>(
        'PRAGMA table_info(tax_snapshot_projection_configurations)',
      ).all();
      const configurationHasProjectionKey = configurationColumns.some(column => column.name === 'projection_key');
      const configurationPrimaryKey = configurationColumns
        .filter(column => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map(column => column.name);
      if (configurationPrimaryKey.join(',') !== 'workspace_id,projection_key') {
        this.#db.exec(`
          DROP TABLE IF EXISTS tax_snapshot_projection_configurations_bu250_migration;
          CREATE TABLE tax_snapshot_projection_configurations_bu250_migration (
            workspace_id TEXT NOT NULL,
            projection_key TEXT NOT NULL DEFAULT 'default',
            config_hash TEXT NOT NULL,
            config_json TEXT NOT NULL,
            configured_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, projection_key)
          );
          INSERT INTO tax_snapshot_projection_configurations_bu250_migration (
            workspace_id, projection_key, config_hash, config_json, configured_at
          )
          SELECT workspace_id, ${configurationHasProjectionKey ? "COALESCE(projection_key, 'default')" : "'default'"}, config_hash, config_json, configured_at
          FROM tax_snapshot_projection_configurations;
          DROP TABLE tax_snapshot_projection_configurations;
          ALTER TABLE tax_snapshot_projection_configurations_bu250_migration
            RENAME TO tax_snapshot_projection_configurations;
        `);
      }

      const snapshotColumns = this.#db.query<{ name: string; pk: number }, []>('PRAGMA table_info(tax_widget_snapshots)').all();
      const hasProjectionKey = snapshotColumns.some(column => column.name === 'projection_key');
      const hasValidUntil = snapshotColumns.some(column => column.name === 'valid_until');
      const hasProjectionConfigHash = snapshotColumns.some(column => column.name === 'projection_config_hash');
      const hasAsOf = snapshotColumns.some(column => column.name === 'as_of');
      const snapshotPrimaryKey = snapshotColumns
        .filter(column => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map(column => column.name);
      if (snapshotPrimaryKey.join(',') !== 'workspace_id,projection_key,snapshot_hash,evidence_generation') {
        this.#db.exec(`
          DROP TABLE IF EXISTS tax_widget_snapshots_bu250_migration;
          CREATE TABLE tax_widget_snapshots_bu250_migration (
            workspace_id TEXT NOT NULL,
            projection_key TEXT NOT NULL DEFAULT 'default',
            snapshot_hash TEXT NOT NULL,
            input_hash TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            projection_json TEXT NOT NULL,
            projection_config_hash TEXT NOT NULL,
            evidence_generation INTEGER NOT NULL,
            as_of TEXT NOT NULL,
            valid_until TEXT,
            generated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, projection_key, snapshot_hash, evidence_generation)
          );
        `);
        this.#db.exec(`
          INSERT INTO tax_widget_snapshots_bu250_migration (
            workspace_id, projection_key, snapshot_hash, input_hash, snapshot_json, projection_json,
            projection_config_hash, evidence_generation, as_of, valid_until, generated_at
          )
          SELECT
            workspace_id,
            ${hasProjectionKey ? "COALESCE(projection_key, 'default')" : "'default'"},
            snapshot_hash,
            input_hash,
            snapshot_json,
            projection_json,
            ${hasProjectionConfigHash ? 'projection_config_hash' : "'legacy-unconfigured'"},
            evidence_generation,
            ${hasAsOf ? 'as_of' : "'1970-01-01T00:00:00.000Z'"},
            ${hasValidUntil ? 'valid_until' : 'NULL'},
            generated_at
          FROM tax_widget_snapshots
        `);
        this.#db.exec(`
          DROP TABLE tax_widget_snapshots;
          ALTER TABLE tax_widget_snapshots_bu250_migration RENAME TO tax_widget_snapshots;
        `);
      } else {
        if (!hasValidUntil) this.#db.exec('ALTER TABLE tax_widget_snapshots ADD COLUMN valid_until TEXT');
        if (!hasProjectionConfigHash) {
          this.#db.exec("ALTER TABLE tax_widget_snapshots ADD COLUMN projection_config_hash TEXT NOT NULL DEFAULT 'legacy-unconfigured'");
        }
        if (!hasAsOf) {
          this.#db.exec("ALTER TABLE tax_widget_snapshots ADD COLUMN as_of TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
        }
      }
      this.#db.query(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES ('bu250-named-tax-snapshot-projections-v1', ?)
        ON CONFLICT(version) DO NOTHING
      `).run(new Date().toISOString());
    })();
    this.#db.transaction(() => {
      const uniqueIndexColumns = this.#db.query<{
        index_name: string;
        column_name: string;
        sequence: number;
      }, []>(`
        SELECT
          indexes.name AS index_name,
          columns.name AS column_name,
          columns.seqno AS sequence
        FROM pragma_index_list('tax_browser_snapshots') AS indexes
        JOIN pragma_index_info(indexes.name) AS columns
        WHERE indexes."unique" = 1 AND indexes.origin <> 'pk'
        ORDER BY indexes.name ASC, columns.seqno ASC
      `).all();
      const columnsByIndex = new Map<string, string[]>();
      for (const row of uniqueIndexColumns) {
        const columns = columnsByIndex.get(row.index_name) ?? [];
        columns.push(row.column_name);
        columnsByIndex.set(row.index_name, columns);
      }
      const hasHistoricalFingerprintUniqueness = [...columnsByIndex.values()].some(columns => (
        columns.join(',') === 'workspace_id,projection_key,source_fingerprint'
      ));
      if (hasHistoricalFingerprintUniqueness) {
        const existingCount = this.#db.query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM tax_browser_snapshots',
        ).get()?.count ?? 0;
        this.#db.exec(`
          DROP TABLE IF EXISTS tax_browser_snapshots_bu234_migration;
          CREATE TABLE tax_browser_snapshots_bu234_migration (
            workspace_id TEXT NOT NULL,
            projection_key TEXT NOT NULL,
            case_ref TEXT NOT NULL,
            case_revision INTEGER NOT NULL CHECK (case_revision > 0),
            source_fingerprint TEXT NOT NULL,
            browser_snapshot_hash TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, projection_key, case_revision)
          );
          INSERT INTO tax_browser_snapshots_bu234_migration (
            workspace_id, projection_key, case_ref, case_revision, source_fingerprint,
            browser_snapshot_hash, snapshot_json, generated_at
          )
          SELECT
            workspace_id, projection_key, case_ref, case_revision, source_fingerprint,
            browser_snapshot_hash, snapshot_json, generated_at
          FROM tax_browser_snapshots
          ORDER BY workspace_id ASC, projection_key ASC, case_revision ASC;
        `);
        const migratedCount = this.#db.query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM tax_browser_snapshots_bu234_migration',
        ).get()?.count ?? 0;
        if (migratedCount !== existingCount) {
          throw new Error('TAX_BROWSER_SNAPSHOT_MIGRATION_INCOMPLETE');
        }
        this.#db.exec(`
          DROP TABLE tax_browser_snapshots;
          ALTER TABLE tax_browser_snapshots_bu234_migration RENAME TO tax_browser_snapshots;
        `);
      }
      this.#db.query(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES ('bu234-browser-tax-snapshot-append-only-v2', ?)
        ON CONFLICT(version) DO NOTHING
      `).run(new Date().toISOString());
    })();
    this.#db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS evidence_consent_grants_workspace_version
      ON evidence_consent_grants (workspace_id, purpose, version);
      CREATE INDEX IF NOT EXISTS tax_widget_snapshots_latest_projection
      ON tax_widget_snapshots (workspace_id, projection_key, projection_config_hash, generated_at DESC);
      CREATE INDEX IF NOT EXISTS tax_browser_snapshots_latest
      ON tax_browser_snapshots (workspace_id, projection_key, case_revision DESC)
    `);
    this.#db.query(`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES ('bu234-browser-tax-snapshot-case-v1', ?)
      ON CONFLICT(version) DO NOTHING
    `).run(new Date().toISOString());
  }

  close(): void {
    this.#db.close();
  }

  /**
   * Persist a privacy-minimized TaxDomainEvent before any agent workflow is
   * notified. The workspace/idempotency uniqueness is the convergence point
   * for retries and reordered upstream provider callbacks.
   */
  appendTaxDomainEvent(eventInput: TaxDomainEventV1, appendedAt: string): Readonly<{
    event: TaxDomainEventV1;
    replayed: boolean;
  }> {
    const event = assertTaxDomainEventV1(eventInput);
    return this.#db.transaction(() => this.#appendTaxDomainEventInTransaction(event, appendedAt))();
  }

  #appendTaxDomainEventInTransaction(
    event: TaxDomainEventV1,
    appendedAt: string,
  ): Readonly<{ event: TaxDomainEventV1; replayed: boolean }> {
    const eventHash = hashTaxDomainEventV1(event);
    const byEventId = this.#db.query<{ event_hash: string; event_json: string }, [string]>(`
      SELECT event_hash, event_json FROM tax_domain_event_outbox WHERE event_id = ?
    `).get(event.eventId);
    if (byEventId) {
      if (byEventId.event_hash !== eventHash) throw new Error('TAX_DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
      return { event: assertTaxDomainEventV1(JSON.parse(byEventId.event_json)), replayed: true };
    }
    const byIdempotency = this.#db.query<{ event_hash: string; event_json: string }, [string, string]>(`
      SELECT event_hash, event_json
      FROM tax_domain_event_outbox
      WHERE workspace_id = ? AND idempotency_key = ?
    `).get(event.workspaceId, event.idempotencyKey);
    if (byIdempotency) {
      if (byIdempotency.event_hash !== eventHash) throw new Error('TAX_DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
      return { event: assertTaxDomainEventV1(JSON.parse(byIdempotency.event_json)), replayed: true };
    }
    this.#db.query(`
      INSERT INTO tax_domain_event_outbox (
        event_id, workspace_id, idempotency_key, event_hash, event_json, appended_at,
        leased_until, lease_token, delivery_attempts, delivered_at, last_error_code
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL)
    `).run(event.eventId, event.workspaceId, event.idempotencyKey, eventHash, JSON.stringify(event), appendedAt);
    return { event, replayed: false };
  }

  /** Lease undelivered events. A worker must ack only after target inbox persistence. */
  leaseTaxDomainEvents(input: Readonly<{
    now: string;
    leaseUntil: string;
    limit: number;
  }>): readonly TaxDomainEventV1[] {
    return this.claimTaxDomainEvents(input).map(claim => claim.event);
  }

  /**
   * Fenced claim used by the network relay. A stale worker cannot acknowledge
   * or release a lease after another worker has taken it over.
   */
  claimTaxDomainEvents(input: Readonly<{
    now: string;
    leaseUntil: string;
    limit: number;
  }>): readonly Readonly<{
    event: TaxDomainEventV1;
    eventHash: string;
    leaseToken: string;
    attempt: number;
  }>[] {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error('TAX_DOMAIN_EVENT_LEASE_LIMIT_INVALID');
    if (input.leaseUntil <= input.now) throw new Error('TAX_DOMAIN_EVENT_LEASE_WINDOW_INVALID');
    return this.#db.transaction(() => {
      const candidates = this.#db.query<{
        event_id: string;
        event_hash: string;
        event_json: string;
        delivery_attempts: number;
      }, [string, number]>(`
        SELECT event_id, event_hash, event_json, delivery_attempts
        FROM tax_domain_event_outbox
        WHERE delivered_at IS NULL AND (leased_until IS NULL OR leased_until <= ?)
        ORDER BY appended_at ASC, event_id ASC
        LIMIT ?
      `).all(input.now, input.limit);
      const claim = this.#db.query(`
        UPDATE tax_domain_event_outbox
        SET leased_until = ?, lease_token = ?, delivery_attempts = delivery_attempts + 1,
            last_error_code = NULL
        WHERE event_id = ? AND delivered_at IS NULL AND (leased_until IS NULL OR leased_until <= ?)
      `);
      const leased: Array<Readonly<{
        event: TaxDomainEventV1;
        eventHash: string;
        leaseToken: string;
        attempt: number;
      }>> = [];
      for (const candidate of candidates) {
        const leaseToken = randomUUID();
        if (claim.run(input.leaseUntil, leaseToken, candidate.event_id, input.now).changes === 1) {
          leased.push({
            event: assertTaxDomainEventV1(JSON.parse(candidate.event_json)),
            eventHash: candidate.event_hash,
            leaseToken,
            attempt: candidate.delivery_attempts + 1,
          });
        }
      }
      return leased;
    })();
  }

  ackTaxDomainEventClaim(eventId: string, leaseToken: string, deliveredAt: string): void {
    const updated = this.#db.query(`
      UPDATE tax_domain_event_outbox
      SET delivered_at = ?, leased_until = NULL, lease_token = NULL, last_error_code = NULL
      WHERE event_id = ? AND lease_token = ? AND delivered_at IS NULL
    `).run(deliveredAt, eventId, leaseToken);
    if (updated.changes === 1) return;
    const row = this.#db.query<{ delivered_at: string | null }, [string]>(`
      SELECT delivered_at FROM tax_domain_event_outbox WHERE event_id = ?
    `).get(eventId);
    if (!row) throw new Error('TAX_DOMAIN_EVENT_NOT_FOUND');
    if (row.delivered_at !== null) return;
    throw new Error('TAX_DOMAIN_EVENT_OUTBOX_ACK_FENCE_REJECTED');
  }

  releaseTaxDomainEventClaim(
    eventId: string,
    leaseToken: string,
    retryAt: string,
    errorCode: string
  ): void {
    if (!/^[A-Z0-9_]{3,120}$/.test(errorCode)) throw new Error('TAX_DOMAIN_EVENT_ERROR_CODE_INVALID');
    const updated = this.#db.query(`
      UPDATE tax_domain_event_outbox
      SET leased_until = ?, lease_token = NULL, last_error_code = ?
      WHERE event_id = ? AND lease_token = ? AND delivered_at IS NULL
    `).run(retryAt, errorCode, eventId, leaseToken);
    if (updated.changes !== 1) throw new Error('TAX_DOMAIN_EVENT_OUTBOX_NACK_FENCE_REJECTED');
  }

  ackTaxDomainEventDelivery(eventId: string, deliveredAt: string): void {
    const updated = this.#db.query(`
      UPDATE tax_domain_event_outbox
      SET delivered_at = ?, leased_until = NULL, lease_token = NULL, last_error_code = NULL
      WHERE event_id = ? AND delivered_at IS NULL
    `).run(deliveredAt, eventId);
    if (updated.changes !== 1) {
      const delivered = this.#db.query<{ event_id: string }, [string]>(`
        SELECT event_id FROM tax_domain_event_outbox WHERE event_id = ? AND delivered_at IS NOT NULL
      `).get(eventId);
      if (!delivered) throw new Error('TAX_DOMAIN_EVENT_NOT_FOUND');
    }
  }

  releaseTaxDomainEventDelivery(eventId: string, retryAt: string, errorCode: string): void {
    if (!/^[A-Z0-9_]{3,120}$/.test(errorCode)) throw new Error('TAX_DOMAIN_EVENT_ERROR_CODE_INVALID');
    const updated = this.#db.query(`
      UPDATE tax_domain_event_outbox
      SET leased_until = ?, lease_token = NULL, last_error_code = ?
      WHERE event_id = ? AND delivered_at IS NULL
    `).run(retryAt, errorCode, eventId);
    if (updated.changes !== 1) throw new Error('TAX_DOMAIN_EVENT_NOT_FOUND');
  }

  listPendingTaxDomainEvents(): readonly TaxDomainEventV1[] {
    const rows = this.#db.query<{ event_json: string }, []>(`
      SELECT event_json FROM tax_domain_event_outbox WHERE delivered_at IS NULL ORDER BY appended_at ASC, event_id ASC
    `).all();
    return rows.map(row => assertTaxDomainEventV1(JSON.parse(row.event_json)));
  }

  get(workspaceId: string): TaxProfile | null {
    const row = this.#db.query<{ profile_json: string }, [string]>(
      'SELECT profile_json FROM tax_profiles WHERE workspace_id = ?'
    ).get(workspaceId);
    return row ? (JSON.parse(row.profile_json) as TaxProfile) : null;
  }

  confirm(input: Readonly<{
    profile: TaxProfile;
    expectedVersion: string | null;
    actorId: string;
    occurredAt: string;
  }>): TaxProfile {
    assertCatalogueSafeProfile(input.profile);
    const existing = this.get(input.profile.workspaceId);
    // A network retry can arrive with the caller's original expected version
    // after the first confirmation committed. Treat the exact same desired
    // profile as a replay before applying optimistic concurrency; otherwise a
    // timeout would either churn the profile version or strand the setup saga.
    // `version` is store-owned and therefore excluded from desired-state
    // identity. Every tax-relevant field (including profileId and answer order)
    // remains part of the hash.
    if (existing && hashCanonical({ ...existing, version: null })
      === hashCanonical({ ...input.profile, version: null })) {
      return existing;
    }
    if (existing && input.expectedVersion !== existing.version) throw new Error('PROFILE_VERSION_CONFLICT');
    if (!existing && input.expectedVersion !== null) throw new Error('PROFILE_VERSION_CONFLICT');
    const nextNumber = existing ? Number(existing.version.replace('profile-v', '')) + 1 : 1;
    const profile: TaxProfile = { ...input.profile, version: `profile-v${nextNumber}` };
    const transaction = this.#db.transaction(() => {
      this.#db.query(`
        INSERT INTO tax_profiles (workspace_id, version, profile_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          version = excluded.version,
          profile_json = excluded.profile_json,
          updated_at = excluded.updated_at
      `).run(profile.workspaceId, nextNumber, JSON.stringify(profile), input.occurredAt);
      this.#db.query(`
        INSERT INTO audit_events (event_id, workspace_id, actor_id, action, occurred_at, safe_metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), profile.workspaceId, input.actorId, 'confirm_tax_profile', input.occurredAt, JSON.stringify({ version: profile.version, jurisdiction: profile.jurisdiction, regimeId: profile.regimeId }));
    });
    transaction();
    return profile;
  }

  appendEvidence(records: readonly TaxEvidenceRecord[], appendedAt: string): number {
    return this.#db.transaction(() => {
      const appended = this.#appendEvidenceRecords(records, appendedAt, false, false, true);
      if (appended > 0) this.#advanceEvidenceGeneration(records[0]?.workspaceId ?? null, appendedAt);
      return appended;
    })();
  }

  #appendEvidenceRecords(
    records: readonly TaxEvidenceRecord[],
    appendedAt: string,
    allowPendingSupersessionTargets: boolean,
    authoritativeOrphanTargets: boolean,
    validateImmediately: boolean,
  ): number {
    const insert = this.#db.query(`
      INSERT INTO evidence_records (
        workspace_id, source_id, idempotency_key, evidence_id, revision, artifact_hash, record_json, appended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, idempotency_key) DO NOTHING
    `);
    let appended = 0;
    const workspaceIds = new Set(records.map(record => record.workspaceId));
    if (workspaceIds.size > 1) throw new Error('EVIDENCE_WORKSPACE_MISMATCH');
    const incoming = new Map<string, TaxEvidenceRecord>();
    for (const rawRecord of records) {
      const record = normalizeEvidenceRecord(rawRecord);
      const duplicate = incoming.get(record.idempotencyKey);
      if (duplicate && hashCanonical(duplicate) !== hashCanonical(record)) throw new Error('EVIDENCE_IDEMPOTENCY_CONFLICT');
      incoming.set(record.idempotencyKey, record);
    }
    for (const record of incoming.values()) {
      this.#assertPendingSupersessionTarget(record);
      const existing = this.#db.query<{ record_json: string }, [string, string]>(
        'SELECT record_json FROM evidence_records WHERE workspace_id = ? AND idempotency_key = ?'
      ).get(record.workspaceId, record.idempotencyKey);
      if (existing && hashCanonical(normalizeEvidenceRecord(JSON.parse(existing.record_json) as TaxEvidenceRecord)) !== hashCanonical(record)) {
        throw new Error('EVIDENCE_IDEMPOTENCY_CONFLICT');
      }
      if (!existing) {
        this.#recordSupersession(record, appendedAt, incoming, allowPendingSupersessionTargets, authoritativeOrphanTargets);
        insert.run(record.workspaceId, record.sourceId, record.idempotencyKey, record.evidenceId, record.revision, record.artifactHash, JSON.stringify(record), appendedAt);
        appended += 1;
      }
    }
    if (validateImmediately && records[0]) this.#assertNoEvidenceCycles(records[0].workspaceId);
    return appended;
  }

  listEvidence(workspaceId: string): readonly TaxEvidenceRecord[] {
    const rows = this.#db.query<{ record_json: string }, [string]>(
      'SELECT record_json FROM evidence_records WHERE workspace_id = ? ORDER BY rowid ASC'
    ).all(workspaceId);
    const memberships = this.#db.query<{
      source_id: string;
      idempotency_key: string;
      sequence: number;
    }, [string]>(`
      SELECT source_id, idempotency_key, sequence
      FROM evidence_batch_records
      WHERE workspace_id = ?
    `).all(workspaceId);
    const canonicalSources = new Set(this.#db.query<{ source_id: string }, [string]>(`
      SELECT DISTINCT source_id
      FROM evidence_source_checkpoints
      WHERE workspace_id = ?
    `).all(workspaceId).map(row => row.source_id));
    const baselines = this.#db.query<{ source_id: string; sequence: number }, [string, string]>(`
      SELECT checkpoints.source_id, checkpoints.sequence
      FROM evidence_source_checkpoints AS checkpoints
      INNER JOIN (
        SELECT source_id, MAX(sequence) AS sequence
        FROM evidence_source_checkpoints
        WHERE workspace_id = ? AND mode = 'full_snapshot'
        GROUP BY source_id
      ) AS latest
        ON latest.source_id = checkpoints.source_id AND latest.sequence = checkpoints.sequence
      WHERE checkpoints.workspace_id = ?
    `).all(workspaceId, workspaceId);
    const baselineBySource = new Map(baselines.map(row => [row.source_id, row.sequence]));
    const sequencesByRecord = new Map<string, number[]>();
    for (const membership of memberships) {
      const key = evidenceMembershipKey(membership.source_id, membership.idempotency_key);
      const sequences = sequencesByRecord.get(key) ?? [];
      sequences.push(membership.sequence);
      sequencesByRecord.set(key, sequences);
    }
    const eligible = rows
      .map(row => normalizeEvidenceRecord(JSON.parse(row.record_json) as TaxEvidenceRecord))
      .filter(record => {
        const sequences = sequencesByRecord.get(evidenceMembershipKey(record.sourceId, record.idempotencyKey));
        const baseline = baselineBySource.get(record.sourceId);
        // Once a source starts the canonical batch protocol, unbatched legacy
        // rows are quarantined. Arrival time is not provenance and must never
        // let the retired append writer contaminate a durable projection.
        if (!sequences) return !canonicalSources.has(record.sourceId);
        return sequences.some(sequence => sequence >= (baseline ?? 0));
      })
      ;
    return resolveActiveEvidenceRecords(eligible, { requireTargets: false });
  }

  listEvidenceForSource(workspaceId: string, sourceId: string): readonly TaxEvidenceRecord[] {
    const total = this.#db.query<{ count: number }, [string, string]>(
      'SELECT COUNT(*) AS count FROM evidence_records WHERE workspace_id = ? AND source_id = ?',
    ).get(workspaceId, sourceId)?.count ?? 0;
    if (total > 500_000) throw new Error('EVIDENCE_SOURCE_RECORD_LIMIT_EXCEEDED');
    const rows = this.#db.query<{ record_json: string }, [string, string]>(`
      SELECT record_json
      FROM evidence_records
      WHERE workspace_id = ? AND source_id = ?
      ORDER BY rowid ASC
    `).all(workspaceId, sourceId);
    const memberships = this.#db.query<{ idempotency_key: string; sequence: number }, [string, string]>(`
      SELECT idempotency_key, sequence
      FROM evidence_batch_records
      WHERE workspace_id = ? AND source_id = ?
    `).all(workspaceId, sourceId);
    const baseline = this.#db.query<{ sequence: number }, [string, string]>(`
      SELECT sequence
      FROM evidence_source_checkpoints
      WHERE workspace_id = ? AND source_id = ? AND mode = 'full_snapshot'
      ORDER BY sequence DESC
      LIMIT 1
    `).get(workspaceId, sourceId);
    const hasCanonicalCheckpoint = Boolean(this.#db.query<{ present: number }, [string, string]>(`
      SELECT 1 AS present
      FROM evidence_source_checkpoints
      WHERE workspace_id = ? AND source_id = ?
      LIMIT 1
    `).get(workspaceId, sourceId));
    const sequencesByRecord = new Map<string, number[]>();
    for (const membership of memberships) {
      const sequences = sequencesByRecord.get(membership.idempotency_key) ?? [];
      sequences.push(membership.sequence);
      sequencesByRecord.set(membership.idempotency_key, sequences);
    }
    const eligible = rows
      .map(row => normalizeEvidenceRecord(JSON.parse(row.record_json) as TaxEvidenceRecord))
      .filter(record => {
        const sequences = sequencesByRecord.get(record.idempotencyKey);
        if (!sequences) return !hasCanonicalCheckpoint;
        return sequences.some(sequence => sequence >= (baseline?.sequence ?? 0));
      })
      ;
    return resolveActiveEvidenceRecords(eligible, { requireTargets: false });
  }

  appendEvidenceBatch(batch: TaxEvidenceBatchV1, appendedAt: string): TaxEvidenceBatchReceiptV1 {
    assertTaxEvidenceBatchV1(batch);
    const batchHash = hashTaxEvidenceBatch(batch);
    return this.#db.transaction(() => {
      const existingBatch = this.#db.query<{ batch_hash: string }, [string, string]>(
        'SELECT batch_hash FROM evidence_batches WHERE workspace_id = ? AND batch_id = ?',
      ).get(batch.workspaceId, batch.batchId);
      if (existingBatch) {
        if (existingBatch.batch_hash !== batchHash) throw new Error('EVIDENCE_BATCH_IDEMPOTENCY_CONFLICT');
        return batchReceipt(batch, batchHash, 0, true);
      }

      const existingSequence = this.#db.query<{ batch_hash: string }, [string, string, number]>(
        'SELECT batch_hash FROM evidence_source_checkpoints WHERE workspace_id = ? AND source_id = ? AND sequence = ?',
      ).get(batch.workspaceId, batch.source.sourceId, batch.checkpoint.sequence);
      if (existingSequence) throw new Error('EVIDENCE_CHECKPOINT_SEQUENCE_CONFLICT');
      this.#assertActiveBatchConsent(batch);
      this.#retireSupersessionEdgesBelowFullSnapshot(batch);
      const appendedRecords = this.#appendEvidenceRecords(
        batch.records,
        appendedAt,
        true,
        batch.mode === 'full_snapshot',
        false,
      );
      const manifest: TaxEvidenceSourceManifestV1 = {
        version: 'tax-evidence-source-manifest-v1',
        workspaceId: batch.workspaceId,
        batchId: batch.batchId,
        batchHash,
        source: batch.source,
        checkpoint: batch.checkpoint,
        mode: batch.mode,
        consent: batch.consent,
        capabilities: batch.capabilities,
        producedAt: batch.producedAt,
      };
      this.#db.query(`
        INSERT INTO evidence_batches (workspace_id, batch_id, batch_hash, batch_json, appended_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(batch.workspaceId, batch.batchId, batchHash, JSON.stringify(batch), appendedAt);
      this.#db.query(`
        INSERT INTO evidence_source_checkpoints (
          workspace_id, source_id, sequence, mode, revision, observed_at, batch_id, batch_hash, manifest_json, appended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batch.workspaceId,
        batch.source.sourceId,
        batch.checkpoint.sequence,
        batch.mode,
        batch.checkpoint.revision,
        batch.checkpoint.observedAt,
        batch.batchId,
        batchHash,
        JSON.stringify(manifest),
        appendedAt,
      );
      const addMembership = this.#db.query(`
        INSERT INTO evidence_batch_records (
          workspace_id, batch_id, source_id, sequence, idempotency_key
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const record of batch.records) {
        addMembership.run(batch.workspaceId, batch.batchId, batch.source.sourceId, batch.checkpoint.sequence, record.idempotencyKey);
      }
      this.listEvidence(batch.workspaceId);
      this.#advanceEvidenceGeneration(batch.workspaceId, appendedAt);
      return batchReceipt(batch, batchHash, appendedRecords, false);
    })();
  }

  listEvidenceSourceManifests(workspaceId: string): readonly TaxEvidenceSourceManifestV1[] {
    const rows = this.#db.query<{ manifest_json: string }, [string, string]>(`
      SELECT checkpoints.manifest_json
      FROM evidence_source_checkpoints AS checkpoints
      INNER JOIN (
        SELECT source_id, MAX(sequence) AS sequence
        FROM evidence_source_checkpoints
        WHERE workspace_id = ?
        GROUP BY source_id
      ) AS latest
        ON latest.source_id = checkpoints.source_id AND latest.sequence = checkpoints.sequence
      WHERE checkpoints.workspace_id = ?
      ORDER BY checkpoints.source_id ASC
    `).all(workspaceId, workspaceId);
    const checkpoints = this.#db.query<{ source_id: string; sequence: number; mode: TaxEvidenceBatchV1['mode'] }, [string]>(`
      SELECT source_id, sequence, mode
      FROM evidence_source_checkpoints
      WHERE workspace_id = ?
      ORDER BY source_id ASC, sequence ASC
    `).all(workspaceId);
    const pendingSupersessions = this.#db.query<{ source_id: string; successor_idempotency_key: string }, [string]>(`
      SELECT supersessions.source_id, supersessions.successor_idempotency_key
      FROM evidence_supersessions AS supersessions
      LEFT JOIN evidence_records AS targets
        ON targets.workspace_id = supersessions.workspace_id
        AND targets.idempotency_key = supersessions.superseded_idempotency_key
      WHERE supersessions.workspace_id = ? AND targets.idempotency_key IS NULL
    `).all(workspaceId);
    const checkpointsBySource = new Map<string, { sequence: number; mode: TaxEvidenceBatchV1['mode'] }[]>();
    for (const checkpoint of checkpoints) {
      const values = checkpointsBySource.get(checkpoint.source_id) ?? [];
      values.push({ sequence: checkpoint.sequence, mode: checkpoint.mode });
      checkpointsBySource.set(checkpoint.source_id, values);
    }
    const activeRecordKeys = new Set(this.listEvidence(workspaceId).map(record => record.idempotencyKey));
    const pendingSources = new Set(pendingSupersessions
      .filter(row => activeRecordKeys.has(row.successor_idempotency_key))
      .map(row => row.source_id));
    return rows.map(row => {
      const manifest = JSON.parse(row.manifest_json) as TaxEvidenceSourceManifestV1;
      const sourceCheckpoints = checkpointsBySource.get(manifest.source.sourceId) ?? [];
      const latestFullSnapshot = sourceCheckpoints
        .filter(checkpoint => checkpoint.mode === 'full_snapshot')
        .reduce((latest, checkpoint) => Math.max(latest, checkpoint.sequence), 0);
      const missingBaseline = latestFullSnapshot === 0;
      const sequenceStart = latestFullSnapshot || 1;
      const relevantSequences = sourceCheckpoints
        .map(checkpoint => checkpoint.sequence)
        .filter(sequence => sequence >= sequenceStart);
      const highestSequence = relevantSequences.reduce((highest, sequence) => Math.max(highest, sequence), sequenceStart - 1);
      const expectedCount = highestSequence >= sequenceStart ? highestSequence - sequenceStart + 1 : 0;
      const sequenceGap = relevantSequences.length !== expectedCount;
      const pendingTarget = pendingSources.has(manifest.source.sourceId);
      if (!missingBaseline && !sequenceGap && !pendingTarget) return manifest;
      return {
        ...manifest,
        capabilities: manifest.capabilities.map(capability => ({
          ...capability,
          state: capability.state === 'available' ? 'partial' : capability.state,
          safeErrorCode: capability.safeErrorCode
            ?? (sequenceGap
              ? 'EVIDENCE_CHECKPOINT_GAP'
              : missingBaseline ? 'EVIDENCE_FULL_SNAPSHOT_REQUIRED' : 'EVIDENCE_SUPERSESSION_TARGET_PENDING'),
        })),
      };
    });
  }

  getEvidenceSourceLineageHash(workspaceId: string, sourceId: string): string {
    const checkpoints = this.#db.query<{
      sequence: number;
      mode: string;
      revision: string;
      observed_at: string;
      batch_hash: string;
    }, [string, string]>(`
      SELECT sequence, mode, revision, observed_at, batch_hash
      FROM evidence_source_checkpoints
      WHERE workspace_id = ? AND source_id = ?
      ORDER BY sequence ASC
    `).all(workspaceId, sourceId);
    return hashCanonical(checkpoints);
  }

  configureSnapshotProjection(input: Readonly<{
    configuration: TaxSnapshotProjectionConfigurationV1;
    projectionKey?: string;
    expectedConfigHash: string | null;
    actorId: string;
    configuredAt: string;
  }>): Readonly<{
    configuration: TaxSnapshotProjectionConfigurationV1;
    projectionKey: string;
    configHash: string;
    replayed: boolean;
  }> {
    const projectionKey = normalizeTaxSnapshotProjectionKey(input.projectionKey);
    const configHash = hashCanonical(input.configuration);
    return this.#db.transaction(() => {
      const existing = this.#db.query<{ config_hash: string; config_json: string }, [string, string]>(`
        SELECT config_hash, config_json
        FROM tax_snapshot_projection_configurations
        WHERE workspace_id = ? AND projection_key = ?
      `).get(input.configuration.workspaceId, projectionKey);
      if (existing?.config_hash === configHash) {
        if (hashCanonical(JSON.parse(existing.config_json)) !== configHash) throw new Error('TAX_SNAPSHOT_CONFIG_IDEMPOTENCY_CONFLICT');
        return { configuration: input.configuration, projectionKey, configHash, replayed: true };
      }
      if ((existing?.config_hash ?? null) !== input.expectedConfigHash) throw new Error('TAX_SNAPSHOT_CONFIG_VERSION_CONFLICT');
      this.#db.query(`
        INSERT INTO tax_snapshot_projection_configurations (
          workspace_id, projection_key, config_hash, config_json, configured_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, projection_key) DO UPDATE SET
          config_hash = excluded.config_hash,
          config_json = excluded.config_json,
          configured_at = excluded.configured_at
      `).run(
        input.configuration.workspaceId,
        projectionKey,
        configHash,
        JSON.stringify(input.configuration),
        input.configuredAt,
      );
      this.#db.query(`
        INSERT INTO audit_events (event_id, workspace_id, actor_id, action, occurred_at, safe_metadata_json)
        VALUES (?, ?, ?, 'configure_tax_snapshot_projection', ?, ?)
      `).run(
        crypto.randomUUID(),
        input.configuration.workspaceId,
        input.actorId,
        input.configuredAt,
        JSON.stringify({ configHash, projectionKey }),
      );
      return { configuration: input.configuration, projectionKey, configHash, replayed: false };
    })();
  }

  getSnapshotProjectionConfiguration(workspaceId: string, projectionKey?: string): Readonly<{
    configuration: TaxSnapshotProjectionConfigurationV1;
    projectionKey: string;
    configHash: string;
  }> | null {
    const normalizedProjectionKey = normalizeTaxSnapshotProjectionKey(projectionKey);
    const row = this.#db.query<{ config_hash: string; config_json: string }, [string, string]>(`
      SELECT config_hash, config_json
      FROM tax_snapshot_projection_configurations
      WHERE workspace_id = ? AND projection_key = ?
    `).get(workspaceId, normalizedProjectionKey);
    return row ? {
      configuration: JSON.parse(row.config_json) as TaxSnapshotProjectionConfigurationV1,
      projectionKey: normalizedProjectionKey,
      configHash: row.config_hash,
    } : null;
  }

  saveTaxWidgetSnapshot(input: Readonly<{
    snapshot: TaxWidgetSnapshotV1;
    projection: TaxEvidencePresentationProjectionV1;
    projectionKey?: string;
    expectedEvidenceGeneration: number;
    expectedProjectionConfigHash: string;
    generatedAt: string;
  }>): TaxWidgetSnapshotReceiptV1 & Readonly<{ replayed: boolean }> {
    const projectionKey = normalizeTaxSnapshotProjectionKey(input.projectionKey);
    return this.#db.transaction(() => {
      if (this.getEvidenceGeneration(input.snapshot.workspaceId) !== input.expectedEvidenceGeneration) {
        throw new Error('TAX_EVIDENCE_GENERATION_CONFLICT');
      }
      if (this.get(input.snapshot.workspaceId)?.version !== input.snapshot.profile.version) {
        throw new Error('TAX_PROFILE_VERSION_CONFLICT');
      }
      const configured = this.getSnapshotProjectionConfiguration(input.snapshot.workspaceId, projectionKey);
      if (!configured || configured.configHash !== input.expectedProjectionConfigHash) {
        throw new Error('TAX_SNAPSHOT_CONFIG_VERSION_CONFLICT');
      }
      const latestSnapshot = this.#db.query<{
        as_of: string;
        snapshot_json: string;
      }, [string, string, string]>(`
        SELECT as_of, snapshot_json
        FROM tax_widget_snapshots
        WHERE workspace_id = ? AND projection_key = ? AND projection_config_hash = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(input.snapshot.workspaceId, projectionKey, input.expectedProjectionConfigHash);
      if (latestSnapshot && parseInstant(input.projection.asOf) < parseInstant(latestSnapshot.as_of)) {
        throw new Error('TAX_SNAPSHOT_AS_OF_REGRESSION');
      }
      const snapshotHash = hashCanonical(input.snapshot);
      const existing = this.#db.query<StoredTaxWidgetSnapshotRow, [string, string, string, number]>(`
        SELECT *
        FROM tax_widget_snapshots
        WHERE workspace_id = ? AND projection_key = ? AND snapshot_hash = ? AND evidence_generation = ?
      `).get(input.snapshot.workspaceId, projectionKey, snapshotHash, input.expectedEvidenceGeneration);
      if (existing) {
        if (existing.projection_config_hash !== input.expectedProjectionConfigHash
          || hashCanonical(JSON.parse(existing.snapshot_json)) !== snapshotHash
          || hashCanonical(JSON.parse(existing.projection_json)) !== hashCanonical(input.projection)) {
          throw new Error('TAX_SNAPSHOT_IDEMPOTENCY_CONFLICT');
        }
        return { ...this.#snapshotReceipt(existing, input.generatedAt), replayed: true };
      }
      this.#db.query(`
        INSERT INTO tax_widget_snapshots (
          workspace_id, projection_key, snapshot_hash, input_hash, snapshot_json, projection_json, projection_config_hash,
          evidence_generation, as_of, valid_until, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.snapshot.workspaceId,
        projectionKey,
        snapshotHash,
        input.snapshot.inputHash,
        JSON.stringify(input.snapshot),
        JSON.stringify(input.projection),
        input.expectedProjectionConfigHash,
        input.expectedEvidenceGeneration,
        input.projection.asOf,
        input.projection.validUntil ?? null,
        input.generatedAt,
      );
      const stored = this.#db.query<StoredTaxWidgetSnapshotRow, [string, string, string, number]>(`
        SELECT *
        FROM tax_widget_snapshots
        WHERE workspace_id = ? AND projection_key = ? AND snapshot_hash = ? AND evidence_generation = ?
      `).get(input.snapshot.workspaceId, projectionKey, snapshotHash, input.expectedEvidenceGeneration);
      if (!stored) throw new Error('TAX_SNAPSHOT_STORAGE_CONFLICT');
      const consent = this.#db.query<{
        version: string;
        scope_hash: string;
      }, [string]>(`
        SELECT version, scope_hash
        FROM evidence_consent_grants
        WHERE workspace_id = ? AND revoked_at IS NULL
        ORDER BY granted_at DESC, version DESC
        LIMIT 1
      `).get(input.snapshot.workspaceId);
      if (consent) {
        const domainEvents = createSnapshotTaxDomainEvents({
          snapshot: input.snapshot,
          previousSnapshot: latestSnapshot
            ? JSON.parse(latestSnapshot.snapshot_json) as TaxWidgetSnapshotV1
            : null,
          previousAsOf: latestSnapshot?.as_of ?? null,
          projectionKey,
          asOf: input.projection.asOf,
          generatedAt: input.generatedAt,
          consent: { version: consent.version, scopeHash: consent.scope_hash },
          commitmentSecret: this.#domainEventCommitmentSecret,
        });
        for (const domainEvent of domainEvents) {
          this.#appendTaxDomainEventInTransaction(domainEvent, input.generatedAt);
        }
      }
      return { ...this.#snapshotReceipt(stored, input.generatedAt), replayed: false };
    })();
  }

  getLatestTaxWidgetSnapshot(
    workspaceId: string,
    now = new Date().toISOString(),
    projectionKey?: string,
  ): TaxWidgetSnapshotReceiptV1 | null {
    const normalizedProjectionKey = normalizeTaxSnapshotProjectionKey(projectionKey);
    const configured = this.getSnapshotProjectionConfiguration(workspaceId, normalizedProjectionKey);
    if (!configured) throw new Error('TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED');
    const row = this.#db.query<StoredTaxWidgetSnapshotRow, [string, string, string]>(`
      SELECT *
      FROM tax_widget_snapshots
      WHERE workspace_id = ? AND projection_key = ? AND projection_config_hash = ?
      ORDER BY rowid DESC
      LIMIT 1
    `).get(workspaceId, normalizedProjectionKey, configured.configHash);
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot_json) as TaxWidgetSnapshotV1;
    if (row.evidence_generation !== this.getEvidenceGeneration(workspaceId)
      || this.get(workspaceId)?.version !== snapshot.profile.version) throw new Error('TAX_SNAPSHOT_STALE');
    if (row.valid_until && parseInstant(now) >= parseInstant(row.valid_until)) throw new Error('TAX_SNAPSHOT_EXPIRED');
    return this.#snapshotReceipt(row, now);
  }

  /**
   * Atomically advances the durable browser case and stamps the projected
   * browser snapshot with the same monotonic revision. The core receipt is
   * rechecked inside this transaction so a stale read cannot become current.
   */
  stampBrowserTaxSnapshot(input: Readonly<{
    receipt: TaxWidgetSnapshotReceiptV1;
    sourceFingerprint: string;
    caseRef: string;
    buildSnapshot: (durable: Readonly<{
      caseRef: string;
      caseRevision: number;
    }>) => BrowserTaxWidgetSnapshotV1;
  }>): Readonly<{
    caseRef: string;
    caseRevision: number;
    snapshot: BrowserTaxWidgetSnapshotV1;
    replayed: boolean;
  }> {
    const receipt = input.receipt;
    const workspaceId = receipt.snapshot.workspaceId;
    const projectionKey = normalizeTaxSnapshotProjectionKey(receipt.projectionKey);
    if (receipt.projectionKey !== projectionKey) throw new Error('TAX_SNAPSHOT_PROJECTION_KEY_INVALID');
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.sourceFingerprint)) {
      throw new Error('Tax browser source fingerprint is invalid');
    }
    return this.#db.transaction(() => {
      if (receipt.snapshot.inputHash !== receipt.inputHash
        || hashCanonical(receipt.snapshot) !== receipt.snapshotHash) {
        throw new Error('Tax browser core snapshot integrity check failed');
      }
      if (this.getEvidenceGeneration(workspaceId) !== receipt.evidenceGeneration) {
        throw new Error('TAX_EVIDENCE_GENERATION_CONFLICT');
      }
      if (this.get(workspaceId)?.version !== receipt.snapshot.profile.version) {
        throw new Error('TAX_PROFILE_VERSION_CONFLICT');
      }
      const configured = this.getSnapshotProjectionConfiguration(workspaceId, projectionKey);
      if (!configured
        || configured.configHash !== receipt.configHash
        || hashCanonical(configured.configuration) !== configured.configHash) {
        throw new Error('TAX_SNAPSHOT_CONFIG_VERSION_CONFLICT');
      }
      const latest = this.#db.query<Pick<StoredTaxWidgetSnapshotRow, 'snapshot_hash' | 'input_hash' | 'evidence_generation'>, [string, string, string]>(`
        SELECT snapshot_hash, input_hash, evidence_generation
        FROM tax_widget_snapshots
        WHERE workspace_id = ? AND projection_key = ? AND projection_config_hash = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(workspaceId, projectionKey, receipt.configHash);
      if (!latest
        || latest.snapshot_hash !== receipt.snapshotHash
        || latest.input_hash !== receipt.inputHash
        || latest.evidence_generation !== receipt.evidenceGeneration) {
        throw new Error('TAX_SNAPSHOT_STALE');
      }

      const current = this.#db.query<StoredBrowserTaxCaseRow, [string, string]>(`
        SELECT case_ref, revision, source_fingerprint
        FROM tax_browser_cases
        WHERE workspace_id = ? AND projection_key = ?
      `).get(workspaceId, projectionKey);
      if (current?.source_fingerprint === input.sourceFingerprint) {
        const stored = this.#browserSnapshotRow(workspaceId, projectionKey, current.revision);
        if (!stored
          || stored.case_ref !== current.case_ref
          || stored.source_fingerprint !== current.source_fingerprint) {
          throw new Error('Tax browser snapshot storage integrity check failed');
        }
        const parsed = JSON.parse(stored.snapshot_json) as BrowserTaxWidgetSnapshotV1;
        if (hashCanonical(parsed) !== stored.browser_snapshot_hash) {
          throw new Error('Tax browser snapshot storage integrity check failed');
        }
        return {
          caseRef: current.case_ref,
          caseRevision: current.revision,
          snapshot: parsed,
          replayed: true,
        };
      }

      const caseRevision = (current?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(caseRevision) || caseRevision < 1) {
        throw new Error('Tax browser case revision is invalid');
      }
      // The first projection derives an opaque case reference. Once persisted,
      // that reference is the case identity: rotating the server-only HMAC key
      // may change new refs and fingerprints, but must not rename old cases.
      const caseRef = current?.case_ref ?? input.caseRef;
      const snapshot = input.buildSnapshot({ caseRef, caseRevision });
      const snapshotHash = hashCanonical(snapshot);
      const snapshotJson = JSON.stringify(snapshot);
      if (current) {
        const updated = this.#db.query(`
          UPDATE tax_browser_cases
          SET revision = ?, source_fingerprint = ?, updated_at = ?
          WHERE workspace_id = ? AND projection_key = ?
            AND revision = ? AND source_fingerprint = ? AND case_ref = ?
        `).run(
          caseRevision,
          input.sourceFingerprint,
          receipt.generatedAt,
          workspaceId,
          projectionKey,
          current.revision,
          current.source_fingerprint,
          current.case_ref,
        );
        if (updated.changes !== 1) throw new Error('TAX_EVIDENCE_GENERATION_CONFLICT');
      } else {
        this.#db.query(`
          INSERT INTO tax_browser_cases (
            workspace_id, projection_key, case_ref, revision, source_fingerprint, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          workspaceId,
          projectionKey,
          caseRef,
          caseRevision,
          input.sourceFingerprint,
          receipt.generatedAt,
        );
      }
      this.#db.query(`
        INSERT INTO tax_browser_snapshots (
          workspace_id, projection_key, case_ref, case_revision, source_fingerprint,
          browser_snapshot_hash, snapshot_json, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workspaceId,
        projectionKey,
        caseRef,
        caseRevision,
        input.sourceFingerprint,
        snapshotHash,
        snapshotJson,
        receipt.generatedAt,
      );
      const stored = this.#browserSnapshotRow(workspaceId, projectionKey, caseRevision);
      if (!stored
        || stored.case_ref !== caseRef
        || stored.source_fingerprint !== input.sourceFingerprint
        || stored.browser_snapshot_hash !== snapshotHash
        || hashCanonical(JSON.parse(stored.snapshot_json)) !== snapshotHash) {
        throw new Error('Tax browser snapshot storage integrity check failed');
      }
      return { caseRef, caseRevision, snapshot, replayed: false };
    })();
  }

  #browserSnapshotRow(
    workspaceId: string,
    projectionKey: string,
    caseRevision: number,
  ): StoredBrowserTaxSnapshotRow | null {
    return this.#db.query<StoredBrowserTaxSnapshotRow, [string, string, number]>(`
      SELECT case_ref, case_revision, source_fingerprint, browser_snapshot_hash, snapshot_json
      FROM tax_browser_snapshots
      WHERE workspace_id = ? AND projection_key = ? AND case_revision = ?
    `).get(workspaceId, projectionKey, caseRevision) ?? null;
  }

  #snapshotReceipt(row: StoredTaxWidgetSnapshotRow, checkedAt: string): TaxWidgetSnapshotReceiptV1 {
    const snapshot = JSON.parse(row.snapshot_json) as TaxWidgetSnapshotV1;
    if (snapshot.workspaceId !== row.workspace_id || snapshot.inputHash !== row.input_hash) {
      throw new Error('TAX_SNAPSHOT_STORAGE_CONFLICT');
    }
    return {
      version: 'tax-widget-snapshot-receipt-v1',
      projectionKey: row.projection_key,
      snapshotHash: row.snapshot_hash,
      inputHash: row.input_hash,
      configHash: row.projection_config_hash,
      evidenceGeneration: row.evidence_generation,
      generatedAt: row.generated_at,
      asOf: row.as_of,
      expiresAt: row.valid_until,
      validity: { state: 'current', checkedAt },
      snapshot,
    };
  }

  #recordSupersession(
    record: TaxEvidenceRecord,
    appendedAt: string,
    incoming: ReadonlyMap<string, TaxEvidenceRecord>,
    allowPendingTarget: boolean,
    authoritativeOrphanTarget: boolean,
  ): void {
    const targetKey = record.supersedesIdempotencyKey;
    if (!targetKey) return;
    if (targetKey === record.idempotencyKey) throw new Error('EVIDENCE_SUPERSESSION_CYCLE');
    const incomingTarget = incoming.get(targetKey);
    const storedTarget = this.#db.query<{ record_json: string }, [string, string]>(
      'SELECT record_json FROM evidence_records WHERE workspace_id = ? AND idempotency_key = ?',
    ).get(record.workspaceId, targetKey);
    const target = incomingTarget ?? (storedTarget ? normalizeEvidenceRecord(JSON.parse(storedTarget.record_json) as TaxEvidenceRecord) : null);
    // Bank cash withdrawals are never authoritative orphan tips. Desk emits
    // them only as ordered incrementals against the exact prior cash head;
    // whole-source retirement is represented by an empty full snapshot.
    if (!target && record.economicRole === 'cash_movement') {
      throw new Error('EVIDENCE_SUPERSESSION_TARGET_NOT_FOUND');
    }
    if (!target && !allowPendingTarget) throw new Error('EVIDENCE_SUPERSESSION_TARGET_NOT_FOUND');
    if (!target && authoritativeOrphanTarget) return;
    if (target && target.sourceId !== record.sourceId) throw new Error('EVIDENCE_SUPERSESSION_SOURCE_MISMATCH');
    const existing = this.#db.query<{ successor_idempotency_key: string }, [string, string]>(
      'SELECT successor_idempotency_key FROM evidence_supersessions WHERE workspace_id = ? AND superseded_idempotency_key = ?',
    ).get(record.workspaceId, targetKey);
    if (existing && existing.successor_idempotency_key !== record.idempotencyKey) throw new Error('EVIDENCE_SUPERSESSION_CONFLICT');
    if (!existing) {
      this.#db.query(`
        INSERT INTO evidence_supersessions (
          workspace_id, source_id, superseded_idempotency_key, successor_idempotency_key, recorded_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(record.workspaceId, record.sourceId, targetKey, record.idempotencyKey, appendedAt);
    }
  }

  #retireSupersessionEdgesBelowFullSnapshot(batch: TaxEvidenceBatchV1): void {
    if (batch.mode !== 'full_snapshot') return;
    const incomingKeys = new Set(batch.records.map(record => record.idempotencyKey));
    const existingEdges = this.#db.query<{
      superseded_idempotency_key: string;
      successor_idempotency_key: string;
    }, [string, string]>(`
      SELECT superseded_idempotency_key, successor_idempotency_key
      FROM evidence_supersessions
      WHERE workspace_id = ? AND source_id = ?
    `).all(batch.workspaceId, batch.source.sourceId);
    const hasMembershipAtOrAboveBaseline = this.#db.query<{ present: number }, [string, string, string, number]>(`
      SELECT 1 AS present
      FROM evidence_batch_records
      WHERE workspace_id = ? AND source_id = ? AND idempotency_key = ? AND sequence >= ?
      LIMIT 1
    `);
    const remove = this.#db.query(`
      DELETE FROM evidence_supersessions
      WHERE workspace_id = ?
        AND source_id = ?
        AND superseded_idempotency_key = ?
        AND successor_idempotency_key = ?
    `);
    for (const edge of existingEdges) {
      if (incomingKeys.has(edge.successor_idempotency_key)) continue;
      const survivesBaseline = hasMembershipAtOrAboveBaseline.get(
        batch.workspaceId,
        batch.source.sourceId,
        edge.successor_idempotency_key,
        batch.checkpoint.sequence,
      );
      if (!survivesBaseline) {
        remove.run(
          batch.workspaceId,
          batch.source.sourceId,
          edge.superseded_idempotency_key,
          edge.successor_idempotency_key,
        );
      }
    }
  }

  #assertPendingSupersessionTarget(record: TaxEvidenceRecord): void {
    const pending = this.#db.query<{ source_id: string }, [string, string]>(`
      SELECT source_id
      FROM evidence_supersessions
      WHERE workspace_id = ? AND superseded_idempotency_key = ?
    `).get(record.workspaceId, record.idempotencyKey);
    if (pending && pending.source_id !== record.sourceId) throw new Error('EVIDENCE_SUPERSESSION_SOURCE_MISMATCH');
  }

  #assertNoEvidenceCycles(workspaceId: string): void {
    const rows = this.#db.query<{ record_json: string }, [string]>(
      'SELECT record_json FROM evidence_records WHERE workspace_id = ?',
    ).all(workspaceId);
    resolveActiveEvidenceRecords(
      rows.map(row => normalizeEvidenceRecord(JSON.parse(row.record_json) as TaxEvidenceRecord)),
      { requireTargets: false },
    );
  }

  #advanceEvidenceGeneration(workspaceId: string | null, updatedAt: string): void {
    if (!workspaceId) return;
    this.#db.query(`
      INSERT INTO tax_evidence_generations (workspace_id, generation, updated_at)
      VALUES (?, 1, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        generation = tax_evidence_generations.generation + 1,
        updated_at = excluded.updated_at
    `).run(workspaceId, updatedAt);
  }

  getEvidenceGeneration(workspaceId: string): number {
    const row = this.#db.query<{ generation: number }, [string]>(
      'SELECT generation FROM tax_evidence_generations WHERE workspace_id = ?',
    ).get(workspaceId);
    return row?.generation ?? 0;
  }

  appendEvidenceConsentEvent(event: TaxEvidenceConsentEventV1): TaxEvidenceConsentEventReceiptV1 {
    const eventHash = hashCanonical(event);
    return this.#db.transaction(() => {
      const existingEvent = this.#db.query<{ event_hash: string }, [string]>(
        'SELECT event_hash FROM evidence_consent_events WHERE event_id = ?',
      ).get(event.eventId);
      if (existingEvent) {
        if (existingEvent.event_hash !== eventHash) throw new Error('EVIDENCE_CONSENT_EVENT_IDEMPOTENCY_CONFLICT');
        return consentEventReceipt(event, true);
      }
      const existingSequence = this.#db.query<{ event_id: string }, [string, number]>(
        'SELECT event_id FROM evidence_consent_events WHERE workspace_id = ? AND sequence = ?',
      ).get(event.workspaceId, event.sequence);
      if (existingSequence) throw new Error('EVIDENCE_CONSENT_SEQUENCE_CONFLICT');
      const latest = this.#db.query<{ sequence: number }, [string]>(
        'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM evidence_consent_events WHERE workspace_id = ?',
      ).get(event.workspaceId)?.sequence ?? 0;
      if (event.sequence !== latest + 1) throw new Error('EVIDENCE_CONSENT_SEQUENCE_GAP');

      const existingGrant = this.#db.query<{
        scope_hash: string;
        source_ids_json: string;
        granted_at: string;
        revoked_at: string | null;
      }, [string, string]>(`
        SELECT scope_hash, source_ids_json, granted_at, revoked_at
        FROM evidence_consent_grants
        WHERE workspace_id = ? AND version = ?
      `).get(event.workspaceId, event.consent.version);
      if (existingGrant && (existingGrant.scope_hash !== event.consent.scopeHash
        || existingGrant.source_ids_json !== JSON.stringify(event.consent.sourceIds))) {
        throw new Error('EVIDENCE_CONSENT_VERSION_SCOPE_CONFLICT');
      }
      if (event.action === 'grant') {
        if (existingGrant?.revoked_at) throw new Error('EVIDENCE_CONSENT_REGRANT_FORBIDDEN');
        if (existingGrant) throw new Error('EVIDENCE_CONSENT_ALREADY_GRANTED');
        this.#db.query(`
          INSERT INTO evidence_consent_grants (
            workspace_id, purpose, version, scope_hash, source_ids_json, granted_at, revoked_at, grant_event_id, revoke_event_id
          ) VALUES (?, 'tax_workspace_processing', ?, ?, ?, ?, NULL, ?, NULL)
        `).run(
          event.workspaceId,
          event.consent.version,
          event.consent.scopeHash,
          JSON.stringify(event.consent.sourceIds),
          event.occurredAt,
          event.eventId,
        );
      } else {
        if (!existingGrant) throw new Error('EVIDENCE_CONSENT_GRANT_NOT_FOUND');
        if (existingGrant.revoked_at) throw new Error('EVIDENCE_CONSENT_ALREADY_REVOKED');
        if (parseInstant(event.occurredAt) < parseInstant(existingGrant.granted_at)) {
          throw new Error('EVIDENCE_CONSENT_EVENT_TIME_INVALID');
        }
        this.#db.query(`
          UPDATE evidence_consent_grants
          SET revoked_at = ?, revoke_event_id = ?
          WHERE workspace_id = ? AND version = ? AND scope_hash = ?
        `).run(event.occurredAt, event.eventId, event.workspaceId, event.consent.version, event.consent.scopeHash);
      }
      this.#db.query(`
        INSERT INTO evidence_consent_events (
          event_id, workspace_id, sequence, action, event_hash, event_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(event.eventId, event.workspaceId, event.sequence, event.action, eventHash, JSON.stringify(event), event.occurredAt);
      this.#advanceEvidenceGeneration(event.workspaceId, event.occurredAt);
      const domainEvent = createConsentRevokedTaxDomainEvent({
        event,
        commitmentSecret: this.#domainEventCommitmentSecret,
      });
      if (domainEvent) this.#appendTaxDomainEventInTransaction(domainEvent, event.occurredAt);
      return consentEventReceipt(event, false);
    })();
  }

  listEvidenceConsentGrants(workspaceId: string): readonly TaxConsentGrant[] {
    const rows = this.#db.query<{
      version: string;
      scope_hash: string;
      source_ids_json: string;
      granted_at: string;
      revoked_at: string | null;
    }, [string]>(`
      SELECT version, scope_hash, source_ids_json, granted_at, revoked_at
      FROM evidence_consent_grants
      WHERE workspace_id = ?
      ORDER BY granted_at ASC, version ASC, scope_hash ASC
    `).all(workspaceId);
    return rows.map(row => ({
      purpose: 'tax_workspace_processing',
      version: row.version,
      scopeIds: JSON.parse(row.source_ids_json) as string[],
      scopeHash: row.scope_hash,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
    }));
  }

  #assertActiveBatchConsent(batch: TaxEvidenceBatchV1): void {
    const grant = this.#db.query<{ scope_hash: string; source_ids_json: string; granted_at: string; revoked_at: string | null }, [string, string]>(`
      SELECT scope_hash, source_ids_json, granted_at, revoked_at
      FROM evidence_consent_grants
      WHERE workspace_id = ? AND version = ?
    `).get(batch.workspaceId, batch.consent.version);
    if (!grant) throw new Error('EVIDENCE_CONSENT_GRANT_NOT_FOUND');
    if (grant.revoked_at) throw new Error('EVIDENCE_CONSENT_REVOKED');
    if (grant.scope_hash !== batch.consent.scopeHash
      || grant.source_ids_json !== JSON.stringify(batch.consent.sourceIds)) throw new Error('EVIDENCE_CONSENT_SCOPE_CONFLICT');
    if (parseInstant(batch.producedAt) < parseInstant(grant.granted_at)) throw new Error('EVIDENCE_CONSENT_NOT_YET_GRANTED');
  }

  appendWorkflowRevision(state: ComplianceWorkspaceState, stateHash: string, appendedAt: string): number {
    const row = this.#db.query<{ revision: number }, [string]>(
      'SELECT COALESCE(MAX(revision), 0) AS revision FROM workflow_revisions WHERE workspace_id = ?'
    ).get(state.workspaceId);
    const revision = (row?.revision ?? 0) + 1;
    this.#db.query(`
      INSERT INTO workflow_revisions (workspace_id, revision, state_json, state_hash, appended_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(state.workspaceId, revision, JSON.stringify(state), stateHash, appendedAt);
    return revision;
  }

  getWorkflowRevision(workspaceId: string, revision?: number): ComplianceWorkspaceState | null {
    const row = revision === undefined
      ? this.#db.query<{ state_json: string }, [string]>(
          'SELECT state_json FROM workflow_revisions WHERE workspace_id = ? ORDER BY revision DESC LIMIT 1'
        ).get(workspaceId)
      : this.#db.query<{ state_json: string }, [string, number]>(
          'SELECT state_json FROM workflow_revisions WHERE workspace_id = ? AND revision = ?'
        ).get(workspaceId, revision);
    return row ? (JSON.parse(row.state_json) as ComplianceWorkspaceState) : null;
  }

  appendFacturaEAgentRevision(input: Readonly<{
    run: FacturaEAgentRunV1;
    event: FacturaEAgentEventV1;
    stateHash: string;
    commandHash: string;
    appendedAt: string;
  }>): FacturaEAgentRunV1 {
    if (input.event.runId !== input.run.runId || input.event.workspaceId !== input.run.workspaceId) throw new Error('AGENT_EVENT_RUN_MISMATCH');
    if (!/^[a-f0-9]{64}$/.test(input.commandHash)) throw new Error('AGENT_COMMAND_HASH_INVALID');
    const transaction = this.#db.transaction(() => {
      const existing = this.#db.query<{ state_json: string; command_hash: string | null }, [string, string]>(`
        SELECT revisions.state_json, commands.command_hash
        FROM factura_e_agent_revisions AS revisions
        LEFT JOIN factura_e_agent_idempotency_commands AS commands
          ON commands.run_id = revisions.run_id AND commands.idempotency_key = revisions.idempotency_key
        WHERE revisions.run_id = ? AND revisions.idempotency_key = ?
      `).get(input.run.runId, input.event.idempotencyKey);
      if (existing) {
        if (existing.command_hash && existing.command_hash !== input.commandHash) throw new Error('AGENT_IDEMPOTENCY_CONFLICT');
        return JSON.parse(existing.state_json) as FacturaEAgentRunV1;
      }

      const latest = this.#db.query<{ revision: number }, [string]>(
        'SELECT COALESCE(MAX(revision), 0) AS revision FROM factura_e_agent_revisions WHERE run_id = ?'
      ).get(input.run.runId);
      const expectedPrevious = input.run.revision - 1;
      if ((latest?.revision ?? 0) !== expectedPrevious) throw new Error('AGENT_RUN_REVISION_CONFLICT');
      this.#db.query(`
        INSERT INTO factura_e_agent_revisions (
          run_id, workspace_id, revision, idempotency_key, state_json, state_hash, event_json, appended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.run.runId,
        input.run.workspaceId,
        input.run.revision,
        input.event.idempotencyKey,
        JSON.stringify(input.run),
        input.stateHash,
        JSON.stringify(input.event),
        input.appendedAt
      );
      this.#db.query(`
        INSERT INTO factura_e_agent_idempotency_commands (run_id, idempotency_key, command_hash, recorded_at)
        VALUES (?, ?, ?, ?)
      `).run(input.run.runId, input.event.idempotencyKey, input.commandHash, input.appendedAt);
      const consent = this.#db.query<{
        version: string;
        scope_hash: string;
      }, [string]>(`
        SELECT version, scope_hash
        FROM evidence_consent_grants
        WHERE workspace_id = ? AND revoked_at IS NULL
        ORDER BY granted_at DESC, version DESC
        LIMIT 1
      `).get(input.run.workspaceId);
      if (consent) {
        const accountantMandate = this.#activeMandateForFacturaEEvent(input.event);
        const domainEvents = createFacturaEAgentTaxDomainEvents({
          run: input.run,
          event: input.event,
          consent: { version: consent.version, scopeHash: consent.scope_hash },
          accountantMandate,
          commitmentSecret: this.#domainEventCommitmentSecret,
        });
        for (const domainEvent of domainEvents) {
          this.#appendTaxDomainEventInTransaction(domainEvent, input.appendedAt);
        }
      }
      return input.run;
    });
    return transaction();
  }

  #activeMandateForFacturaEEvent(
    event: FacturaEAgentEventV1,
  ): Readonly<{ mandateId: string }> | null {
    const scope = accountantMandateScopeForFacturaEEvent(event);
    if (!scope) return null;
    const rows = this.#db.query<{ mandate_json: string }, [string, string]>(`
      SELECT mandate_json
      FROM accountant_mandates
      WHERE workspace_id = ? AND accountant_actor_id = ?
      ORDER BY granted_at DESC, mandate_id ASC
    `).all(event.workspaceId, event.actorId);
    for (const row of rows) {
      const mandate = JSON.parse(row.mandate_json) as AccountantMandateV1;
      try {
        assertActiveAccountantMandate(mandate, {
          workspaceId: event.workspaceId,
          accountantActorId: event.actorId,
          scope,
          at: event.occurredAt,
        });
        return { mandateId: mandate.mandateId };
      } catch {
        // Continue looking: an older mandate can still be active after a
        // newer, narrower grant expired or was revoked.
      }
    }
    throw new Error('ACCOUNTANT_MANDATE_REQUIRED_FOR_DOMAIN_EVENT');
  }

  getFacturaEAgentRun(runId: string): FacturaEAgentRunV1 | null {
    const row = this.#db.query<{ state_json: string }, [string]>(
      'SELECT state_json FROM factura_e_agent_revisions WHERE run_id = ? ORDER BY revision DESC LIMIT 1'
    ).get(runId);
    return row ? JSON.parse(row.state_json) as FacturaEAgentRunV1 : null;
  }

  getFacturaEAgentRunByIdempotency(runId: string, idempotencyKey: string, expectedCommandHash?: string): FacturaEAgentRunV1 | null {
    if (expectedCommandHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedCommandHash)) throw new Error('AGENT_COMMAND_HASH_INVALID');
    const row = this.#db.query<{ state_json: string; command_hash: string | null }, [string, string]>(`
      SELECT revisions.state_json, commands.command_hash
      FROM factura_e_agent_revisions AS revisions
      LEFT JOIN factura_e_agent_idempotency_commands AS commands
        ON commands.run_id = revisions.run_id AND commands.idempotency_key = revisions.idempotency_key
      WHERE revisions.run_id = ? AND revisions.idempotency_key = ?
    `).get(runId, idempotencyKey);
    if (row?.command_hash && expectedCommandHash && row.command_hash !== expectedCommandHash) throw new Error('AGENT_IDEMPOTENCY_CONFLICT');
    return row ? JSON.parse(row.state_json) as FacturaEAgentRunV1 : null;
  }

  listFacturaEAgentRuns(workspaceId: string): readonly FacturaEAgentRunV1[] {
    const rows = this.#db.query<{ state_json: string }, [string]>(`
      SELECT revisions.state_json
      FROM factura_e_agent_revisions AS revisions
      INNER JOIN (
        SELECT run_id, MAX(revision) AS revision
        FROM factura_e_agent_revisions
        WHERE workspace_id = ?
        GROUP BY run_id
      ) AS latest ON latest.run_id = revisions.run_id AND latest.revision = revisions.revision
      ORDER BY revisions.appended_at DESC
    `).all(workspaceId);
    return rows.map(row => JSON.parse(row.state_json) as FacturaEAgentRunV1);
  }

  listFacturaEAgentEvents(runId: string): readonly FacturaEAgentEventV1[] {
    const rows = this.#db.query<{ event_json: string }, [string]>(
      'SELECT event_json FROM factura_e_agent_revisions WHERE run_id = ? ORDER BY revision ASC'
    ).all(runId);
    return rows.map(row => JSON.parse(row.event_json) as FacturaEAgentEventV1);
  }

  getFacturaEAgentEventByIdempotency(runId: string, idempotencyKey: string): FacturaEAgentEventV1 | null {
    const row = this.#db.query<{ event_json: string }, [string, string]>(
      'SELECT event_json FROM factura_e_agent_revisions WHERE run_id = ? AND idempotency_key = ?'
    ).get(runId, idempotencyKey);
    return row ? JSON.parse(row.event_json) as FacturaEAgentEventV1 : null;
  }

  appendArcaOnboardingRevision(input: Readonly<{
    run: ArcaOnboardingRunV1;
    event: ArcaOnboardingEventV1;
    stateHash: string;
    appendedAt: string;
  }>): ArcaOnboardingRunV1 {
    if (input.event.onboardingId !== input.run.onboardingId || input.event.workspaceId !== input.run.workspaceId) {
      throw new Error('ARCA_ONBOARDING_EVENT_RUN_MISMATCH');
    }
    const transaction = this.#db.transaction(() => {
      const existing = this.#db.query<{ state_json: string }, [string, string]>(
        'SELECT state_json FROM arca_onboarding_revisions WHERE onboarding_id = ? AND idempotency_key = ?'
      ).get(input.run.onboardingId, input.event.idempotencyKey);
      if (existing) return JSON.parse(existing.state_json) as ArcaOnboardingRunV1;

      const latest = this.#db.query<{ revision: number }, [string]>(
        'SELECT COALESCE(MAX(revision), 0) AS revision FROM arca_onboarding_revisions WHERE onboarding_id = ?'
      ).get(input.run.onboardingId);
      if ((latest?.revision ?? 0) !== input.run.revision - 1) throw new Error('ARCA_ONBOARDING_REVISION_CONFLICT');
      this.#db.query(`
        INSERT INTO arca_onboarding_revisions (
          onboarding_id, workspace_id, revision, idempotency_key, state_json, state_hash, event_json, appended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.run.onboardingId,
        input.run.workspaceId,
        input.run.revision,
        input.event.idempotencyKey,
        JSON.stringify(input.run),
        input.stateHash,
        JSON.stringify(input.event),
        input.appendedAt,
      );
      const consent = this.#db.query<{
        version: string;
        scope_hash: string;
      }, [string]>(`
        SELECT version, scope_hash
        FROM evidence_consent_grants
        WHERE workspace_id = ? AND revoked_at IS NULL
        ORDER BY granted_at DESC, version DESC
        LIMIT 1
      `).get(input.run.workspaceId);
      if (consent) {
        const domainEvent = createArcaOnboardingTaxDomainEvent({
          run: input.run,
          event: input.event,
          consent: { version: consent.version, scopeHash: consent.scope_hash },
          commitmentSecret: this.#domainEventCommitmentSecret,
        });
        if (domainEvent) this.#appendTaxDomainEventInTransaction(domainEvent, input.appendedAt);
      }
      return input.run;
    });
    return transaction();
  }

  getArcaOnboardingRun(onboardingId: string): ArcaOnboardingRunV1 | null {
    const row = this.#db.query<{ state_json: string }, [string]>(
      'SELECT state_json FROM arca_onboarding_revisions WHERE onboarding_id = ? ORDER BY revision DESC LIMIT 1'
    ).get(onboardingId);
    return row ? JSON.parse(row.state_json) as ArcaOnboardingRunV1 : null;
  }

  getArcaOnboardingRunByIdempotency(onboardingId: string, idempotencyKey: string): ArcaOnboardingRunV1 | null {
    const row = this.#db.query<{ state_json: string }, [string, string]>(
      'SELECT state_json FROM arca_onboarding_revisions WHERE onboarding_id = ? AND idempotency_key = ?'
    ).get(onboardingId, idempotencyKey);
    return row ? JSON.parse(row.state_json) as ArcaOnboardingRunV1 : null;
  }

  listArcaOnboardingRuns(workspaceId: string): readonly ArcaOnboardingRunV1[] {
    const rows = this.#db.query<{ state_json: string }, [string]>(`
      SELECT revisions.state_json
      FROM arca_onboarding_revisions AS revisions
      INNER JOIN (
        SELECT onboarding_id, MAX(revision) AS revision
        FROM arca_onboarding_revisions
        WHERE workspace_id = ?
        GROUP BY onboarding_id
      ) AS latest
        ON latest.onboarding_id = revisions.onboarding_id AND latest.revision = revisions.revision
      ORDER BY revisions.appended_at DESC
    `).all(workspaceId);
    return rows.map(row => JSON.parse(row.state_json) as ArcaOnboardingRunV1);
  }

  listArcaOnboardingEvents(onboardingId: string): readonly ArcaOnboardingEventV1[] {
    const rows = this.#db.query<{ event_json: string }, [string]>(
      'SELECT event_json FROM arca_onboarding_revisions WHERE onboarding_id = ? ORDER BY revision ASC'
    ).all(onboardingId);
    return rows.map(row => JSON.parse(row.event_json) as ArcaOnboardingEventV1);
  }

  getArcaOnboardingEventByIdempotency(onboardingId: string, idempotencyKey: string): ArcaOnboardingEventV1 | null {
    const row = this.#db.query<{ event_json: string }, [string, string]>(
      'SELECT event_json FROM arca_onboarding_revisions WHERE onboarding_id = ? AND idempotency_key = ?'
    ).get(onboardingId, idempotencyKey);
    return row ? JSON.parse(row.event_json) as ArcaOnboardingEventV1 : null;
  }

  bindArcaOnboardingReclaimSession(onboardingId: string, session: ArcaOnboardingReclaimSessionV1, boundAt: string): void {
    const existing = this.#db.query<{ onboarding_id: string }, [string]>(
      'SELECT onboarding_id FROM arca_onboarding_reclaim_bindings WHERE session_id = ?'
    ).get(session.sessionId);
    if (existing && existing.onboarding_id !== onboardingId) throw new Error('RECLAIM_SESSION_BINDING_CONFLICT');
    if (!existing) {
      this.#db.query(`
        INSERT INTO arca_onboarding_reclaim_bindings (
          session_id, onboarding_id, provider_id, provider_version, expires_at, bound_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(session.sessionId, onboardingId, session.providerId, session.providerVersion, session.expiresAt, boundAt);
    }
  }

  getArcaOnboardingIdForReclaimSession(sessionId: string): string | null {
    const row = this.#db.query<{ onboarding_id: string }, [string]>(
      'SELECT onboarding_id FROM arca_onboarding_reclaim_bindings WHERE session_id = ?'
    ).get(sessionId);
    return row?.onboarding_id ?? null;
  }

  bindReclaimSession(runId: string, session: ReclaimSessionReferenceV1, boundAt: string): void {
    const existing = this.#db.query<{ run_id: string }, [string]>(
      'SELECT run_id FROM reclaim_session_bindings WHERE session_id = ?'
    ).get(session.sessionId);
    if (existing && existing.run_id !== runId) throw new Error('RECLAIM_SESSION_BINDING_CONFLICT');
    if (!existing) {
      this.#db.query(`
        INSERT INTO reclaim_session_bindings (
          session_id, run_id, purpose, provider_id, provider_version, expires_at, bound_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(session.sessionId, runId, session.purpose, session.providerId, session.providerVersion, session.expiresAt, boundAt);
    }
  }

  getRunIdForReclaimSession(sessionId: string): string | null {
    const row = this.#db.query<{ run_id: string }, [string]>(
      'SELECT run_id FROM reclaim_session_bindings WHERE session_id = ?'
    ).get(sessionId);
    return row?.run_id ?? null;
  }

  saveReclaimRequestArtifact(input: Readonly<{
    sessionId: string;
    requestUrl: string;
    requestConfig: string;
    statusUrl: string;
    storedAt: string;
  }>): void {
    this.#db.query(`
      INSERT INTO reclaim_request_artifacts (session_id, request_url, request_config, status_url, stored_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO NOTHING
    `).run(input.sessionId, input.requestUrl, input.requestConfig, input.statusUrl, input.storedAt);
  }

  getReclaimRequestArtifact(sessionId: string): Readonly<{ requestUrl: string; requestConfig: string; statusUrl: string }> | null {
    const row = this.#db.query<{ request_url: string; request_config: string; status_url: string }, [string]>(
      'SELECT request_url, request_config, status_url FROM reclaim_request_artifacts WHERE session_id = ?'
    ).get(sessionId);
    return row ? { requestUrl: row.request_url, requestConfig: row.request_config, statusUrl: row.status_url } : null;
  }

  grantAccountantMandate(mandate: AccountantMandateV1): void {
    assertActiveAccountantMandate(mandate, {
      workspaceId: mandate.workspaceId,
      accountantActorId: mandate.accountantActorId,
      scope: mandate.scopes[0] ?? invalidMandateScope(),
      at: mandate.grantedAt,
    });
    const existing = this.getAccountantMandate(mandate.mandateId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(mandate)) throw new Error('ACCOUNTANT_MANDATE_ID_CONFLICT');
      return;
    }
    this.#db.query(`
      INSERT INTO accountant_mandates (
        mandate_id, workspace_id, accountant_actor_id, mandate_json, granted_at, expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      mandate.mandateId,
      mandate.workspaceId,
      mandate.accountantActorId,
      JSON.stringify(mandate),
      mandate.grantedAt,
      mandate.expiresAt,
      mandate.revokedAt,
    );
    this.#db.query(`
      INSERT INTO audit_events (event_id, workspace_id, actor_id, action, occurred_at, safe_metadata_json)
      VALUES (?, ?, ?, 'accountant_mandate_granted', ?, ?)
    `).run(
      `accountant-mandate-grant:${mandate.mandateId}`,
      mandate.workspaceId,
      mandate.grantedByActorId,
      mandate.grantedAt,
      JSON.stringify({ mandateId: mandate.mandateId, accountantActorId: mandate.accountantActorId, scopes: mandate.scopes, expiresAt: mandate.expiresAt }),
    );
  }

  revokeAccountantMandate(mandateId: string, workspaceId: string, revokedByActorId: string, revokedAt: string): AccountantMandateV1 {
    const mandate = this.getAccountantMandate(mandateId);
    if (!mandate) throw new Error('ACCOUNTANT_MANDATE_NOT_FOUND');
    if (mandate.workspaceId !== workspaceId) throw new Error('ACCOUNTANT_MANDATE_WORKSPACE_UNAUTHORIZED');
    if (mandate.revokedAt !== null) return mandate;
    const revoked = { ...mandate, revokedAt };
    this.#db.query(`
      UPDATE accountant_mandates SET mandate_json = ?, revoked_at = ? WHERE mandate_id = ?
    `).run(JSON.stringify(revoked), revokedAt, mandateId);
    this.#db.query(`
      INSERT INTO audit_events (event_id, workspace_id, actor_id, action, occurred_at, safe_metadata_json)
      VALUES (?, ?, ?, 'accountant_mandate_revoked', ?, ?)
    `).run(
      `accountant-mandate-revoke:${mandateId}`,
      workspaceId,
      revokedByActorId,
      revokedAt,
      JSON.stringify({ mandateId, accountantActorId: mandate.accountantActorId }),
    );
    return revoked;
  }

  getAccountantMandate(mandateId: string): AccountantMandateV1 | null {
    const row = this.#db.query<{ mandate_json: string }, [string]>(
      'SELECT mandate_json FROM accountant_mandates WHERE mandate_id = ?'
    ).get(mandateId);
    return row ? JSON.parse(row.mandate_json) as AccountantMandateV1 : null;
  }

  listAccountantMandates(workspaceId: string): readonly AccountantMandateV1[] {
    return this.#db.query<{ mandate_json: string }, [string]>(
      'SELECT mandate_json FROM accountant_mandates WHERE workspace_id = ? ORDER BY granted_at DESC, mandate_id ASC'
    ).all(workspaceId).map(row => JSON.parse(row.mandate_json) as AccountantMandateV1);
  }

  requireAccountantMandate(input: Readonly<{
    mandateId: string;
    workspaceId: string;
    accountantActorId: string;
    scope: AccountantMandateScope;
    at: string;
  }>): AccountantMandateV1 {
    const mandate = this.getAccountantMandate(input.mandateId);
    if (!mandate) throw new Error('ACCOUNTANT_MANDATE_NOT_FOUND');
    assertActiveAccountantMandate(mandate, input);
    return mandate;
  }
}

function invalidMandateScope(): AccountantMandateScope {
  throw new Error('ACCOUNTANT_MANDATE_SCOPE_REQUIRED');
}

function normalizeEvidenceRecord(record: TaxEvidenceRecord): TaxEvidenceRecord {
  return {
    ...record,
    supersedesIdempotencyKey: record.supersedesIdempotencyKey ?? null,
    validityState: record.validityState ?? 'active',
    invoiceDocumentKind: record.invoiceDocumentKind ?? null,
    invoiceAdjustmentKind: record.invoiceAdjustmentKind ?? null,
    adjustsEconomicEventId: record.adjustsEconomicEventId ?? null,
  };
}

function batchReceipt(
  batch: TaxEvidenceBatchV1,
  batchHash: string,
  appendedRecords: number,
  replayed: boolean,
): TaxEvidenceBatchReceiptV1 {
  return {
    version: 'tax-evidence-batch-receipt-v1',
    batchId: batch.batchId,
    batchHash,
    workspaceId: batch.workspaceId,
    sourceId: batch.source.sourceId,
    sequence: batch.checkpoint.sequence,
    appendedRecords,
    replayed,
  };
}

function consentEventReceipt(
  event: TaxEvidenceConsentEventV1,
  replayed: boolean,
): TaxEvidenceConsentEventReceiptV1 {
  return {
    version: 'tax-evidence-consent-event-receipt-v1',
    eventId: event.eventId,
    workspaceId: event.workspaceId,
    sequence: event.sequence,
    action: event.action,
    replayed,
  };
}

function parseInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('EVIDENCE_TIMESTAMP_INVALID');
  return parsed;
}

function evidenceMembershipKey(sourceId: string, idempotencyKey: string): string {
  return `${sourceId}\u0000${idempotencyKey}`;
}
