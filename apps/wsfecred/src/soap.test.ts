import { describe, expect, test } from 'bun:test';

import { SoapWsfecredAuthorityClient, WsfecredTransportError } from './soap';
import { coordinates, ctaCteResponse, emptyResponse, errorResponse, ticket } from './test-fixtures';

describe('official WSFECRED SOAP transport', () => {
  test('encodes consultarCtaCte with the verified authRequest + idFactura tree', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    let capturedAction = '';
    const client = new SoapWsfecredAuthorityClient('homologation', async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      capturedAction = new Headers(init?.headers).get('soapaction') ?? '';
      return ctaCteResponse();
    });

    await client.getLifecycle(ticket, coordinates());
    expect(capturedUrl).toBe('https://fwshomo.afip.gov.ar/wsfecred/FECredService');
    expect(capturedAction).toBe('"http://ar.gob.afip.wsfecred/FECredService/consultarCtaCte"');
    expect(capturedBody).toContain('<consultarCtaCteRequest xmlns="http://ar.gob.afip.wsfecred/FECredService/">');
    // token/sign are XML-escaped; the represented CUIT is the querying party.
    expect(capturedBody).toContain('<authRequest><token>token&lt;&amp;</token><sign>sign&gt;&amp;</sign><cuitRepresentada>20123456786</cuitRepresentada></authRequest>');
    expect(capturedBody).toContain('<idCtaCte><idFactura><CUITEmisor>20123456786</CUITEmisor><codTipoCmp>201</codTipoCmp><ptoVta>4</ptoVta><nroCmp>81</nroCmp></idFactura></idCtaCte>');
  });

  test('decodes the nested estado/ctaCte tuple into normalized lifecycle fields', async () => {
    const client = new SoapWsfecredAuthorityClient('production', async () => ctaCteResponse());
    await expect(client.getLifecycle(ticket, coordinates())).resolves.toEqual({
      estadoComprobante: 'Aceptado',
      estadoCtaCte: 'Aceptada',
      tipoAceptacion: 'Expresa',
      opcionTransferencia: 'ADC',
      fechaEmision: '2026-07-01',
      fechaHoraAcep: '2026-07-10T12:00:00',
      fechaVenAcep: '2026-07-22',
      codMoneda: 'PES',
      importeTotal: '15000.00',
      saldoAceptado: '15000.00',
      codCtaCte: '778899',
    });
  });

  test('uses the production endpoint host (.gob.ar, not .gov.ar)', async () => {
    let url = '';
    const client = new SoapWsfecredAuthorityClient('production', async input => { url = String(input); return ctaCteResponse(); });
    await client.getLifecycle(ticket, coordinates());
    expect(url).toBe('https://serviciosjava.afip.gob.ar/wsfecred/FECredService');
  });

  test('normalizes an emitted FCE still awaiting reception (no acceptance dates yet)', async () => {
    const client = new SoapWsfecredAuthorityClient('homologation', async () => ctaCteResponse({
      estadoCtaCte: 'Modificable', estadoCmp: 'PendienteRecepcion', tipoAcep: null, fechaHoraAcep: null, fechaVenAcep: null, saldoAceptado: null,
    }));
    await expect(client.getLifecycle(ticket, coordinates())).resolves.toEqual(expect.objectContaining({
      estadoComprobante: 'PendienteRecepcion', estadoCtaCte: 'Modificable', tipoAceptacion: null, fechaHoraAcep: null, fechaVenAcep: null, saldoAceptado: null, fechaEmision: '2026-07-01',
    }));
  });

  test('slices a dateTime fechaEmision to a yyyy-mm-dd date', async () => {
    const client = new SoapWsfecredAuthorityClient('homologation', async () => ctaCteResponse({ fechaEmision: '2026-07-01T09:30:00' }));
    const result = await client.getLifecycle(ticket, coordinates());
    expect(result?.fechaEmision).toBe('2026-07-01');
  });

  test('maps the not-found business codes (1102/1105/32767) to null, not an error', async () => {
    for (const code of ['1102', '1105', '32767']) {
      const client = new SoapWsfecredAuthorityClient('homologation', async () => errorResponse(code, 'No existe el comprobante indicado'));
      await expect(client.getLifecycle(ticket, coordinates())).resolves.toBeNull();
    }
  });

  test('a response with no cuenta corriente and no error is treated as not found', async () => {
    const client = new SoapWsfecredAuthorityClient('homologation', async () => emptyResponse());
    await expect(client.getLifecycle(ticket, coordinates())).resolves.toBeNull();
  });

  test('surfaces any other ARCA business error as a safe coded error without leaking the descripcion', async () => {
    const client = new SoapWsfecredAuthorityClient('homologation', async () => errorResponse('602', 'sensitive authority detail'));
    await expect(client.getLifecycle(ticket, coordinates())).rejects.toThrow('WSFECRED_ERROR_602');
    try {
      await new SoapWsfecredAuthorityClient('homologation', async () => errorResponse('602', 'sensitive authority detail')).getLifecycle(ticket, coordinates());
    } catch (error) {
      expect(JSON.stringify({ message: (error as Error).message })).not.toContain('sensitive authority detail');
    }
  });

  test('classifies network failures and 5xx as transport errors without exposing raw bodies', async () => {
    const networkClient = new SoapWsfecredAuthorityClient('homologation', async () => { throw new TypeError('secret network detail'); });
    await expect(networkClient.getLifecycle(ticket, coordinates())).rejects.toBeInstanceOf(WsfecredTransportError);
    const serverClient = new SoapWsfecredAuthorityClient('homologation', async () => new Response('sensitive upstream body', { status: 503 }));
    try {
      await serverClient.getLifecycle(ticket, coordinates());
      throw new Error('expected transport error');
    } catch (error) {
      expect(error).toBeInstanceOf(WsfecredTransportError);
      expect(JSON.stringify({ message: (error as Error).message })).not.toContain('sensitive upstream body');
    }
  });

  test('turns a SOAP Fault into a safe error', async () => {
    const client = new SoapWsfecredAuthorityClient('homologation', async () => new Response(
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultstring>sensitive authority detail</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>',
      { status: 200, headers: { 'content-type': 'text/xml' } }
    ));
    await expect(client.getLifecycle(ticket, coordinates())).rejects.toThrow('WSFECRED_SOAP_FAULT');
  });
});
