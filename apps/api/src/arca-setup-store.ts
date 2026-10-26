import { randomUUID } from 'node:crypto';

import {
  ARCA_SETUP_TERMINAL_PHASES,
  hashCanonical,
  type ArcaSetupEventV1,
  type ArcaSetupExecutionV1,
} from '@tax-engine/core';
import { Database } from 'bun:sqlite';

/**
 * Durable state for automated ARCA connections.
 *
 * - `arca_setup_revisions`: append-only execution revisions, so a customer can
 *   close the app and the run continues and recovers from the last revision.
 * - `arca_setup_private`: references that must not appear in any projection
 *   (boundary setup and enrollment references, provider acceptance evidence).
 * - `arca_setup_leases`: one holder per taxpayer and environment at a time, so
 *   two jobs can never touch the same ARCA account concurrently.
 */
export type ArcaSetupPrivate = Readonly<{
  setupRef: string | null;
  enrollmentRef: string | null;
  providerAcceptanceEvidenceHash: string | null;
  lastHandoffTicketHash: string | null;
  cleanupPending: boolean;
}>;

export class ArcaSetupStore {
  readonly #db: Database;

  constructor(path = process.env.TAX_ARCA_SETUP_DB_PATH ?? process.env.TAX_ENGINE_DB_PATH ?? ':memory:') {
    this.#db = new Database(path, { create: true });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS arca_setup_revisions (
        execution_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        onboarding_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        phase TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        event_json TEXT,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (execution_id, revision),
        UNIQUE (execution_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS arca_setup_by_onboarding ON arca_setup_revisions (onboarding_id, revision);
      CREATE INDEX IF NOT EXISTS arca_setup_by_scope ON arca_setup_revisions (scope_key, revision);
      CREATE INDEX IF NOT EXISTS arca_setup_by_workspace ON arca_setup_revisions (workspace_id, revision);
      CREATE TABLE IF NOT EXISTS arca_setup_private (
        execution_id TEXT PRIMARY KEY,
        setup_ref TEXT,
        enrollment_ref TEXT,
        provider_acceptance_evidence_hash TEXT,
        last_handoff_ticket_hash TEXT,
        cleanup_pending INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arca_setup_leases (
        scope_key TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arca_setup_receipts (
        receipt_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        receipt_hash TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
    `);
  }

  static scopeKey(execution: Pick<ArcaSetupExecutionV1, 'workspaceId' | 'taxpayerReferenceHash' | 'environment'>): string {
    return hashCanonical({ workspaceId: execution.workspaceId, taxpayer: execution.taxpayerReferenceHash, environment: execution.environment });
  }

  /** Idempotent append. A replayed key returns the revision it produced. */
  append(execution: ArcaSetupExecutionV1, event: ArcaSetupEventV1 | null, idempotencyKey: string, appendedAt: string): ArcaSetupExecutionV1 {
    return this.#db.transaction(() => {
      const existing = this.#db.query<{ state_json: string }, [string, string]>(
        'SELECT state_json FROM arca_setup_revisions WHERE execution_id = ? AND idempotency_key = ?',
      ).get(execution.executionId, idempotencyKey);
      if (existing) return JSON.parse(existing.state_json) as ArcaSetupExecutionV1;
      const latest = this.#db.query<{ revision: number }, [string]>(
        'SELECT COALESCE(MAX(revision), 0) AS revision FROM arca_setup_revisions WHERE execution_id = ?',
      ).get(execution.executionId)!.revision;
      if (latest !== 0 && execution.revision !== latest + 1) throw new Error('ARCA_SETUP_REVISION_CONFLICT');
      this.#db.query(`
        INSERT INTO arca_setup_revisions (
          execution_id, revision, workspace_id, onboarding_id, scope_key, phase, idempotency_key,
          state_json, state_hash, event_json, appended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        execution.executionId, execution.revision, execution.workspaceId, execution.onboardingId,
        ArcaSetupStore.scopeKey(execution), execution.phase, idempotencyKey,
        JSON.stringify(execution), hashCanonical(execution), event ? JSON.stringify(event) : null, appendedAt,
      );
      return execution;
    })();
  }

  get(executionId: string): ArcaSetupExecutionV1 | null {
    const row = this.#db.query<{ state_json: string }, [string]>(
      'SELECT state_json FROM arca_setup_revisions WHERE execution_id = ? ORDER BY revision DESC LIMIT 1',
    ).get(executionId);
    return row ? JSON.parse(row.state_json) as ArcaSetupExecutionV1 : null;
  }

  /** The single non-terminal execution for a taxpayer, if any: start resumes it. */
  activeForScope(scopeKey: string): ArcaSetupExecutionV1 | null {
    const rows = this.#db.query<{ execution_id: string }, [string]>(
      'SELECT DISTINCT execution_id FROM arca_setup_revisions WHERE scope_key = ?',
    ).all(scopeKey);
    for (const row of rows) {
      const execution = this.get(row.execution_id);
      if (execution && !ARCA_SETUP_TERMINAL_PHASES.includes(execution.phase)) return execution;
    }
    return null;
  }

  latestForOnboarding(onboardingId: string): ArcaSetupExecutionV1 | null {
    const row = this.#db.query<{ execution_id: string }, [string]>(
      'SELECT execution_id FROM arca_setup_revisions WHERE onboarding_id = ? ORDER BY appended_at DESC, revision DESC LIMIT 1',
    ).get(onboardingId);
    return row ? this.get(row.execution_id) : null;
  }

  listForWorkspace(workspaceId: string): readonly ArcaSetupExecutionV1[] {
    const rows = this.#db.query<{ execution_id: string }, [string]>(
      'SELECT DISTINCT execution_id FROM arca_setup_revisions WHERE workspace_id = ?',
    ).all(workspaceId);
    return rows.map(row => this.get(row.execution_id)).filter((value): value is ArcaSetupExecutionV1 => value !== null);
  }

  /** Non-terminal executions, for the scheduler tick. */
  listOpen(limit = 100): readonly ArcaSetupExecutionV1[] {
    const rows = this.#db.query<{ execution_id: string }, [number]>(`
      SELECT execution_id FROM arca_setup_revisions AS outer_rows
      WHERE revision = (SELECT MAX(revision) FROM arca_setup_revisions WHERE execution_id = outer_rows.execution_id)
        AND phase NOT IN ('connected', 'cancelled', 'failed')
      ORDER BY appended_at ASC LIMIT ?
    `).all(limit);
    return rows.map(row => this.get(row.execution_id)).filter((value): value is ArcaSetupExecutionV1 => value !== null);
  }

  events(executionId: string): readonly ArcaSetupEventV1[] {
    return this.#db.query<{ event_json: string | null }, [string]>(
      'SELECT event_json FROM arca_setup_revisions WHERE execution_id = ? ORDER BY revision ASC',
    ).all(executionId).flatMap(row => row.event_json ? [JSON.parse(row.event_json) as ArcaSetupEventV1] : []);
  }

  private(executionId: string): ArcaSetupPrivate {
    const row = this.#db.query<{
      setup_ref: string | null;
      enrollment_ref: string | null;
      provider_acceptance_evidence_hash: string | null;
      last_handoff_ticket_hash: string | null;
      cleanup_pending: number;
    }, [string]>('SELECT * FROM arca_setup_private WHERE execution_id = ?').get(executionId);
    return {
      setupRef: row?.setup_ref ?? null,
      enrollmentRef: row?.enrollment_ref ?? null,
      providerAcceptanceEvidenceHash: row?.provider_acceptance_evidence_hash ?? null,
      lastHandoffTicketHash: row?.last_handoff_ticket_hash ?? null,
      cleanupPending: Boolean(row?.cleanup_pending),
    };
  }

  setPrivate(executionId: string, patch: Partial<ArcaSetupPrivate>, at: string): void {
    const current = this.private(executionId);
    const next = { ...current, ...patch };
    this.#db.query(`
      INSERT INTO arca_setup_private (execution_id, setup_ref, enrollment_ref, provider_acceptance_evidence_hash, last_handoff_ticket_hash, cleanup_pending, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(execution_id) DO UPDATE SET
        setup_ref = excluded.setup_ref,
        enrollment_ref = excluded.enrollment_ref,
        provider_acceptance_evidence_hash = excluded.provider_acceptance_evidence_hash,
        last_handoff_ticket_hash = excluded.last_handoff_ticket_hash,
        cleanup_pending = excluded.cleanup_pending,
        updated_at = excluded.updated_at
    `).run(executionId, next.setupRef, next.enrollmentRef, next.providerAcceptanceEvidenceHash, next.lastHandoffTicketHash, next.cleanupPending ? 1 : 0, at);
  }

  listCleanupPending(limit = 50): readonly string[] {
    return this.#db.query<{ execution_id: string }, [number]>('SELECT execution_id FROM arca_setup_private WHERE cleanup_pending = 1 LIMIT ?')
      .all(limit).map(row => row.execution_id);
  }

  /** Atomic: succeeds only if the lease is free, expired, or already ours. */
  acquireLease(scopeKey: string, holder: string, ttlMs: number, now: Date): boolean {
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const result = this.#db.query(`
      INSERT INTO arca_setup_leases (scope_key, holder, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
      WHERE arca_setup_leases.holder = excluded.holder OR arca_setup_leases.expires_at <= ?
    `).run(scopeKey, holder, expiresAt, now.toISOString());
    return result.changes > 0;
  }

  releaseLease(scopeKey: string, holder: string): void {
    this.#db.query('DELETE FROM arca_setup_leases WHERE scope_key = ? AND holder = ?').run(scopeKey, holder);
  }

  /** First sighting wins; a different body under a known receipt id is a conflict. */
  recordReceipt(receiptId: string, executionId: string, receiptHash: string, at: string): 'new' | 'duplicate' | 'conflict' {
    const existing = this.#db.query<{ receipt_hash: string }, [string]>('SELECT receipt_hash FROM arca_setup_receipts WHERE receipt_id = ?').get(receiptId);
    if (existing) return existing.receipt_hash === receiptHash ? 'duplicate' : 'conflict';
    this.#db.query('INSERT INTO arca_setup_receipts (receipt_id, execution_id, receipt_hash, received_at) VALUES (?, ?, ?, ?)')
      .run(receiptId, executionId, receiptHash, at);
    return 'new';
  }

  static newLeaseHolder(): string {
    return `tax:${randomUUID()}`;
  }
}
