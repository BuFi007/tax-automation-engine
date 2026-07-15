import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import {
  hashTaxFacturaEFeatureHeadV1,
  parseTaxFacturaEFeatureHeadV1,
  parseUnsignedTaxFacturaEFeatureHeadV1,
  signTaxFacturaEFeatureHeadV1,
  verifyTaxFacturaEFeatureHeadV1Signature,
} from './factura-e-feature-head';

function unsigned() {
  return {
    version: 'factura-e-feature-head-v1',
    schemaVersion: 'factura-e-feature-head-v1',
    featureId: '22222222-2222-4222-8222-222222222222',
    featureHash: '12550849f43e70c13b491feb161f256b28d47603ecb7ce09c23f0289dd00a9e6',
    workspaceCommitment: 'a'.repeat(64),
    invoiceCommitment: 'b'.repeat(64),
    featureLifecycle: 'active',
    eligibleCurrentUnpaid: true,
    officialIssuanceReconciled: true,
    undisputed: true,
    consentVersion: 'factoring-consent-v1',
    consentState: 'active',
    featureRevision: 1,
    previousFeatureHash: null,
    featureValidUntil: '2026-07-15T18:04:00.000Z',
    settlementObservationState: 'unobserved',
    evidenceHeadRef: `hmac-sha256:v1:${'e'.repeat(64)}`,
    headRevision: 11,
    observedAt: '2026-07-15T17:59:55.000Z',
    keyVersion: 'tax-feature-fixture-key-v1',
    restrictedAuthority: {
      scheme: 'BUFI_ARCA_FACTURA_E_AUTHORITY_INVOICE_ID_V1',
      authorityId: 'c'.repeat(64),
      evidenceCommitment: 'd'.repeat(64),
    },
  };
}

describe('Tax Factura E restricted feature head', () => {
  test('matches the standalone CRE canonical golden vector exactly', () => {
    const parsed = parseUnsignedTaxFacturaEFeatureHeadV1(unsigned());
    expect(hashTaxFacturaEFeatureHeadV1(parsed))
      .toBe('0afa002ed5d86d988af3b849c296a26793858c952d218f8bc20b887bca39d9f6');
  });

  test('signs and verifies a current strict head through the external gateway', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const head = await signTaxFacturaEFeatureHeadV1(unsigned(), {
      keyVersion: 'tax-feature-fixture-key-v1',
      async signDigest(digestHex) {
        return sign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('base64url');
      },
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyTaxFacturaEFeatureHeadV1Signature(
      head,
      publicKeyPem,
      new Date('2026-07-15T18:00:00.000Z')
    )).toEqual(head);
    expect(() => parseTaxFacturaEFeatureHeadV1({ ...head, amount: '1000' })).toThrow();
  });

  test('rejects stale heads, broken feature chains, and key mismatches', async () => {
    expect(() => parseUnsignedTaxFacturaEFeatureHeadV1({
      ...unsigned(),
      featureRevision: 2,
      previousFeatureHash: null,
    })).toThrow();
    await expect(signTaxFacturaEFeatureHeadV1(unsigned(), {
      keyVersion: 'wrong-key',
      async signDigest() {
        throw new Error('must not sign');
      },
    })).rejects.toThrow('FACTURA_E_FEATURE_HEAD_SIGNING_KEY_VERSION_MISMATCH');
  });
});
