import { createHmac, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SqlDatabase } from '@tax-engine/sql-store';
import { openSqlDatabase } from '@tax-engine/sql-store/bun';

import {
  assertTaxDomainEventV1,
  deriveFacturaEFeatureDecision,
  hashCanonical,
  hashTaxDomainEventV1,
  parseFacturaEFeatureV1,
  parseTaxFacturaEFeatureHeadV1,
  signFacturaEFeatureV1,
  signTaxFacturaEFeatureHeadV1,
  type FacturaEFeatureSigningGateway,
  type FacturaEFeatureV1,
  type TaxDomainEventV1,
  type TaxFacturaEFeatureHeadV1,
} from '@tax-engine/core';

import {
  createFacturaEFeaturePublishedTaxDomainEvent,
  resolveTaxDomainEventCommitmentSecret,
} from './tax-domain-event-factory';

const SHA256 = /^[a-f0-9]{64}$/;
const HEX32 = /^0x(?!0{64}$)[a-f0-9]{64}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:/-]{1,200}$/;
const FEATURE_TTL_MS = 60_000;
const RENEWAL_WINDOW_MS = 15_000;
const MAX_OUTBOX_ATTEMPTS = 12;
// Desk and Tax persist their terminal fences on independent, NTP-synchronised
// database clocks. The signed receipt still has to follow the fence within a
// tightly bounded skew; this avoids turning sub-second clock drift into a
// permanent reconciliation failure without accepting stale authority proof.
const MAX_TERMINAL_AUTHORITY_CLOCK_SKEW_MS = 5_000;

export type PrivateFacturaEFeatureSource = Readonly<{
  executionId: string;
  runId: string;
  workspaceId: string;
  authorityState: 'unverified' | 'ambiguous' | 'officially_reconciled' | 'revoked';
  authorityIdentityHash: string | null;
  reconciliationEvidenceHash: string | null;
  settlementState: 'unobserved' | 'observed' | 'final' | 'reversed' | 'disputed';
  invoiceState: 'current' | 'expired' | 'voided';
  hasAdjustment: boolean;
  sourceRevision: string;
}>;

export type FacturaEFeatureProjectionReceipt = Readonly<{
  version: 'factura-e-feature-projection-receipt-v1';
  executionId: string;
  workspaceId: string;
  state: 'not_publishable' | 'active' | 'withdrawn';
  featureId: string | null;
  featureHash: string | null;
  revision: number | null;
  replayed: boolean;
}>;

export type CurrentRestrictedFacturaEFeatureHead = Readonly<{
  feature: FacturaEFeatureV1;
  sourceStateHash: string;
  consentRevision: number;
  restrictedAuthority: Readonly<{
    authorityId: string;
    evidenceCommitment: string;
  }>;
}>;

type ConsentState = Readonly<{
  executionId: string;
  workspaceId: string;
  version: string;
  state: 'active' | 'revoked' | 'expired';
  revision: number;
  expiresAt: string;
}>;

type ConsentCommandRow = Readonly<{
  execution_id: string;
  workspace_id: string;
  command_hash: string;
  action: 'grant' | 'revoke';
  result_revision: number | null;
}>;

type StoredHead = Readonly<{
  execution_id: string;
  workspace_id: string;
  feature_id: string;
  feature_hash: string;
  revision: number;
  lifecycle: 'active' | 'withdrawn';
  source_state_hash: string;
  consent_revision: number;
  feature_json: string;
  valid_until: string;
  restricted_head_revision: number;
}>;

export type TaxFacturaEFeatureHeadRequestV1 = Readonly<{
  featureId: string;
  featureHash: string;
  workspaceCommitment: string;
  invoiceCommitment: string;
  revision: number;
  purpose: 'factura_e_factoring';
}>;

export type ClaimedFacturaEFeatureEvent = Readonly<{
  eventId: string;
  workspaceId: string;
  executionId: string;
  feature: FacturaEFeatureV1;
  leaseToken: string;
  attempt: number;
}>;

export type FacturaEFeatureReservationState =
  | 'reserved'
  | 'consumed'
  | 'completed'
  | 'released'
  | 'expired';

export type FacturaEFeatureReservationReceiptV1 = Readonly<{
  version: 'factura-e-feature-reservation-receipt-v1';
  reservationId: string;
  operationId: string;
  featureId: string;
  featureHash: string;
  featureRevision: number;
  headHash: string;
  state: FacturaEFeatureReservationState;
  leaseExpiresAt: string | null;
  effectReceiptCommitment: string | null;
  replayed: boolean;
}>;

type IssuedRestrictedHeadRow = Readonly<{
  head_hash: string;
  execution_id: string;
  run_id: string;
  workspace_id: string;
  feature_id: string;
  feature_hash: string;
  feature_revision: number;
  head_revision: number;
  source_state_hash: string;
  consent_revision: number;
  head_json: string;
  issued_at: string;
}>;

type ReservationRow = Readonly<{
  reservation_id: string;
  operation_id: string;
  execution_id: string;
  run_id: string;
  workspace_id: string;
  feature_id: string;
  feature_hash: string;
  feature_revision: number;
  head_hash: string;
  source_state_hash: string;
  consent_revision: number;
  state: FacturaEFeatureReservationState;
  lease_expires_at: string | null;
  effect_receipt_commitment: string | null;
  report_tx_hash: string | null;
  recovery_evidence_ref: string | null;
  terminal_authority_envelope_hash: string | null;
  terminal_authority_key_id: string | null;
  terminal_authority_recorded_at: string | null;
  consumed_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}>;

type ReservationCommandRow = Readonly<{
  command_hash: string;
  operation: 'reserve' | 'consume' | 'complete' | 'release' | 'recover_no_effect';
  receipt_json: string;
}>;

export interface FacturaEFeaturePublicationDependencies {
  readSource(executionId: string): PrivateFacturaEFeatureSource;
  signer: FacturaEFeatureSigningGateway;
  commitmentSecret: string;
  domainEventCommitmentSecret?: string;
  policyVersion: string;
  databasePath?: string;
  /** An injected database (Durable Object); takes precedence over `databasePath`. */
  database?: SqlDatabase;
  requireDurable?: boolean;
  singleWriter?: boolean;
}

export class FacturaEFeaturePublicationStore {
  readonly #db: SqlDatabase;
  readonly #readSource: FacturaEFeaturePublicationDependencies['readSource'];
  readonly #signer: FacturaEFeatureSigningGateway;
  readonly #secret: string;
  readonly #domainEventCommitmentSecret: string;
  readonly #policyVersion: string;
  readonly #restrictedHeadLocks = new Map<string, Promise<void>>();

  constructor(dependencies: FacturaEFeaturePublicationDependencies) {
    const injected = dependencies.database;
    const path = dependencies.databasePath ?? ':memory:';
    const requireDurable = dependencies.requireDurable ?? process.env.NODE_ENV === 'production';
    if (requireDurable) {
      if (injected) {
        if (!injected.durable) throw new Error('TAX_FACTURA_E_FEATURE_DURABLE_STORE_REQUIRED');
      } else {
        assertDurableDatabasePath(path);
      }
      assertFacturaEFeatureSingleWriterConfiguration(
        dependencies.singleWriter
          ?? process.env.TAX_FACTURA_E_FEATURE_SINGLE_WRITER === 'true'
      );
    }
    if (Buffer.byteLength(dependencies.commitmentSecret) < 32) {
      throw new Error('TAX_FACTURA_E_FEATURE_COMMITMENT_SECRET_REQUIRED');
    }
    if (!SAFE_REFERENCE.test(dependencies.policyVersion)) {
      throw new Error('TAX_FACTURA_E_FEATURE_POLICY_VERSION_INVALID');
    }
    this.#readSource = dependencies.readSource;
    this.#signer = dependencies.signer;
    this.#secret = dependencies.commitmentSecret;
    this.#domainEventCommitmentSecret = dependencies.domainEventCommitmentSecret
      ?? resolveTaxDomainEventCommitmentSecret();
    this.#policyVersion = dependencies.policyVersion;
    if (!injected) assertFacturaEFeatureDatabaseSeparateFromTaxEngine(path);
    this.#db = injected ?? openSqlDatabase(path);
    this.#db.configure({ busyTimeoutMs: 5000, wal: true, foreignKeys: true });
    if (requireDurable && !injected) {
      try {
        assertDurableDatabaseBacking(this.#db, path);
      } catch (error) {
        this.#db.close();
        throw error;
      }
    }
    if (!injected) renameLegacyTaxDomainEventOutbox(this.#db);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS factura_e_factoring_consents (
        execution_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        consent_version TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'revoked', 'expired')),
        revision INTEGER NOT NULL CHECK (revision > 0),
        actor_hash TEXT NOT NULL CHECK (actor_hash GLOB '[0-9a-f]*' AND length(actor_hash) = 64),
        expires_at TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        revoked_at TEXT,
        last_projection_checked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS factura_e_factoring_consent_commands (
        idempotency_key TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
        result_revision INTEGER NOT NULL CHECK (result_revision > 0),
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS factura_e_feature_heads (
        execution_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        feature_hash TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL CHECK (revision > 0),
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'withdrawn')),
        source_state_hash TEXT NOT NULL,
        consent_revision INTEGER NOT NULL CHECK (consent_revision > 0),
        feature_json TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        restricted_head_revision INTEGER NOT NULL DEFAULT 0
          CHECK (restricted_head_revision >= 0),
        last_checked_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS factura_e_feature_events (
        event_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        feature_hash TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL CHECK (revision > 0),
        previous_feature_hash TEXT,
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'withdrawn')),
        source_state_hash TEXT NOT NULL,
        consent_revision INTEGER NOT NULL CHECK (consent_revision > 0),
        feature_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (execution_id, revision)
      );
      CREATE TABLE IF NOT EXISTS factura_e_feature_outbox (
        event_id TEXT PRIMARY KEY REFERENCES factura_e_feature_events(event_id) ON DELETE RESTRICT,
        execution_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        feature_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK (state IN ('pending', 'inflight', 'delivered', 'dead')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        lease_token TEXT,
        lease_expires_at TEXT,
        next_attempt_at TEXT NOT NULL,
        safe_error_code TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS factura_e_feature_outbox_claim_idx
        ON factura_e_feature_outbox (state, next_attempt_at, created_at);
      CREATE TABLE IF NOT EXISTS factura_e_feature_tax_domain_event_outbox (
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
      CREATE INDEX IF NOT EXISTS factura_e_feature_tax_domain_event_outbox_pending
        ON factura_e_feature_tax_domain_event_outbox (delivered_at, leased_until, appended_at);
      CREATE UNIQUE INDEX IF NOT EXISTS factura_e_feature_head_feature_id_idx
        ON factura_e_feature_heads (feature_id);
      CREATE TABLE IF NOT EXISTS factura_e_feature_restricted_heads (
        head_hash TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        feature_hash TEXT NOT NULL,
        feature_revision INTEGER NOT NULL CHECK (feature_revision > 0),
        head_revision INTEGER NOT NULL CHECK (head_revision > 0),
        source_state_hash TEXT NOT NULL,
        consent_revision INTEGER NOT NULL CHECK (consent_revision > 0),
        head_json TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        UNIQUE (feature_id, head_hash)
      );
      CREATE TABLE IF NOT EXISTS factura_e_feature_reservations (
        reservation_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        feature_hash TEXT NOT NULL,
        feature_revision INTEGER NOT NULL CHECK (feature_revision > 0),
        head_hash TEXT NOT NULL REFERENCES factura_e_feature_restricted_heads(head_hash),
        source_state_hash TEXT NOT NULL,
        consent_revision INTEGER NOT NULL CHECK (consent_revision > 0),
        state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'completed', 'released', 'expired')),
        lease_expires_at TEXT,
        effect_receipt_commitment TEXT,
        report_tx_hash TEXT,
        recovery_evidence_ref TEXT,
        terminal_authority_envelope_hash TEXT,
        terminal_authority_key_id TEXT,
        terminal_authority_recorded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        consumed_at TEXT,
        completed_at TEXT,
        released_at TEXT,
        expired_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS factura_e_feature_reservation_active_operation_idx
        ON factura_e_feature_reservations (operation_id)
        WHERE state IN ('reserved', 'consumed', 'completed');
      CREATE UNIQUE INDEX IF NOT EXISTS factura_e_feature_reservation_one_use_feature_idx
        ON factura_e_feature_reservations (feature_id)
        WHERE state IN ('reserved', 'consumed', 'completed');
      CREATE INDEX IF NOT EXISTS factura_e_feature_reservation_run_fence_idx
        ON factura_e_feature_reservations (run_id, workspace_id, state, lease_expires_at);
      CREATE TABLE IF NOT EXISTS factura_e_feature_reservation_commands (
        idempotency_key TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('reserve', 'consume', 'complete', 'release', 'recover_no_effect')),
        command_hash TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
    `);
    this.#ensureColumn(
      'factura_e_factoring_consents',
      'last_projection_checked_at',
      'TEXT'
    );
    this.#ensureColumn(
      'factura_e_factoring_consent_commands',
      'result_revision',
      'INTEGER'
    );
    this.#ensureColumn(
      'factura_e_feature_heads',
      'last_checked_at',
      "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'"
    );
    this.#ensureColumn(
      'factura_e_feature_heads',
      'restricted_head_revision',
      'INTEGER NOT NULL DEFAULT 0'
    );
    this.#ensureColumn(
      'factura_e_feature_reservations',
      'report_tx_hash',
      'TEXT'
    );
    this.#ensureColumn(
      'factura_e_feature_reservations',
      'recovery_evidence_ref',
      'TEXT'
    );
    this.#ensureColumn(
      'factura_e_feature_reservations',
      'terminal_authority_envelope_hash',
      'TEXT'
    );
    this.#ensureColumn(
      'factura_e_feature_reservations',
      'terminal_authority_key_id',
      'TEXT'
    );
    this.#ensureColumn(
      'factura_e_feature_reservations',
      'terminal_authority_recorded_at',
      'TEXT'
    );
  }

  close(): void {
    this.#db.close();
  }

  projectionCandidates(limit = 100): string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('FACTURA_E_FEATURE_PROJECTION_LIMIT_INVALID');
    }
    return this.#db.query<{ execution_id: string }, [number]>(`
      SELECT consent.execution_id
      FROM factura_e_factoring_consents consent
      LEFT JOIN factura_e_feature_heads head
        ON head.execution_id = consent.execution_id
      WHERE consent.state = 'active' OR head.lifecycle = 'active'
      ORDER BY COALESCE(consent.last_projection_checked_at, ''), consent.execution_id
      LIMIT ?
    `).all(limit).map(row => row.execution_id);
  }

  grantConsent(input: Readonly<{
    executionId: string;
    workspaceId: string;
    consentVersion: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
    expiresAt: string;
  }>): Readonly<{ replayed: boolean; revision: number }> {
    validateConsentInput(input);
    const source = this.#readSource(input.executionId);
    assertSourceScope(source, input.workspaceId);
    const commandHash = hashCanonical({ ...input, actorId: hashCanonical(input.actorId) });
    return this.#db.transaction(() => {
      const replay = this.#command(input.idempotencyKey);
      if (replay) {
        if (
          replay.command_hash !== commandHash
          || replay.action !== 'grant'
          || replay.execution_id !== input.executionId
          || replay.workspace_id !== input.workspaceId
        ) {
          throw new Error('FACTURA_E_FACTORING_CONSENT_IDEMPOTENCY_CONFLICT');
        }
        return { replayed: true, revision: replayRevision(replay) };
      }
      const current = this.#consent(input.executionId);
      const effectiveCurrent = this.#effectiveConsent(
        input.executionId,
        new Date(input.occurredAt)
      );
      if (effectiveCurrent?.state === 'active') {
        throw new Error('FACTURA_E_FACTORING_CONSENT_ALREADY_ACTIVE');
      }
      const revision = (current?.revision ?? 0) + 1;
      this.#db.query(`
        INSERT INTO factura_e_factoring_consents (
          execution_id, workspace_id, consent_version, state, revision,
          actor_hash, expires_at, granted_at, revoked_at,
          last_projection_checked_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT (execution_id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          consent_version = excluded.consent_version,
          state = 'active', revision = excluded.revision,
          actor_hash = excluded.actor_hash, expires_at = excluded.expires_at,
          granted_at = excluded.granted_at, revoked_at = NULL,
          last_projection_checked_at = NULL
      `).run(
        input.executionId,
        input.workspaceId,
        input.consentVersion,
        revision,
        hashCanonical(input.actorId),
        input.expiresAt,
        input.occurredAt
      );
      this.#recordCommand(input, 'grant', commandHash, revision);
      return { replayed: false, revision };
    })();
  }

  revokeConsent(input: Readonly<{
    executionId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Readonly<{ replayed: boolean; revision: number }> {
    validateReference(input.executionId, 'FACTURA_E_FACTORING_EXECUTION_ID_INVALID');
    validateReference(input.workspaceId, 'FACTURA_E_FACTORING_WORKSPACE_ID_INVALID');
    validateReference(input.idempotencyKey, 'FACTURA_E_FACTORING_IDEMPOTENCY_KEY_INVALID');
    validateTimestamp(input.occurredAt, 'FACTURA_E_FACTORING_TIMESTAMP_INVALID');
    const source = this.#readSource(input.executionId);
    assertSourceScope(source, input.workspaceId);
    const commandHash = hashCanonical({ ...input, actorId: hashCanonical(input.actorId) });
    return this.#db.transaction(() => {
      const replay = this.#command(input.idempotencyKey);
      if (replay) {
        if (
          replay.command_hash !== commandHash
          || replay.action !== 'revoke'
          || replay.execution_id !== input.executionId
          || replay.workspace_id !== input.workspaceId
        ) {
          throw new Error('FACTURA_E_FACTORING_CONSENT_IDEMPOTENCY_CONFLICT');
        }
        return { replayed: true, revision: replayRevision(replay) };
      }
      this.#expireReservations(input.occurredAt);
      const consumedFence = this.#db.query<{ reservation_id: string }, [string]>(`
        SELECT reservation_id FROM factura_e_feature_reservations
        WHERE execution_id = ? AND state = 'consumed' LIMIT 1
      `).get(input.executionId);
      if (consumedFence) {
        throw new Error('FACTURA_E_FACTORING_CONSENT_MUTATION_FENCED_RETRYABLE');
      }
      this.#db.query(`
        UPDATE factura_e_feature_reservations
        SET state = 'released', released_at = ?, updated_at = ?
        WHERE execution_id = ? AND state = 'reserved'
      `).run(input.occurredAt, input.occurredAt, input.executionId);
      const current = this.#effectiveConsent(input.executionId, new Date(input.occurredAt));
      if (!current) throw new Error('FACTURA_E_FACTORING_CONSENT_NOT_FOUND');
      if (current.workspaceId !== input.workspaceId) {
        throw new Error('FACTURA_E_FACTORING_CONSENT_SCOPE_UNAUTHORIZED');
      }
      if (current.state !== 'active') {
        throw new Error('FACTURA_E_FACTORING_CONSENT_NOT_ACTIVE');
      }
      const revision = current.revision + 1;
      const changed = this.#db.query(`
        UPDATE factura_e_factoring_consents
        SET state = 'revoked', revision = ?, actor_hash = ?, revoked_at = ?
        WHERE execution_id = ? AND state = 'active'
      `).run(revision, hashCanonical(input.actorId), input.occurredAt, input.executionId);
      if (changed.changes !== 1) {
        throw new Error('FACTURA_E_FACTORING_CONSENT_REVOCATION_RACE');
      }
      this.#recordCommand(input, 'revoke', commandHash, revision);
      return { replayed: false, revision };
    })();
  }

  async project(executionId: string, now = new Date()): Promise<FacturaEFeatureProjectionReceipt> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const source = this.#readSource(executionId);
      validateSource(source, executionId);
      const consent = this.#effectiveConsent(executionId, now);
      const prior = this.#head(executionId);
      const decision = deriveFacturaEFeatureDecision({
        authorityState: source.authorityState,
        consentState: consent?.state ?? 'missing',
        settlementState: source.settlementState,
        invoiceState: source.invoiceState,
        hasAdjustment: source.hasAdjustment,
        hadActiveFeature: prior?.lifecycle === 'active',
      });
      if (decision.publication === 'none') {
        this.#touchProjection(executionId, now.toISOString());
        return receipt(source, prior, 'not_publishable', true);
      }
      const sourceStateHash = privateSourceStateHash(source);
      if (
        prior
        && prior.source_state_hash === sourceStateHash
        && prior.consent_revision === consent?.revision
        && prior.lifecycle === decision.publication
        && parseFacturaEFeatureV1(JSON.parse(prior.feature_json)).keyVersion
          === this.#signer.keyVersion
        && (prior.lifecycle === 'withdrawn'
          || Date.parse(prior.valid_until) - now.getTime() > RENEWAL_WINDOW_MS)
      ) {
        this.#touchProjection(executionId, now.toISOString());
        return receipt(source, prior, prior.lifecycle, true);
      }
      if (!consent) throw new Error('FACTURA_E_FACTORING_CONSENT_REQUIRED');
      const previous = prior ? parseFacturaEFeatureV1(JSON.parse(prior.feature_json)) : null;
      const authorityIdentityHash = source.authorityIdentityHash;
      const invoiceCommitment = authorityIdentityHash
        ? this.#commit('invoice', `${source.workspaceId}\0${authorityIdentityHash}`)
        : previous?.invoiceCommitment;
      if (!invoiceCommitment) {
        this.#touchProjection(executionId, now.toISOString());
        return receipt(source, prior, 'not_publishable', true);
      }
      const producedAt = now.toISOString();
      const unsigned = {
        version: 'factura-e-feature-v1' as const,
        eventId: randomUUID(),
        featureId: prior?.feature_id ?? randomUUID(),
        purpose: 'factura_e_factoring' as const,
        workspaceCommitment: this.#commit('workspace', source.workspaceId),
        invoiceCommitment,
        lifecycle: decision.publication,
        predicates: decision.predicates,
        consent: {
          purpose: 'factura_e_factoring' as const,
          version: consent.version,
          state: consent.state,
        },
        schemaVersion: 'factura-e-feature-v1' as const,
        policyVersion: this.#policyVersion,
        keyVersion: this.#signer.keyVersion,
        revision: (prior?.revision ?? 0) + 1,
        previousFeatureHash: prior?.feature_hash ?? null,
        withdrawalReason: decision.withdrawalReason,
        producedAt,
        validUntil: new Date(now.getTime() + FEATURE_TTL_MS).toISOString(),
      };
      const feature = await signFacturaEFeatureV1(unsigned, this.#signer);

      const freshSource = this.#readSource(executionId);
      validateSource(freshSource, executionId);
      const freshConsent = this.#effectiveConsent(executionId, now);
      if (
        privateSourceStateHash(freshSource) !== sourceStateHash
        || freshConsent?.revision !== consent.revision
        || freshConsent?.state !== consent.state
      ) continue;
      const inserted = this.#finalize(
        feature,
        source.executionId,
        source.workspaceId,
        sourceStateHash,
        consent.revision,
        now.toISOString()
      );
      if (inserted) {
        this.#touchProjection(executionId, now.toISOString());
        return receipt(source, this.#head(executionId), feature.lifecycle, false);
      }
    }
    throw new Error('FACTURA_E_FEATURE_PROJECTION_RACE');
  }

  currentRestrictedHead(
    executionId: string,
    workspaceCommitment: string,
    invoiceCommitment: string,
    now = new Date()
  ): CurrentRestrictedFacturaEFeatureHead {
    const head = this.#head(executionId);
    if (!head) throw new Error('FACTURA_E_FEATURE_HEAD_NOT_FOUND');
    const feature = parseFacturaEFeatureV1(JSON.parse(head.feature_json));
    if (
      feature.workspaceCommitment !== workspaceCommitment
      || feature.invoiceCommitment !== invoiceCommitment
    ) throw new Error('FACTURA_E_FEATURE_HEAD_SCOPE_UNAUTHORIZED');
    const source = this.#readSource(executionId);
    validateSource(source, executionId);
    const consent = this.#effectiveConsent(executionId, now);
    const decision = deriveFacturaEFeatureDecision({
      authorityState: source.authorityState,
      consentState: consent?.state ?? 'missing',
      settlementState: source.settlementState,
      invoiceState: source.invoiceState,
      hasAdjustment: source.hasAdjustment,
      hadActiveFeature: true,
    });
    if (
      head.lifecycle !== 'active'
      || feature.lifecycle !== 'active'
      || Date.parse(feature.validUntil) <= now.getTime()
      || decision.publication !== 'active'
      || privateSourceStateHash(source) !== head.source_state_hash
      || consent?.revision !== head.consent_revision
      || !source.authorityIdentityHash
      || !source.reconciliationEvidenceHash
    ) throw new Error('FACTURA_E_FEATURE_HEAD_NOT_CURRENT');
    return {
      feature,
      sourceStateHash: head.source_state_hash,
      consentRevision: head.consent_revision,
      restrictedAuthority: {
        authorityId: source.authorityIdentityHash,
        evidenceCommitment: this.#commit(
          'reconciliation-evidence',
          `${source.workspaceId}\0${source.reconciliationEvidenceHash}`
        ),
      },
    };
  }

  currentRestrictedHeadForWorkspace(
    executionId: string,
    workspaceId: string,
    workspaceCommitment: string,
    invoiceCommitment: string,
    now = new Date()
  ): CurrentRestrictedFacturaEFeatureHead {
    const source = this.#readSource(executionId);
    validateSource(source, executionId);
    assertSourceScope(source, workspaceId);
    return this.currentRestrictedHead(
      executionId,
      workspaceCommitment,
      invoiceCommitment,
      now
    );
  }

  currentPublicHead(
    executionId: string,
    workspaceId: string,
    now = new Date()
  ): FacturaEFeatureV1 {
    const head = this.#head(executionId);
    if (!head) throw new Error('FACTURA_E_FEATURE_HEAD_NOT_FOUND');
    if (head.workspace_id !== workspaceId) {
      throw new Error('FACTURA_E_FEATURE_HEAD_SCOPE_UNAUTHORIZED');
    }
    const feature = parseFacturaEFeatureV1(JSON.parse(head.feature_json));
    const source = this.#readSource(executionId);
    validateSource(source, executionId);
    assertSourceScope(source, workspaceId);
    const consent = this.#effectiveConsent(executionId, now);
    const decision = deriveFacturaEFeatureDecision({
      authorityState: source.authorityState,
      consentState: consent?.state ?? 'missing',
      settlementState: source.settlementState,
      invoiceState: source.invoiceState,
      hasAdjustment: source.hasAdjustment,
      hadActiveFeature: true,
    });
    if (
      Date.parse(feature.validUntil) <= now.getTime()
      || feature.lifecycle !== head.lifecycle
      || decision.publication !== head.lifecycle
      || privateSourceStateHash(source) !== head.source_state_hash
      || consent?.revision !== head.consent_revision
    ) throw new Error('FACTURA_E_FEATURE_HEAD_NOT_CURRENT');
    return feature;
  }

  async signRestrictedHeadByFeature(
    request: TaxFacturaEFeatureHeadRequestV1,
    clock: () => Date = () => new Date()
  ): Promise<TaxFacturaEFeatureHeadV1> {
    validateReference(request.featureId, 'FACTURA_E_FEATURE_HEAD_FEATURE_ID_INVALID');
    if (!SHA256.test(request.featureHash)) {
      throw new Error('FACTURA_E_FEATURE_HEAD_FEATURE_HASH_INVALID');
    }
    if (!SHA256.test(request.workspaceCommitment)) {
      throw new Error('FACTURA_E_FEATURE_HEAD_WORKSPACE_COMMITMENT_INVALID');
    }
    if (!SHA256.test(request.invoiceCommitment)) {
      throw new Error('FACTURA_E_FEATURE_HEAD_INVOICE_COMMITMENT_INVALID');
    }
    if (!Number.isSafeInteger(request.revision) || request.revision < 1) {
      throw new Error('FACTURA_E_FEATURE_HEAD_REVISION_INVALID');
    }
    if (request.purpose !== 'factura_e_factoring') {
      throw new Error('FACTURA_E_FEATURE_HEAD_PURPOSE_INVALID');
    }
    return this.#withRestrictedHeadLock(request.featureId, async () => {
      const stored = this.#headByFeature(request.featureId);
      if (!stored) throw new Error('FACTURA_E_FEATURE_HEAD_NOT_FOUND');
      const observedAt = clock();
      if (!Number.isFinite(observedAt.getTime())) {
        throw new Error('FACTURA_E_FEATURE_HEAD_TIMESTAMP_INVALID');
      }
      const current = this.currentRestrictedHeadForWorkspace(
        stored.execution_id,
        stored.workspace_id,
        request.workspaceCommitment,
        request.invoiceCommitment,
        observedAt
      );
      const feature = current.feature;
      if (
        feature.featureId !== request.featureId
        || feature.featureHash !== request.featureHash
        || feature.revision !== request.revision
        || feature.purpose !== request.purpose
      ) throw new Error('FACTURA_E_FEATURE_HEAD_CONTEXT_MISMATCH');
      if (feature.keyVersion !== this.#signer.keyVersion) {
        throw new Error('FACTURA_E_FEATURE_HEAD_SIGNING_KEY_VERSION_MISMATCH');
      }
      if (Date.parse(feature.validUntil) - observedAt.getTime() <= RENEWAL_WINDOW_MS) {
        throw new Error('FACTURA_E_FEATURE_HEAD_REPROJECTION_REQUIRED');
      }

      const materialized = this.#materializedRestrictedHead(
        stored,
        current,
        request,
        observedAt
      );
      if (materialized) return materialized;

      const headRevision = this.#reserveRestrictedHeadRevision(stored, feature);
      const unsigned = {
      version: 'factura-e-feature-head-v1' as const,
      schemaVersion: 'factura-e-feature-head-v1' as const,
      featureId: feature.featureId,
      featureHash: feature.featureHash,
      workspaceCommitment: feature.workspaceCommitment,
      invoiceCommitment: feature.invoiceCommitment,
      featureLifecycle: 'active' as const,
      eligibleCurrentUnpaid: true as const,
      officialIssuanceReconciled: true as const,
      undisputed: true as const,
      consentVersion: feature.consent.version,
      consentState: 'active' as const,
      featureRevision: feature.revision,
      previousFeatureHash: feature.previousFeatureHash,
      featureValidUntil: feature.validUntil,
      settlementObservationState: 'unobserved' as const,
      evidenceHeadRef: `hmac-sha256:v1:${this.#commit(
        'evidence-head',
        `${stored.workspace_id}\0${current.sourceStateHash}\0${current.consentRevision}`
      )}`,
      headRevision,
      observedAt: observedAt.toISOString(),
      keyVersion: feature.keyVersion,
      restrictedAuthority: {
        scheme: 'BUFI_ARCA_FACTURA_E_AUTHORITY_INVOICE_ID_V1' as const,
        authorityId: current.restrictedAuthority.authorityId,
        evidenceCommitment: current.restrictedAuthority.evidenceCommitment,
      },
      };
      const signed = await signTaxFacturaEFeatureHeadV1(unsigned, this.#signer);
      const checkedAt = clock();
      if (checkedAt.getTime() < observedAt.getTime()) {
        throw new Error('FACTURA_E_FEATURE_HEAD_CLOCK_REGRESSION');
      }
      const fresh = this.currentRestrictedHeadForWorkspace(
        stored.execution_id,
        stored.workspace_id,
        request.workspaceCommitment,
        request.invoiceCommitment,
        checkedAt
      );
      if (
        fresh.feature.featureHash !== feature.featureHash
        || fresh.feature.revision !== feature.revision
        || fresh.sourceStateHash !== current.sourceStateHash
        || fresh.consentRevision !== current.consentRevision
        || Date.parse(signed.featureValidUntil) <= checkedAt.getTime()
      ) throw new Error('FACTURA_E_FEATURE_HEAD_CHANGED_DURING_SIGNING');
      this.#recordIssuedRestrictedHead(
        signed,
        stored,
        fresh,
        checkedAt.toISOString()
      );
      return signed;
    });
  }

  reserveForFactoring(input: Readonly<{
    featureId: string;
    featureHash: string;
    featureRevision: number;
    headHash: string;
    operationId: string;
    idempotencyKey: string;
    leaseSeconds: number;
  }>, now = new Date()): FacturaEFeatureReservationReceiptV1 {
    validateReservationCommon(input);
    const nowIso = trustedReservationNow(now);
    if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 5 || input.leaseSeconds > 60) {
      throw new Error('FACTURA_E_FEATURE_RESERVATION_LEASE_INVALID');
    }
    const commandHash = reservationCommandHash('reserve', input);
    return this.#db.transaction(() => {
      const replay = this.#reservationCommand(input.idempotencyKey);
      if (replay) return reservationReplay(replay, 'reserve', commandHash);
      this.#expireReservations(nowIso);
      const issued = this.#issuedRestrictedHead(input.headHash);
      if (!issued) throw new Error('FACTURA_E_FEATURE_RESERVATION_HEAD_NOT_FOUND');
      if (
        issued.feature_id !== input.featureId
        || issued.feature_hash !== input.featureHash
        || issued.feature_revision !== input.featureRevision
      ) throw new Error('FACTURA_E_FEATURE_RESERVATION_HEAD_CONTEXT_CONFLICT');
      this.#assertIssuedHeadCurrent(issued, now);
      const existing = this.#db.query<ReservationRow, [string]>(`
        SELECT * FROM factura_e_feature_reservations
        WHERE operation_id = ? AND state IN ('reserved', 'consumed', 'completed')
        ORDER BY created_at DESC LIMIT 1
      `).get(input.operationId);
      if (existing) throw new Error('FACTURA_E_FEATURE_RESERVATION_OPERATION_CONFLICT');
      const featureFence = this.#db.query<ReservationRow, [string]>(`
        SELECT * FROM factura_e_feature_reservations
        WHERE feature_id = ? AND state IN ('reserved', 'consumed', 'completed')
        ORDER BY created_at DESC LIMIT 1
      `).get(input.featureId);
      if (featureFence) throw new Error('FACTURA_E_FEATURE_RESERVATION_FEATURE_ONE_USE_CONFLICT');
      const reservationId = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + input.leaseSeconds * 1_000
      ).toISOString();
      this.#db.query(`
        INSERT INTO factura_e_feature_reservations (
          reservation_id, operation_id, execution_id, run_id, workspace_id,
          feature_id, feature_hash, feature_revision, head_hash,
          source_state_hash, consent_revision, state, lease_expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
      `).run(
        reservationId,
        input.operationId,
        issued.execution_id,
        issued.run_id,
        issued.workspace_id,
        input.featureId,
        input.featureHash,
        input.featureRevision,
        input.headHash,
        issued.source_state_hash,
        issued.consent_revision,
        leaseExpiresAt,
        nowIso,
        nowIso
      );
      const row = this.#requiredReservation(reservationId);
      const receipt = reservationReceipt(row, false);
      this.#recordReservationCommand(input, nowIso, 'reserve', reservationId, commandHash, receipt);
      return receipt;
    })();
  }

  consumeFactoringReservation(input: Readonly<{
    reservationId: string;
    operationId: string;
    headHash: string;
    idempotencyKey: string;
  }>, now = new Date()): FacturaEFeatureReservationReceiptV1 {
    validateReservationTransition(input);
    const nowIso = trustedReservationNow(now);
    const commandHash = reservationCommandHash('consume', input);
    return this.#db.transaction(() => {
      const replay = this.#reservationCommand(input.idempotencyKey);
      if (replay) return reservationReplay(replay, 'consume', commandHash);
      this.#expireReservations(nowIso);
      const row = this.#requiredReservation(input.reservationId);
      assertReservationTransitionBinding(row, input);
      if (row.state === 'expired') throw new Error('FACTURA_E_FEATURE_RESERVATION_EXPIRED');
      if (row.state !== 'reserved' || !row.lease_expires_at) {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_CONSUME_CONFLICT');
      }
      this.#assertIssuedHeadCurrent(
        this.#requiredIssuedRestrictedHead(row.head_hash),
        now,
        row
      );
      const changed = this.#db.query(`
        UPDATE factura_e_feature_reservations
        SET state = 'consumed', consumed_at = ?, updated_at = ?
        WHERE reservation_id = ? AND state = 'reserved' AND lease_expires_at > ?
      `).run(nowIso, nowIso, input.reservationId, nowIso);
      if (changed.changes !== 1) {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_CONSUME_CONFLICT');
      }
      const receipt = reservationReceipt(this.#requiredReservation(input.reservationId), false);
      this.#recordReservationCommand(input, nowIso, 'consume', input.reservationId, commandHash, receipt);
      return receipt;
    })();
  }

  completeFactoringReservation(input: Readonly<{
    reservationId: string;
    operationId: string;
    headHash: string;
    featureId: string;
    featureHash: string;
    featureRevision: number;
    reportTxHash: string;
    effectReceiptCommitment: string;
    authorityEnvelopeHash: string;
    authorityKeyId: string;
    authorityRecordedAt: string;
    idempotencyKey: string;
  }>, now = new Date()): FacturaEFeatureReservationReceiptV1 {
    validateReservationTransition(input);
    validateFeatureIdentity(input);
    if (!HEX32.test(input.reportTxHash) || /^0x0{64}$/.test(input.reportTxHash)) {
      throw new Error('FACTURA_E_FEATURE_RESERVATION_REPORT_TX_HASH_INVALID');
    }
    if (!HEX32.test(input.effectReceiptCommitment) || /^0x0{64}$/.test(input.effectReceiptCommitment)) {
      throw new Error('FACTURA_E_FEATURE_RESERVATION_EFFECT_RECEIPT_INVALID');
    }
    validateTerminalAuthorityEvidence(input);
    const nowIso = trustedReservationNow(now);
    const commandHash = reservationCommandHash('complete', input);
    return this.#db.transaction(() => {
      const replay = this.#reservationCommand(input.idempotencyKey);
      if (replay) return reservationReplay(replay, 'complete', commandHash);
      const row = this.#db.query<ReservationRow, [string]>(`
        SELECT * FROM factura_e_feature_reservations
        WHERE operation_id = ? AND state IN ('consumed', 'completed')
        ORDER BY created_at DESC LIMIT 1
      `).get(input.operationId);
      if (!row) throw new Error('FACTURA_E_FEATURE_RESERVATION_NOT_FOUND');
      assertReservationTransitionBinding(row, input);
      assertReservationFeatureBinding(row, input);
      if (row.reservation_id !== input.reservationId) {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_BINDING_CONFLICT');
      }
      assertTerminalAuthorityAfterFence(row, input.authorityRecordedAt);
      if (row.state !== 'consumed') {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_COMPLETE_CONFLICT');
      }
      const changed = this.#db.query(`
        UPDATE factura_e_feature_reservations
        SET state = 'completed', effect_receipt_commitment = ?, report_tx_hash = ?,
            terminal_authority_envelope_hash = ?, terminal_authority_key_id = ?,
            terminal_authority_recorded_at = ?,
            completed_at = ?, updated_at = ?
        WHERE reservation_id = ? AND state = 'consumed'
      `).run(
        input.effectReceiptCommitment,
        input.reportTxHash,
        input.authorityEnvelopeHash,
        input.authorityKeyId,
        input.authorityRecordedAt,
        nowIso,
        nowIso,
        row.reservation_id
      );
      if (changed.changes !== 1) {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_COMPLETE_CONFLICT');
      }
      const receipt = reservationReceipt(this.#requiredReservation(row.reservation_id), false);
      this.#recordReservationCommand(input, nowIso, 'complete', row.reservation_id, commandHash, receipt);
      return receipt;
    })();
  }

  releaseFactoringReservation(input: Readonly<{
    reservationId: string;
    operationId: string;
    headHash: string;
    reason: 'before_consume';
    idempotencyKey: string;
  }>, now = new Date()): FacturaEFeatureReservationReceiptV1 {
    validateReservationTransition(input);
    const nowIso = trustedReservationNow(now);
    const commandHash = reservationCommandHash('release', input);
    return this.#db.transaction(() => {
      const replay = this.#reservationCommand(input.idempotencyKey);
      if (replay) return reservationReplay(replay, 'release', commandHash);
      this.#expireReservations(nowIso);
      const row = this.#requiredReservation(input.reservationId);
      assertReservationTransitionBinding(row, input);
      if (row.state !== 'reserved') {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_RELEASE_CONFLICT');
      }
      const changed = this.#db.query(`
        UPDATE factura_e_feature_reservations
        SET state = 'released', released_at = ?, updated_at = ?
        WHERE reservation_id = ? AND state = ?
      `).run(
        nowIso,
        nowIso,
        input.reservationId,
        'reserved'
      );
      if (changed.changes !== 1) {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_RELEASE_CONFLICT');
      }
      const receipt = reservationReceipt(this.#requiredReservation(input.reservationId), false);
      this.#recordReservationCommand(input, nowIso, 'release', input.reservationId, commandHash, receipt);
      return receipt;
    })();
  }

  recoverFactoringReservationNoEffect(input: Readonly<{
    reservationId: string;
    operationId: string;
    headHash: string;
    featureId: string;
    featureHash: string;
    featureRevision: number;
    recoveryEvidenceRef: string;
    noEffectReceiptCommitment: string;
    authorityEnvelopeHash: string;
    authorityKeyId: string;
    authorityRecordedAt: string;
    idempotencyKey: string;
  }>, now = new Date()): FacturaEFeatureReservationReceiptV1 {
    validateReservationTransition(input);
    validateFeatureIdentity(input);
    if (!/^hmac-sha256:v1:(?!0{64}$)[a-f0-9]{64}$/.test(input.recoveryEvidenceRef)) {
      throw new Error('FACTURA_E_FEATURE_RECOVERY_EVIDENCE_REF_INVALID');
    }
    if (
      !HEX32.test(input.noEffectReceiptCommitment)
      || /^0x0{64}$/.test(input.noEffectReceiptCommitment)
    ) throw new Error('FACTURA_E_FEATURE_RESERVATION_NO_EFFECT_RECEIPT_INVALID');
    validateTerminalAuthorityEvidence(input);
    const nowIso = trustedReservationNow(now);
    const commandHash = reservationCommandHash('recover_no_effect', input);
    return this.#db.transaction(() => {
      const replay = this.#reservationCommand(input.idempotencyKey);
      if (replay) return reservationReplay(replay, 'recover_no_effect', commandHash);
      this.#expireReservations(nowIso);
      const row = this.#requiredReservation(input.reservationId);
      assertReservationTransitionBinding(row, input);
      assertReservationFeatureBinding(row, input);
      const safelyReleasedBeforeConsume = row.state === 'released'
        && row.consumed_at === null
        && row.effect_receipt_commitment === null
        && row.report_tx_hash === null
        && row.recovery_evidence_ref === null
        && row.terminal_authority_envelope_hash === null
        && row.terminal_authority_key_id === null
        && row.terminal_authority_recorded_at === null;
      const safelyExpiredBeforeConsume = row.state === 'expired'
        && row.consumed_at === null
        && row.released_at === null
        && row.lease_expires_at !== null
        && row.lease_expires_at <= nowIso
        && row.effect_receipt_commitment === null
        && row.report_tx_hash === null
        && row.recovery_evidence_ref === null
        && row.terminal_authority_envelope_hash === null
        && row.terminal_authority_key_id === null
        && row.terminal_authority_recorded_at === null;
      assertTerminalAuthorityAfterFence(row, input.authorityRecordedAt);
      if (
        row.state !== 'consumed'
        && !safelyReleasedBeforeConsume
        && !safelyExpiredBeforeConsume
      ) {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_RECOVERY_CONFLICT');
      }
      const changed = safelyReleasedBeforeConsume
        ? this.#db.query(`
            UPDATE factura_e_feature_reservations
            SET effect_receipt_commitment = ?, recovery_evidence_ref = ?,
                terminal_authority_envelope_hash = ?, terminal_authority_key_id = ?,
                terminal_authority_recorded_at = ?, updated_at = ?
            WHERE reservation_id = ? AND state = 'released'
              AND consumed_at IS NULL AND effect_receipt_commitment IS NULL
              AND report_tx_hash IS NULL AND recovery_evidence_ref IS NULL
              AND terminal_authority_envelope_hash IS NULL
          `).run(
            input.noEffectReceiptCommitment,
            input.recoveryEvidenceRef,
            input.authorityEnvelopeHash,
            input.authorityKeyId,
            input.authorityRecordedAt,
            nowIso,
            input.reservationId
          )
        : safelyExpiredBeforeConsume
          ? this.#db.query(`
              UPDATE factura_e_feature_reservations
              SET state = 'released', effect_receipt_commitment = ?,
                  recovery_evidence_ref = ?, terminal_authority_envelope_hash = ?,
                  terminal_authority_key_id = ?, terminal_authority_recorded_at = ?,
                  released_at = ?, updated_at = ?
              WHERE reservation_id = ? AND state = 'expired'
                AND consumed_at IS NULL AND released_at IS NULL
                AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
                AND effect_receipt_commitment IS NULL AND report_tx_hash IS NULL
                AND recovery_evidence_ref IS NULL
                AND terminal_authority_envelope_hash IS NULL
                AND terminal_authority_key_id IS NULL
                AND terminal_authority_recorded_at IS NULL
            `).run(
              input.noEffectReceiptCommitment,
              input.recoveryEvidenceRef,
              input.authorityEnvelopeHash,
              input.authorityKeyId,
              input.authorityRecordedAt,
              nowIso,
              nowIso,
              input.reservationId,
              nowIso
            )
        : this.#db.query(`
            UPDATE factura_e_feature_reservations
            SET state = 'released', effect_receipt_commitment = ?,
                recovery_evidence_ref = ?, terminal_authority_envelope_hash = ?,
                terminal_authority_key_id = ?, terminal_authority_recorded_at = ?,
                released_at = ?, updated_at = ?
            WHERE reservation_id = ? AND state = 'consumed'
          `).run(
            input.noEffectReceiptCommitment,
            input.recoveryEvidenceRef,
            input.authorityEnvelopeHash,
            input.authorityKeyId,
            input.authorityRecordedAt,
            nowIso,
            nowIso,
            input.reservationId
          );
      if (changed.changes !== 1) {
        throw new Error('FACTURA_E_FEATURE_RESERVATION_RECOVERY_CONFLICT');
      }
      const receipt = reservationReceipt(this.#requiredReservation(input.reservationId), false);
      this.#recordReservationCommand(
        input,
        nowIso,
        'recover_no_effect',
        input.reservationId,
        commandHash,
        receipt
      );
      return receipt;
    })();
  }

  assertRunMutationAllowed(input: Readonly<{
    runId: string;
    workspaceId: string;
  }>, now = new Date()): void {
    validateReference(input.runId, 'FACTURA_E_FEATURE_RESERVATION_RUN_ID_INVALID');
    validateReference(input.workspaceId, 'FACTURA_E_FEATURE_RESERVATION_WORKSPACE_ID_INVALID');
    const nowIso = trustedReservationNow(now);
    this.#db.transaction(() => {
      this.#expireReservations(nowIso);
      const fence = this.#db.query<{ reservation_id: string }, [string, string]>(`
        SELECT reservation_id FROM factura_e_feature_reservations
        WHERE run_id = ? AND workspace_id = ? AND state IN ('reserved', 'consumed')
        LIMIT 1
      `).get(input.runId, input.workspaceId);
      if (fence) throw new Error('FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE');
    })();
  }

  claimOutbox(input: Readonly<{
    limit: number;
    leaseSeconds: number;
    now: Date;
  }>): ClaimedFacturaEFeatureEvent[] {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new Error('FACTURA_E_FEATURE_OUTBOX_LIMIT_INVALID');
    }
    if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 5 || input.leaseSeconds > 300) {
      throw new Error('FACTURA_E_FEATURE_OUTBOX_LEASE_INVALID');
    }
    return this.#db.transaction(() => {
      this.#db.query(`
        UPDATE factura_e_feature_outbox
        SET state = 'dead', lease_token = NULL, lease_expires_at = NULL,
            safe_error_code = 'MAX_ATTEMPTS_EXHAUSTED', updated_at = ?
        WHERE attempts >= ${MAX_OUTBOX_ATTEMPTS}
          AND (
            state = 'pending'
            OR (state = 'inflight' AND lease_expires_at <= ?)
          )
      `).run(input.now.toISOString(), input.now.toISOString());
      const rows = this.#db.query<OutboxRow, [string, string, number]>(`
        SELECT * FROM factura_e_feature_outbox
        WHERE (
          (state = 'pending' AND next_attempt_at <= ?)
          OR (state = 'inflight' AND lease_expires_at <= ?)
        ) AND attempts < ${MAX_OUTBOX_ATTEMPTS}
        ORDER BY created_at, event_id
        LIMIT ?
      `).all(input.now.toISOString(), input.now.toISOString(), input.limit);
      return rows.map(row => {
        const leaseToken = randomUUID();
        const leaseExpiresAt = new Date(
          input.now.getTime() + input.leaseSeconds * 1_000
        ).toISOString();
        const changed = this.#db.query(`
          UPDATE factura_e_feature_outbox
          SET state = 'inflight', attempts = attempts + 1,
              lease_token = ?, lease_expires_at = ?, updated_at = ?
          WHERE event_id = ? AND attempts = ? AND (
            (state = 'pending' AND next_attempt_at <= ?)
            OR (state = 'inflight' AND lease_expires_at <= ?)
          )
        `).run(
          leaseToken,
          leaseExpiresAt,
          input.now.toISOString(),
          row.event_id,
          row.attempts,
          input.now.toISOString(),
          input.now.toISOString()
        );
        if (changed.changes !== 1) throw new Error('FACTURA_E_FEATURE_OUTBOX_CLAIM_RACE');
        return {
          eventId: row.event_id,
          workspaceId: row.workspace_id,
          executionId: row.execution_id,
          feature: parseFacturaEFeatureV1(JSON.parse(row.feature_json)),
          leaseToken,
          attempt: row.attempts + 1,
        };
      });
    })();
  }

  ackOutbox(eventId: string, leaseToken: string, occurredAt: string): void {
    validateReference(eventId, 'FACTURA_E_FEATURE_OUTBOX_EVENT_ID_INVALID');
    validateReference(leaseToken, 'FACTURA_E_FEATURE_OUTBOX_LEASE_TOKEN_INVALID');
    validateTimestamp(occurredAt, 'FACTURA_E_FEATURE_OUTBOX_TIMESTAMP_INVALID');
    this.#db.transaction(() => {
      const row = this.#db.query<{
        execution_id: string;
        workspace_id: string;
        feature_json: string;
      }, [string, string, string]>(`
        SELECT execution_id, workspace_id, feature_json
        FROM factura_e_feature_outbox
        WHERE event_id = ? AND state = 'inflight' AND lease_token = ?
          AND lease_expires_at > ?
      `).get(eventId, leaseToken, occurredAt);
      if (!row) throw new Error('FACTURA_E_FEATURE_OUTBOX_ACK_FENCE_REJECTED');
      const feature = parseFacturaEFeatureV1(JSON.parse(row.feature_json));
      const source = this.#readSource(row.execution_id);
      validateSource(source, row.execution_id);
      assertSourceScope(source, row.workspace_id);
      const result = this.#db.query(`
        UPDATE factura_e_feature_outbox
        SET state = 'delivered', delivered_at = ?, lease_token = NULL,
            lease_expires_at = NULL, updated_at = ?
        WHERE event_id = ? AND state = 'inflight' AND lease_token = ?
          AND lease_expires_at > ?
      `).run(occurredAt, occurredAt, eventId, leaseToken, occurredAt);
      if (result.changes !== 1) {
        throw new Error('FACTURA_E_FEATURE_OUTBOX_ACK_FENCE_REJECTED');
      }
      this.#appendTaxDomainEventInTransaction(
        createFacturaEFeaturePublishedTaxDomainEvent({
          feature,
          caseRef: source.runId,
          workspaceId: row.workspace_id,
          receipt: {
            version: 'factura-e-feature-event-receipt-v1',
            eventId,
            featureHash: feature.featureHash,
            accepted: true,
          },
          occurredAt,
          commitmentSecret: this.#domainEventCommitmentSecret,
        }),
        occurredAt,
      );
    })();
  }

  nackOutbox(
    eventId: string,
    leaseToken: string,
    safeErrorCode: string,
    retryAt: string,
    occurredAt: string
  ): void {
    validateReference(eventId, 'FACTURA_E_FEATURE_OUTBOX_EVENT_ID_INVALID');
    validateReference(leaseToken, 'FACTURA_E_FEATURE_OUTBOX_LEASE_TOKEN_INVALID');
    validateTimestamp(retryAt, 'FACTURA_E_FEATURE_OUTBOX_RETRY_AT_INVALID');
    validateTimestamp(occurredAt, 'FACTURA_E_FEATURE_OUTBOX_TIMESTAMP_INVALID');
    if (Date.parse(retryAt) <= Date.parse(occurredAt)) {
      throw new Error('FACTURA_E_FEATURE_OUTBOX_RETRY_AT_INVALID');
    }
    if (!/^[A-Z0-9_]{1,80}$/.test(safeErrorCode)) {
      throw new Error('FACTURA_E_FEATURE_OUTBOX_ERROR_CODE_INVALID');
    }
    this.#db.transaction(() => {
      const row = this.#db.query<{ attempts: number }, [string, string, string]>(`
        SELECT attempts FROM factura_e_feature_outbox
        WHERE event_id = ? AND state = 'inflight' AND lease_token = ?
          AND lease_expires_at > ?
      `).get(eventId, leaseToken, occurredAt);
      if (!row) throw new Error('FACTURA_E_FEATURE_OUTBOX_NACK_FENCE_REJECTED');
      const state = row.attempts >= MAX_OUTBOX_ATTEMPTS ? 'dead' : 'pending';
      const result = this.#db.query(`
        UPDATE factura_e_feature_outbox
        SET state = ?, next_attempt_at = ?, safe_error_code = ?,
            lease_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE event_id = ? AND state = 'inflight' AND lease_token = ?
          AND lease_expires_at > ? AND attempts = ?
      `).run(
        state,
        retryAt,
        safeErrorCode,
        occurredAt,
        eventId,
        leaseToken,
        occurredAt,
        row.attempts
      );
      if (result.changes !== 1) {
        throw new Error('FACTURA_E_FEATURE_OUTBOX_NACK_FENCE_REJECTED');
      }
    })();
  }

  /** Whether the feature loop has anything to do: a projection candidate or an undelivered outbox row. */
  hasPendingFeatureWork(): boolean {
    return this.projectionCandidates(1).length > 0 || this.#db.query<{ found: number }, []>(
      "SELECT 1 AS found FROM factura_e_feature_outbox WHERE state IN ('pending', 'inflight') LIMIT 1"
    ).get() !== null;
  }

  /** Earliest undelivered event's lease end; `''` when one is claimable now, `null` when none is undelivered. */
  nextTaxDomainEventDueAt(): string | null {
    return this.#db.query<{ due: string | null }, []>(
      "SELECT MIN(COALESCE(leased_until, '')) AS due FROM factura_e_feature_tax_domain_event_outbox WHERE delivered_at IS NULL"
    ).get()?.due ?? null;
  }

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
    validateTimestamp(input.now, 'TAX_DOMAIN_EVENT_LEASE_TIME_INVALID');
    validateTimestamp(input.leaseUntil, 'TAX_DOMAIN_EVENT_LEASE_TIME_INVALID');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('TAX_DOMAIN_EVENT_LEASE_LIMIT_INVALID');
    }
    if (input.leaseUntil <= input.now) {
      throw new Error('TAX_DOMAIN_EVENT_LEASE_WINDOW_INVALID');
    }
    return this.#db.transaction(() => {
      const candidates = this.#db.query<{
        event_id: string;
        event_hash: string;
        event_json: string;
        delivery_attempts: number;
      }, [string, number]>(`
        SELECT event_id, event_hash, event_json, delivery_attempts
        FROM factura_e_feature_tax_domain_event_outbox
        WHERE delivered_at IS NULL AND (leased_until IS NULL OR leased_until <= ?)
        ORDER BY appended_at ASC, event_id ASC
        LIMIT ?
      `).all(input.now, input.limit);
      const claim = this.#db.query(`
        UPDATE factura_e_feature_tax_domain_event_outbox
        SET leased_until = ?, lease_token = ?, delivery_attempts = delivery_attempts + 1,
            last_error_code = NULL
        WHERE event_id = ? AND delivered_at IS NULL
          AND (leased_until IS NULL OR leased_until <= ?)
      `);
      const leased: Array<Readonly<{
        event: TaxDomainEventV1;
        eventHash: string;
        leaseToken: string;
        attempt: number;
      }>> = [];
      for (const candidate of candidates) {
        const claimToken = randomUUID();
        if (claim.run(
          input.leaseUntil,
          claimToken,
          candidate.event_id,
          input.now,
        ).changes !== 1) continue;
        leased.push({
          event: assertTaxDomainEventV1(JSON.parse(candidate.event_json)),
          eventHash: candidate.event_hash,
          leaseToken: claimToken,
          attempt: candidate.delivery_attempts + 1,
        });
      }
      return leased;
    })();
  }

  ackTaxDomainEventClaim(eventId: string, leaseToken: string, deliveredAt: string): void {
    const updated = this.#db.query(`
      UPDATE factura_e_feature_tax_domain_event_outbox
      SET delivered_at = ?, leased_until = NULL, lease_token = NULL,
          last_error_code = NULL
      WHERE event_id = ? AND lease_token = ? AND delivered_at IS NULL
    `).run(deliveredAt, eventId, leaseToken);
    if (updated.changes === 1) return;
    const row = this.#db.query<{ delivered_at: string | null }, [string]>(`
      SELECT delivered_at FROM factura_e_feature_tax_domain_event_outbox WHERE event_id = ?
    `).get(eventId);
    if (!row) throw new Error('TAX_DOMAIN_EVENT_NOT_FOUND');
    if (row.delivered_at !== null) return;
    throw new Error('TAX_DOMAIN_EVENT_OUTBOX_ACK_FENCE_REJECTED');
  }

  releaseTaxDomainEventClaim(
    eventId: string,
    leaseToken: string,
    retryAt: string,
    errorCode: string,
  ): void {
    if (!/^[A-Z0-9_]{3,120}$/.test(errorCode)) {
      throw new Error('TAX_DOMAIN_EVENT_ERROR_CODE_INVALID');
    }
    const updated = this.#db.query(`
      UPDATE factura_e_feature_tax_domain_event_outbox
      SET leased_until = ?, lease_token = NULL, last_error_code = ?
      WHERE event_id = ? AND lease_token = ? AND delivered_at IS NULL
    `).run(retryAt, errorCode, eventId, leaseToken);
    if (updated.changes !== 1) {
      throw new Error('TAX_DOMAIN_EVENT_OUTBOX_NACK_FENCE_REJECTED');
    }
  }

  listPendingTaxDomainEvents(): readonly TaxDomainEventV1[] {
    return this.#db.query<{ event_json: string }, []>(`
      SELECT event_json FROM factura_e_feature_tax_domain_event_outbox
      WHERE delivered_at IS NULL ORDER BY appended_at ASC, event_id ASC
    `).all().map(row => assertTaxDomainEventV1(JSON.parse(row.event_json)));
  }

  #appendTaxDomainEventInTransaction(
    eventInput: TaxDomainEventV1,
    appendedAt: string,
  ): Readonly<{ event: TaxDomainEventV1; replayed: boolean }> {
    const event = assertTaxDomainEventV1(eventInput);
    const eventHash = hashTaxDomainEventV1(event);
    const byEventId = this.#db.query<{
      event_hash: string;
      event_json: string;
    }, [string]>(`
      SELECT event_hash, event_json FROM factura_e_feature_tax_domain_event_outbox WHERE event_id = ?
    `).get(event.eventId);
    if (byEventId) {
      if (byEventId.event_hash !== eventHash) {
        throw new Error('TAX_DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
      }
      return {
        event: assertTaxDomainEventV1(JSON.parse(byEventId.event_json)),
        replayed: true,
      };
    }
    const byIdempotency = this.#db.query<{
      event_hash: string;
      event_json: string;
    }, [string, string]>(`
      SELECT event_hash, event_json FROM factura_e_feature_tax_domain_event_outbox
      WHERE workspace_id = ? AND idempotency_key = ?
    `).get(event.workspaceId, event.idempotencyKey);
    if (byIdempotency) {
      if (byIdempotency.event_hash !== eventHash) {
        throw new Error('TAX_DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
      }
      return {
        event: assertTaxDomainEventV1(JSON.parse(byIdempotency.event_json)),
        replayed: true,
      };
    }
    this.#db.query(`
      INSERT INTO factura_e_feature_tax_domain_event_outbox (
        event_id, workspace_id, idempotency_key, event_hash, event_json,
        appended_at, leased_until, lease_token, delivery_attempts,
        delivered_at, last_error_code
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL)
    `).run(
      event.eventId,
      event.workspaceId,
      event.idempotencyKey,
      eventHash,
      JSON.stringify(event),
      appendedAt,
    );
    return { event, replayed: false };
  }

  #finalize(
    feature: FacturaEFeatureV1,
    executionId: string,
    workspaceId: string,
    sourceStateHash: string,
    consentRevision: number,
    occurredAt: string
  ): boolean {
    return this.#db.transaction(() => {
      const prior = this.#head(executionId);
      if (prior && (
        prior.workspace_id !== workspaceId
        || prior.feature_id !== feature.featureId
      )) return false;
      if (
        (feature.revision === 1 && prior)
        || (feature.revision > 1
          && (!prior
            || prior.revision !== feature.revision - 1
            || prior.feature_hash !== feature.previousFeatureHash))
      ) return false;
      this.#db.query(`
        INSERT INTO factura_e_feature_events (
          event_id, execution_id, workspace_id, feature_id, feature_hash,
          revision, previous_feature_hash, lifecycle, source_state_hash,
          consent_revision, feature_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        feature.eventId,
        executionId,
        workspaceId,
        feature.featureId,
        feature.featureHash,
        feature.revision,
        feature.previousFeatureHash,
        feature.lifecycle,
        sourceStateHash,
        consentRevision,
        JSON.stringify(feature),
        occurredAt
      );
      this.#db.query(`
        INSERT INTO factura_e_feature_heads (
          execution_id, workspace_id, feature_id, feature_hash, revision,
          lifecycle, source_state_hash, consent_revision, feature_json,
          valid_until, restricted_head_revision, last_checked_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT (execution_id) DO UPDATE SET
          feature_id = excluded.feature_id, feature_hash = excluded.feature_hash,
          revision = excluded.revision, lifecycle = excluded.lifecycle,
          source_state_hash = excluded.source_state_hash,
          consent_revision = excluded.consent_revision,
          feature_json = excluded.feature_json,
          valid_until = excluded.valid_until,
          last_checked_at = excluded.last_checked_at,
          updated_at = excluded.updated_at
      `).run(
        executionId,
        workspaceId,
        feature.featureId,
        feature.featureHash,
        feature.revision,
        feature.lifecycle,
        sourceStateHash,
        consentRevision,
        JSON.stringify(feature),
        feature.validUntil,
        occurredAt,
        occurredAt
      );
      this.#db.query(`
        INSERT INTO factura_e_feature_outbox (
          event_id, execution_id, workspace_id, feature_json, state,
          attempts, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)
      `).run(
        feature.eventId,
        executionId,
        workspaceId,
        JSON.stringify(feature),
        occurredAt,
        occurredAt,
        occurredAt
      );
      return true;
    })();
  }

  #commit(kind: string, value: string): string {
    return createHmac('sha256', this.#secret)
      .update(`BUFI_FACTURA_E_FEATURE_V1\0${kind}\0${value}`)
      .digest('hex');
  }

  #effectiveConsent(executionId: string, now: Date): ConsentState | null {
    const consent = this.#consent(executionId);
    if (!consent) return null;
    if (consent.state === 'active' && Date.parse(consent.expiresAt) <= now.getTime()) {
      return { ...consent, state: 'expired' };
    }
    return consent;
  }

  #consent(executionId: string): ConsentState | null {
    const row = this.#db.query<ConsentRow, [string]>(
      'SELECT * FROM factura_e_factoring_consents WHERE execution_id = ?'
    ).get(executionId);
    return row ? consentFromRow(row) : null;
  }

  #head(executionId: string): StoredHead | null {
    return this.#db.query<StoredHead, [string]>(
      'SELECT * FROM factura_e_feature_heads WHERE execution_id = ?'
    ).get(executionId) ?? null;
  }

  #headByFeature(featureId: string): StoredHead | null {
    return this.#db.query<StoredHead, [string]>(
      'SELECT * FROM factura_e_feature_heads WHERE feature_id = ?'
    ).get(featureId) ?? null;
  }

  #reserveRestrictedHeadRevision(
    stored: StoredHead,
    feature: FacturaEFeatureV1
  ): number {
    return this.#db.transaction(() => {
      const changed = this.#db.query(`
        UPDATE factura_e_feature_heads
        SET restricted_head_revision = restricted_head_revision + 1
        WHERE execution_id = ? AND workspace_id = ? AND feature_id = ?
          AND feature_hash = ? AND revision = ? AND lifecycle = 'active'
      `).run(
        stored.execution_id,
        stored.workspace_id,
        feature.featureId,
        feature.featureHash,
        feature.revision
      );
      if (changed.changes !== 1) {
        throw new Error('FACTURA_E_FEATURE_HEAD_RESERVATION_RACE');
      }
      const current = this.#head(stored.execution_id);
      if (!current || current.restricted_head_revision < 1) {
        throw new Error('FACTURA_E_FEATURE_HEAD_RESERVATION_RACE');
      }
      return current.restricted_head_revision;
    })();
  }

  #command(idempotencyKey: string): ConsentCommandRow | null {
    return this.#db.query<ConsentCommandRow, [string]>(
      'SELECT * FROM factura_e_factoring_consent_commands WHERE idempotency_key = ?'
    ).get(idempotencyKey) ?? null;
  }

  #recordCommand(
    input: Readonly<{
      executionId: string;
      workspaceId: string;
      idempotencyKey: string;
      occurredAt: string;
    }>,
    action: 'grant' | 'revoke',
    commandHash: string,
    resultRevision: number
  ): void {
    this.#db.query(`
      INSERT INTO factura_e_factoring_consent_commands (
        idempotency_key, execution_id, workspace_id, command_hash, action,
        result_revision, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.idempotencyKey,
      input.executionId,
      input.workspaceId,
      commandHash,
      action,
      resultRevision,
      input.occurredAt
    );
  }

  #touchProjection(executionId: string, occurredAt: string): void {
    this.#db.transaction(() => {
      this.#db.query(`
        UPDATE factura_e_factoring_consents
        SET last_projection_checked_at = ?
        WHERE execution_id = ?
      `).run(occurredAt, executionId);
      this.#db.query(`
        UPDATE factura_e_feature_heads
        SET last_checked_at = ?
        WHERE execution_id = ?
      `).run(occurredAt, executionId);
    })();
  }

  #recordIssuedRestrictedHead(
    head: TaxFacturaEFeatureHeadV1,
    stored: StoredHead,
    current: CurrentRestrictedFacturaEFeatureHead,
    issuedAt: string
  ): void {
    const source = this.#readSource(stored.execution_id);
    validateSource(source, stored.execution_id);
    if (
      source.workspaceId !== stored.workspace_id
      || privateSourceStateHash(source) !== current.sourceStateHash
    ) throw new Error('FACTURA_E_FEATURE_HEAD_CHANGED_DURING_RECORDING');
    this.#db.transaction(() => {
      this.#db.query(`
        INSERT INTO factura_e_feature_restricted_heads (
          head_hash, execution_id, run_id, workspace_id, feature_id,
          feature_hash, feature_revision, head_revision, source_state_hash, consent_revision,
          head_json, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (head_hash) DO NOTHING
      `).run(
        head.headHash,
        stored.execution_id,
        source.runId,
        stored.workspace_id,
        head.featureId,
        head.featureHash,
        head.featureRevision,
        head.headRevision,
        current.sourceStateHash,
        current.consentRevision,
        JSON.stringify(head),
        issuedAt
      );
      const recorded = this.#requiredIssuedRestrictedHead(head.headHash);
      if (
        recorded.execution_id !== stored.execution_id
        || recorded.run_id !== source.runId
        || recorded.workspace_id !== stored.workspace_id
        || recorded.feature_id !== head.featureId
        || recorded.feature_hash !== head.featureHash
        || recorded.feature_revision !== head.featureRevision
        || recorded.head_revision !== head.headRevision
        || recorded.source_state_hash !== current.sourceStateHash
        || recorded.consent_revision !== current.consentRevision
        || recorded.head_json !== JSON.stringify(head)
      ) throw new Error('FACTURA_E_FEATURE_RESTRICTED_HEAD_HASH_CONFLICT');
    })();
  }

  #issuedRestrictedHead(headHash: string): IssuedRestrictedHeadRow | null {
    return this.#db.query<IssuedRestrictedHeadRow, [string]>(
      'SELECT * FROM factura_e_feature_restricted_heads WHERE head_hash = ?'
    ).get(headHash) ?? null;
  }

  #materializedRestrictedHead(
    stored: StoredHead,
    current: CurrentRestrictedFacturaEFeatureHead,
    request: TaxFacturaEFeatureHeadRequestV1,
    now: Date
  ): TaxFacturaEFeatureHeadV1 | null {
    const row = this.#db.query<IssuedRestrictedHeadRow, [string, string, number, string, number]>(`
      SELECT * FROM factura_e_feature_restricted_heads
      WHERE feature_id = ? AND feature_hash = ? AND feature_revision = ?
        AND source_state_hash = ? AND consent_revision = ?
      ORDER BY head_revision DESC LIMIT 1
    `).get(
      current.feature.featureId,
      current.feature.featureHash,
      current.feature.revision,
      current.sourceStateHash,
      current.consentRevision
    );
    if (!row) return null;
    let head: TaxFacturaEFeatureHeadV1;
    try {
      head = parseTaxFacturaEFeatureHeadV1(JSON.parse(row.head_json) as unknown);
    } catch {
      throw new Error('FACTURA_E_FEATURE_RESTRICTED_HEAD_STORED_INVALID');
    }
    if (
      row.execution_id !== stored.execution_id
      || row.workspace_id !== stored.workspace_id
      || head.featureId !== request.featureId
      || head.featureHash !== request.featureHash
      || head.featureRevision !== request.revision
      || head.workspaceCommitment !== request.workspaceCommitment
      || head.invoiceCommitment !== request.invoiceCommitment
      || head.keyVersion !== this.#signer.keyVersion
    ) throw new Error('FACTURA_E_FEATURE_RESTRICTED_HEAD_BINDING_CONFLICT');
    this.#assertIssuedHeadCurrent(row, now);
    return head;
  }

  async #withRestrictedHeadLock<T>(
    featureId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.#restrictedHeadLocks.get(featureId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolveLock => {
      release = resolveLock;
    });
    this.#restrictedHeadLocks.set(featureId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#restrictedHeadLocks.get(featureId) === current) {
        this.#restrictedHeadLocks.delete(featureId);
      }
    }
  }

  #requiredIssuedRestrictedHead(headHash: string): IssuedRestrictedHeadRow {
    const row = this.#issuedRestrictedHead(headHash);
    if (!row) throw new Error('FACTURA_E_FEATURE_RESERVATION_HEAD_NOT_FOUND');
    return row;
  }

  #assertIssuedHeadCurrent(
    issued: IssuedRestrictedHeadRow,
    now: Date,
    reservation: ReservationRow | null = null
  ): void {
    if (!Number.isFinite(now.getTime())) {
      throw new Error('FACTURA_E_FEATURE_RESERVATION_TIMESTAMP_INVALID');
    }
    const head = parseTaxFacturaEFeatureHeadV1(JSON.parse(issued.head_json) as unknown);
    const observedAt = Date.parse(head.observedAt);
    if (
      head.headHash !== issued.head_hash
      || head.featureId !== issued.feature_id
      || head.featureHash !== issued.feature_hash
      || head.featureRevision !== issued.feature_revision
      || observedAt > now.getTime() + 30_000
      || now.getTime() - observedAt > 60_000
      || Date.parse(head.featureValidUntil) <= now.getTime()
    ) throw new Error('FACTURA_E_FEATURE_RESERVATION_HEAD_NOT_CURRENT');
    const latest = this.#db.query<IssuedRestrictedHeadRow, [string]>(`
      SELECT * FROM factura_e_feature_restricted_heads
      WHERE feature_id = ? ORDER BY head_revision DESC LIMIT 1
    `).get(issued.feature_id);
    if (!latest || latest.head_hash !== issued.head_hash) {
      throw new Error('FACTURA_E_FEATURE_RESERVATION_HEAD_SUPERSEDED');
    }
    if (reservation && (
      reservation.execution_id !== issued.execution_id
      || reservation.run_id !== issued.run_id
      || reservation.workspace_id !== issued.workspace_id
      || reservation.feature_id !== issued.feature_id
      || reservation.feature_hash !== issued.feature_hash
      || reservation.feature_revision !== issued.feature_revision
      || reservation.head_hash !== issued.head_hash
      || reservation.source_state_hash !== issued.source_state_hash
      || reservation.consent_revision !== issued.consent_revision
    )) throw new Error('FACTURA_E_FEATURE_RESERVATION_BINDING_CONFLICT');
    const source = this.#readSource(issued.execution_id);
    validateSource(source, issued.execution_id);
    if (source.runId !== issued.run_id || source.workspaceId !== issued.workspace_id) {
      throw new Error('FACTURA_E_FEATURE_RESERVATION_SOURCE_SCOPE_CONFLICT');
    }
    const current = this.currentRestrictedHeadForWorkspace(
      issued.execution_id,
      issued.workspace_id,
      head.workspaceCommitment,
      head.invoiceCommitment,
      now
    );
    if (
      current.feature.featureId !== issued.feature_id
      || current.feature.featureHash !== issued.feature_hash
      || current.feature.revision !== issued.feature_revision
      || current.sourceStateHash !== issued.source_state_hash
      || current.consentRevision !== issued.consent_revision
    ) throw new Error('FACTURA_E_FEATURE_RESERVATION_HEAD_NOT_CURRENT');
  }

  #requiredReservation(reservationId: string): ReservationRow {
    const row = this.#db.query<ReservationRow, [string]>(
      'SELECT * FROM factura_e_feature_reservations WHERE reservation_id = ?'
    ).get(reservationId);
    if (!row) throw new Error('FACTURA_E_FEATURE_RESERVATION_NOT_FOUND');
    return row;
  }

  #expireReservations(occurredAt: string): void {
    this.#db.query(`
      UPDATE factura_e_feature_reservations
      SET state = 'expired', expired_at = ?, updated_at = ?
      WHERE state = 'reserved' AND lease_expires_at <= ?
    `).run(occurredAt, occurredAt, occurredAt);
  }

  #reservationCommand(idempotencyKey: string): ReservationCommandRow | null {
    return this.#db.query<ReservationCommandRow, [string]>(
      'SELECT command_hash, operation, receipt_json FROM factura_e_feature_reservation_commands WHERE idempotency_key = ?'
    ).get(idempotencyKey) ?? null;
  }

  #recordReservationCommand(
    input: Readonly<{ idempotencyKey: string }>,
    recordedAt: string,
    operation: ReservationCommandRow['operation'],
    reservationId: string,
    commandHash: string,
    receipt: FacturaEFeatureReservationReceiptV1
  ): void {
    this.#db.query(`
      INSERT INTO factura_e_feature_reservation_commands (
        idempotency_key, reservation_id, operation_id, operation,
        command_hash, receipt_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.idempotencyKey,
      reservationId,
      receipt.operationId,
      operation,
      commandHash,
      JSON.stringify(receipt),
      recordedAt
    );
  }

  #ensureColumn(
    table:
      | 'factura_e_factoring_consents'
      | 'factura_e_factoring_consent_commands'
      | 'factura_e_feature_heads'
      | 'factura_e_feature_reservations',
    column: string,
    definition: string
  ): void {
    const columns = this.#db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
    if (!columns.some(candidate => candidate.name === column)) {
      this.#db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function privateSourceStateHash(source: PrivateFacturaEFeatureSource): string {
  return hashCanonical(source);
}

function receipt(
  source: PrivateFacturaEFeatureSource,
  head: StoredHead | null,
  state: FacturaEFeatureProjectionReceipt['state'],
  replayed: boolean
): FacturaEFeatureProjectionReceipt {
  return {
    version: 'factura-e-feature-projection-receipt-v1',
    executionId: source.executionId,
    workspaceId: source.workspaceId,
    state,
    featureId: head?.feature_id ?? null,
    featureHash: head?.feature_hash ?? null,
    revision: head?.revision ?? null,
    replayed,
  };
}

function assertSourceScope(source: PrivateFacturaEFeatureSource, workspaceId: string): void {
  validateSource(source, source.executionId);
  if (source.workspaceId !== workspaceId) {
    throw new Error('FACTURA_E_FACTORING_SOURCE_SCOPE_UNAUTHORIZED');
  }
}

function validateSource(source: PrivateFacturaEFeatureSource, executionId: string): void {
  validateReference(source.executionId, 'FACTURA_E_FEATURE_SOURCE_EXECUTION_ID_INVALID');
  validateReference(source.runId, 'FACTURA_E_FEATURE_SOURCE_RUN_ID_INVALID');
  validateReference(source.workspaceId, 'FACTURA_E_FEATURE_SOURCE_WORKSPACE_ID_INVALID');
  validateReference(source.sourceRevision, 'FACTURA_E_FEATURE_SOURCE_REVISION_INVALID');
  if (source.executionId !== executionId) {
    throw new Error('FACTURA_E_FEATURE_SOURCE_EXECUTION_MISMATCH');
  }
  if (source.authorityIdentityHash !== null && !SHA256.test(source.authorityIdentityHash)) {
    throw new Error('FACTURA_E_FEATURE_SOURCE_AUTHORITY_HASH_INVALID');
  }
  if (
    source.reconciliationEvidenceHash !== null
    && !SHA256.test(source.reconciliationEvidenceHash)
  ) {
    throw new Error('FACTURA_E_FEATURE_SOURCE_EVIDENCE_HASH_INVALID');
  }
  if (
    source.authorityState === 'officially_reconciled'
    && (!source.authorityIdentityHash || !source.reconciliationEvidenceHash)
  ) {
    throw new Error('FACTURA_E_FEATURE_SOURCE_RECONCILIATION_EVIDENCE_REQUIRED');
  }
}

function validateConsentInput(input: Readonly<{
  executionId: string;
  workspaceId: string;
  consentVersion: string;
  idempotencyKey: string;
  occurredAt: string;
  expiresAt: string;
}>): void {
  validateReference(input.executionId, 'FACTURA_E_FACTORING_EXECUTION_ID_INVALID');
  validateReference(input.workspaceId, 'FACTURA_E_FACTORING_WORKSPACE_ID_INVALID');
  validateReference(input.consentVersion, 'FACTURA_E_FACTORING_CONSENT_VERSION_INVALID');
  validateReference(input.idempotencyKey, 'FACTURA_E_FACTORING_IDEMPOTENCY_KEY_INVALID');
  validateTimestamp(input.occurredAt, 'FACTURA_E_FACTORING_TIMESTAMP_INVALID');
  validateTimestamp(input.expiresAt, 'FACTURA_E_FACTORING_EXPIRY_INVALID');
  if (Date.parse(input.expiresAt) <= Date.parse(input.occurredAt)) {
    throw new Error('FACTURA_E_FACTORING_EXPIRY_INVALID');
  }
}

function validateReference(value: string, code: string): void {
  if (!SAFE_REFERENCE.test(value)) throw new Error(code);
}

function validateTimestamp(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(code);
  }
}

function isMemory(path: string): boolean {
  return path === ':memory:' || path.startsWith('file::memory:') || /[?&]mode=memory(?:&|$)/.test(path);
}

function canonicalDatabasePath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Bun only. The feature outbox shared its table and index names with
 * `TaxProfileStore`'s; on one database they would merge. Refuse a file shared
 * with the tax-engine store rather than rename that store's live table.
 */
export function assertFacturaEFeatureDatabaseSeparateFromTaxEngine(
  featurePath: string,
  taxEnginePath = process.env.TAX_ENGINE_DB_PATH,
): void {
  const taxEngine = taxEnginePath?.trim();
  if (isMemory(featurePath) || !featurePath.trim() || !taxEngine || isMemory(taxEngine)) return;
  if (canonicalDatabasePath(featurePath) === canonicalDatabasePath(taxEngine)) {
    throw new Error('FACTURA_E_FEATURE_DB_SHARED_WITH_TAX_ENGINE');
  }
}

/** Bun only: moves a pre-rename feature outbox (its own file) to the new names. */
function renameLegacyTaxDomainEventOutbox(database: SqlDatabase): void {
  const tables = database.query<{ name: string }, []>(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('tax_domain_event_outbox', 'factura_e_feature_tax_domain_event_outbox')
  `).all().map(row => row.name);
  if (!tables.includes('tax_domain_event_outbox') || tables.includes('factura_e_feature_tax_domain_event_outbox')) return;
  database.transaction(() => {
    database.exec('ALTER TABLE tax_domain_event_outbox RENAME TO factura_e_feature_tax_domain_event_outbox');
    database.exec('DROP INDEX IF EXISTS tax_domain_event_outbox_pending');
  })();
}

export function assertFacturaEFeatureSingleWriterConfiguration(singleWriter: boolean): void {
  if (!singleWriter) {
    throw new Error('TAX_FACTURA_E_FEATURE_SINGLE_WRITER_REQUIRED');
  }
}

function assertDurableDatabasePath(path: string): void {
  if (
    typeof path !== 'string'
    || path.trim().length === 0
    || isMemory(path)
    || path.startsWith('file:')
  ) {
    throw new Error('TAX_FACTURA_E_FEATURE_DURABLE_STORE_REQUIRED');
  }
}

function assertDurableDatabaseBacking(database: SqlDatabase, configuredPath: string): void {
  const row = database.query<{ name: string; file: string }, []>(
    'PRAGMA database_list'
  ).all().find(candidate => candidate.name === 'main');
  if (!row?.file || row.file.trim().length === 0) {
    throw new Error('TAX_FACTURA_E_FEATURE_DURABLE_BACKING_INVALID');
  }
  let configuredRealPath: string;
  let backingRealPath: string;
  try {
    configuredRealPath = realpathSync(resolve(configuredPath));
    backingRealPath = realpathSync(resolve(row.file));
  } catch {
    throw new Error('TAX_FACTURA_E_FEATURE_DURABLE_BACKING_INVALID');
  }
  if (configuredRealPath !== backingRealPath) {
    throw new Error('TAX_FACTURA_E_FEATURE_DURABLE_BACKING_MISMATCH');
  }
}

function replayRevision(command: ConsentCommandRow): number {
  if (!Number.isSafeInteger(command.result_revision) || (command.result_revision ?? 0) < 1) {
    throw new Error('FACTURA_E_FACTORING_CONSENT_REPLAY_REVISION_UNAVAILABLE');
  }
  return command.result_revision!;
}

function trustedReservationNow(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_TIMESTAMP_INVALID');
  }
  return now.toISOString();
}

function validateReservationCommon(input: Readonly<{
  featureId: string;
  featureHash: string;
  featureRevision: number;
  headHash: string;
  operationId: string;
  idempotencyKey: string;
}>): void {
  validateReference(input.featureId, 'FACTURA_E_FEATURE_RESERVATION_FEATURE_ID_INVALID');
  if (!SHA256.test(input.featureHash)) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_FEATURE_HASH_INVALID');
  }
  if (!Number.isSafeInteger(input.featureRevision) || input.featureRevision < 1) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_FEATURE_REVISION_INVALID');
  }
  if (!SHA256.test(input.headHash)) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_HEAD_HASH_INVALID');
  }
  if (!HEX32.test(input.operationId)) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_OPERATION_ID_INVALID');
  }
  validateReference(
    input.idempotencyKey,
    'FACTURA_E_FEATURE_RESERVATION_IDEMPOTENCY_KEY_INVALID'
  );
}

function validateReservationTransition(input: Readonly<{
  reservationId: string;
  operationId: string;
  headHash: string;
  idempotencyKey: string;
  reason?: string;
}>): void {
  validateReference(
    input.reservationId,
    'FACTURA_E_FEATURE_RESERVATION_ID_INVALID'
  );
  if (!HEX32.test(input.operationId)) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_OPERATION_ID_INVALID');
  }
  if (!SHA256.test(input.headHash)) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_HEAD_HASH_INVALID');
  }
  validateReference(
    input.idempotencyKey,
    'FACTURA_E_FEATURE_RESERVATION_IDEMPOTENCY_KEY_INVALID'
  );
  if (
    input.reason !== undefined
    && input.reason !== 'before_consume'
  ) throw new Error('FACTURA_E_FEATURE_RESERVATION_RELEASE_REASON_INVALID');
}

function validateFeatureIdentity(input: Readonly<{
  featureId: string;
  featureHash: string;
  featureRevision: number;
}>): void {
  validateReference(input.featureId, 'FACTURA_E_FEATURE_RESERVATION_FEATURE_ID_INVALID');
  if (!SHA256.test(input.featureHash)) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_FEATURE_HASH_INVALID');
  }
  if (!Number.isSafeInteger(input.featureRevision) || input.featureRevision < 1) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_FEATURE_REVISION_INVALID');
  }
}

function validateTerminalAuthorityEvidence(input: Readonly<{
  authorityEnvelopeHash: string;
  authorityKeyId: string;
  authorityRecordedAt: string;
}>): void {
  if (!SHA256.test(input.authorityEnvelopeHash)) {
    throw new Error('FACTURA_E_FEATURE_TERMINAL_AUTHORITY_ENVELOPE_HASH_INVALID');
  }
  validateReference(
    input.authorityKeyId,
    'FACTURA_E_FEATURE_TERMINAL_AUTHORITY_KEY_ID_INVALID'
  );
  validateTimestamp(
    input.authorityRecordedAt,
    'FACTURA_E_FEATURE_TERMINAL_AUTHORITY_RECORDED_AT_INVALID'
  );
}

function assertTerminalAuthorityAfterFence(
  row: ReservationRow,
  authorityRecordedAt: string
): void {
  const lowerBound = row.consumed_at
    ?? row.released_at
    ?? (row.state === 'expired' ? row.lease_expires_at : null);
  if (
    !lowerBound
    || Date.parse(authorityRecordedAt) + MAX_TERMINAL_AUTHORITY_CLOCK_SKEW_MS
      < Date.parse(lowerBound)
  ) throw new Error('FACTURA_E_FEATURE_TERMINAL_AUTHORITY_ORDERING_CONFLICT');
}

function reservationCommandHash(operation: string, input: object): string {
  const command = { ...input } as Record<string, unknown>;
  delete command.idempotencyKey;
  return hashCanonical({ operation, command });
}

function reservationReceipt(
  row: ReservationRow,
  replayed: boolean
): FacturaEFeatureReservationReceiptV1 {
  return {
    version: 'factura-e-feature-reservation-receipt-v1',
    reservationId: row.reservation_id,
    operationId: row.operation_id,
    featureId: row.feature_id,
    featureHash: row.feature_hash,
    featureRevision: row.feature_revision,
    headHash: row.head_hash,
    state: row.state,
    leaseExpiresAt: row.lease_expires_at,
    effectReceiptCommitment: row.effect_receipt_commitment,
    replayed,
  };
}

function reservationReplay(
  command: ReservationCommandRow,
  operation: ReservationCommandRow['operation'],
  commandHash: string
): FacturaEFeatureReservationReceiptV1 {
  if (command.operation !== operation || command.command_hash !== commandHash) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_IDEMPOTENCY_CONFLICT');
  }
  let value: unknown;
  try {
    value = JSON.parse(command.receipt_json) as unknown;
  } catch {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_REPLAY_CORRUPT');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_REPLAY_CORRUPT');
  }
  const receipt = value as Record<string, unknown>;
  if (
    Object.keys(receipt).sort().join(',')
      !== 'effectReceiptCommitment,featureHash,featureId,featureRevision,headHash,leaseExpiresAt,operationId,replayed,reservationId,state,version'
    || receipt.version !== 'factura-e-feature-reservation-receipt-v1'
    || typeof receipt.reservationId !== 'string'
    || typeof receipt.operationId !== 'string'
    || typeof receipt.featureId !== 'string'
    || typeof receipt.featureHash !== 'string'
    || typeof receipt.featureRevision !== 'number'
    || typeof receipt.headHash !== 'string'
    || !['reserved', 'consumed', 'completed', 'released', 'expired'].includes(String(receipt.state))
    || (receipt.leaseExpiresAt !== null && typeof receipt.leaseExpiresAt !== 'string')
    || (receipt.effectReceiptCommitment !== null && typeof receipt.effectReceiptCommitment !== 'string')
  ) throw new Error('FACTURA_E_FEATURE_RESERVATION_REPLAY_CORRUPT');
  return { ...(receipt as FacturaEFeatureReservationReceiptV1), replayed: true };
}

function assertReservationTransitionBinding(
  row: ReservationRow,
  input: Readonly<{ operationId: string; headHash: string }>
): void {
  if (row.operation_id !== input.operationId || row.head_hash !== input.headHash) {
    throw new Error('FACTURA_E_FEATURE_RESERVATION_BINDING_CONFLICT');
  }
}

function assertReservationFeatureBinding(
  row: ReservationRow,
  input: Readonly<{
    featureId: string;
    featureHash: string;
    featureRevision: number;
  }>
): void {
  if (
    row.feature_id !== input.featureId
    || row.feature_hash !== input.featureHash
    || row.feature_revision !== input.featureRevision
  ) throw new Error('FACTURA_E_FEATURE_RESERVATION_BINDING_CONFLICT');
}

function consentFromRow(row: ConsentRow): ConsentState {
  return {
    executionId: row.execution_id,
    workspaceId: row.workspace_id,
    version: row.consent_version,
    state: row.state,
    revision: row.revision,
    expiresAt: row.expires_at,
  };
}

type ConsentRow = Readonly<{
  execution_id: string;
  workspace_id: string;
  consent_version: string;
  state: 'active' | 'revoked' | 'expired';
  revision: number;
  expires_at: string;
}>;

type OutboxRow = Readonly<{
  event_id: string;
  execution_id: string;
  workspace_id: string;
  feature_json: string;
  attempts: number;
}>;
