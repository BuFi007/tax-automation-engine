import { describe, expect, test } from 'bun:test';

import { payload } from './test-fixtures';
import { SoapWsfeAuthorityClient, WsfeAmbiguousTransportError } from './soap';

const ticket = { token: 'token<&', sign: 'sign>&', representedCuit: '20123456786', expiresAt: '2099-01-01T00:00:00.000Z' };
const note = { documentType: 11 as const, pointOfSale: 4, invoiceNumber: '81' };

describe('official WSFEV1 SOAP transport', () => {
  test('uses the homologation endpoint and encodes the domestic class-C detail', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const client = new SoapWsfeAuthorityClient('homologation', async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      expect(new Headers(init?.headers).get('soapaction')).toBe('"http://ar.gov.afip.dif.FEV1/FECAESolicitar"');
      return xmlResponse('FECAESolicitar', `
        <FeCabResp><Cuit>20123456786</Cuit><PtoVta>4</PtoVta><CbteTipo>11</CbteTipo><FchProceso>20260711</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>
        <FeDetResp><FECAEDetResponse><Concepto>2</Concepto><DocTipo>80</DocTipo><DocNro>27300000008</DocNro><CbteDesde>6</CbteDesde><CbteHasta>6</CbteHasta><CbteFch>20260711</CbteFch><Resultado>A</Resultado><CAE>71234567890123</CAE><CAEFchVto>20260721</CAEFchVto></FECAEDetResponse></FeDetResp>`);
    });

    const result = await client.authorize(ticket, payload());
    expect(capturedUrl).toBe('https://wswhomo.afip.gov.ar/wsfev1/service.asmx');
    expect(capturedBody).toContain('<Token>token&lt;&amp;</Token>');
    expect(capturedBody).toContain('<CantReg>1</CantReg><PtoVta>4</PtoVta><CbteTipo>11</CbteTipo>');
    expect(capturedBody).toContain('<DocTipo>80</DocTipo><DocNro>27300000008</DocNro>');
    expect(capturedBody).toContain('<CbteDesde>6</CbteDesde><CbteHasta>6</CbteHasta>');
    expect(capturedBody).toContain('<CbteFch>20260711</CbteFch>');
    expect(capturedBody).toContain('<ImpTotal>15000.00</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>15000.00</ImpNeto><ImpOpEx>0</ImpOpEx><ImpIVA>0</ImpIVA><ImpTrib>0</ImpTrib>');
    expect(capturedBody).toContain('<FchServDesde>20260701</FchServDesde><FchServHasta>20260711</FchServHasta><FchVtoPago>20260711</FchVtoPago>');
    expect(capturedBody).toContain('<MonId>PES</MonId><MonCotiz>1</MonCotiz><CondicionIVAReceptorId>6</CondicionIVAReceptorId>');
    expect(result).toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '6', issueDate: '2026-07-11', cae: '71234567890123', caeExpiry: '2026-07-21', reprocessed: false }));
  });

  test('omits the service period for productos and emits one exact CbtesAsoc for a note', async () => {
    let productsBody = '';
    const productsClient = new SoapWsfeAuthorityClient('homologation', async (_input, init) => {
      productsBody = String(init?.body);
      return xmlResponse('FECAESolicitar', `
        <FeCabResp><PtoVta>4</PtoVta><CbteTipo>11</CbteTipo><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>
        <FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>80</DocTipo><DocNro>27300000008</DocNro><CbteDesde>6</CbteDesde><CbteHasta>6</CbteHasta><CbteFch>20260711</CbteFch><Resultado>A</Resultado><CAE>71234567890123</CAE><CAEFchVto>20260721</CAEFchVto></FECAEDetResponse></FeDetResp>`);
    });
    await productsClient.authorize(ticket, payload({ concept: 1, servicePeriod: null }));
    expect(productsBody).not.toContain('<FchServDesde>');

    let noteBody = '';
    const noteClient = new SoapWsfeAuthorityClient('homologation', async (_input, init) => {
      noteBody = String(init?.body);
      return xmlResponse('FECAESolicitar', `
        <FeCabResp><PtoVta>4</PtoVta><CbteTipo>13</CbteTipo><Resultado>A</Resultado><Reproceso>S</Reproceso></FeCabResp>
        <FeDetResp><FECAEDetResponse><Concepto>2</Concepto><DocTipo>80</DocTipo><DocNro>27300000008</DocNro><CbteDesde>1</CbteDesde><CbteHasta>1</CbteHasta><CbteFch>20260711</CbteFch><Resultado>A</Resultado><CAE>72234567890123</CAE><CAEFchVto>20260721</CAEFchVto></FECAEDetResponse></FeDetResp>`);
    });
    const noteResult = await noteClient.authorize(ticket, payload({ documentType: 13, invoiceNumber: '1', total: { decimal: '5000.00', currency: 'ARS' }, associatedDocument: note }));
    expect(noteBody).toContain('<CbtesAsoc><CbteAsoc><Tipo>11</Tipo><PtoVta>4</PtoVta><Nro>81</Nro><Cuit>20123456786</Cuit></CbteAsoc></CbtesAsoc>');
    expect(noteResult.reprocessed).toBe(true);
    expect(noteResult).toEqual(expect.objectContaining({ status: 'accepted', documentType: 13, invoiceNumber: '1', cae: '72234567890123' }));
  });

  test('reads the last authorized number and treats ARCA 602 as an absent comprobante', async () => {
    const requestBodies: string[] = [];
    const client = new SoapWsfeAuthorityClient('homologation', async (_input, init) => {
      const body = String(init?.body);
      requestBodies.push(body);
      if (body.includes('FECompUltimoAutorizado')) return xmlResponse('FECompUltimoAutorizado', '<PtoVta>4</PtoVta><CbteTipo>11</CbteTipo><CbteNro>5</CbteNro>');
      if (body.includes('<CbteNro>999</CbteNro>')) return xmlResponse('FECompConsultar', '<Errors><Err><Code>602</Code><Msg>No existe</Msg></Err></Errors>');
      return xmlResponse('FECompConsultar', `
        <ResultGet><Concepto>2</Concepto><DocTipo>80</DocTipo><DocNro>27300000008</DocNro><CbteDesde>6</CbteDesde><CbteHasta>6</CbteHasta><CbteFch>20260711</CbteFch><ImpTotal>15000.00</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>15000.00</ImpNeto><ImpOpEx>0</ImpOpEx><ImpIVA>0</ImpIVA><ImpTrib>0</ImpTrib><FchServDesde>20260701</FchServDesde><FchServHasta>20260711</FchServHasta><FchVtoPago>20260711</FchVtoPago><MonId>PES</MonId><MonCotiz>1</MonCotiz><Resultado>A</Resultado><CodAutorizacion>71234567890123</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>20260721</FchVto><PtoVta>4</PtoVta><CbteTipo>11</CbteTipo></ResultGet>`);
    });
    await expect(client.getLastInvoiceNumber(ticket, 11, 4)).resolves.toBe('5');
    await expect(client.getDocument(ticket, 11, 4, '6')).resolves.toEqual(expect.objectContaining({
      documentType: 11, pointOfSale: 4, invoiceNumber: '6', issueDate: '2026-07-11', concept: 2, currencyId: 'PES', currencyQuote: '1',
      total: '15000.00', netAmount: '15000.00', vatAmount: '0', cae: '71234567890123', caeExpiry: '2026-07-21', result: 'A',
      servicePeriod: { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' }, associatedDocument: null,
    }));
    await expect(client.getDocument(ticket, 11, 4, '999')).resolves.toBeNull();
    expect(requestBodies.at(-1)).toContain('<FeCompConsReq><CbteTipo>11</CbteTipo><CbteNro>999</CbteNro><PtoVta>4</PtoVta></FeCompConsReq>');
  });

  test('accepts an active point of sale and a live FEDummy from multi-entry responses', async () => {
    const client = new SoapWsfeAuthorityClient('homologation', async (_input, init) => {
      if (String(init?.body).includes('FEDummy')) return xmlResponse('FEDummy', '<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>');
      return xmlResponse('FEParamGetPtosVenta', `
        <ResultGet>
          <PtoVenta><Nro>3</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>S</Bloqueado></PtoVenta>
          <PtoVenta><Nro>4</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado></PtoVenta>
        </ResultGet>`);
    });
    await expect(client.assertPointOfSaleActive(ticket, 4)).resolves.toBeUndefined();
    await expect(client.assertPointOfSaleActive(ticket, 9)).rejects.toThrow('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    await expect(client.dummy()).resolves.toEqual({ appServer: 'OK', dbServer: 'OK', authServer: 'OK' });
  });

  test('classifies network failures and 5xx responses as ambiguous without exposing raw bodies', async () => {
    const networkClient = new SoapWsfeAuthorityClient('homologation', async () => { throw new TypeError('secret network detail'); });
    await expect(networkClient.authorize(ticket, payload())).rejects.toBeInstanceOf(WsfeAmbiguousTransportError);
    const serverClient = new SoapWsfeAuthorityClient('homologation', async () => new Response('sensitive upstream body', { status: 503 }));
    try {
      await serverClient.authorize(ticket, payload());
      throw new Error('expected ambiguity');
    } catch (error) {
      expect(error).toBeInstanceOf(WsfeAmbiguousTransportError);
      expect(JSON.stringify(error)).not.toContain('sensitive upstream body');
    }
  });

  test('normalizes a SOAP-level ARCA rejection even when no FeCabResp echo is returned', async () => {
    const client = new SoapWsfeAuthorityClient('homologation', async () => xmlResponse('FECAESolicitar',
      '<Errors><Err><Code>10016</Code><Msg>sensitive authority detail</Msg></Err></Errors>'));
    const result = await client.authorize(ticket, payload());
    expect(result).toEqual(expect.objectContaining({
      status: 'rejected', documentType: 11, pointOfSale: 4, invoiceNumber: '6', issueDate: '2026-07-11', cae: null,
      safeErrors: [{ code: '10016', message: 'ARCA WSFE error 10016' }],
    }));
    expect(JSON.stringify(result)).not.toContain('sensitive authority detail');
  });
});

function xmlResponse(action: string, result: string): Response {
  return new Response(`<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body><${action}Response xmlns="http://ar.gov.afip.dif.FEV1/"><${action}Result>${result}</${action}Result></${action}Response></soap:Body>
    </soap:Envelope>`, { status: 200, headers: { 'content-type': 'text/xml' } });
}
