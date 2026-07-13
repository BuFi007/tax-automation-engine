import { describe, expect, test } from 'bun:test';

import { ticketRequestSchema, wsaaServiceSchema } from './contracts';

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
});
