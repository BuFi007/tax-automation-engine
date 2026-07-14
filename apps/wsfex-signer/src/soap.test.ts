import { describe, expect, test } from 'bun:test';

import { payload } from './test-fixtures';
import { SoapWsfexAuthorityClient, WsfexAmbiguousTransportError } from './soap';

const ticket = { token: 'token<&', sign: 'sign>&', representedCuit: '20123456786', expiresAt: '2099-01-01T00:00:00.000Z' };

describe('official WSFEX SOAP transport', () => {
  test('uses the homologation endpoint and encodes invoice-only service fields safely', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const client = new SoapWsfexAuthorityClient('homologation', async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      expect(new Headers(init?.headers).get('soapaction')).toBe('"http://ar.gov.afip.dif.fexv1/FEXAuthorize"');
      return xmlResponse('FEXAuthorize', `
        <FEXResultAuth><Id>101</Id><Cbte_tipo>19</Cbte_tipo><Punto_vta>4</Punto_vta><Cbte_nro>6</Cbte_nro><Fch_cbte>20260711</Fch_cbte><Resultado>A</Resultado><Cae>12345678901234</Cae><Reproceso>N</Reproceso></FEXResultAuth>
        <FEXErr><ErrCode>0</ErrCode><ErrMsg></ErrMsg></FEXErr>`);
    });

    const result = await client.authorize(ticket, payload({ customer: { referenceHash: payload().customer.referenceHash, name: 'A & B <Corp>', address: 'Main > Side', countryCuit: '50000000016', foreignTaxId: 'US<&ID' } }));
    expect(capturedUrl).toBe('https://wswhomo.afip.gov.ar/wsfexv1/service.asmx');
    expect(capturedBody).toContain('<Fecha_pago>20260711</Fecha_pago>');
    expect(capturedBody).toContain('<CanMisMonExt>S</CanMisMonExt>');
    expect(capturedBody).toContain('<Cliente>A &amp; B &lt;Corp&gt;</Cliente>');
    expect(capturedBody).toContain('<Id_impositivo>US&lt;&amp;ID</Id_impositivo>');
    expect(capturedBody).toContain('<Token>token&lt;&amp;</Token>');
    expect(result).toEqual(expect.objectContaining({ status: 'accepted', requestId: '101', invoiceNumber: '6', cae: '12345678901234', reprocessed: false }));
  });

  test('omits invoice-only fields and emits one exact association for note 21', async () => {
    let capturedBody = '';
    const association = { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' };
    const client = new SoapWsfexAuthorityClient('homologation', async (_input, init) => {
      capturedBody = String(init?.body);
      return xmlResponse('FEXAuthorize', `
        <FEXResultAuth><Id>102</Id><Cbte_tipo>21</Cbte_tipo><Punto_vta>4</Punto_vta><Cbte_nro>1</Cbte_nro><Fch_cbte>20260711</Fch_cbte><Resultado>A</Resultado><Cae>22345678901234</Cae><Reproceso>S</Reproceso></FEXResultAuth>
        <FEXErr><ErrCode>0</ErrCode></FEXErr>`);
    });
    const note = payload({
      subjectId: 'credit-1', requestId: '102', invoiceNumber: '1', documentType: 21, paymentDate: null, sameCurrencyPayment: null,
      total: '100.00', associatedDocument: association,
      items: [{ code: null, description: 'Credit', quantity: '1', unitCode: 7, unitPrice: '100.00', discount: '0', total: '100.00' }],
    });
    const result = await client.authorize(ticket, note);
    expect(capturedBody).not.toContain('<Fecha_pago>');
    expect(capturedBody).not.toContain('<CanMisMonExt>');
    expect(capturedBody).toContain('<Cmps_asoc><Cmp_asoc><Cbte_tipo>19</Cbte_tipo><Cbte_punto_vta>4</Cbte_punto_vta><Cbte_nro>81</Cbte_nro><Cbte_cuit>20123456786</Cbte_cuit></Cmp_asoc></Cmps_asoc>');
    expect(result.reprocessed).toBe(true);
  });

  test('parses an exact FEXGetCMP recovery receipt and treats ARCA 1020 as absent', async () => {
    const requestBodies: string[] = [];
    const responses = [
      xmlResponse('FEXGetCMP', `
        <FEXResultGet><Cbte_tipo>21</Cbte_tipo><Punto_vta>4</Punto_vta><Cbte_nro>82</Cbte_nro><Fecha_cbte>20260711</Fecha_cbte><Moneda_Id>DOL</Moneda_Id><Moneda_ctz>1200.25</Moneda_ctz><Imp_total>100.00</Imp_total><Cae>22345678901234</Cae><Resultado>A</Resultado><Cmps_asoc><Cmp_asoc><Cbte_tipo>19</Cbte_tipo><Cbte_punto_vta>4</Cbte_punto_vta><Cbte_nro>81</Cbte_nro></Cmp_asoc></Cmps_asoc></FEXResultGet>
        <FEXErr><ErrCode>0</ErrCode></FEXErr>`),
      xmlResponse('FEXGetCMP', '<FEXErr><ErrCode>1020</ErrCode><ErrMsg>Not found</ErrMsg></FEXErr>'),
    ];
    const client = new SoapWsfexAuthorityClient('homologation', async (_input, init) => {
      requestBodies.push(String(init?.body));
      return responses.shift()!;
    });
    await expect(client.getDocument(ticket, 21, 4, '82')).resolves.toEqual(expect.objectContaining({
      documentType: 21, pointOfSale: 4, invoiceNumber: '82', issueDate: '2026-07-11', currencyId: 'DOL', currencyQuote: '1200.25',
      total: '100.00', cae: '22345678901234', associatedDocument: { documentType: 19, pointOfSale: 4, invoiceNumber: '81' },
    }));
    await expect(client.getDocument(ticket, 21, 4, '999')).resolves.toBeNull();
    expect(requestBodies[0]).toContain('<Cmp><Cbte_tipo>21</Cbte_tipo><Punto_vta>4</Punto_vta><Cbte_nro>82</Cbte_nro></Cmp>');
    expect(requestBodies[0]).not.toContain('<Cbte_Tipo>');
  });

  test('accepts an active point of sale from a multi-entry response', async () => {
    const client = new SoapWsfexAuthorityClient('homologation', async () => xmlResponse('FEXGetPARAM_PtoVenta', `
      <FEXResultGet>
        <ClsFEXResponse_PtoVenta><Pve_Nro>3</Pve_Nro><Pve_Bloqueado>S</Pve_Bloqueado></ClsFEXResponse_PtoVenta>
        <ClsFEXResponse_PtoVenta><Pve_Nro>4</Pve_Nro><Pve_Bloqueado>N</Pve_Bloqueado></ClsFEXResponse_PtoVenta>
      </FEXResultGet><FEXErr><ErrCode>0</ErrCode></FEXErr>`));
    await expect(client.assertPointOfSaleActive(ticket, 4)).resolves.toBeUndefined();
    await expect(client.assertPointOfSaleActive(ticket, 9)).rejects.toThrow('WSFEX_POINT_OF_SALE_NOT_ACTIVE');
  });

  test('classifies network failures and 5xx responses as ambiguous without exposing raw bodies', async () => {
    const networkClient = new SoapWsfexAuthorityClient('homologation', async () => { throw new TypeError('secret network detail'); });
    await expect(networkClient.authorize(ticket, payload())).rejects.toBeInstanceOf(WsfexAmbiguousTransportError);
    const serverClient = new SoapWsfexAuthorityClient('homologation', async () => new Response('sensitive upstream body', { status: 503 }));
    try {
      await serverClient.authorize(ticket, payload());
      throw new Error('expected ambiguity');
    } catch (error) {
      expect(error).toBeInstanceOf(WsfexAmbiguousTransportError);
      expect(JSON.stringify(error)).not.toContain('sensitive upstream body');
    }
  });

  test('normalizes a SOAP-level ARCA rejection even when no result echo is returned', async () => {
    const client = new SoapWsfexAuthorityClient('homologation', async () => xmlResponse('FEXAuthorize',
      '<FEXErr><ErrCode>1000</ErrCode><ErrMsg>sensitive authority detail</ErrMsg></FEXErr>'));
    const result = await client.authorize(ticket, payload());
    expect(result).toEqual(expect.objectContaining({
      status: 'rejected', requestId: '101', documentType: 19, pointOfSale: 4, invoiceNumber: '6', issueDate: '2026-07-11', cae: null,
      safeErrors: [{ code: '1000', message: 'ARCA WSFEX error 1000' }],
    }));
    expect(JSON.stringify(result)).not.toContain('sensitive authority detail');
  });

  test('reads FEXGetPARAM_Ctz cotización, quote and date', async () => {
    let capturedBody = '';
    const client = new SoapWsfexAuthorityClient('homologation', async (_input, init) => {
      capturedBody = String(init?.body);
      expect(new Headers(init?.headers).get('soapaction')).toBe('"http://ar.gov.afip.dif.fexv1/FEXGetPARAM_Ctz"');
      return xmlResponse('FEXGetPARAM_Ctz', '<FEXResultGet><Mon_Id>DOL</Mon_Id><Mon_ctz>1200.250000</Mon_ctz><Fch_cotiz>20260710</Fch_cotiz></FEXResultGet><FEXErr><ErrCode>0</ErrCode></FEXErr>');
    });
    await expect(client.getCotizacion(ticket, 'DOL')).resolves.toEqual({ monId: 'DOL', ctz: '1200.250000', date: '2026-07-10' });
    expect(capturedBody).toContain('<Mon_id>DOL</Mon_id>');
  });

  test('surfaces an ARCA error from FEXGetPARAM_Ctz without leaking the raw message', async () => {
    const client = new SoapWsfexAuthorityClient('homologation', async () => xmlResponse('FEXGetPARAM_Ctz', '<FEXErr><ErrCode>602</ErrCode><ErrMsg>sensitive</ErrMsg></FEXErr>'));
    await expect(client.getCotizacion(ticket, 'DOL')).rejects.toThrow('WSFEX_ERROR_602');
  });
});

function xmlResponse(action: string, result: string): Response {
  return new Response(`<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body><${action}Response xmlns="http://ar.gov.afip.dif.fexv1/"><${action}Result>${result}</${action}Result></${action}Response></soap:Body>
    </soap:Envelope>`, { status: 200, headers: { 'content-type': 'text/xml' } });
}
