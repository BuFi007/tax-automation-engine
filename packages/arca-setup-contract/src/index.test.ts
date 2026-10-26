import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import {
  canonicalHash,
  mintArcaSetupHandoffTicket,
  signArcaSetupMessage,
  verifyArcaSetupHandoffTicket,
  verifyArcaSetupMessage,
} from './index';

const SECRET = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

describe('ARCA setup wire contract', () => {
  test('a signature binds the purpose, the body and a fresh timestamp', async () => {
    const now = new Date('2026-10-26T12:00:00.000Z');
    const headers = new Headers(await signArcaSetupMessage(SECRET, 'receipt', '{"a":1}', now));
    await verifyArcaSetupMessage(SECRET, 'receipt', headers, '{"a":1}', now);
    await expect(verifyArcaSetupMessage(SECRET, 'order', headers, '{"a":1}', now)).rejects.toThrow('ARCA_SETUP_SIGNATURE_INVALID');
    await expect(verifyArcaSetupMessage(SECRET, 'receipt', headers, '{"a":2}', now)).rejects.toThrow('ARCA_SETUP_SIGNATURE_INVALID');
    await expect(verifyArcaSetupMessage(OTHER, 'receipt', headers, '{"a":1}', now)).rejects.toThrow('ARCA_SETUP_SIGNATURE_INVALID');
    await expect(verifyArcaSetupMessage(SECRET, 'receipt', headers, '{"a":1}', new Date(now.getTime() + 600_000)))
      .rejects.toThrow('ARCA_SETUP_SIGNATURE_INVALID');
  });

  test('a handoff ticket is short-lived and bound to one execution and actor', async () => {
    const now = new Date('2026-10-26T12:00:00.000Z');
    const minted = await mintArcaSetupHandoffTicket(SECRET, {
      executionId: '22222222-2222-4222-8222-222222222222', actorId: 'user-1', purpose: 'customer_authentication',
    }, now);
    const claims = await verifyArcaSetupHandoffTicket(SECRET, minted.ticket, now);
    expect(claims).toMatchObject({ executionId: '22222222-2222-4222-8222-222222222222', actorId: 'user-1' });
    await expect(verifyArcaSetupHandoffTicket(SECRET, minted.ticket, new Date(now.getTime() + 121_000))).rejects.toThrow('ARCA_SETUP_HANDOFF_TICKET_EXPIRED');
    await expect(verifyArcaSetupHandoffTicket(OTHER, minted.ticket, now)).rejects.toThrow('ARCA_SETUP_HANDOFF_TICKET_INVALID');
    const [encoded, signature] = minted.ticket.split('.');
    const tampered = `${encoded!.slice(0, -2)}xx.${signature}`;
    await expect(verifyArcaSetupHandoffTicket(SECRET, tampered, now)).rejects.toThrow('ARCA_SETUP_HANDOFF_TICKET_INVALID');
  });

  test('canonical hashes match the core implementation', async () => {
    const value = { b: [3, { y: 1, x: 2 }], a: 'z' };
    expect(await canonicalHash(value)).toBe(hashCanonical(value));
  });
});
