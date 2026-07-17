import { Database } from 'bun:sqlite';

import { hashCanonical } from '@tax-engine/core';

const RECONCILIATION_LEASE_MS = 30_000;
const RECOVERY_LEASE_MS = 30_000;

export type FacturaEAuthorityExecutionState =
  | 'intent_persisted'
  | 'approved'
  | 'preparing'
  | 'prepared'
  | 'dispatching'
  | 'ambiguous'
  | 'recovering'
  | 'authority_accepted_unverified'
  | 'reconciling'
  | 'reconciliation_ambiguous'
  | 'officially_reconciled'
  | 'rejected';

export type FacturaEAuthorityExecutionRecord = Readonly<{
  executionId: string;
  workspaceId: string;
  runId: string;
  intentHash: string;
  authorityEnvironment: 'homologation' | 'production' | 'unbound';
  authorityProviderId: string;
  state: FacturaEAuthorityExecutionState;
  createdByActorHash: string;
  approvalActorHash: string | null;
  approvalRefHash: string | null;
  requestId: string | null;
  authorityPayloadRef: string | null;
  authorityPayloadHash: string | null;
  authorityIdentityHash: string | null;
  receiptHash: string | null;
  createIdempotencyKey: string;
  approvalIdempotencyKey: string | null;
  executeIdempotencyKey: string | null;
  recoverIdempotencyKey: string | null;
  reconcileIdempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type SafeFacturaEAuthorityExecutionReceipt = Readonly<{
  version: 'factura-e-authority-execution-receipt-v1';
  executionId: string;
  workspaceId: string;
  state:
    | 'intent_persisted'
    | 'approved'
    | 'effect_pending'
    | 'recovery_required'
    | 'authority_accepted_unverified'
    | 'reconciliation_required'
    | 'officially_reconciled'
    | 'rejected';
  replayed: boolean;
  nextAction:
    | 'register_human_approval'
    | 'execute_with_one_use_approval'
    | 'wait'
    | 'recover_exactly'
    | 'reconcile_authority_exactly'
    | 'none';
}>;

export type FacturaEAuthorityEffectPreparation = Readonly<{
  executionId: string;
  workspaceId: string;
  runId: string;
  intentHash: string;
  requestId: string;
  authorityPayloadRef: string;
  authorityPayloadHash: string;
}>;

export type FacturaEAuthorityEffectOutcome = Readonly<{
  status: 'authority_accepted_unverified' | 'rejected' | 'ambiguous';
  receiptHash: string;
}>;

export type FacturaEAuthorityReconciliationOutcome = Readonly<{
  status: 'officially_reconciled' | 'rejected' | 'ambiguous';
  receiptHash: string;
  /** Permanent private lock derived from the official authority identity. */
  authorityIdentityHash?: string;
}>;

/**
 * The implementation belongs inside Tax. It resolves represented-CUIT material,
 * certificate/vault references and WSFEX recovery state without returning any of
 * them to Motora, Open Agents or a browser.
 */
export interface FacturaEAuthorityRemoteEffect {
  prepare(input: Readonly<{
    executionId: string;
    workspaceId: string;
    runId: string;
    intentHash: string;
    idempotencyKey: string;
  }>): Promise<FacturaEAuthorityEffectPreparation>;
  execute(input: FacturaEAuthorityEffectPreparation): Promise<FacturaEAuthorityEffectOutcome>;
  recover(input: FacturaEAuthorityEffectPreparation): Promise<FacturaEAuthorityEffectOutcome>;
  /** Independent official read (for example FEXGetCMP), never the submit response. */
  reconcile(
    input: FacturaEAuthorityEffectPreparation
  ): Promise<FacturaEAuthorityReconciliationOutcome>;
}

export type FacturaERunAuthorityState = Readonly<{
  workspaceId: string;
  intentHash: string | null;
  issuanceState: string;
}>;

export class FacturaEAuthorityExecutionStore {
  readonly #db: Database;

  constructor(
    path = process.env.TAX_AUTHORITY_EXECUTION_DB_PATH ?? ':memory:',
    requireDurable = process.env.NODE_ENV === 'production'
  ) {
    if (requireDurable && (path === ':memory:' || path.trim() === '')) {
      throw new Error('TAX_AUTHORITY_EXECUTION_DURABLE_STORE_CONFIGURATION_REQUIRED');
    }
    this.#db = new Database(path, { create: true });
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS factura_e_authority_executions (
        execution_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        authority_environment TEXT NOT NULL,
        authority_provider_id TEXT NOT NULL,
        state TEXT NOT NULL,
        created_by_actor_hash TEXT NOT NULL,
        approval_actor_hash TEXT,
        approval_ref_hash TEXT UNIQUE,
        request_id TEXT,
        authority_payload_ref TEXT,
        authority_payload_hash TEXT,
        authority_identity_hash TEXT,
        receipt_hash TEXT,
        create_idempotency_key TEXT NOT NULL,
        create_command_hash TEXT NOT NULL,
        approval_idempotency_key TEXT,
        approval_command_hash TEXT,
        execute_idempotency_key TEXT,
        execute_command_hash TEXT,
        recover_idempotency_key TEXT,
        recover_command_hash TEXT,
        reconcile_idempotency_key TEXT,
        reconcile_command_hash TEXT,
        approval_consumed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, create_idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS factura_e_authority_audit (
        event_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        actor_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        state TEXT NOT NULL,
        safe_metadata_hash TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS factura_e_authority_recovery_attempts (
        execution_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        receipt_hash TEXT,
        fence_token TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (execution_id, idempotency_key),
        FOREIGN KEY (execution_id) REFERENCES factura_e_authority_executions(execution_id)
      );
      CREATE TABLE IF NOT EXISTS factura_e_authority_reconciliation_attempts (
        execution_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        receipt_hash TEXT,
        fence_token TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (execution_id, idempotency_key),
        FOREIGN KEY (execution_id) REFERENCES factura_e_authority_executions(execution_id)
      );
    `);
    this.ensureExecutionColumn('authority_identity_hash', 'TEXT');
    this.ensureExecutionColumn('authority_environment', 'TEXT');
    this.ensureExecutionColumn('authority_provider_id', 'TEXT');
    this.ensureExecutionColumn('reconcile_idempotency_key', 'TEXT');
    this.ensureExecutionColumn('reconcile_command_hash', 'TEXT');
    this.ensureTableColumn(
      'factura_e_authority_recovery_attempts',
      'fence_token',
      'TEXT'
    );
    this.ensureTableColumn(
      'factura_e_authority_recovery_attempts',
      'lease_expires_at',
      'TEXT'
    );
    this.ensureTableColumn(
      'factura_e_authority_recovery_attempts',
      'revision',
      'INTEGER'
    );
    this.ensureTableColumn(
      'factura_e_authority_reconciliation_attempts',
      'fence_token',
      'TEXT'
    );
    this.ensureTableColumn(
      'factura_e_authority_reconciliation_attempts',
      'lease_expires_at',
      'TEXT'
    );
    this.ensureTableColumn(
      'factura_e_authority_reconciliation_attempts',
      'revision',
      'INTEGER'
    );
    this.#db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS factura_e_authority_identity_lock_idx
      ON factura_e_authority_executions (authority_identity_hash)
      WHERE authority_identity_hash IS NOT NULL;
    `);
  }

  close(): void {
    this.#db.close();
  }

  private ensureExecutionColumn(name: string, type: 'TEXT'): void {
    this.ensureTableColumn('factura_e_authority_executions', name, type);
  }

  private ensureTableColumn(
    table: 'factura_e_authority_executions'
      | 'factura_e_authority_recovery_attempts'
      | 'factura_e_authority_reconciliation_attempts',
    name: string,
    type: 'TEXT' | 'INTEGER'
  ): void {
    const columns = this.#db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all();
    if (!columns.some(column => column.name === name))
      this.#db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }

  get(executionId: string): FacturaEAuthorityExecutionRecord | null {
    const row = this.#db
      .query<AuthorityExecutionRow, [string]>(
        'SELECT * FROM factura_e_authority_executions WHERE execution_id = ?'
      )
      .get(executionId);
    return row ? recordFromRow(row) : null;
  }

  latestForWorkspace(workspaceId: string): FacturaEAuthorityExecutionRecord | null {
    const row = this.#db
      .query<AuthorityExecutionRow, [string]>(`
        SELECT * FROM factura_e_authority_executions
        WHERE workspace_id = ?
        ORDER BY created_at DESC, execution_id DESC
        LIMIT 1
      `)
      .get(workspaceId);
    return row ? recordFromRow(row) : null;
  }

  create(input: Readonly<{
    workspaceId: string;
    runId: string;
    intentHash: string;
    authorityEnvironment: 'homologation' | 'production';
    authorityProviderId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Readonly<{ record: FacturaEAuthorityExecutionRecord; replayed: boolean }> {
    const commandHash = hashCanonical({
      workspaceId: input.workspaceId,
      runId: input.runId,
      intentHash: input.intentHash,
      authorityEnvironment: input.authorityEnvironment,
      authorityProviderId: input.authorityProviderId,
      actorId: input.actorId,
    });
    const existing = this.#db
      .query<AuthorityExecutionRow, [string, string]>(
        'SELECT * FROM factura_e_authority_executions WHERE workspace_id = ? AND create_idempotency_key = ?'
      )
      .get(input.workspaceId, input.idempotencyKey);
    if (existing) {
      if (existing.create_command_hash !== commandHash)
        throw new Error('TAX_AUTHORITY_INTENT_IDEMPOTENCY_CONFLICT');
      return { record: recordFromRow(existing), replayed: true };
    }
    const executionId = crypto.randomUUID();
    const actorHash = hashCanonical(input.actorId);
    this.#db.transaction(() => {
      this.#db.query(`
        INSERT INTO factura_e_authority_executions (
          execution_id, workspace_id, run_id, intent_hash,
          authority_environment, authority_provider_id, state,
          created_by_actor_hash, create_idempotency_key, create_command_hash,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'intent_persisted', ?, ?, ?, ?, ?)
      `).run(
        executionId,
        input.workspaceId,
        input.runId,
        input.intentHash,
        input.authorityEnvironment,
        input.authorityProviderId,
        actorHash,
        input.idempotencyKey,
        commandHash,
        input.occurredAt,
        input.occurredAt
      );
      this.audit(executionId, input.workspaceId, actorHash, 'persist_intent', 'intent_persisted', commandHash, input.occurredAt);
    })();
    return { record: this.required(executionId), replayed: false };
  }

  approve(input: Readonly<{
    executionId: string;
    workspaceId: string;
    intentHash: string;
    approvalRef: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Readonly<{ record: FacturaEAuthorityExecutionRecord; replayed: boolean }> {
    const approvalRefHash = hashCanonical(input.approvalRef);
    const actorHash = hashCanonical(input.actorId);
    const commandHash = hashCanonical({
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      intentHash: input.intentHash,
      approvalRefHash,
      actorId: input.actorId,
    });
    return this.#db.transaction(() => {
      const current = this.required(input.executionId);
      assertExecutionIdentity(current, input.workspaceId, input.intentHash);
      if (current.approvalIdempotencyKey) {
        const row = this.raw(input.executionId);
        if (
          current.approvalIdempotencyKey !== input.idempotencyKey ||
          row.approval_command_hash !== commandHash
        )
          throw new Error('TAX_AUTHORITY_APPROVAL_IDEMPOTENCY_CONFLICT');
        return { record: current, replayed: true };
      }
      if (current.state !== 'intent_persisted')
        throw new Error('TAX_AUTHORITY_APPROVAL_STATE_CONFLICT');
      if (current.createdByActorHash === actorHash)
        throw new Error('TAX_AUTHORITY_SELF_APPROVAL_FORBIDDEN');
      const reused = this.#db
        .query<{ execution_id: string }, [string]>(
          'SELECT execution_id FROM factura_e_authority_executions WHERE approval_ref_hash = ?'
        )
        .get(approvalRefHash);
      if (reused && reused.execution_id !== input.executionId)
        throw new Error('TAX_AUTHORITY_APPROVAL_REF_REPLAY');
      this.#db.query(`
        UPDATE factura_e_authority_executions
        SET state = 'approved', approval_actor_hash = ?, approval_ref_hash = ?,
            approval_idempotency_key = ?, approval_command_hash = ?, updated_at = ?
        WHERE execution_id = ? AND state = 'intent_persisted'
      `).run(
        actorHash,
        approvalRefHash,
        input.idempotencyKey,
        commandHash,
        input.occurredAt,
        input.executionId
      );
      this.audit(input.executionId, input.workspaceId, actorHash, 'register_human_approval', 'approved', commandHash, input.occurredAt);
      return { record: this.required(input.executionId), replayed: false };
    })();
  }

  beginExecution(input: Readonly<{
    executionId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Readonly<{ record: FacturaEAuthorityExecutionRecord; replayed: boolean }> {
    const actorHash = hashCanonical(input.actorId);
    const commandHash = hashCanonical({
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
    });
    return this.#db.transaction(() => {
      const current = this.required(input.executionId);
      if (current.workspaceId !== input.workspaceId)
        throw new Error('TAX_AUTHORITY_EXECUTION_SCOPE_UNAUTHORIZED');
      if (current.executeIdempotencyKey) {
        const row = this.raw(input.executionId);
        if (
          current.executeIdempotencyKey !== input.idempotencyKey ||
          row.execute_command_hash !== commandHash
        )
          throw new Error('TAX_AUTHORITY_EXECUTION_IDEMPOTENCY_CONFLICT');
        return { record: current, replayed: true };
      }
      if (current.state !== 'approved' || !current.approvalRefHash)
        throw new Error('TAX_AUTHORITY_ONE_USE_APPROVAL_REQUIRED');
      this.#db.query(`
        UPDATE factura_e_authority_executions
        SET state = 'preparing', execute_idempotency_key = ?, execute_command_hash = ?,
            approval_consumed_at = ?, updated_at = ?
        WHERE execution_id = ? AND state = 'approved' AND approval_ref_hash IS NOT NULL
      `).run(
        input.idempotencyKey,
        commandHash,
        input.occurredAt,
        input.occurredAt,
        input.executionId
      );
      this.audit(input.executionId, input.workspaceId, actorHash, 'consume_one_use_approval', 'preparing', commandHash, input.occurredAt);
      return { record: this.required(input.executionId), replayed: false };
    })();
  }

  prepared(
    executionId: string,
    preparation: FacturaEAuthorityEffectPreparation,
    occurredAt: string
  ): FacturaEAuthorityExecutionRecord {
    if (!/^vault:\/\/[A-Za-z0-9._:/-]+$/.test(preparation.authorityPayloadRef))
      throw new Error('TAX_AUTHORITY_PAYLOAD_REFERENCE_INVALID');
    if (!/^[a-f0-9]{64}$/.test(preparation.authorityPayloadHash))
      throw new Error('TAX_AUTHORITY_PAYLOAD_HASH_INVALID');
    if (!/^[1-9]\d{0,14}$/.test(preparation.requestId))
      throw new Error('TAX_AUTHORITY_REQUEST_ID_INVALID');
    return this.#db.transaction(() => {
      const current = this.required(executionId);
      if (current.state === 'prepared') {
        if (
          current.requestId !== preparation.requestId ||
          current.authorityPayloadRef !== preparation.authorityPayloadRef ||
          current.authorityPayloadHash !== preparation.authorityPayloadHash
        )
          throw new Error('TAX_AUTHORITY_PREPARATION_CONFLICT');
        return current;
      }
      if (current.state !== 'preparing')
        throw new Error('TAX_AUTHORITY_PREPARATION_STATE_CONFLICT');
      this.#db.query(`
        UPDATE factura_e_authority_executions
        SET state = 'prepared', request_id = ?, authority_payload_ref = ?,
            authority_payload_hash = ?, updated_at = ?
        WHERE execution_id = ? AND state = 'preparing'
      `).run(
        preparation.requestId,
        preparation.authorityPayloadRef,
        preparation.authorityPayloadHash,
        occurredAt,
        executionId
      );
      const next = this.required(executionId);
      this.audit(executionId, next.workspaceId, next.createdByActorHash, 'persist_private_authority_payload', 'prepared', preparation.authorityPayloadHash, occurredAt);
      return next;
    })();
  }

  markDispatching(executionId: string, occurredAt: string): FacturaEAuthorityExecutionRecord {
    return this.#db.transaction(() => {
      const current = this.required(executionId);
      if (current.state !== 'prepared')
        throw new Error('TAX_AUTHORITY_DISPATCH_STATE_CONFLICT');
      this.#db.query(`
        UPDATE factura_e_authority_executions
        SET state = 'dispatching', updated_at = ?
        WHERE execution_id = ? AND state = 'prepared'
      `).run(occurredAt, executionId);
      const next = this.required(executionId);
      this.audit(executionId, next.workspaceId, next.createdByActorHash, 'dispatch_authority_effect', 'dispatching', hashCanonical({ executionId, requestId: next.requestId }), occurredAt);
      return next;
    })();
  }

  beginRecovery(input: Readonly<{
    executionId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Readonly<{
    record: FacturaEAuthorityExecutionRecord;
    replayed: boolean;
    fenceToken: string | null;
  }> {
    const actorHash = hashCanonical(input.actorId);
    const commandHash = hashCanonical({
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
    });
    return this.#db.transaction(() => {
      const current = this.required(input.executionId);
      if (current.workspaceId !== input.workspaceId)
        throw new Error('TAX_AUTHORITY_EXECUTION_SCOPE_UNAUTHORIZED');
      const existingAttempt = this.#db
        .query<RecoveryAttemptRow, [string, string]>(
          'SELECT * FROM factura_e_authority_recovery_attempts WHERE execution_id = ? AND idempotency_key = ?'
        )
        .get(input.executionId, input.idempotencyKey);
      if (existingAttempt) {
        if (existingAttempt.command_hash !== commandHash)
          throw new Error('TAX_AUTHORITY_RECOVERY_IDEMPOTENCY_CONFLICT');
        if (current.state !== 'recovering')
          return { record: current, replayed: true, fenceToken: null };
        const leaseExpiresAt = Date.parse(existingAttempt.lease_expires_at ?? '');
        const now = Date.parse(input.occurredAt);
        if (!Number.isFinite(now)) throw new Error('TAX_AUTHORITY_OCCURRED_AT_INVALID');
        if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now)
          return { record: current, replayed: true, fenceToken: null };
        const fenceToken = crypto.randomUUID();
        const nextLease = new Date(now + RECOVERY_LEASE_MS).toISOString();
        const reclaimed = this.#db.query(`
          UPDATE factura_e_authority_recovery_attempts
          SET fence_token = ?, lease_expires_at = ?, revision = COALESCE(revision, 0) + 1,
              updated_at = ?
          WHERE execution_id = ? AND idempotency_key = ? AND state = 'recovering'
            AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        `).run(
          fenceToken,
          nextLease,
          input.occurredAt,
          input.executionId,
          input.idempotencyKey,
          input.occurredAt
        );
        if (reclaimed.changes !== 1)
          return { record: current, replayed: true, fenceToken: null };
        this.audit(
          input.executionId,
          input.workspaceId,
          actorHash,
          'reclaim_stale_authority_recovery_lease',
          'recovering',
          commandHash,
          input.occurredAt
        );
        return {
          record: this.required(input.executionId),
          replayed: false,
          fenceToken,
        };
      }
      if (current.state !== 'ambiguous' && current.state !== 'dispatching')
        throw new Error('TAX_AUTHORITY_RECOVERY_STATE_CONFLICT');
      const occurredAt = Date.parse(input.occurredAt);
      if (!Number.isFinite(occurredAt))
        throw new Error('TAX_AUTHORITY_OCCURRED_AT_INVALID');
      const fenceToken = crypto.randomUUID();
      const leaseExpiresAt = new Date(occurredAt + RECOVERY_LEASE_MS).toISOString();
      this.#db.query(`
        INSERT INTO factura_e_authority_recovery_attempts (
          execution_id, idempotency_key, command_hash, state, fence_token,
          lease_expires_at, revision, created_at, updated_at
        ) VALUES (?, ?, ?, 'recovering', ?, ?, 1, ?, ?)
      `).run(
        input.executionId,
        input.idempotencyKey,
        commandHash,
        fenceToken,
        leaseExpiresAt,
        input.occurredAt,
        input.occurredAt
      );
      this.#db.query(`
        UPDATE factura_e_authority_executions
        SET state = 'recovering', recover_idempotency_key = ?, recover_command_hash = ?, updated_at = ?
        WHERE execution_id = ? AND state IN ('ambiguous', 'dispatching')
      `).run(input.idempotencyKey, commandHash, input.occurredAt, input.executionId);
      this.audit(input.executionId, input.workspaceId, actorHash, 'recover_exact_authority_effect', 'recovering', commandHash, input.occurredAt);
      return {
        record: this.required(input.executionId),
        replayed: false,
        fenceToken,
      };
    })();
  }

  complete(
    executionId: string,
    outcome: FacturaEAuthorityEffectOutcome,
    occurredAt: string,
    recoveryFenceToken?: string
  ): FacturaEAuthorityExecutionRecord {
    if (!/^[a-f0-9]{64}$/.test(outcome.receiptHash))
      throw new Error('TAX_AUTHORITY_RECEIPT_HASH_INVALID');
    return this.#db.transaction(() => {
      const current = this.required(executionId);
      if (current.state !== 'dispatching' && current.state !== 'recovering') {
        if (
          (current.state === 'authority_accepted_unverified' ||
            current.state === 'rejected' ||
            current.state === 'ambiguous') &&
          current.receiptHash === outcome.receiptHash &&
          current.state === outcome.status
        )
          return current;
        throw new Error('TAX_AUTHORITY_COMPLETION_STATE_CONFLICT');
      }
      let recoveryAttempt: RecoveryAttemptRow | null = null;
      if (current.state === 'recovering') {
        if (!current.recoverIdempotencyKey || !recoveryFenceToken)
          throw new Error('TAX_AUTHORITY_RECOVERY_FENCE_LOST');
        recoveryAttempt = this.#db
          .query<RecoveryAttemptRow, [string, string]>(
            'SELECT * FROM factura_e_authority_recovery_attempts WHERE execution_id = ? AND idempotency_key = ?'
          )
          .get(executionId, current.recoverIdempotencyKey);
        if (
          !recoveryAttempt
          || recoveryAttempt.state !== 'recovering'
          || recoveryAttempt.fence_token !== recoveryFenceToken
        ) throw new Error('TAX_AUTHORITY_RECOVERY_FENCE_LOST');
      }
      this.#db.query(`
        UPDATE factura_e_authority_executions
        SET state = ?, receipt_hash = ?, updated_at = ?
        WHERE execution_id = ? AND state IN ('dispatching', 'recovering')
      `).run(outcome.status, outcome.receiptHash, occurredAt, executionId);
      if (current.state === 'recovering' && current.recoverIdempotencyKey) {
        const completed = this.#db.query(`
          UPDATE factura_e_authority_recovery_attempts
          SET state = ?, receipt_hash = ?, updated_at = ?
          WHERE execution_id = ? AND idempotency_key = ? AND state = 'recovering'
            AND fence_token = ?
        `).run(
          outcome.status,
          outcome.receiptHash,
          occurredAt,
          executionId,
          current.recoverIdempotencyKey,
          recoveryFenceToken!
        );
        if (completed.changes !== 1)
          throw new Error('TAX_AUTHORITY_RECOVERY_FENCE_LOST');
      }
      const next = this.required(executionId);
      this.audit(executionId, next.workspaceId, next.createdByActorHash, 'record_safe_authority_outcome', outcome.status, outcome.receiptHash, occurredAt);
      return next;
    })();
  }

  markAmbiguous(
    executionId: string,
    receiptHash: string,
    occurredAt: string,
    recoveryFenceToken?: string
  ) {
    return this.complete(
      executionId,
      { status: 'ambiguous', receiptHash },
      occurredAt,
      recoveryFenceToken
    );
  }

  beginReconciliation(input: Readonly<{
    executionId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Readonly<{
    record: FacturaEAuthorityExecutionRecord;
    replayed: boolean;
    fenceToken: string | null;
  }> {
    const actorHash = hashCanonical(input.actorId);
    const commandHash = hashCanonical({
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      operation: 'independent_official_authority_read',
    });
    return this.#db.transaction(() => {
      const current = this.required(input.executionId);
      if (current.workspaceId !== input.workspaceId)
        throw new Error('TAX_AUTHORITY_EXECUTION_SCOPE_UNAUTHORIZED');
      const existingAttempt = this.#db
        .query<ReconciliationAttemptRow, [string, string]>(
          'SELECT * FROM factura_e_authority_reconciliation_attempts WHERE execution_id = ? AND idempotency_key = ?'
        )
        .get(input.executionId, input.idempotencyKey);
      if (existingAttempt) {
        if (existingAttempt.command_hash !== commandHash)
          throw new Error('TAX_AUTHORITY_RECONCILIATION_IDEMPOTENCY_CONFLICT');
        if (current.state !== 'reconciling')
          return { record: current, replayed: true, fenceToken: null };
        const leaseExpiresAt = Date.parse(existingAttempt.lease_expires_at ?? '');
        const now = Date.parse(input.occurredAt);
        if (!Number.isFinite(now)) throw new Error('TAX_AUTHORITY_OCCURRED_AT_INVALID');
        if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now)
          return { record: current, replayed: true, fenceToken: null };
        const fenceToken = crypto.randomUUID();
        const nextLease = new Date(now + RECONCILIATION_LEASE_MS).toISOString();
        this.#db.query(`
          UPDATE factura_e_authority_reconciliation_attempts
          SET fence_token = ?, lease_expires_at = ?, revision = COALESCE(revision, 0) + 1,
              updated_at = ?
          WHERE execution_id = ? AND idempotency_key = ? AND state = 'reconciling'
        `).run(
          fenceToken,
          nextLease,
          input.occurredAt,
          input.executionId,
          input.idempotencyKey
        );
        this.audit(
          input.executionId,
          input.workspaceId,
          actorHash,
          'reclaim_stale_official_read_lease',
          'reconciling',
          commandHash,
          input.occurredAt
        );
        return { record: this.required(input.executionId), replayed: false, fenceToken };
      }
      if (
        current.state !== 'authority_accepted_unverified' &&
        current.state !== 'reconciliation_ambiguous'
      )
        throw new Error('TAX_AUTHORITY_RECONCILIATION_STATE_CONFLICT');
      const occurredAt = Date.parse(input.occurredAt);
      if (!Number.isFinite(occurredAt)) throw new Error('TAX_AUTHORITY_OCCURRED_AT_INVALID');
      const fenceToken = crypto.randomUUID();
      const leaseExpiresAt = new Date(
        occurredAt + RECONCILIATION_LEASE_MS
      ).toISOString();
      this.#db.query(`
        INSERT INTO factura_e_authority_reconciliation_attempts (
          execution_id, idempotency_key, command_hash, state, fence_token,
          lease_expires_at, revision, created_at, updated_at
        ) VALUES (?, ?, ?, 'reconciling', ?, ?, 1, ?, ?)
      `).run(
        input.executionId,
        input.idempotencyKey,
        commandHash,
        fenceToken,
        leaseExpiresAt,
        input.occurredAt,
        input.occurredAt
      );
      this.#db.query(`
        UPDATE factura_e_authority_executions
        SET state = 'reconciling', reconcile_idempotency_key = ?,
            reconcile_command_hash = ?, updated_at = ?
        WHERE execution_id = ?
          AND state IN ('authority_accepted_unverified', 'reconciliation_ambiguous')
      `).run(input.idempotencyKey, commandHash, input.occurredAt, input.executionId);
      this.audit(
        input.executionId,
        input.workspaceId,
        actorHash,
        'independent_official_authority_read',
        'reconciling',
        commandHash,
        input.occurredAt
      );
      return { record: this.required(input.executionId), replayed: false, fenceToken };
    })();
  }

  completeReconciliation(
    executionId: string,
    outcome: FacturaEAuthorityReconciliationOutcome,
    occurredAt: string,
    fenceToken: string
  ): FacturaEAuthorityExecutionRecord {
    if (!/^[a-f0-9]{64}$/.test(outcome.receiptHash))
      throw new Error('TAX_AUTHORITY_RECEIPT_HASH_INVALID');
    if (
      outcome.status === 'officially_reconciled' &&
      !/^[a-f0-9]{64}$/.test(outcome.authorityIdentityHash ?? '')
    )
      throw new Error('TAX_AUTHORITY_IDENTITY_HASH_REQUIRED');
    if (outcome.status !== 'officially_reconciled' && outcome.authorityIdentityHash)
      throw new Error('TAX_AUTHORITY_IDENTITY_HASH_FORBIDDEN');
    return this.#db.transaction(() => {
      const current = this.required(executionId);
      if (current.state !== 'reconciling')
        throw new Error('TAX_AUTHORITY_RECONCILIATION_STATE_CONFLICT');
      if (!current.reconcileIdempotencyKey)
        throw new Error('TAX_AUTHORITY_RECONCILIATION_FENCE_LOST');
      const attempt = this.#db
        .query<ReconciliationAttemptRow, [string, string]>(
          'SELECT * FROM factura_e_authority_reconciliation_attempts WHERE execution_id = ? AND idempotency_key = ?'
        )
        .get(executionId, current.reconcileIdempotencyKey);
      if (
        !attempt ||
        attempt.state !== 'reconciling' ||
        attempt.fence_token !== fenceToken
      )
        throw new Error('TAX_AUTHORITY_RECONCILIATION_FENCE_LOST');
      let nextState =
        outcome.status === 'ambiguous' ? 'reconciliation_ambiguous' : outcome.status;
      let identityHash = outcome.authorityIdentityHash ?? null;
      if (identityHash) {
        const duplicate = this.#db
          .query<{ execution_id: string }, [string, string]>(
            'SELECT execution_id FROM factura_e_authority_executions WHERE authority_identity_hash = ? AND execution_id <> ?'
          )
          .get(identityHash, executionId);
        if (duplicate) {
          nextState = 'rejected';
          identityHash = null;
        }
      }
      this.#db.query(`
        UPDATE factura_e_authority_executions
        SET state = ?, receipt_hash = ?, authority_identity_hash = ?, updated_at = ?
        WHERE execution_id = ? AND state = 'reconciling'
      `).run(nextState, outcome.receiptHash, identityHash, occurredAt, executionId);
      if (current.reconcileIdempotencyKey) {
        this.#db.query(`
          UPDATE factura_e_authority_reconciliation_attempts
          SET state = ?, receipt_hash = ?, updated_at = ?
          WHERE execution_id = ? AND idempotency_key = ? AND state = 'reconciling'
            AND fence_token = ?
        `).run(
          nextState,
          outcome.receiptHash,
          occurredAt,
          executionId,
          current.reconcileIdempotencyKey,
          fenceToken
        );
      }
      const next = this.required(executionId);
      this.audit(
        executionId,
        next.workspaceId,
        next.createdByActorHash,
        'record_official_authority_reconciliation',
        nextState,
        outcome.receiptHash,
        occurredAt
      );
      return next;
    })();
  }

  private required(executionId: string): FacturaEAuthorityExecutionRecord {
    const record = this.get(executionId);
    if (!record) throw new Error('TAX_AUTHORITY_EXECUTION_NOT_FOUND');
    return record;
  }

  private raw(executionId: string): AuthorityExecutionRow {
    const row = this.#db
      .query<AuthorityExecutionRow, [string]>(
        'SELECT * FROM factura_e_authority_executions WHERE execution_id = ?'
      )
      .get(executionId);
    if (!row) throw new Error('TAX_AUTHORITY_EXECUTION_NOT_FOUND');
    return row;
  }

  private audit(
    executionId: string,
    workspaceId: string,
    actorHash: string,
    action: string,
    state: string,
    safeMetadataHash: string,
    occurredAt: string
  ): void {
    this.#db.query(`
      INSERT INTO factura_e_authority_audit (
        event_id, execution_id, workspace_id, actor_hash, action, state,
        safe_metadata_hash, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      executionId,
      workspaceId,
      actorHash,
      action,
      state,
      safeMetadataHash,
      occurredAt
    );
  }
}

export class FacturaEAuthorityExecutionService {
  constructor(
    private readonly store: FacturaEAuthorityExecutionStore,
    private readonly readRun: (runId: string) => FacturaERunAuthorityState,
    private readonly effect: FacturaEAuthorityRemoteEffect | null,
    private readonly effectsEnabled: boolean,
    private readonly authorityContext: Readonly<{
      environment: 'homologation' | 'production';
      providerId: string;
    }> = { environment: 'homologation', providerId: 'unconfigured' }
  ) {
    if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(authorityContext.providerId)) {
      throw new Error('TAX_AUTHORITY_PROVIDER_ID_INVALID');
    }
  }

  readiness() {
    return {
      version: 'factura-e-authority-readiness-v1' as const,
      authorityOwner: 'tax-engine' as const,
      authorityEnvironment: this.authorityContext.environment,
      authorityProviderId: this.authorityContext.providerId,
      intentPersistence: 'available' as const,
      humanApproval: 'required' as const,
      remoteEffects: this.effectsEnabled && this.effect ? ('armed' as const) : ('dark' as const),
      pointOfSaleCreation: 'user_portal_handoff' as const,
      officialAuthorityReconciliation:
        this.effectsEnabled && this.effect ? ('available_required' as const) : ('required_dark' as const),
      downstreamEligibility: 'blocked_until_officially_verified' as const,
    };
  }

  current(workspaceId: string): SafeFacturaEAuthorityExecutionReceipt | null {
    const record = this.store.latestForWorkspace(workspaceId);
    return record ? safeReceipt(record, false) : null;
  }

  createIntent(input: Readonly<{
    workspaceId: string;
    runId: string;
    intentHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): SafeFacturaEAuthorityExecutionReceipt {
    const run = this.readRun(input.runId);
    if (run.workspaceId !== input.workspaceId || run.intentHash !== input.intentHash)
      throw new Error('TAX_AUTHORITY_RUN_SCOPE_CONFLICT');
    if (run.issuanceState !== 'ready_for_wsfex')
      throw new Error('TAX_AUTHORITY_FROZEN_APPROVED_INTENT_REQUIRED');
    const created = this.store.create({
      ...input,
      authorityEnvironment: this.authorityContext.environment,
      authorityProviderId: this.authorityContext.providerId,
    });
    return safeReceipt(created.record, created.replayed);
  }

  registerApproval(input: Readonly<{
    executionId: string;
    workspaceId: string;
    intentHash: string;
    approvalRef: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): SafeFacturaEAuthorityExecutionReceipt {
    this.assertCurrentAuthorityContext(input.executionId);
    const approved = this.store.approve(input);
    return safeReceipt(approved.record, approved.replayed);
  }

  async execute(input: Readonly<{
    executionId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<SafeFacturaEAuthorityExecutionReceipt> {
    if (!this.effectsEnabled || !this.effect)
      throw new Error('TAX_ARCA_REMOTE_EFFECTS_CONFIGURATION_REQUIRED');
    this.assertCurrentAuthorityContext(input.executionId);
    const begun = this.store.beginExecution(input);
    let record = begun.record;
    if (
      record.state === 'authority_accepted_unverified' ||
      record.state === 'rejected' ||
      record.state === 'ambiguous'
    )
      return safeReceipt(record, true);
    if (record.state === 'dispatching' || record.state === 'recovering')
      return safeReceipt(record, true);
    if (record.state === 'preparing') {
      const prepared = await this.effect.prepare({
        executionId: record.executionId,
        workspaceId: record.workspaceId,
        runId: record.runId,
        intentHash: record.intentHash,
        idempotencyKey: `${record.executionId}:prepare`,
      });
      record = this.store.prepared(record.executionId, prepared, input.occurredAt);
    }
    if (record.state !== 'prepared')
      throw new Error('TAX_AUTHORITY_EXECUTION_STATE_CONFLICT');
    record = this.store.markDispatching(record.executionId, input.occurredAt);
    try {
      const outcome = await this.effect.execute(privatePreparation(record));
      return safeReceipt(this.store.complete(record.executionId, outcome, input.occurredAt), begun.replayed);
    } catch (error) {
      const receiptHash = hashCanonical({
        executionId: record.executionId,
        state: 'ambiguous',
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return safeReceipt(this.store.markAmbiguous(record.executionId, receiptHash, input.occurredAt), begun.replayed);
    }
  }

  async recover(input: Readonly<{
    executionId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<SafeFacturaEAuthorityExecutionReceipt> {
    if (!this.effectsEnabled || !this.effect)
      throw new Error('TAX_ARCA_REMOTE_EFFECTS_CONFIGURATION_REQUIRED');
    this.assertCurrentAuthorityContext(input.executionId);
    const begun = this.store.beginRecovery(input);
    const record = begun.record;
    if (begun.replayed) return safeReceipt(record, true);
    if (record.state === 'authority_accepted_unverified' || record.state === 'rejected')
      return safeReceipt(record, true);
    if (record.state !== 'recovering' || !begun.fenceToken)
      throw new Error('TAX_AUTHORITY_RECOVERY_STATE_CONFLICT');
    try {
      const outcome = await this.effect.recover(privatePreparation(record));
      return safeReceipt(
        this.store.complete(
          record.executionId,
          outcome,
          input.occurredAt,
          begun.fenceToken
        ),
        begun.replayed
      );
    } catch (error) {
      const receiptHash = hashCanonical({
        executionId: record.executionId,
        state: 'ambiguous',
        recovery: true,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return safeReceipt(
        this.store.markAmbiguous(
          record.executionId,
          receiptHash,
          input.occurredAt,
          begun.fenceToken
        ),
        begun.replayed
      );
    }
  }

  async reconcile(input: Readonly<{
    executionId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<SafeFacturaEAuthorityExecutionReceipt> {
    if (!this.effectsEnabled || !this.effect)
      throw new Error('TAX_ARCA_REMOTE_EFFECTS_CONFIGURATION_REQUIRED');
    this.assertCurrentAuthorityContext(input.executionId);
    const begun = this.store.beginReconciliation(input);
    const record = begun.record;
    if (begun.replayed) return safeReceipt(record, true);
    if (record.state !== 'reconciling' || !begun.fenceToken)
      throw new Error('TAX_AUTHORITY_RECONCILIATION_STATE_CONFLICT');
    let outcome: FacturaEAuthorityReconciliationOutcome;
    try {
      outcome = await this.effect.reconcile(privatePreparation(record));
    } catch (error) {
      const receiptHash = hashCanonical({
        executionId: record.executionId,
        state: 'reconciliation_ambiguous',
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      outcome = { status: 'ambiguous', receiptHash };
    }
    return safeReceipt(
      this.store.completeReconciliation(
        record.executionId,
        outcome,
        input.occurredAt,
        begun.fenceToken
      ),
      false
    );
  }

  private assertCurrentAuthorityContext(executionId: string): void {
    const record = this.store.get(executionId);
    if (!record) throw new Error('TAX_AUTHORITY_EXECUTION_NOT_FOUND');
    if (
      record.authorityEnvironment !== this.authorityContext.environment
      || record.authorityProviderId !== this.authorityContext.providerId
    ) throw new Error('TAX_AUTHORITY_EXECUTION_CONTEXT_MISMATCH');
  }
}

function privatePreparation(
  record: FacturaEAuthorityExecutionRecord
): FacturaEAuthorityEffectPreparation {
  if (!record.requestId || !record.authorityPayloadRef || !record.authorityPayloadHash)
    throw new Error('TAX_AUTHORITY_PRIVATE_PREPARATION_REQUIRED');
  return {
    executionId: record.executionId,
    workspaceId: record.workspaceId,
    runId: record.runId,
    intentHash: record.intentHash,
    requestId: record.requestId,
    authorityPayloadRef: record.authorityPayloadRef,
    authorityPayloadHash: record.authorityPayloadHash,
  };
}

function safeReceipt(
  record: FacturaEAuthorityExecutionRecord,
  replayed: boolean
): SafeFacturaEAuthorityExecutionReceipt {
  const state = safeState(record.state);
  return {
    version: 'factura-e-authority-execution-receipt-v1',
    executionId: record.executionId,
    workspaceId: record.workspaceId,
    state,
    replayed,
    nextAction:
      state === 'intent_persisted'
        ? 'register_human_approval'
        : state === 'approved'
          ? 'execute_with_one_use_approval'
          : state === 'recovery_required'
            ? 'recover_exactly'
            : state === 'authority_accepted_unverified'
              ? 'reconcile_authority_exactly'
              : state === 'reconciliation_required'
                ? 'reconcile_authority_exactly'
            : state === 'effect_pending'
              ? 'wait'
              : 'none',
  };
}

function safeState(
  state: FacturaEAuthorityExecutionState
): SafeFacturaEAuthorityExecutionReceipt['state'] {
  if (
    state === 'intent_persisted' ||
    state === 'approved' ||
    state === 'authority_accepted_unverified' ||
    state === 'rejected'
  )
    return state;
  if (state === 'officially_reconciled') return 'officially_reconciled';
  if (state === 'reconciliation_ambiguous') return 'reconciliation_required';
  if (state === 'ambiguous' || state === 'dispatching' || state === 'recovering')
    return 'recovery_required';
  return 'effect_pending';
}

function assertExecutionIdentity(
  record: FacturaEAuthorityExecutionRecord,
  workspaceId: string,
  intentHash: string
): void {
  if (record.workspaceId !== workspaceId || record.intentHash !== intentHash)
    throw new Error('TAX_AUTHORITY_EXECUTION_SCOPE_UNAUTHORIZED');
}

function recordFromRow(row: AuthorityExecutionRow): FacturaEAuthorityExecutionRecord {
  return {
    executionId: row.execution_id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    intentHash: row.intent_hash,
    authorityEnvironment: authorityEnvironment(row.authority_environment),
    authorityProviderId: row.authority_provider_id ?? 'unbound',
    state: executionState(row.state),
    createdByActorHash: row.created_by_actor_hash,
    approvalActorHash: row.approval_actor_hash,
    approvalRefHash: row.approval_ref_hash,
    requestId: row.request_id,
    authorityPayloadRef: row.authority_payload_ref,
    authorityPayloadHash: row.authority_payload_hash,
    authorityIdentityHash: row.authority_identity_hash,
    receiptHash: row.receipt_hash,
    createIdempotencyKey: row.create_idempotency_key,
    approvalIdempotencyKey: row.approval_idempotency_key,
    executeIdempotencyKey: row.execute_idempotency_key,
    recoverIdempotencyKey: row.recover_idempotency_key,
    reconcileIdempotencyKey: row.reconcile_idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function executionState(value: string): FacturaEAuthorityExecutionState {
  if (
    ![
      'intent_persisted',
      'approved',
      'preparing',
      'prepared',
      'dispatching',
      'ambiguous',
      'recovering',
      'authority_accepted_unverified',
      'reconciling',
      'reconciliation_ambiguous',
      'officially_reconciled',
      'rejected',
    ].includes(value)
  )
    throw new Error('TAX_AUTHORITY_STORED_STATE_INVALID');
  return value as FacturaEAuthorityExecutionState;
}

function authorityEnvironment(
  value: string | null
): FacturaEAuthorityExecutionRecord['authorityEnvironment'] {
  if (value === 'homologation' || value === 'production') return value;
  return 'unbound';
}

type AuthorityExecutionRow = {
  execution_id: string;
  workspace_id: string;
  run_id: string;
  intent_hash: string;
  authority_environment: string | null;
  authority_provider_id: string | null;
  state: string;
  created_by_actor_hash: string;
  approval_actor_hash: string | null;
  approval_ref_hash: string | null;
  request_id: string | null;
  authority_payload_ref: string | null;
  authority_payload_hash: string | null;
  authority_identity_hash: string | null;
  receipt_hash: string | null;
  create_idempotency_key: string;
  create_command_hash: string;
  approval_idempotency_key: string | null;
  approval_command_hash: string | null;
  execute_idempotency_key: string | null;
  execute_command_hash: string | null;
  recover_idempotency_key: string | null;
  recover_command_hash: string | null;
  reconcile_idempotency_key: string | null;
  reconcile_command_hash: string | null;
  approval_consumed_at: string | null;
  created_at: string;
  updated_at: string;
};

type RecoveryAttemptRow = {
  execution_id: string;
  idempotency_key: string;
  command_hash: string;
  state: string;
  receipt_hash: string | null;
  fence_token: string | null;
  lease_expires_at: string | null;
  revision: number | null;
  created_at: string;
  updated_at: string;
};

type ReconciliationAttemptRow = RecoveryAttemptRow;
