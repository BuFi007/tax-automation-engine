import { describe, expect, test } from 'bun:test';

import {
  ContabiliumClientCredentialsTokenSource,
  ContabiliumRestSandboxProvider,
  ContabiliumSandboxProvider,
  contabiliumAccountCommitment,
  type ContabiliumTokenSource,
} from './contabilium';

describe('Contabilium conformance boundary', () => {
  test('makes no production capability claim without an authorized sandbox', async () => {
    const provider = new ContabiliumSandboxProvider(null);
    const capabilities = await provider.getImportCapabilities('tenant:unconfigured');
    expect(capabilities).toHaveLength(7);
    expect(capabilities.every(capability => capability.state === 'sandbox_required')).toBe(true);
    const page = await provider.readInvoicesPage({ tenantId: 'tenant:unconfigured', cursor: null, limit: 50 });
    expect(page.records).toEqual([]);
    expect(page.capability.safeErrorCode).toBe('AUTHORIZED_SANDBOX_REQUIRED');
  });

  test('binds a real REST read to one approved sandbox account and normalizes fiscal invoices without inferring settlement', async () => {
    const requests: string[] = [];
    const provider = new ContabiliumRestSandboxProvider({
      tenantId: 'tenant:accountant-client-a',
      expectedAccountCommitment: contabiliumAccountCommitment({ accountId: 807, cuit: '30-70895184-2' }),
      sandboxEvidenceHash: hash('approved-contabilium-sandbox'),
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    }, fixedToken(), async input => {
      const url = new URL(String(input));
      requests.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/api/usuarios/obtenerinfo') {
        return Response.json({ IDUsuario: 807, CUIT: '30708951842' });
      }
      if (url.pathname === '/api/comprobantes/search') {
        expect(url.searchParams.get('page')).toBe('1');
        expect(url.searchParams.get('fechaDesde')).toBe('2026-01-01');
        return Response.json({ Items: [{ Id: 101 }, { Id: 102 }], TotalPage: 2, TotalItems: 2 });
      }
      if (url.pathname === '/api/comprobantes/' && url.searchParams.get('id') === '101') {
        return Response.json(invoice({ id: 101, cae: '76123456789012', total: '1.234,50', number: '0002-00000001' }));
      }
      if (url.pathname === '/api/comprobantes/' && url.searchParams.get('id') === '102') {
        return Response.json(invoice({ id: 102, cae: null, total: '500,00', number: '0002-00000002' }));
      }
      if (url.pathname === '/api/monedas/search') {
        return Response.json([{ IDMoneda: 42508, DescripcionMoneda: 'Pesos Argentinos', CodigoMoneda: '$', Activa: true }]);
      }
      return new Response(null, { status: 404 });
    }, () => new Date('2026-07-16T12:00:00.000Z'));

    const capabilities = await provider.getImportCapabilities('tenant:accountant-client-a');
    expect(capabilities.find(item => item.id === 'invoices')?.state).toBe('available');
    expect(capabilities.find(item => item.id === 'payments')?.state).toBe('unsupported');
    expect(capabilities.find(item => item.id === 'reconciliation')?.state).toBe('partial');

    const first = await provider.readInvoicesPage({ tenantId: 'tenant:accountant-client-a', cursor: null, limit: 1 });
    expect(first.nextCursor).toEqual({ value: 'p:1:o:1', version: 'v1' });
    expect(first.records).toEqual([expect.objectContaining({
      externalId: 'contabilium:invoice:101',
      number: '0002-00000001',
      settledAt: null,
      total: { decimal: '1234.5', currency: 'ARS' },
      taxDocumentExternalIds: ['contabilium:tax-document:101'],
    })]);
    expect(first.records[0]?.taxLines[0]).toEqual(expect.objectContaining({
      taxType: 'PercepcionIIBB CABA',
      rateDecimal: '0.03',
      amount: { decimal: '37.035', currency: 'ARS' },
    }));

    const second = await provider.readInvoicesPage({ tenantId: 'tenant:accountant-client-a', cursor: first.nextCursor!.value, limit: 1 });
    expect(second.nextCursor).toBeNull();
    expect(second.records[0]?.externalId).toBe('contabilium:invoice:102');
    expect(requests.filter(request => request === '/api/usuarios/obtenerinfo')).toHaveLength(1);

    const fiscal = await provider.readTaxDocumentsPage({ tenantId: 'tenant:accountant-client-a', cursor: null, limit: 2 });
    expect(fiscal.records).toHaveLength(1);
    expect(fiscal.records[0]).toEqual(expect.objectContaining({
      externalId: 'contabilium:tax-document:101',
      documentType: 'FCE',
      pointOfSale: '0002',
      relatedDocumentExternalIds: ['contabilium:invoice:99'],
    }));
    expect(fiscal.records[0]?.caeReferenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(fiscal)).not.toContain('76123456789012');

    const unsupported = await provider.readPaymentsPage({ tenantId: 'tenant:accountant-client-a', cursor: null, limit: 50 });
    expect(unsupported.records).toEqual([]);
    expect(unsupported.capability).toEqual({
      id: 'payments',
      state: 'unsupported',
      safeErrorCode: 'CONTABILIUM_PAYMENT_ENUMERATION_NOT_DOCUMENTED',
    });
  });

  test('fails closed for a different workspace or provider account', async () => {
    const provider = new ContabiliumRestSandboxProvider({
      tenantId: 'tenant:a',
      expectedAccountCommitment: contabiliumAccountCommitment({ accountId: 807, cuit: '30708951842' }),
      sandboxEvidenceHash: hash('sandbox'),
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    }, fixedToken(), async () => Response.json({ IDUsuario: 999, CUIT: '30708951842' }));

    await expect(provider.getImportCapabilities('tenant:b')).rejects.toThrow('TENANT_SCOPE_MISMATCH');
    await expect(provider.getImportCapabilities('tenant:a')).rejects.toThrow('CONTABILIUM_ACCOUNT_BINDING_MISMATCH');
  });

  test('fails closed on provider rate limits and transport timeouts', async () => {
    const config = {
      tenantId: 'tenant:a',
      expectedAccountCommitment: contabiliumAccountCommitment({ accountId: 807, cuit: '30708951842' }),
      sandboxEvidenceHash: hash('sandbox'),
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    };
    const rateLimited = new ContabiliumRestSandboxProvider(
      config,
      fixedToken(),
      async () => new Response(null, { status: 429 }),
    );
    await expect(rateLimited.getImportCapabilities('tenant:a'))
      .rejects.toThrow('CONTABILIUM_API_REJECTED_429');

    const timedOut = new ContabiliumRestSandboxProvider(
      config,
      fixedToken(),
      async () => { throw new DOMException('timeout', 'TimeoutError'); },
    );
    await expect(timedOut.getImportCapabilities('tenant:a'))
      .rejects.toThrow('CONTABILIUM_TRANSPORT_FAILED');
  });

  test('obtains and caches a bounded client-credentials token without exposing credentials', async () => {
    let calls = 0;
    const source = new ContabiliumClientCredentialsTokenSource({
      clientId: 'account@example.test',
      clientSecret: 'server-only-api-key',
    }, async (input, init) => {
      calls += 1;
      expect(String(input)).toBe('https://rest.contabilium.com/token');
      expect(init?.redirect).toBe('error');
      const body = init?.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('client_credentials');
      expect(body.get('client_id')).toBe('account@example.test');
      expect(body.get('client_secret')).toBe('server-only-api-key');
      return Response.json({ access_token: 'ephemeral-access-token', expires_in: 3600 });
    }, () => new Date('2026-07-16T12:00:00.000Z'));

    expect(await source.getAccessToken()).toBe('ephemeral-access-token');
    expect(await source.getAccessToken()).toBe('ephemeral-access-token');
    expect(calls).toBe(1);
    expect(JSON.stringify(source)).not.toContain('server-only-api-key');
  });
});

function fixedToken(): ContabiliumTokenSource {
  return { getAccessToken: async () => 'ephemeral-token' };
}

function hash(value: string): string {
  return Bun.CryptoHasher.hash('sha256', value, 'hex');
}

function invoice(input: Readonly<{ id: number; cae: string | null; total: string; number: string }>) {
  return {
    Id: input.id,
    IdComprobanteAsociado: 99,
    IdCliente: 501,
    FechaEmision: '2026-07-15T00:00:00',
    FechaVencimiento: '2026-08-15T00:00:00',
    Numero: input.number,
    TipoFc: input.cae ? 'FCE' : 'COT',
    Cae: input.cae,
    ImporteTotalNeto: input.total,
    IDMoneda: 42508,
    Pagos: [{ ID: 7001 }],
    Tributos: [{ Id: 44, Tipo: 2, Descripcion: 'PercepcionIIBB CABA', Alicuota: 3, Importe: 37.035 }],
  };
}
