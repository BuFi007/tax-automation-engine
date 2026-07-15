import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import {
  assertFacturaETerminalReceiptVerifiers,
  canonicalDeskTaxEffectReceipt,
  canonicalDeskTaxNoEffectRecoveryReceipt,
  computeDeskTaxEffectReceiptCommitment,
  computeDeskTaxNoEffectReceiptCommitment,
  verifyDeskTaxEffectReceipt,
  verifyDeskTaxNoEffectRecoveryReceipt,
} from './factura-e-feature-terminal-receipt';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const effectKeys = generateKeyPairSync('ed25519');
const recoveryKeys = generateKeyPairSync('ed25519');
const publicPem = (key: typeof effectKeys.publicKey) =>
  key.export({ type: 'spki', format: 'pem' }).toString();

function effectEnvelope(overrides: Record<string, unknown> = {}) {
  const payloadWithoutCommitment = {
    action: 'submitted' as const,
    handoffRef: `hmac-sha256:v1:${'1'.repeat(64)}`,
    handoffIdempotencyKey: `0x${'2'.repeat(64)}`,
    idempotencyKey: 'complete-terminal-operation-0001',
    reservationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    operationId: `0x${'3'.repeat(64)}`,
    headHash: '4'.repeat(64),
    featureId: '55555555-5555-4555-8555-555555555555',
    featureHash: '6'.repeat(64),
    featureRevision: 7,
    reportTxHash: `0x${'8'.repeat(64)}`,
    recordedAt: NOW.toISOString(),
    ...overrides,
  } as any;
  const unsigned = {
    version: 'bufi.desk-tax-effect-receipt.v1' as const,
    keyId: 'desk-effect-key-2026-01',
    payload: {
      ...payloadWithoutCommitment,
      effectReceiptCommitment:
        computeDeskTaxEffectReceiptCommitment(payloadWithoutCommitment),
    },
  };
  return {
    ...unsigned,
    signature: `ed25519:v1:${sign(
      null,
      Buffer.from(canonicalDeskTaxEffectReceipt(unsigned), 'utf8'),
      effectKeys.privateKey
    ).toString('hex')}`,
  };
}

function recoveryEnvelope() {
  const payloadWithoutCommitment = {
    action: 'confirmed_not_submitted' as const,
    reservationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    idempotencyKey: 'recover-terminal-operation-0001',
    operationId: `0x${'3'.repeat(64)}`,
    headHash: '4'.repeat(64),
    featureId: '55555555-5555-4555-8555-555555555555',
    featureHash: '6'.repeat(64),
    featureRevision: 7,
    recoveryEvidenceRef: `hmac-sha256:v1:${'9'.repeat(64)}`,
    recordedAt: NOW.toISOString(),
  };
  const unsigned = {
    version: 'bufi.desk-tax-no-effect-recovery.v1' as const,
    keyId: 'desk-recovery-key-2026-01',
    payload: {
      ...payloadWithoutCommitment,
      noEffectReceiptCommitment:
        computeDeskTaxNoEffectReceiptCommitment(payloadWithoutCommitment),
    },
  };
  return {
    ...unsigned,
    signature: `ed25519:v1:${sign(
      null,
      Buffer.from(canonicalDeskTaxNoEffectRecoveryReceipt(unsigned), 'utf8'),
      recoveryKeys.privateKey
    ).toString('hex')}`,
  };
}

describe('Factura E terminal receipts', () => {
  test('verifies immutable Desk submission evidence after long outages', () => {
    const envelope = effectEnvelope();
    expect(verifyDeskTaxEffectReceipt({
      value: envelope,
      verifier: {
        enabled: true,
        keyId: envelope.keyId,
        publicKey: publicPem(effectKeys.publicKey),
      },
      now: new Date('2027-07-15T12:00:00.000Z'),
    }).payload.reportTxHash).toBe(`0x${'8'.repeat(64)}`);
  });

  test('rejects tampering, future DB times, and a CRE-controlled key', () => {
    const envelope = effectEnvelope();
    const verifier = {
      enabled: true,
      keyId: envelope.keyId,
      publicKey: publicPem(effectKeys.publicKey),
    } as const;
    expect(() => verifyDeskTaxEffectReceipt({
      value: {
        ...envelope,
        payload: { ...envelope.payload, reportTxHash: `0x${'a'.repeat(64)}` },
      },
      verifier,
      now: NOW,
    })).toThrow('FACTURA_E_FEATURE_TERMINAL_EFFECT_COMMITMENT_INVALID');
    expect(() => verifyDeskTaxEffectReceipt({
      value: effectEnvelope({ recordedAt: '2026-07-15T12:01:00.000Z' }),
      verifier,
      now: NOW,
    })).toThrow('FACTURA_E_FEATURE_TERMINAL_RECEIPT_TIMESTAMP_INVALID');
    expect(() => verifyDeskTaxEffectReceipt({
      value: envelope,
      verifier: { ...verifier, publicKey: publicPem(recoveryKeys.publicKey) },
      now: NOW,
    })).toThrow('FACTURA_E_FEATURE_TERMINAL_EFFECT_RECEIPT_UNAUTHORIZED');
    expect(() => verifyDeskTaxEffectReceipt({
      value: effectEnvelope({
        handoffRef: `hmac-sha256:v1:${'0'.repeat(64)}`,
      }),
      verifier,
      now: NOW,
    })).toThrow();
  });

  test('requires an independent recovery key and constrained evidence reference', () => {
    const envelope = recoveryEnvelope();
    expect(verifyDeskTaxNoEffectRecoveryReceipt({
      value: envelope,
      verifier: {
        enabled: true,
        keyId: envelope.keyId,
        publicKey: publicPem(recoveryKeys.publicKey),
      },
      now: NOW,
    }).payload.recoveryEvidenceRef).toMatch(/^hmac-sha256:v1:/);
    expect(() => assertFacturaETerminalReceiptVerifiers({
      deskEffect: {
        enabled: true,
        keyId: 'same-key',
        publicKey: publicPem(effectKeys.publicKey),
        transportSecret: 'effect-transport-purpose-secret-more-than-32-bytes',
      },
      noEffectRecovery: {
        enabled: true,
        keyId: 'same-key',
        publicKey: publicPem(recoveryKeys.publicKey),
        transportSecret: 'recovery-transport-purpose-secret-more-than-32-bytes',
      },
    })).toThrow('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_KEYS_MUST_BE_DISTINCT');
  });
});
