import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import { HttpFacturaEFeatureSigningGateway } from './factura-e-feature-signer';

const digest = 'a'.repeat(64);
const secret = 'signer-purpose-secret-that-is-at-least-thirty-two-bytes';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const signatureFor = (value: string) => sign(
  null,
  Buffer.from(value, 'hex'),
  privateKey
).toString('base64url');

describe('Factura E feature signing gateway', () => {
  test('sends only a digest to the configured Ed25519 signer and binds the receipt', async () => {
    let sent: Record<string, unknown> | null = null;
    const gateway = new HttpFacturaEFeatureSigningGateway(
      new URL('http://127.0.0.1:4400/v1/signatures/factura-e-feature'),
      'tax-feature-key-2026-01',
      secret,
      publicKeyPem,
      (async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        expect(init?.headers).toMatchObject({
          'content-type': 'application/json',
        });
        expect((init?.headers as Record<string, string>)['x-tax-feature-request-signature'])
          .toMatch(/^[a-f0-9]{64}$/);
        expect(init?.redirect).toBe('error');
        return Response.json({
          version: 'factura-e-feature-signature-receipt-v1',
          digestHex: digest,
          keyVersion: 'tax-feature-key-2026-01',
          algorithm: 'Ed25519',
          signature: signatureFor(digest),
        });
      })
    );
    expect(await gateway.signDigest(digest)).toBe(signatureFor(digest));
    expect(sent).toMatchObject({ digestHex: digest, algorithm: 'Ed25519' });
    expect(JSON.stringify(sent).toLowerCase()).not.toContain('privatekey');
  });

  test('rejects mismatched, oversized, insecure-production and partial configuration', async () => {
    const mismatched = new HttpFacturaEFeatureSigningGateway(
      new URL('http://127.0.0.1:4400/v1/signatures/factura-e-feature'),
      'tax-feature-key-2026-01',
      secret,
      publicKeyPem,
      (async () => Response.json({
        version: 'factura-e-feature-signature-receipt-v1',
        digestHex: 'b'.repeat(64),
        keyVersion: 'tax-feature-key-2026-01',
        algorithm: 'Ed25519',
        signature: signatureFor(digest),
      }))
    );
    await expect(mismatched.signDigest(digest))
      .rejects.toThrow('TAX_FACTURA_E_FEATURE_SIGNER_RECEIPT_MISMATCH');

    const oversized = new HttpFacturaEFeatureSigningGateway(
      new URL('http://127.0.0.1:4400/v1/signatures/factura-e-feature'),
      'tax-feature-key-2026-01',
      secret,
      publicKeyPem,
      async () => new Response('{}', { headers: { 'content-length': '99999' } })
    );
    await expect(oversized.signDigest(digest))
      .rejects.toThrow('TAX_FACTURA_E_FEATURE_SIGNER_RESPONSE_TOO_LARGE');

    const streamedOversized = new HttpFacturaEFeatureSigningGateway(
      new URL('http://127.0.0.1:4400/v1/signatures/factura-e-feature'),
      'tax-feature-key-2026-01',
      secret,
      publicKeyPem,
      async () => new Response('x'.repeat(16 * 1024 + 1))
    );
    await expect(streamedOversized.signDigest(digest))
      .rejects.toThrow('TAX_FACTURA_E_FEATURE_SIGNER_RESPONSE_TOO_LARGE');

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new HttpFacturaEFeatureSigningGateway(
        new URL('http://127.0.0.1:4400/sign'),
        'tax-feature-key-2026-01',
        secret,
        publicKeyPem
      )).toThrow('TAX_FACTURA_E_FEATURE_SIGNER_HTTPS_REQUIRED');
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  test('verifies the returned Ed25519 signature against the pinned key and origin', async () => {
    const otherPrivateKey = generateKeyPairSync('ed25519').privateKey;
    const invalidSignature = sign(
      null,
      Buffer.from(digest, 'hex'),
      otherPrivateKey
    ).toString('base64url');
    const invalid = new HttpFacturaEFeatureSigningGateway(
      new URL('http://127.0.0.1:4400/v1/signatures/factura-e-feature'),
      'tax-feature-key-2026-01',
      secret,
      publicKeyPem,
      async () => Response.json({
        version: 'factura-e-feature-signature-receipt-v1',
        digestHex: digest,
        keyVersion: 'tax-feature-key-2026-01',
        algorithm: 'Ed25519',
        signature: invalidSignature,
      })
    );
    await expect(invalid.signDigest(digest))
      .rejects.toThrow('TAX_FACTURA_E_FEATURE_SIGNER_SIGNATURE_INVALID');

    const crossOrigin = new HttpFacturaEFeatureSigningGateway(
      new URL('http://127.0.0.1:4400/v1/signatures/factura-e-feature'),
      'tax-feature-key-2026-01',
      secret,
      publicKeyPem,
      async () => {
        const response = Response.json({
          version: 'factura-e-feature-signature-receipt-v1',
          digestHex: digest,
          keyVersion: 'tax-feature-key-2026-01',
          algorithm: 'Ed25519',
          signature: signatureFor(digest),
        });
        Object.defineProperty(response, 'url', { value: 'https://attacker.invalid/sign' });
        return response;
      }
    );
    await expect(crossOrigin.signDigest(digest))
      .rejects.toThrow('TAX_FACTURA_E_FEATURE_SIGNER_RESPONSE_ORIGIN_MISMATCH');
  });

  test('never accepts private signing material as the pinned verifier key', () => {
    const privateKeyPem = privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }).toString();

    expect(() => new HttpFacturaEFeatureSigningGateway(
      new URL('http://127.0.0.1:4400/v1/signatures/factura-e-feature'),
      'tax-feature-key-2026-01',
      secret,
      privateKeyPem
    )).toThrow('TAX_FACTURA_E_FEATURE_SIGNER_PUBLIC_KEY_INVALID');
  });
});
