import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import {
  HUMAN_AUTH_CAPTURE_POLICY,
  HUMAN_AUTH_CAPTURE_POLICY_HASH,
  assertHumanAuthCompletion,
  assertSafeHumanAuthValue,
} from './human-auth';

const receipt = () => ({
  version: 'human-auth-completion-v1' as const,
  completionReceiptHash: createHash('sha256').update('signed-browser-completion').digest('hex'),
  capturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH,
  completedAt: '2026-07-16T15:00:00.000Z',
  signatureVerified: true as const,
});

describe('ARCA human_auth boundary', () => {
  test('pins the no-capture policy and accepts only a signed hash receipt', () => {
    expect(HUMAN_AUTH_CAPTURE_POLICY).toEqual({
      inspectCredentialDom: false,
      screenshots: false,
      clipboard: false,
      cookies: false,
      browserStorage: false,
      networkBodies: false,
      rawTraces: false,
    });
    expect(createHash('sha256').update(JSON.stringify(HUMAN_AUTH_CAPTURE_POLICY)).digest('hex')).toBe(HUMAN_AUTH_CAPTURE_POLICY_HASH);
    expect(() => assertHumanAuthCompletion(receipt())).not.toThrow();
  });

  test('rejects malformed, unsigned, and capture-policy-substituted receipts', () => {
    expect(() => assertHumanAuthCompletion({ ...receipt(), extra: true } as never)).toThrow('HUMAN_AUTH_MALFORMED_PAYLOAD');
    expect(() => assertHumanAuthCompletion({ ...receipt(), signatureVerified: false } as never)).toThrow('HUMAN_AUTH_COMPLETION_UNVERIFIED');
    expect(() => assertHumanAuthCompletion({ ...receipt(), capturePolicyHash: '0'.repeat(64) })).toThrow('HUMAN_AUTH_CAPTURE_POLICY_MISMATCH');
  });

  test('credential canary never survives schema, log, trace, or support-export validation', () => {
    const canary = 'spooky-credential-canary-7c31';
    for (const payload of [
      { password: canary },
      { clave_fiscal: canary },
      { otp: canary },
      { browser: { cookies: canary } },
      { raw_trace: [{ request: canary }] },
      { supportExport: `password=${canary}` },
      { networkLog: `Bearer ${canary.repeat(2)}` },
    ]) {
      let error = '';
      try { assertSafeHumanAuthValue(payload); } catch (caught) { error = String(caught); }
      expect(error).toMatch(/HUMAN_AUTH_(FIELD|SECRET)_/);
      expect(error).not.toContain(canary);
    }
  });
});
