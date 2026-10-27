import { describe, expect, test } from 'bun:test';

import { payload } from './test-fixtures';
import { SoapWsfexAuthorityClient, WsfexAmbiguousTransportError } from './soap';

const ticket = { token: 'token<&', sign: 'sign>&', representedCuit: '20123456786', representedCuitCommitment: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00.000Z' };

describe('official WSFEX SOAP transport', () => {
  test('uses the homologation endpoint and encodes invoice-only service fields safely', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const client = new SoapWsfexAuthorityClient('homologation', async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      expect(init?.redirect).toBe('manual');
      expect(new Headers(init?.headers).get('soapaction')).toBe('"http://ar.gov.afip.dif.fexv1/FEXAuthorize"');
      return xmlResponse('FEXAuthorize', `
        <FEXResultAuth><Id>101</Id><Cbte_tipo>19</Cbte_tipo><Punto_vta>4</Punto_vta><Cbte_nro>6</Cbte_nro><Fch_cbte>20260711</Fch_cbte><Resultado>A</Resultado><Cae>12345678901234</Cae><Fch_venc_Cae>20260721</Fch_venc_Cae><Reproceso>N</Reproceso></FEXResultAuth>
        <FEXErr><ErrCode>0</ErrCode><ErrMsg></ErrMsg></FEXErr>`);
    });

    const result = await client.authorize(ticket, payload({ customer: { referenceHash: payload().customer.referenceHash, name: 'A & B <Corp>', address: 'Main > Side', countryCuit: '50000000016', foreignTaxId: 'US<&ID' } }));
    expect(capturedUrl).toBe('https://wswhomo.afip.gov.ar/wsfexv1/service.asmx');
    expect(capturedBody).toContain('<Fecha_pago>20260711</Fecha_pago>');
    expect(capturedBody).toContain('<CanMisMonExt>S</CanMisMonExt>');
    expect(capturedBody).toContain('<Tipo_expo>2</Tipo_expo><Permiso_existente></Permiso_existente>');
    expect(capturedBody).toContain('<Cliente>A &amp; B &lt;Corp&gt;</Cliente>');
    expect(capturedBody).toContain('<Id_impositivo>US&lt;&amp;ID</Id_impositivo>');
    expect(capturedBody).toContain('<Token>token&lt;&amp;</Token>');
    expect(result).toEqual(expect.objectContaining({ status: 'accepted', requestId: '101', invoiceNumber: '6', cae: '12345678901234', caeExpiry: '2026-07-21', reprocessed: false }));
    await client.authorize(ticket, payload({ sameCurrencyPayment: false }));
    expect(capturedBody).toContain('<CanMisMonExt>N</CanMisMonExt>');
  });

  test('omits invoice-only fields and emits one exact association for note 21', async () => {
    let capturedBody = '';
    const association = { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' };
    const client = new SoapWsfexAuthorityClient('homologation', async (_input, init) => {
      capturedBody = String(init?.body);
      return xmlResponse('FEXAuthorize', `
        <FEXResultAuth><Id>102</Id><Cbte_tipo>21</Cbte_tipo><Punto_vta>4</Punto_vta><Cbte_nro>1</Cbte_nro><Fch_cbte>20260711</Fch_cbte><Resultado>A</Resultado><Cae>22345678901234</Cae><Fch_venc_Cae>20260721</Fch_venc_Cae><Reproceso>S</Reproceso></FEXResultAuth>
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

  test('keeps authorization ambiguous when an accepted response omits CAE evidence', async () => {
    const client = new SoapWsfexAuthorityClient('homologation', async () => xmlResponse('FEXAuthorize', `
      <FEXResultAuth><Id>101</Id><Cbte_tipo>19</Cbte_tipo><Punto_vta>4</Punto_vta><Cbte_nro>6</Cbte_nro><Fch_cbte>20260711</Fch_cbte><Resultado>A</Resultado><Cae>12345678901234</Cae><Reproceso>N</Reproceso></FEXResultAuth>
      <FEXErr><ErrCode>0</ErrCode></FEXErr>`));
    await expect(client.authorize(ticket, payload())).rejects.toBeInstanceOf(WsfexAmbiguousTransportError);
  });

  test('parses an exact FEXGetCMP recovery receipt and treats ARCA 1020 as absent', async () => {
    const requestBodies: string[] = [];
    const responses = [
      xmlResponse('FEXGetCMP', `
        <FEXResultGet><Cbte_tipo>21</Cbte_tipo><Tipo_expo>2</Tipo_expo><Punto_vta>4</Punto_vta><Cbte_nro>82</Cbte_nro><Fecha_cbte>20260711</Fecha_cbte><Dst_cmp>200</Dst_cmp><Cliente>Foreign Customer</Cliente><Domicilio_cliente>123 Main St</Domicilio_cliente><Cuit_pais_cliente>50000000016</Cuit_pais_cliente><Id_impositivo>US-TAX-SECRET</Id_impositivo><Moneda_Id>DOL</Moneda_Id><Moneda_ctz>1200.25</Moneda_ctz><Imp_total>100.00</Imp_total><Idioma_cbte>2</Idioma_cbte><Items><Item><Pro_ds>Credit</Pro_ds><Pro_qty>1</Pro_qty><Pro_umed>7</Pro_umed><Pro_precio_uni>100.00</Pro_precio_uni><Pro_bonificacion>0</Pro_bonificacion><Pro_total_item>100.00</Pro_total_item></Item></Items><Cae>22345678901234</Cae><Fch_venc_Cae>20260721</Fch_venc_Cae><Resultado>A</Resultado><Cmps_asoc><Cmp_asoc><Cbte_tipo>19</Cbte_tipo><Cbte_punto_vta>4</Cbte_punto_vta><Cbte_nro>81</Cbte_nro><Cbte_cuit>20123456786</Cbte_cuit></Cmp_asoc></Cmps_asoc></FEXResultGet>
        <FEXErr><ErrCode>0</ErrCode></FEXErr>`),
      xmlResponse('FEXGetCMP', '<FEXErr><ErrCode>1020</ErrCode><ErrMsg>Not found</ErrMsg></FEXErr>'),
    ];
    const client = new SoapWsfexAuthorityClient('homologation', async (_input, init) => {
      requestBodies.push(String(init?.body));
      return responses.shift()!;
    });
    await expect(client.getDocument(ticket, 21, 4, '82')).resolves.toEqual(expect.objectContaining({
      documentType: 21, pointOfSale: 4, invoiceNumber: '82', issueDate: '2026-07-11', currencyId: 'DOL', currencyQuote: '1200.25',
      total: '100.00', cae: '22345678901234', caeExpiry: '2026-07-21', associatedDocument: { documentType: 19, pointOfSale: 4, invoiceNumber: '81', representedCuit: '20123456786' },
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

  test('discovers only active FEEWS points with a hashed authority receipt', async () => {
    const client = new SoapWsfexAuthorityClient('homologation', async () => xmlResponse('FEXGetPARAM_PtoVenta', `
      <FEXResultGet>
        <ClsFEXResponse_PtoVenta><Pve_Nro>9</Pve_Nro><Pve_Bloqueado>N</Pve_Bloqueado><Pve_FchBaja>20260101</Pve_FchBaja></ClsFEXResponse_PtoVenta>
        <ClsFEXResponse_PtoVenta><Pve_Nro>4</Pve_Nro><Pve_Bloqueado>N</Pve_Bloqueado></ClsFEXResponse_PtoVenta>
        <ClsFEXResponse_PtoVenta><Pve_Nro>3</Pve_Nro><Pve_Bloqueado>S</Pve_Bloqueado></ClsFEXResponse_PtoVenta>
        <ClsFEXResponse_PtoVenta><Pve_Nro>4</Pve_Nro><Pve_Bloqueado>N</Pve_Bloqueado></ClsFEXResponse_PtoVenta>
      </FEXResultGet><FEXErr><ErrCode>0</ErrCode></FEXErr>`));
    const result = await client.getPointsOfSale(ticket);
    expect(result.activePoints).toEqual([4]);
    expect(result.listedCount).toBe(4);
    expect(result.rawResponseHash).toMatch(/^[a-f0-9]{64}$/);
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

  test('cancels an oversized chunked authority response and keeps the outcome ambiguous', async () => {
    let cancelled = false;
    const client = new SoapWsfexAuthorityClient('homologation', async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1_100_000)); },
      cancel() { cancelled = true; },
    }), { status: 200 }));
    await expect(client.authorize(ticket, payload())).rejects.toBeInstanceOf(WsfexAmbiguousTransportError);
    expect(cancelled).toBe(true);
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
      return xmlResponse('FEXGetPARAM_Ctz', '<FEXResultGet><Mon_ctz>1200.250000</Mon_ctz><Mon_fecha>20260710</Mon_fecha></FEXResultGet><FEXErr><ErrCode>0</ErrCode></FEXErr>');
    });
    await expect(client.getCotizacion(ticket, 'DOL')).resolves.toEqual({ monId: 'DOL', ctz: '1200.250000', date: '2026-07-10' });
    expect(capturedBody).toContain('<Mon_id>DOL</Mon_id>');
  });

  test('accepts the legacy Fch_cotiz response spelling as a compatibility fallback', async () => {
    const client = new SoapWsfexAuthorityClient('homologation', async () =>
      xmlResponse('FEXGetPARAM_Ctz', '<FEXResultGet><Mon_ctz>1200.250000</Mon_ctz><Fch_cotiz>20260710</Fch_cotiz></FEXResultGet><FEXErr><ErrCode>0</ErrCode></FEXErr>')
    );
    await expect(client.getCotizacion(ticket, 'DOL')).resolves.toEqual({ monId: 'DOL', ctz: '1200.250000', date: '2026-07-10' });
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

test('refuses a WSFEX redirect before reading its body', async () => {
  let bodyRead = false;
  const client = new SoapWsfexAuthorityClient('homologation', async () => new Response(
    new ReadableStream({ pull(controller) { bodyRead = true; controller.close(); } }, { highWaterMark: 0 }),
    { status: 302, headers: { location: 'https://attacker.test/' } },
  ));
  await expect(client.authorize(ticket, payload())).rejects.toBeInstanceOf(WsfexAmbiguousTransportError);
  expect(bodyRead).toBe(false);
});
