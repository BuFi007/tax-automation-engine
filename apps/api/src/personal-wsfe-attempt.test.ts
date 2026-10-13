import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PersonalWsfeAttemptStore } from './personal-wsfe-attempt';

const directory = mkdtempSync(join(tmpdir(), 'bufi-personal-wsfe-'));
const path = join(directory, 'attempts.sqlite');
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const attempt = {
  invoiceId: '11111111-1111-4111-8111-111111111111',
  workspaceId: 'personal:22222222-2222-4222-8222-222222222222',
  environment: 'homologation' as const,
  connectionId: '77777777-7777-4777-8777-777777777777',
  invoiceUpdatedAt: '2026-07-11T12:00:00.000Z',
  issuerProfileRef: 'vault://issuer/personal-1',
  taxpayerReferenceHash: 'a'.repeat(64),
  representedCuitCommitment: 'f'.repeat(64),
  pointOfSale: 1,
  voucherNumber: '2',
  signerRequestId: '12345678901',
  idempotencyKey: '33333333-3333-4333-8333-333333333333',
  requestHash: 'b'.repeat(64),
};

describe('durable Personal WSFE attempt', () => {
  test('freezes one invoice, survives restart and rejects a competing voucher or changed retry', () => {
    expect(() => new PersonalWsfeAttemptStore(':memory:')).toThrow('PERSONAL_WSFE_DURABLE_DB_REQUIRED');
    const store = new PersonalWsfeAttemptStore(path);
    const first = store.freeze(attempt);
    expect(store.freeze(attempt)).toEqual(first);
    expect(() => store.freeze({ ...attempt, requestHash: 'c'.repeat(64) }))
      .toThrow('PERSONAL_WSFE_ATTEMPT_CONFLICT');
    expect(() => store.freeze({
      ...attempt, invoiceId: '44444444-4444-4444-8444-444444444444',
      signerRequestId: '12345678902', idempotencyKey: '55555555-5555-4555-8555-555555555555',
    })).toThrow('PERSONAL_WSFE_ATTEMPT_CONFLICT');
    expect(() => store.freeze({
      ...attempt, invoiceId: '44444444-4444-4444-8444-444444444444',
      issuerProfileRef: 'vault://issuer/another-profile-for-same-cuit',
      signerRequestId: '12345678902', idempotencyKey: '55555555-5555-4555-8555-555555555555',
    })).toThrow('PERSONAL_WSFE_ATTEMPT_CONFLICT');
    const reference = 'vault://wsfe/66666666-6666-4666-8666-666666666666';
    store.attachPayload(attempt.invoiceId, reference, 'd'.repeat(64));
    store.close();

    const restored = new PersonalWsfeAttemptStore(path);
    expect(restored.freeze(attempt).payloadReference).toBe(reference);
    expect(restored.attachPayload(attempt.invoiceId, reference, 'd'.repeat(64)).payloadHash).toBe('d'.repeat(64));
    expect(() => restored.attachPayload(attempt.invoiceId, reference, 'e'.repeat(64)))
      .toThrow('PERSONAL_WSFE_PAYLOAD_CONFLICT');
    restored.releaseRejectedVoucher(attempt.invoiceId);
    expect(restored.get(attempt.invoiceId)?.claimState).toBe('rejected');
    const corrected = restored.freeze({
      ...attempt, invoiceId: '44444444-4444-4444-8444-444444444444',
      signerRequestId: '12345678902', idempotencyKey: '55555555-5555-4555-8555-555555555555',
    });
    expect(corrected.claimState).toBe('active');
    expect(corrected.voucherNumber).toBe(attempt.voucherNumber);
    restored.close();
    expect(readFileSync(path).toString('utf8')).not.toContain('27300000008');
  });
});
