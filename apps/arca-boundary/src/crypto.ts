import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const VERSION = 'v1';

export function loadMasterKey(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = environment.ARCA_BOUNDARY_MASTER_KEY_FILE
    ? readFileSync(environment.ARCA_BOUNDARY_MASTER_KEY_FILE, 'utf8').trim()
    : environment.ARCA_BOUNDARY_MASTER_KEY?.trim();
  if (!encoded) throw new Error('ARCA_BOUNDARY_MASTER_KEY_REQUIRED');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('ARCA_BOUNDARY_MASTER_KEY_INVALID');
  return key;
}

export function sealJson(masterKey: Buffer, aad: string, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function deriveDomainKey(masterKey: Buffer, domain: 'authority-payloads' | 'issuer-credentials'): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('motora-arca-boundary-v1'), Buffer.from(domain), 32));
}

export function openJson(masterKey: Buffer, aad: string, sealed: string): unknown {
  const [version, ivText, tagText, ciphertextText, extra] = sealed.split('.');
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra !== undefined) throw new Error('ARCA_BOUNDARY_CIPHERTEXT_INVALID');
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivText, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new Error('ARCA_BOUNDARY_CIPHERTEXT_AUTHENTICATION_FAILED');
  }
}

export function fingerprintDer(derBytes: string): string {
  return createHash('sha256').update(Buffer.from(derBytes, 'binary')).digest('hex');
}

export function safeTokenEqual(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}
