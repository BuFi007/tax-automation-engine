import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, X509Certificate } from 'node:crypto';

import * as forge from 'node-forge';

import { certificateMatchesPrivateKey } from './setup';

function selfSigned(privateKeyPem: string): X509Certificate {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  certificate.setSubject([{ name: 'commonName', value: 'key-match' }]);
  certificate.setIssuer([{ name: 'commonName', value: 'key-match' }]);
  certificate.sign(privateKey, forge.md.sha256.create());
  return new X509Certificate(forge.pki.certificateToPem(certificate));
}

function rsaPem(): string {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

describe('certificateMatchesPrivateKey (SPKI DER compare, replaces checkPrivateKey)', () => {
  test('accepts the certificate key and rejects a different key', () => {
    const key = rsaPem();
    const certificate = selfSigned(key);
    expect(certificateMatchesPrivateKey(certificate, key)).toBe(true);
    expect(certificateMatchesPrivateKey(certificate, rsaPem())).toBe(false);
  });
});
