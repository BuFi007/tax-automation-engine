import { expect, test } from 'bun:test';

import { AfipSdkWsfeClient } from './afipsdk';
import { payload } from './test-fixtures';
import { WsfeAmbiguousTransportError, type WsfeAuthorityClient } from './soap';

const ticket = {
  token: 'ephemeral-token', sign: 'ephemeral-sign', representedCuit: '20123456786',
  representedCuitCommitment: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00.000Z',
};
const config = { accessToken: 'sdk-token', environment: 'homologation' as const };

test('Factura C uses AFIP SDK with a broker ticket, then reads back the exact official voucher', async () => {
  const methods: string[] = [];
  const client = new AfipSdkWsfeClient(config, undefined, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);
    expect(body).toMatchObject({ environment: 'dev', wsid: 'wsfe', params: { Auth: {
      Token: ticket.token, Sign: ticket.sign, Cuit: ticket.representedCuit,
    } } });
    expect(JSON.stringify(body)).not.toContain('PRIVATE KEY');
    expect(body.params).not.toHaveProperty('cert');
    expect(body.params).not.toHaveProperty('key');
    if (body.method === 'FECompUltimoAutorizado') return Response.json({ FECompUltimoAutorizadoResult: { CbteNro: 5 } });
    if (body.method === 'FEParamGetPtosVenta') return Response.json({ FEParamGetPtosVentaResult: {
      ResultGet: { PtoVenta: { Nro: 4, Bloqueado: 'N' } },
    } });
    if (body.method === 'FECAESolicitar') {
      expect(body.params.FeCAEReq).toMatchObject({
        FeCabReq: { CantReg: 1, PtoVta: 4, CbteTipo: 11 },
        FeDetReq: { FECAEDetRequest: {
          Concepto: 2, CbteDesde: '6', CbteFch: '20260711', ImpTotal: '15000.00',
          ImpNeto: '15000.00', ImpIVA: 0, MonId: 'PES', CondicionIVAReceptorId: 6,
          FchServDesde: '20260701', FchVtoPago: '20260711',
        } },
      });
      return Response.json({ FECAESolicitarResult: {
        FeCabResp: { Resultado: 'A', CbteTipo: 11, PtoVta: 4, Reproceso: 'N' },
        FeDetResp: { FECAEDetResponse: [{
          Concepto: 2, DocTipo: 80, DocNro: '27300000008', CbteDesde: 6,
          CbteFch: '20260711', CAE: '12345678901234', CAEFchVto: '20260721',
        }] },
      } });
    }
    expect(body.params.FeCompConsReq).toEqual({ CbteTipo: 11, CbteNro: '6', PtoVta: 4 });
    return Response.json({ FECompConsultarResult: { ResultGet: {
      CbteTipo: 11, PtoVta: 4, CbteDesde: 6, CbteFch: '20260711',
      Concepto: 2, DocTipo: 80, DocNro: '27300000008', MonId: 'PES', MonCotiz: 1,
      ImpTotal: 15000, ImpNeto: 15000, ImpIVA: 0, FchServDesde: '20260701',
      FchServHasta: '20260711', FchVtoPago: '20260711', Resultado: 'A',
      CodAutorizacion: '12345678901234', FchVto: '20260721',
    } } });
  });
  expect(await client.getLastInvoiceNumber(ticket, 11, 4)).toBe('5');
  await client.assertPointOfSaleActive(ticket, 4);
  expect((await client.authorize(ticket, payload())).cae).toBe('12345678901234');
  expect((await client.getDocument(ticket, 11, 4, '6'))?.cae).toBe('12345678901234');
  expect(methods).toEqual(['FECompUltimoAutorizado', 'FEParamGetPtosVenta', 'FECAESolicitar', 'FECompConsultar']);
});

test('an uncertain provider response remains ambiguous and other WSFE classes keep the direct client', async () => {
  let directCalls = 0;
  const direct = { authorize: async () => { directCalls++; return { status: 'rejected' as const }; } } as unknown as WsfeAuthorityClient;
  const client = new AfipSdkWsfeClient(config, direct, async () => Response.json({ error: 'upstream' }, { status: 502 }));
  await expect(client.authorize(ticket, payload())).rejects.toBeInstanceOf(WsfeAmbiguousTransportError);
  await client.authorize(ticket, payload({ documentType: 1 }));
  expect(directCalls).toBe(1);
});

test('rejects a provider CAE echo for another issuer before accepting it', async () => {
  const client = new AfipSdkWsfeClient(config, undefined, async () => Response.json({ FECAESolicitarResult: {
    FeCabResp: { Resultado: 'A', Cuit: '20965240390', CbteTipo: 11, PtoVta: 4 },
    FeDetResp: { FECAEDetResponse: [{
      Concepto: 2, DocTipo: 80, DocNro: '27300000008', CbteDesde: 6,
      CbteFch: '20260711', CAE: '12345678901234', CAEFchVto: '20260721',
    }] },
  } }));
  await expect(client.authorize(ticket, payload())).rejects.toBeInstanceOf(WsfeAmbiguousTransportError);
});
