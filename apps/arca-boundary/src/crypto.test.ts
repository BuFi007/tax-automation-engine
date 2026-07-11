import { describe, expect, test } from 'bun:test';

import { deriveDomainKey, openJson, sealJson } from './crypto';

describe('ARCA boundary envelope encryption', () => {
  test('authenticates both ciphertext and record binding', () => {
    const key = Buffer.alloc(32, 7);
    expect(deriveDomainKey(key, 'authority-payloads')).not.toEqual(deriveDomainKey(key, 'issuer-credentials'));
    const sealed = sealJson(key, 'payload:one', { secret: 'never-plaintext' });
    expect(sealed).not.toContain('never-plaintext');
    expect(openJson(key, 'payload:one', sealed)).toEqual({ secret: 'never-plaintext' });
    expect(() => openJson(key, 'payload:two', sealed)).toThrow('ARCA_BOUNDARY_CIPHERTEXT_AUTHENTICATION_FAILED');
    const parts = sealed.split('.');
    const ciphertext = Buffer.from(parts[3]!, 'base64url');
    ciphertext[0] = ciphertext[0]! ^ 1;
    const tampered = [parts[0], parts[1], parts[2], ciphertext.toString('base64url')].join('.');
    expect(() => openJson(key, 'payload:one', tampered)).toThrow('ARCA_BOUNDARY_CIPHERTEXT_AUTHENTICATION_FAILED');
  });
});
