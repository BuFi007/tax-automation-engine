import { Database } from 'bun:sqlite';

import type { ComplianceWorkspaceState, TaxEvidenceRecord, TaxProfile } from '@tax-engine/core';

import { assertCatalogueSafeProfile } from './profile-validation';

export class TaxProfileStore {
  readonly #db: Database;

  constructor(path = process.env.TAX_ENGINE_DB_PATH ?? ':memory:') {
    this.#db = new Database(path, { create: true });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
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
      CREATE TABLE IF NOT EXISTS evidence_records (
        workspace_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        record_json TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS evidence_records_workspace_revision
        ON evidence_records (workspace_id, revision);
      CREATE TABLE IF NOT EXISTS workflow_revisions (
        workspace_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, revision)
      );
    `);
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
    const insert = this.#db.query(`
      INSERT INTO evidence_records (
        workspace_id, idempotency_key, evidence_id, revision, artifact_hash, record_json, appended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, idempotency_key) DO NOTHING
    `);
    let appended = 0;
    const transaction = this.#db.transaction(() => {
      for (const record of records) {
        const existing = this.#db.query<{ artifact_hash: string }, [string, string]>(
          'SELECT artifact_hash FROM evidence_records WHERE workspace_id = ? AND idempotency_key = ?'
        ).get(record.workspaceId, record.idempotencyKey);
        if (existing && existing.artifact_hash !== record.artifactHash) throw new Error('EVIDENCE_IDEMPOTENCY_CONFLICT');
        if (!existing) {
          insert.run(record.workspaceId, record.idempotencyKey, record.evidenceId, record.revision, record.artifactHash, JSON.stringify(record), appendedAt);
          appended += 1;
        }
      }
    });
    transaction();
    return appended;
  }

  listEvidence(workspaceId: string): readonly TaxEvidenceRecord[] {
    const rows = this.#db.query<{ record_json: string }, [string]>(
      'SELECT record_json FROM evidence_records WHERE workspace_id = ? ORDER BY rowid ASC'
    ).all(workspaceId);
    return rows.map(row => JSON.parse(row.record_json) as TaxEvidenceRecord);
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
}
