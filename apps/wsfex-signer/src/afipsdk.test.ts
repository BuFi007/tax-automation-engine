import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCanonical } from '@tax-engine/core';

import { AfipSdkWsfexClient, type AfipSdkIssuer } from './afipsdk';
import { WsfexAmbiguousTransportError } from './soap';
import { WsfexSignerService } from './service';
import { SignerAttemptStore } from './store';
import { payload, request } from './test-fixtures';

const scope = { environment: 'homologation' as const, workspaceId: 'workspace-1', issuerProfileRef: payload().issuerProfileRef };
const issuer: AfipSdkIssuer = { ...scope, representedCuit: '20123456786', representedCuitCommitment: payload().representedCuitCommitment, active: true, delegationConfirmed: true };
const auth = { token: 'private-token', sign: 'private-sign', expiration: '2099-01-01T00:00:00.000Z' };
const accepted = { Id: '101', Cbte_tipo: 19, Punto_vta: 4, Cbte_nro: '6', Fch_cbte: '20260711', Resultado: 'A', Cae: '12345678901234', Fch_venc_Cae: '20260721', Reproceso: 'N' };
const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('AFIP SDK WSFEX HTTPS adapter', () => {
  test('uses a boundary ticket for SDK methods without sending the certificate or key', async () => {
    const calls: string[] = [];
    const broker = {
      getTicket: async () => ({ token: auth.token, sign: auth.sign,
        expiresAt: auth.expiration, representedCuit: issuer.representedCuit,
        representedCuitCommitment: issuer.representedCuitCommitment }),
      health: async () => ({ certificateDelegationConfigured: true, wsaaReady: true }),
    };
    const client = new AfipSdkWsfexClient({ accessToken: 'provider-token', environment: 'homologation' },
      null, async (url, init) => {
        calls.push(String(url));
        const body = JSON.parse(String(init?.body));
        expect(body).not.toHaveProperty('cert');
        expect(body).not.toHaveProperty('key');
        expect(body.params.Auth).toMatchObject({ Token: auth.token, Sign: auth.sign,
          Cuit: issuer.representedCuit });
        return Response.json({ FEXGetLast_IDResult: { FEXResultGet: { Id: 101 } } });
      }, broker);
    const ticket = await client.getTicket(scope);
    expect(await client.getLastRequestId(ticket)).toBe('101');
    expect(calls).toEqual(['https://app.afipsdk.com/api/v1/afip/requests']);
    expect(await client.health('homologation')).toEqual({ certificateDelegationConfigured: true,
      wsaaReady: true });
  });
  test('rejects private key material from issuer resolution before provider access', async () => {
    const credentials = { certificatePem: 'test-certificate', privateKeyPem: 'test-private-key' };
    let calls = 0;
    const client = new AfipSdkWsfexClient({ accessToken: 'provider-token', environment: 'homologation' },
      async () => ({ ...issuer, credentials }), async (_url, init) => {
        calls++;
        return Response.json(auth);
      });
    await expect(client.getTicket(scope)).rejects.toThrow();
    expect(calls).toBe(0);
    const missing = new AfipSdkWsfexClient({ accessToken: 'provider-token', environment: 'homologation' },
      async () => issuer, async () => Response.json({ data_errors: {
        cert: 'El campo Certificado es obligatorio', key: 'El campo Key es obligatorio',
      } }, { status: 400 }));
    await expect(missing.getTicket(scope)).rejects.toThrow('AFIPSDK_ISSUER_CERTIFICATE_CONFIGURATION_REQUIRED');
  });
  test('binds auth to a trusted issuer and sends complete JSON without local credentials', async () => {
    const bodies: any[] = [];
    const client = new AfipSdkWsfexClient({ accessToken: 'provider-token', environment: 'homologation' }, async () => issuer, async (url, init) => {
      expect(init?.redirect).toBe('manual');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer provider-token');
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      expect(String(url)).toBe(`https://app.afipsdk.com/api/v1/afip/${bodies.length === 1 ? 'auth' : 'requests'}`);
      return Response.json(bodies.length === 1 ? auth : { FEXAuthorizeResult: { FEXResultAuth: accepted } });
    });
    const ticket = await client.getTicket(scope);
    expect(bodies[0]).toEqual({ environment: 'dev', wsid: 'wsfex', tax_id: issuer.representedCuit });
    expect(Object.isFrozen(ticket)).toBe(true);
    expect(await client.authorize(ticket, payload())).toMatchObject({ status: 'accepted', invoiceNumber: '6', cae: accepted.Cae });
    expect(bodies[1]).toMatchObject({ environment: 'dev', wsid: 'wsfex', method: 'FEXAuthorize', params: {
      Auth: { Token: auth.token, Sign: auth.sign, Cuit: issuer.representedCuit },
      Cmp: { Id: '101', Permiso_existente: '', CanMisMonExt: 'S', Fecha_pago: '20260711', Moneda_ctz: '1200.25', Imp_total: '1000.00', Items: { Item: [{ Pro_ds: 'Software services', Pro_total_item: '1000.00' }] } },
    } });
    await client.authorize(ticket, payload({ sameCurrencyPayment: false }));
    expect(bodies[2].params.Cmp.CanMisMonExt).toBe('N');
    await expect(client.authorize({ ...ticket }, payload())).rejects.toThrow('AFIPSDK_TICKET_BINDING_MISMATCH');
    await expect(client.authorize(ticket, payload({ representedCuitCommitment: 'f'.repeat(64) }))).rejects.toThrow('AFIPSDK_PAYLOAD_ISSUER_MISMATCH');
    expect(bodies).toHaveLength(3);
  });

  test('rejects cross-workspace/environment and revoked issuer bindings before network access', async () => {
    let calls = 0;
    for (const other of [{ ...issuer, workspaceId: 'other' }, { ...issuer, active: false }, { ...issuer, delegationConfirmed: false }]) {
      const client = new AfipSdkWsfexClient({ accessToken: 'token', environment: 'homologation' }, async () => other as AfipSdkIssuer, async () => { calls++; return Response.json(auth); });
      await expect(client.getTicket(scope)).rejects.toThrow();
      await expect(client.getTicket({ ...scope, environment: 'production' })).rejects.toThrow('AFIPSDK_ENVIRONMENT_MISMATCH');
    }
    expect(calls).toBe(0);
  });

  test('normalizes sequence, point-of-sale, quotes, absence and credit-note associations', async () => {
    const calls: any[] = [];
    const client = new AfipSdkWsfexClient({ accessToken: 'token', environment: 'production' }, async s => ({ ...issuer, ...s }), async (_url, init) => {
      const b = JSON.parse(String(init?.body)); calls.push(b);
      if (!b.method) return Response.json(auth);
      const results: Record<string, unknown> = {
        FEXGetLast_ID: { FEXResultGet: { Id: 100 } },
        FEXGetLast_CMP: { FEXResult_LastCMP: { Cbte_nro: 5 } },
        FEXGetPARAM_PtoVenta: { FEXResultGet: { ClsFEXResponse_PtoVenta: [{ Pve_Nro: 4, Pve_Bloqueado: 'N' }, { Pve_Nro: 9, Pve_Bloqueado: 'S' }] } },
        FEXGetPARAM_Ctz: { FEXResultGet: { Mon_Id: 'DOL', Mon_ctz: '1200.25', Mon_fecha: '20260710' } },
        FEXGetCMP: { FEXErr: { ErrCode: 1020 } },
        FEXAuthorize: { FEXResultAuth: { ...accepted, Cbte_tipo: 21 } },
      };
      return Response.json({ [`${b.method}Result`]: results[b.method] });
    });
    const ticket = await client.getTicket({ ...scope, environment: 'production' });
    expect(await client.getLastRequestId(ticket)).toBe('100');
    expect(await client.getLastInvoiceNumber(ticket, 19, 4)).toBe('5');
    expect(await client.getPointsOfSale(ticket)).toMatchObject({ activePoints: [4] });
    await expect(client.assertPointOfSaleActive(ticket, 9)).rejects.toThrow('WSFEX_POINT_OF_SALE_NOT_ACTIVE');
    expect(await client.getCotizacion(ticket, 'DOL')).toEqual({ monId: 'DOL', ctz: '1200.25', date: '2026-07-10' });
    expect(await client.getDocument(ticket, 19, 4, '6')).toBeNull();
    await client.authorize(ticket, payload({ documentType: 21, sameCurrencyPayment: null, paymentDate: null, associatedDocument: { documentType: 19, pointOfSale: 4, invoiceNumber: '5' } }));
    expect(calls[2].params.Auth).toMatchObject({ Pto_venta: 4, Cbte_Tipo: 19 });
    expect(calls.every(c => c.environment === 'prod')).toBe(true);
    const cmp = calls.at(-1).params.Cmp;
    expect(cmp).not.toHaveProperty('CanMisMonExt');
    expect(cmp).not.toHaveProperty('Fecha_pago');
    expect(cmp.Cmps_asoc.Cmp_asoc).toEqual([{ Cbte_tipo: 19, Cbte_punto_vta: 4, Cbte_nro: '5', Cbte_cuit: issuer.representedCuit }]);
  });

  test('keeps uncertain HTTP, malformed and incomplete accepted responses ambiguous without leaking bodies', async () => {
    for (const response of [() => { throw new Error('secret'); }, () => new Response('secret', { status: 503 }), () => new Response('secret', { status: 400 }), () => new Response('{'), () => Response.json({}), () => Response.json({ FEXAuthorizeResult: { FEXResultAuth: { ...accepted, Cae: null } } }), () => Response.json({ FEXAuthorizeResult: { FEXResultAuth: { ...accepted, Cuit: '20409378472' } } }), () => Response.json({ FEXAuthorizeResult: { FEXResultAuth: { ...accepted, Resultado: '?' } } }), () => new Response('oversized', { headers: { 'content-length': '3000000' } })]) {
      const client = new AfipSdkWsfexClient({ accessToken: 'token', environment: 'homologation' }, async () => issuer, async url => String(url).endsWith('/auth') ? Response.json(auth) : response());
      const ticket = await client.getTicket(scope);
      try { await client.authorize(ticket, payload()); throw new Error('expected failure'); }
      catch (e) { expect(e).toBeInstanceOf(WsfexAmbiguousTransportError); expect(JSON.stringify(e)).not.toContain('secret'); }
    }
  });

  test('checks ticket expiry and health using an explicit issuer without claiming readiness from configuration', async () => {
    const client = new AfipSdkWsfexClient({ accessToken: 'token', environment: 'homologation', healthIssuer: scope }, async () => issuer, async () => Response.json({ ...auth, expiration: '2000-01-01T00:00:00.000Z' }));
    await expect(client.getTicket(scope)).rejects.toThrow('AFIPSDK_TICKET_EXPIRED');
    expect(await client.health('homologation')).toEqual({ certificateDelegationConfigured: false, wsaaReady: false });
  });

  test('persists an ambiguous submit, recovers by exact lookup after restart, and never resubmits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'afipsdk-test-')); paths.push(dir);
    const methods: string[] = [];
    let visible = false;
    let wrongCustomer = false;
    let cmp: any;
    const makeClient = () => new AfipSdkWsfexClient({ accessToken: 'token', environment: 'homologation' }, async () => issuer, async (url, init) => {
      if (String(url).endsWith('/auth')) return Response.json(auth);
      const b = JSON.parse(String(init?.body)); methods.push(b.method);
      if (b.method === 'FEXAuthorize') { cmp = b.params.Cmp; throw new Error('connection lost after commit'); }
      if (b.method === 'FEXGetCMP') {
        if (!visible) return new Response('unavailable', { status: 503 });
        return Response.json({ FEXGetCMPResult: { FEXResultGet: { ...cmp, Cliente: wrongCustomer ? 'Different customer' : cmp.Cliente, Cbte_tipo: cmp.Cbte_Tipo, Resultado: 'A', Cae: accepted.Cae, Fch_venc_Cae: '20260721' } } });
      }
      const results: Record<string, unknown> = {
        FEXGetLast_ID: { FEXResultGet: { Id: 100 } }, FEXGetLast_CMP: { FEXResult_LastCMP: { Cbte_nro: 5 } },
        FEXGetPARAM_PtoVenta: { FEXResultGet: { ClsFEXResponse_PtoVenta: { Pve_Nro: 4, Pve_Bloqueado: 'N' } } },
        FEXGetPARAM_Ctz: { FEXResultGet: { Mon_Id: 'DOL', Mon_ctz: '1200.25', Mon_fecha: '20260710' } },
      };
      return Response.json({ [`${b.method}Result`]: results[b.method] });
    });
    const vault = { resolve: async () => ({ payload: payload(), payloadHash: hashCanonical(payload()) }) };
    const makeService = () => {
      const client = makeClient();
      return new WsfexSignerService({ environment: 'homologation', signerVersion: 'test', sequenceReservationsRequired: true }, new SignerAttemptStore(join(dir, 'attempts.sqlite')), vault, client, client);
    };
    const first = makeService();
    await first.reserveSequence({ version: 'tax-wsfex-sequence-reservation-request-v1', workspaceId: scope.workspaceId, issuerProfileRef: scope.issuerProfileRef, runId: request().runId, intentHash: request().intentHash, subjectId: request().subjectId, documentType: 19, pointOfSale: 4, idempotencyKey: 'reserve-sdk-test-001' }, '2026-07-11T10:00:00.000Z');
    expect((await first.authorize(request(), '101', '2026-07-11T10:01:00.000Z')).status).toBe('ambiguous');
    visible = true;
    const restarted = makeService();
    expect((await restarted.recover(request(), '101', '2026-07-11T10:02:00.000Z')).status).toBe('accepted');
    wrongCustomer = true;
    await expect(restarted.reconcile(request(), '101', '2026-07-11T10:02:30.000Z')).rejects.toThrow('WSFEX_RECOVERED_DOCUMENT_MISMATCH');
    wrongCustomer = false;
    expect((await restarted.reconcile(request(), '101', '2026-07-11T10:03:00.000Z')).reconciliation?.source).toBe('FEXGetCMP');
    expect(methods.filter(m => m === 'FEXAuthorize')).toHaveLength(1);
    expect(methods.filter(m => m === 'FEXGetCMP')).toHaveLength(4);
  });
});

test('refuses an AFIP SDK auth redirect as the transport-ambiguous outcome, not an HTTP status', async () => {
  const client = new AfipSdkWsfexClient({ accessToken: 'provider-token', environment: 'homologation' }, async () => issuer, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  const error = await client.getTicket(scope).catch(caught => caught);
  expect(error).toBeInstanceOf(WsfexAmbiguousTransportError);
  expect(error.receiptHash).toBe(hashCanonical({ endpoint: 'auth', outcome: 'transport_ambiguous' }));
});
