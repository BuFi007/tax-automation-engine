import { describe, expect, test } from 'bun:test';

import { payloadTerminalReceiptSchema, ticketRequestSchema, ticketResponseSchema, wsaaServiceSchema } from './contracts';

describe('WSAA ticket service literal', () => {
  test('scopes tickets to the three ARCA services this broker fronts', () => {
    expect(wsaaServiceSchema.parse('wsfex')).toBe('wsfex');
    expect(wsaaServiceSchema.parse('wsfe')).toBe('wsfe');
    // Additive: the read-only Factura de Crédito lifecycle client obtains tickets
    // for ARCA service literal 'wsfecred' (WSFECRED manual v2.0.3 §2.3).
    expect(wsaaServiceSchema.parse('wsfecred')).toBe('wsfecred');
  });

  test('fails closed on any other service literal', () => {
    expect(() => wsaaServiceSchema.parse('wsfecredsca')).toThrow();
    expect(() => wsaaServiceSchema.parse('wsmtxca')).toThrow();
    expect(() => wsaaServiceSchema.parse('')).toThrow();
  });

  test('a wsfecred ticket request parses through the shared request schema', () => {
    expect(ticketRequestSchema.parse({
      version: 'wsaa-ticket-request-v1',
      service: 'wsfecred',
      environment: 'homologation',
      workspaceId: 'workspace-1',
      issuerProfileRef: 'issuer://workspace-1/primary',
    })).toEqual(expect.objectContaining({ service: 'wsfecred' }));
  });

  test('fails closed on a legacy ticket without represented-CUIT commitment', () => {
    const legacy = {
      token: 'ephemeral-token',
      sign: 'ephemeral-sign',
      representedCuit: '20123456786',
      expiresAt: '2026-07-11T20:00:00.000Z',
    };
    expect(() => ticketResponseSchema.parse(legacy)).toThrow();
    expect(ticketResponseSchema.parse({
      ...legacy,
      representedCuitCommitment: 'a'.repeat(64),
    }).representedCuitCommitment).toBe('a'.repeat(64));
  });

  test('binds a terminal receipt to both payload and official authority identity', () => {
    const receipt = {
      version: 'authority-payload-terminal-receipt-v1', referenceHash: 'a'.repeat(64),
      payloadHash: 'b'.repeat(64), authorityIdentityHash: 'c'.repeat(64),
      terminalState: 'officially_reconciled', retentionPolicyId: 'policy-v1',
      retireAfter: '2026-08-11T12:00:00.000Z', terminalEvidenceHash: 'd'.repeat(64),
    };
    expect(payloadTerminalReceiptSchema.parse(receipt).authorityIdentityHash).toBe('c'.repeat(64));
    const { authorityIdentityHash: _missing, ...unbound } = receipt;
    expect(() => payloadTerminalReceiptSchema.parse(unbound)).toThrow();
  });
});
