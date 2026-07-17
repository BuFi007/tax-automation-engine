import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import {
  type FacturaEFeatureV1,
  assertFacturaEFeatureV1LockEligible,
  deriveFacturaEFeatureDecision,
  hashFacturaEFeatureV1,
  parseFacturaEFeatureV1,
  parseUnsignedFacturaEFeatureV1,
  signFacturaEFeatureV1,
  verifyFacturaEFeatureV1Signature,
} from './factura-e-feature';

const hash = (seed: string) => Bun.CryptoHasher.hash('sha256', seed, 'hex');

function structuredKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(structuredKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key.toLowerCase(), ...structuredKeys(nested)]);
}

function unsigned(overrides: Record<string, unknown> = {}) {
  return {
    version: 'factura-e-feature-v1',
    eventId: '11111111-1111-4111-8111-111111111111',
    featureId: '22222222-2222-4222-8222-222222222222',
    purpose: 'factura_e_factoring',
    workspaceCommitment: hash('workspace-purpose-salt'),
    invoiceCommitment: hash('invoice-purpose-salt'),
    lifecycle: 'active',
    predicates: {
      eligibleCurrentUnpaid: true,
      officialIssuanceReconciled: true,
      undisputed: true,
    },
    consent: {
      purpose: 'factura_e_factoring',
      version: 'factoring-consent-v1',
      state: 'active',
    },
    schemaVersion: 'factura-e-feature-v1',
    policyVersion: 'ar-factura-e-factoring-v1',
    keyVersion: 'tax-feature-key-2026-01',
    revision: 1,
    previousFeatureHash: null,
    withdrawalReason: null,
    producedAt: '2026-07-15T12:00:00.000Z',
    validUntil: '2026-07-15T12:05:00.000Z',
    ...overrides,
  };
}

function signed(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload = parseUnsignedFacturaEFeatureV1(unsigned(overrides));
  const featureHash = hashFacturaEFeatureV1(payload);
  const feature: FacturaEFeatureV1 = parseFacturaEFeatureV1({
    ...payload,
    featureHash,
    signature: {
      algorithm: 'Ed25519',
      keyId: payload.keyVersion,
      value: sign(null, Buffer.from(featureHash, 'hex'), privateKey).toString('base64url'),
    },
  });
  return {
    feature,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('FacturaEFeatureV1', () => {
  test('accepts and verifies only a current signed minimized feature', () => {
    const { feature, publicKey } = signed();
    const context = {
      workspaceCommitment: feature.workspaceCommitment,
      invoiceCommitment: feature.invoiceCommitment,
      keyVersion: feature.keyVersion,
      minimumRevision: 1,
    };
    expect(
      verifyFacturaEFeatureV1Signature(
        feature,
        publicKey,
        context,
        new Date('2026-07-15T12:01:00.000Z')
      )
    ).toEqual(feature);
    expect(assertFacturaEFeatureV1LockEligible(feature)).toEqual(feature);
  });

  test('signs through a key-version-bound gateway without accepting key material', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const feature = await signFacturaEFeatureV1(unsigned(), {
      keyVersion: 'tax-feature-key-2026-01',
      async signDigest(digestHex) {
        return sign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('base64url');
      },
    });
    expect(feature.signature.keyId).toBe(feature.keyVersion);
    await expect(signFacturaEFeatureV1(unsigned(), {
      keyVersion: 'wrong-key-version',
      async signDigest() {
        throw new Error('must not be called');
      },
    })).rejects.toThrow('FACTURA_E_FEATURE_SIGNING_KEY_VERSION_MISMATCH');
  });

  test('rejects active features without dedicated consent or official reconciliation', () => {
    expect(() => parseUnsignedFacturaEFeatureV1(unsigned({
      consent: { purpose: 'tax_workspace_processing', version: 'v1', state: 'active' },
    }))).toThrow();
    expect(() => parseUnsignedFacturaEFeatureV1(unsigned({
      predicates: {
        eligibleCurrentUnpaid: true,
        officialIssuanceReconciled: false,
        undisputed: true,
      },
    }))).toThrow();
  });

  test('requires an ineligible, chained tombstone for withdrawal', () => {
    const firstHash = hashFacturaEFeatureV1(parseUnsignedFacturaEFeatureV1(unsigned()));
    const withdrawn = parseUnsignedFacturaEFeatureV1(unsigned({
      lifecycle: 'withdrawn',
      predicates: {
        eligibleCurrentUnpaid: false,
        officialIssuanceReconciled: true,
        undisputed: true,
      },
      consent: {
        purpose: 'factura_e_factoring',
        version: 'factoring-consent-v1',
        state: 'revoked',
      },
      revision: 2,
      previousFeatureHash: firstHash,
      withdrawalReason: 'CONSENT_REVOKED',
    }));
    expect(withdrawn.lifecycle).toBe('withdrawn');
    expect(() => parseUnsignedFacturaEFeatureV1({
      ...withdrawn,
      predicates: { ...withdrawn.predicates, eligibleCurrentUnpaid: true },
    })).toThrow();
  });

  test('is strict and serialized output contains no fiscal or monetary fields', () => {
    const { feature } = signed();
    expect(() => parseFacturaEFeatureV1({ ...feature, cae: 'forbidden' })).toThrow();
    const keys = structuredKeys(feature);
    for (const forbidden of [
      'cuit',
      'cae',
      'counterparty',
      'amount',
      'currency',
      'invoiceissue',
      'invoicedue',
      'pointofsale',
      'authorityinvoiceid',
      'rawproof',
      'credential',
      'score',
    ]) expect(keys).not.toContain(forbidden);
  });

  test('rejects tampering, wrong keys, expiry and broken predecessor chains', () => {
    const { feature, publicKey } = signed();
    const context = {
      workspaceCommitment: feature.workspaceCommitment,
      invoiceCommitment: feature.invoiceCommitment,
      keyVersion: feature.keyVersion,
    };
    expect(() => parseFacturaEFeatureV1({
      ...feature,
      predicates: { ...feature.predicates, undisputed: false },
    })).toThrow();

    const wrongKey = generateKeyPairSync('ed25519').publicKey
      .export({ type: 'spki', format: 'pem' }).toString();
    expect(() => verifyFacturaEFeatureV1Signature(
      feature,
      wrongKey,
      context,
      new Date('2026-07-15T12:01:00.000Z')
    )).toThrow('FACTURA_E_FEATURE_SIGNATURE_INVALID');
    expect(() => verifyFacturaEFeatureV1Signature(
      feature,
      publicKey,
      context,
      new Date('2026-07-15T12:06:00.000Z')
    )).toThrow('FACTURA_E_FEATURE_EXPIRED');
    expect(() => parseUnsignedFacturaEFeatureV1(unsigned({
      revision: 2,
      previousFeatureHash: null,
    }))).toThrow();
    expect(() => verifyFacturaEFeatureV1Signature(
      feature,
      publicKey,
      { ...context, workspaceCommitment: hash('another-workspace') },
      new Date('2026-07-15T12:01:00.000Z')
    )).toThrow('FACTURA_E_FEATURE_CONTEXT_MISMATCH');
    expect(() => verifyFacturaEFeatureV1Signature(
      feature,
      publicKey,
      { ...context, minimumRevision: 2 },
      new Date('2026-07-15T12:01:00.000Z')
    )).toThrow('FACTURA_E_FEATURE_REVISION_STALE');

    const future = signed({
      producedAt: '2026-07-15T12:01:31.000Z',
      validUntil: '2026-07-15T12:05:00.000Z',
    });
    expect(() => verifyFacturaEFeatureV1Signature(
      future.feature,
      future.publicKey,
      {
        workspaceCommitment: future.feature.workspaceCommitment,
        invoiceCommitment: future.feature.invoiceCommitment,
        keyVersion: future.feature.keyVersion,
      },
      new Date('2026-07-15T12:01:00.000Z')
    )).toThrow('FACTURA_E_FEATURE_EXPIRED');

    const excessiveValidity = signed({ validUntil: '2026-07-15T12:05:00.001Z' });
    expect(() => verifyFacturaEFeatureV1Signature(
      excessiveValidity.feature,
      excessiveValidity.publicKey,
      {
        workspaceCommitment: excessiveValidity.feature.workspaceCommitment,
        invoiceCommitment: excessiveValidity.feature.invoiceCommitment,
        keyVersion: excessiveValidity.feature.keyVersion,
      },
      new Date('2026-07-15T12:01:00.000Z')
    )).toThrow('FACTURA_E_FEATURE_EXPIRED');
    expect(() => verifyFacturaEFeatureV1Signature(
      feature,
      publicKey,
      context,
      new Date(Number.NaN)
    )).toThrow('FACTURA_E_FEATURE_EVALUATION_TIME_INVALID');
  });

  test('publishes only independently reconciled, current and wholly unpaid receivables', () => {
    const eligible = {
      authorityState: 'officially_reconciled' as const,
      consentState: 'active' as const,
      settlementState: 'unobserved' as const,
      invoiceState: 'current' as const,
      hasAdjustment: false,
      hadActiveFeature: false,
    };
    expect(deriveFacturaEFeatureDecision(eligible).publication).toBe('active');

    for (const source of [
      { ...eligible, authorityState: 'unverified' as const },
      { ...eligible, authorityState: 'ambiguous' as const },
      { ...eligible, consentState: 'missing' as const },
      { ...eligible, settlementState: 'observed' as const },
      { ...eligible, settlementState: 'final' as const },
      { ...eligible, settlementState: 'reversed' as const },
      { ...eligible, settlementState: 'disputed' as const },
      { ...eligible, invoiceState: 'expired' as const },
      { ...eligible, invoiceState: 'voided' as const },
      { ...eligible, hasAdjustment: true },
    ]) expect(deriveFacturaEFeatureDecision(source).publication).toBe('none');
  });

  test('withdraws an active feature on consent, settlement, dispute, expiry or adjustment', () => {
    const active = {
      authorityState: 'officially_reconciled' as const,
      consentState: 'active' as const,
      settlementState: 'unobserved' as const,
      invoiceState: 'current' as const,
      hasAdjustment: false,
      hadActiveFeature: true,
    };
    expect(deriveFacturaEFeatureDecision({ ...active, consentState: 'revoked' }))
      .toMatchObject({ publication: 'withdrawn', withdrawalReason: 'CONSENT_REVOKED' });
    expect(deriveFacturaEFeatureDecision({ ...active, settlementState: 'observed' }))
      .toMatchObject({ publication: 'withdrawn', withdrawalReason: 'SETTLEMENT_OBSERVED' });
    expect(deriveFacturaEFeatureDecision({ ...active, settlementState: 'disputed' }))
      .toMatchObject({ publication: 'withdrawn', withdrawalReason: 'DISPUTED' });
    expect(deriveFacturaEFeatureDecision({ ...active, invoiceState: 'expired' }))
      .toMatchObject({ publication: 'withdrawn', withdrawalReason: 'FEATURE_EXPIRED' });
    expect(deriveFacturaEFeatureDecision({ ...active, hasAdjustment: true }))
      .toMatchObject({ publication: 'withdrawn', withdrawalReason: 'VOIDED_OR_ADJUSTED' });
  });
});
