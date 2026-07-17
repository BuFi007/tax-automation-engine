import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { FacturaEFeatureSigningGateway } from '@tax-engine/core';

import {
  FacturaEFeaturePublicationStore,
  type PrivateFacturaEFeatureSource,
} from './factura-e-feature-publication';

const T0 = new Date('2026-07-15T12:00:00.000Z');
const T1 = new Date('2026-07-15T12:00:01.000Z');
const T2 = new Date('2026-07-15T12:00:02.000Z');
const T7 = new Date('2026-07-15T12:00:07.000Z');
const operationId = `0x${'a'.repeat(64)}`;
const effectReceipt = `0x${'b'.repeat(64)}`;
const reportTxHash = `0x${'e'.repeat(64)}`;
const hash = (seed: string) => Bun.CryptoHasher.hash('sha256', seed, 'hex');

function signer(): FacturaEFeatureSigningGateway {
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    keyVersion: 'tax-feature-key-2026-01',
    async signDigest(digestHex) {
      return sign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('base64url');
    },
  };
}

async function fixture() {
  let current: PrivateFacturaEFeatureSource = {
    executionId: 'execution-1',
    runId: 'run-1',
    workspaceId: 'workspace-1',
    authorityState: 'officially_reconciled',
    authorityIdentityHash: hash('authority'),
    reconciliationEvidenceHash: hash('evidence'),
    settlementState: 'unobserved',
    invoiceState: 'current',
    hasAdjustment: false,
    sourceRevision: 'source-1',
  };
  const store = new FacturaEFeaturePublicationStore({
    readSource: () => current,
    signer: signer(),
    commitmentSecret: 'reservation-purpose-secret-that-is-more-than-32-bytes',
    policyVersion: 'ar-factura-e-factoring-v1',
  });
  store.grantConsent({
    executionId: current.executionId,
    workspaceId: current.workspaceId,
    consentVersion: 'factoring-consent-v1',
    actorId: 'user-1',
    idempotencyKey: 'grant-reservation-consent',
    occurredAt: T0.toISOString(),
    expiresAt: '2026-07-15T13:00:00.000Z',
  });
  await store.project(current.executionId, T0);
  const feature = store.currentPublicHead(current.executionId, current.workspaceId, T0);
  const issueHead = (now: Date) => store.signRestrictedHeadByFeature({
    featureId: feature.featureId,
    featureHash: feature.featureHash,
    workspaceCommitment: feature.workspaceCommitment,
    invoiceCommitment: feature.invoiceCommitment,
    revision: feature.revision,
    purpose: 'factura_e_factoring',
  }, () => now);
  const head = await issueHead(T0);
  return {
    store,
    feature,
    head,
    issueHead,
    get current() { return current; },
    set current(value: PrivateFacturaEFeatureSource) { current = value; },
  };
}

function reserveInput(f: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
  return {
    featureId: f.feature.featureId,
    featureHash: f.feature.featureHash,
    featureRevision: f.feature.revision,
    headHash: f.head.headHash,
    operationId,
    idempotencyKey: 'reserve-operation-0001',
    leaseSeconds: 5,
    ...overrides,
  };
}

function completeInput(
  f: Awaited<ReturnType<typeof fixture>>,
  reservationId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    reservationId,
    operationId,
    headHash: f.head.headHash,
    featureId: f.feature.featureId,
    featureHash: f.feature.featureHash,
    featureRevision: f.feature.revision,
    reportTxHash,
    effectReceiptCommitment: effectReceipt,
    authorityEnvelopeHash: hash('desk-terminal-envelope'),
    authorityKeyId: 'desk-terminal-key-2026-01',
    authorityRecordedAt: T2.toISOString(),
    idempotencyKey: 'complete-operation-0001',
    ...overrides,
  };
}

describe('Factura E factoring one-use reservation', () => {
  test('fences mutations through reserve and consume, then completes with exact effect evidence', async () => {
    const f = await fixture();
    try {
      expect(() => f.store.reserveForFactoring(reserveInput(f, {
        operationId: `0x${'0'.repeat(64)}`,
        idempotencyKey: 'reserve-zero-operation',
      }), T1)).toThrow('FACTURA_E_FEATURE_RESERVATION_OPERATION_ID_INVALID');
      const reserved = f.store.reserveForFactoring(reserveInput(f), T1);
      expect(reserved).toMatchObject({ state: 'reserved', replayed: false });
      expect(f.store.reserveForFactoring(reserveInput(f), T1))
        .toMatchObject({ reservationId: reserved.reservationId, replayed: true });
      expect(() => f.store.reserveForFactoring(reserveInput(f, {
        leaseSeconds: 6,
      }), T1)).toThrow('FACTURA_E_FEATURE_RESERVATION_IDEMPOTENCY_CONFLICT');
      expect(() => f.store.reserveForFactoring(reserveInput(f, {
        idempotencyKey: 'reserve-same-operation-conflict',
      }), T1)).toThrow('FACTURA_E_FEATURE_RESERVATION_OPERATION_CONFLICT');
      expect(() => f.store.reserveForFactoring(reserveInput(f, {
        operationId: `0x${'c'.repeat(64)}`,
        idempotencyKey: 'reserve-same-feature-conflict',
      }), T1)).toThrow('FACTURA_E_FEATURE_RESERVATION_FEATURE_ONE_USE_CONFLICT');
      expect(() => f.store.assertRunMutationAllowed({
        runId: 'run-1', workspaceId: 'workspace-1',
      }, T2)).toThrow('FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE');

      const consumed = f.store.consumeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        idempotencyKey: 'consume-operation-0001',
      }, T2);
      expect(consumed.state).toBe('consumed');
      expect(() => f.store.assertRunMutationAllowed({
        runId: 'run-1', workspaceId: 'workspace-1',
      }, T7)).toThrow('FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE');

      expect(() => f.store.completeFactoringReservation(completeInput(
        f,
        reserved.reservationId,
        {
          authorityRecordedAt: new Date(T2.getTime() - 5_001).toISOString(),
          idempotencyKey: 'complete-before-consume-time',
        }
      ), T7)).toThrow('FACTURA_E_FEATURE_TERMINAL_AUTHORITY_ORDERING_CONFLICT');

      const withinClockSkew = completeInput(f, reserved.reservationId, {
        authorityRecordedAt: T1.toISOString(),
      });
      const completed = f.store.completeFactoringReservation(withinClockSkew, T7);
      expect(completed).toMatchObject({
        state: 'completed',
        effectReceiptCommitment: effectReceipt,
      });
      expect(f.store.completeFactoringReservation(withinClockSkew, T7))
        .toMatchObject({ state: 'completed', replayed: true });
      expect(() => f.store.completeFactoringReservation(completeInput(f, reserved.reservationId, {
        effectReceiptCommitment: `0x${'c'.repeat(64)}`,
      }), T7)).toThrow('FACTURA_E_FEATURE_RESERVATION_IDEMPOTENCY_CONFLICT');
      expect(() => f.store.assertRunMutationAllowed({
        runId: 'run-1', workspaceId: 'workspace-1',
      }, T7)).not.toThrow();
      expect(() => f.store.reserveForFactoring(reserveInput(f, {
        operationId: `0x${'d'.repeat(64)}`,
        idempotencyKey: 'reserve-after-completed-conflict',
      }), T7)).toThrow('FACTURA_E_FEATURE_RESERVATION_FEATURE_ONE_USE_CONFLICT');
    } finally {
      f.store.close();
    }
  });

  test('expires only from the trusted guard clock and never expires consumed state', async () => {
    const f = await fixture();
    try {
      const reserved = f.store.reserveForFactoring(reserveInput(f), T1);
      expect(() => f.store.assertRunMutationAllowed({
        runId: 'run-1', workspaceId: 'workspace-1',
      }, T7)).not.toThrow();
      expect(() => f.store.consumeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        idempotencyKey: 'consume-expired-0001',
      }, T7)).toThrow('FACTURA_E_FEATURE_RESERVATION_EXPIRED');

      const second = f.store.reserveForFactoring(reserveInput(f, {
        operationId: `0x${'d'.repeat(64)}`,
        idempotencyKey: 'reserve-operation-0002',
      }), T7);
      f.store.consumeFactoringReservation({
        reservationId: second.reservationId,
        operationId: second.operationId,
        headHash: second.headHash,
        idempotencyKey: 'consume-operation-0002',
      }, T7);
      expect(() => f.store.assertRunMutationAllowed({
        runId: 'run-1', workspaceId: 'workspace-1',
      }, new Date('2026-07-15T12:10:00.000Z')))
        .toThrow('FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE');
    } finally {
      f.store.close();
    }
  });

  test('materializes one byte-identical head per current feature for DON consensus', async () => {
    const f = await fixture();
    try {
      const heads = await Promise.all([
        f.issueHead(T1),
        f.issueHead(T1),
        f.issueHead(T2),
      ]);
      expect(heads.every(head => JSON.stringify(head) === JSON.stringify(f.head)))
        .toBe(true);
      expect(heads.map(head => head.headRevision)).toEqual([1, 1, 1]);
      expect(f.store.reserveForFactoring(reserveInput(f), T2).headHash)
        .toBe(f.head.headHash);
    } finally {
      f.store.close();
    }
  });

  test('revalidates settlement at consume and supports only pre-effect release', async () => {
    const f = await fixture();
    try {
      const reserved = f.store.reserveForFactoring(reserveInput(f), T1);
      f.current = {
        ...f.current,
        settlementState: 'observed',
        sourceRevision: 'source-settled',
      };
      expect(() => f.store.consumeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        idempotencyKey: 'consume-settled-0001',
      }, T2)).toThrow('FACTURA_E_FEATURE_HEAD_NOT_CURRENT');
      expect(f.store.releaseFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        reason: 'before_consume',
        idempotencyKey: 'release-before-consume-0001',
      }, T2).state).toBe('released');
      expect(f.store.recoverFactoringReservationNoEffect({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        featureId: f.feature.featureId,
        featureHash: f.feature.featureHash,
        featureRevision: f.feature.revision,
        recoveryEvidenceRef: `hmac-sha256:v1:${'e'.repeat(64)}`,
        noEffectReceiptCommitment: `0x${'f'.repeat(64)}`,
        authorityEnvelopeHash: hash('pre-consume-release-recovery-envelope'),
        authorityKeyId: 'desk-recovery-key-2026-01',
        authorityRecordedAt: T2.toISOString(),
        idempotencyKey: 'recover-after-pre-consume-release',
      }, T2)).toMatchObject({
        state: 'released',
        effectReceiptCommitment: `0x${'f'.repeat(64)}`,
      });
      expect(() => f.store.assertRunMutationAllowed({
        runId: 'run-1', workspaceId: 'workspace-1',
      }, T2)).not.toThrow();
    } finally {
      f.store.close();
    }
  });

  test('rearms the same operation only after a proven pre-effect release', async () => {
    const f = await fixture();
    try {
      const reserved = f.store.reserveForFactoring(reserveInput(f), T1);
      f.store.releaseFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        reason: 'before_consume',
        idempotencyKey: 'release-for-new-claim-attempt',
      }, T2);
      const rearmed = f.store.reserveForFactoring(reserveInput(f, {
        idempotencyKey: 'reserve-operation-claim-attempt-2',
      }), T2);
      expect(rearmed).toMatchObject({
        operationId,
        featureId: f.feature.featureId,
        state: 'reserved',
        replayed: false,
      });
      expect(rearmed.reservationId).not.toBe(reserved.reservationId);
    } finally {
      f.store.close();
    }
  });

  test('recovers an unconsumed reservation after expiry with ordered no-effect evidence', async () => {
    const f = await fixture();
    try {
      const reserved = f.store.reserveForFactoring(reserveInput(f), T1);
      const recovery = {
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        featureId: f.feature.featureId,
        featureHash: f.feature.featureHash,
        featureRevision: f.feature.revision,
        recoveryEvidenceRef: `hmac-sha256:v1:${'9'.repeat(64)}`,
        noEffectReceiptCommitment: `0x${'8'.repeat(64)}`,
        authorityEnvelopeHash: hash('expired-before-consume-recovery-envelope'),
        authorityKeyId: 'desk-recovery-key-2026-01',
        authorityRecordedAt: T0.toISOString(),
        idempotencyKey: 'recover-expired-before-consume-too-early',
      };

      expect(() => f.store.recoverFactoringReservationNoEffect(recovery, T7))
        .toThrow('FACTURA_E_FEATURE_TERMINAL_AUTHORITY_ORDERING_CONFLICT');

      const released = f.store.recoverFactoringReservationNoEffect({
        ...recovery,
        authorityRecordedAt: T7.toISOString(),
        idempotencyKey: 'recover-expired-before-consume-ordered',
      }, T7);
      expect(released).toMatchObject({
        reservationId: reserved.reservationId,
        state: 'released',
        effectReceiptCommitment: `0x${'8'.repeat(64)}`,
      });
      expect(() => f.store.assertRunMutationAllowed({
        runId: 'run-1', workspaceId: 'workspace-1',
      }, T7)).not.toThrow();
    } finally {
      f.store.close();
    }
  });

  test('revocation cancels reserved work but is retryably fenced after consume', async () => {
    const reservedFixture = await fixture();
    try {
      const reserved = reservedFixture.store.reserveForFactoring(reserveInput(reservedFixture), T1);
      reservedFixture.store.revokeConsent({
        executionId: 'execution-1', workspaceId: 'workspace-1', actorId: 'user-1',
        idempotencyKey: 'revoke-reserved-consent', occurredAt: T2.toISOString(),
      });
      expect(() => reservedFixture.store.consumeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: reservedFixture.head.headHash,
        idempotencyKey: 'consume-revoked-0001',
      }, T2)).toThrow('FACTURA_E_FEATURE_RESERVATION_CONSUME_CONFLICT');
    } finally {
      reservedFixture.store.close();
    }

    const consumedFixture = await fixture();
    try {
      const reserved = consumedFixture.store.reserveForFactoring(reserveInput(consumedFixture), T1);
      consumedFixture.store.consumeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: consumedFixture.head.headHash,
        idempotencyKey: 'consume-before-revoke-0001',
      }, T2);
      expect(() => consumedFixture.store.revokeConsent({
        executionId: 'execution-1', workspaceId: 'workspace-1', actorId: 'user-1',
        idempotencyKey: 'revoke-consumed-consent', occurredAt: T2.toISOString(),
      })).toThrow('FACTURA_E_FACTORING_CONSENT_MUTATION_FENCED_RETRYABLE');
    } finally {
      consumedFixture.store.close();
    }
  });

  test('allows no-effect release after consume only through the recovery transition', async () => {
    const f = await fixture();
    try {
      const reserved = f.store.reserveForFactoring(reserveInput(f), T1);
      f.store.consumeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        idempotencyKey: 'consume-no-effect-0001',
      }, T2);
      expect(() => f.store.releaseFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        reason: 'before_consume',
        idempotencyKey: 'release-wrong-phase-0001',
      }, T2)).toThrow('FACTURA_E_FEATURE_RESERVATION_RELEASE_CONFLICT');
      expect(() => f.store.recoverFactoringReservationNoEffect({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        featureId: f.feature.featureId,
        featureHash: f.feature.featureHash,
        featureRevision: f.feature.revision,
        recoveryEvidenceRef: `hmac-sha256:v1:${'0'.repeat(64)}`,
        noEffectReceiptCommitment: `0x${'d'.repeat(64)}`,
        authorityEnvelopeHash: hash('invalid-recovery-envelope'),
        authorityKeyId: 'desk-recovery-key-2026-01',
        authorityRecordedAt: T2.toISOString(),
        idempotencyKey: 'release-invalid-evidence-0001',
      }, T2)).toThrow('FACTURA_E_FEATURE_RECOVERY_EVIDENCE_REF_INVALID');
      const released = f.store.recoverFactoringReservationNoEffect({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        featureId: f.feature.featureId,
        featureHash: f.feature.featureHash,
        featureRevision: f.feature.revision,
        recoveryEvidenceRef: `hmac-sha256:v1:${'c'.repeat(64)}`,
        noEffectReceiptCommitment: `0x${'d'.repeat(64)}`,
        authorityEnvelopeHash: hash('recovery-terminal-envelope'),
        authorityKeyId: 'desk-recovery-key-2026-01',
        authorityRecordedAt: T2.toISOString(),
        idempotencyKey: 'release-no-effect-0001',
      }, T2);
      expect(released.state).toBe('released');
      expect(released.effectReceiptCommitment).toBe(`0x${'d'.repeat(64)}`);
      expect(f.store.recoverFactoringReservationNoEffect({
        reservationId: reserved.reservationId,
        operationId,
        headHash: f.head.headHash,
        featureId: f.feature.featureId,
        featureHash: f.feature.featureHash,
        featureRevision: f.feature.revision,
        recoveryEvidenceRef: `hmac-sha256:v1:${'c'.repeat(64)}`,
        noEffectReceiptCommitment: `0x${'d'.repeat(64)}`,
        authorityEnvelopeHash: hash('recovery-terminal-envelope'),
        authorityKeyId: 'desk-recovery-key-2026-01',
        authorityRecordedAt: T2.toISOString(),
        idempotencyKey: 'release-no-effect-0001',
      }, T2)).toMatchObject({ state: 'released', replayed: true });
    } finally {
      f.store.close();
    }
  });

  test('persists a consumed one-use fence across a process/store restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tax-factoring-reservation-'));
    const databasePath = join(directory, 'feature-publication.sqlite');
    let current: PrivateFacturaEFeatureSource = {
      executionId: 'execution-durable',
      runId: 'run-durable',
      workspaceId: 'workspace-durable',
      authorityState: 'officially_reconciled',
      authorityIdentityHash: hash('durable-authority'),
      reconciliationEvidenceHash: hash('durable-evidence'),
      settlementState: 'unobserved',
      invoiceState: 'current',
      hasAdjustment: false,
      sourceRevision: 'durable-source-1',
    };
    const dependencies = {
      readSource: () => current,
      signer: signer(),
      commitmentSecret: 'durable-reservation-secret-that-is-more-than-32-bytes',
      policyVersion: 'ar-factura-e-factoring-v1',
      databasePath,
      requireDurable: true,
      singleWriter: true,
    } as const;
    let first: FacturaEFeaturePublicationStore | null = new FacturaEFeaturePublicationStore(dependencies);
    let second: FacturaEFeaturePublicationStore | null = null;
    try {
      first.grantConsent({
        executionId: current.executionId,
        workspaceId: current.workspaceId,
        consentVersion: 'factoring-consent-v1',
        actorId: 'user-durable',
        idempotencyKey: 'grant-durable-reservation-consent',
        occurredAt: T0.toISOString(),
        expiresAt: '2026-07-15T13:00:00.000Z',
      });
      await first.project(current.executionId, T0);
      const feature = first.currentPublicHead(current.executionId, current.workspaceId, T0);
      const head = await first.signRestrictedHeadByFeature({
        featureId: feature.featureId,
        featureHash: feature.featureHash,
        workspaceCommitment: feature.workspaceCommitment,
        invoiceCommitment: feature.invoiceCommitment,
        revision: feature.revision,
        purpose: 'factura_e_factoring',
      }, () => T0);
      const reserved = first.reserveForFactoring({
        featureId: feature.featureId,
        featureHash: feature.featureHash,
        featureRevision: feature.revision,
        headHash: head.headHash,
        operationId,
        idempotencyKey: 'reserve-durable-operation',
        leaseSeconds: 5,
      }, T1);
      first.consumeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: head.headHash,
        idempotencyKey: 'consume-durable-operation',
      }, T2);
      first.close();
      first = null;

      second = new FacturaEFeaturePublicationStore(dependencies);
      expect(() => second!.assertRunMutationAllowed({
        runId: current.runId,
        workspaceId: current.workspaceId,
      }, new Date('2026-07-16T12:00:00.000Z')))
        .toThrow('FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE');
      expect(second.completeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: head.headHash,
        featureId: feature.featureId,
        featureHash: feature.featureHash,
        featureRevision: feature.revision,
        reportTxHash,
        effectReceiptCommitment: effectReceipt,
        authorityEnvelopeHash: hash('durable-terminal-envelope'),
        authorityKeyId: 'desk-terminal-key-2026-01',
        authorityRecordedAt: T2.toISOString(),
        idempotencyKey: 'complete-durable-operation',
      }, new Date('2026-07-16T12:00:00.000Z')).state).toBe('completed');
    } finally {
      first?.close();
      second?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
