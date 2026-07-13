import { describe, expect, test } from 'bun:test';

import { SoapWsfeAuthorityClient } from './soap';
import { BREAKDOWN_21, BREAKDOWN_MIXED, buildVatAdjustmentCase, buildVatInvoiceCase, fceEmission, RECEPTOR_CONSUMIDOR_FINAL, RECEPTOR_RI } from './test-fixtures-vat';

const ticket = { token: 'tok', sign: 'sig', representedCuit: '20123456786', expiresAt: '2099-01-01T00:00:00.000Z' };

function capturing(onBody: (body: string) => void, cbteTipo: number, cbteNro: string, docNro: string) {
  return new SoapWsfeAuthorityClient('homologation', async (_input, init) => {
    onBody(String(init?.body));
    return xmlResponse('FECAESolicitar', `
      <FeCabResp><PtoVta>4</PtoVta><CbteTipo>${cbteTipo}</CbteTipo><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>
      <FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>80</DocTipo><DocNro>${docNro}</DocNro><CbteDesde>${cbteNro}</CbteDesde><CbteHasta>${cbteNro}</CbteHasta><CbteFch>20260711</CbteFch><Resultado>A</Resultado><CAE>71234567890123</CAE><CAEFchVto>20260721</CAEFchVto></FECAEDetResponse></FeDetResp>`);
  });
}

describe('WSFEV1 SOAP encoding — class A / B discriminated IVA', () => {
  test('encodes a Factura A with ImpNeto/ImpTrib/ImpIVA (XSD order) and one <Iva> alícuota', async () => {
    let body = '';
    const client = capturing(b => { body = b; }, 1, '1', RECEPTOR_RI.docNumber);
    await client.authorize(ticket, buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 }).payload);
    expect(body).toContain('<CbteTipo>1</CbteTipo>');
    expect(body).toContain('<ImpTotal>12100.00</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>10000.00</ImpNeto><ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>2100.00</ImpIVA>');
    expect(body).toContain('<CondicionIVAReceptorId>1</CondicionIVAReceptorId>');
    expect(body).toContain('<Iva><AlicIva><Id>5</Id><BaseImp>10000.00</BaseImp><Importe>2100.00</Importe></AlicIva></Iva>');
  });

  test('encodes a mixed 21% + 10.5% invoice as two <AlicIva> lines summing ImpIVA', async () => {
    let body = '';
    const client = capturing(b => { body = b; }, 1, '1', RECEPTOR_RI.docNumber);
    await client.authorize(ticket, buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_MIXED }).payload);
    expect(body).toContain('<ImpNeto>15000.00</ImpNeto><ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>2625.00</ImpIVA>');
    expect(body).toContain('<AlicIva><Id>5</Id><BaseImp>10000.00</BaseImp><Importe>2100.00</Importe></AlicIva><AlicIva><Id>4</Id><BaseImp>5000.00</BaseImp><Importe>525.00</Importe></AlicIva>');
  });

  test('encodes a Factura B to a consumidor final with the same net/IVA breakdown', async () => {
    let body = '';
    const client = capturing(b => { body = b; }, 6, '1', '0');
    await client.authorize(ticket, buildVatInvoiceCase({ documentType: 6, receptor: RECEPTOR_CONSUMIDOR_FINAL, taxBreakdown: BREAKDOWN_21 }).payload);
    expect(body).toContain('<DocTipo>99</DocTipo><DocNro>0</DocNro>');
    expect(body).toContain('<ImpNeto>10000.00</ImpNeto><ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>2100.00</ImpIVA>');
    expect(body).toContain('<CondicionIVAReceptorId>5</CondicionIVAReceptorId>');
  });
});

describe('WSFEV1 SOAP encoding — FCE MiPyME', () => {
  test('encodes an FCE-A factura with FchVtoPago and Opcionales 2101/2102/27', async () => {
    let body = '';
    const client = capturing(b => { body = b; }, 201, '1', RECEPTOR_RI.docNumber);
    await client.authorize(ticket, buildVatInvoiceCase({ documentType: 201, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, fce: fceEmission(), concept: 1 }).payload);
    // Concepto 1 (productos): no FchServDesde, but FchVtoPago is still present for the FCE.
    expect(body).not.toContain('<FchServDesde>');
    expect(body).toContain('<FchVtoPago>20260810</FchVtoPago>');
    expect(body).toContain('<Opcionales><Opcional><Id>2101</Id><Valor>2850590940090418135201</Valor></Opcional><Opcional><Id>2102</Id><Valor>mi.alias.fce</Valor></Opcional><Opcional><Id>27</Id><Valor>SCA</Valor></Opcional></Opcionales>');
    expect(body).toContain('<Iva><AlicIva><Id>5</Id>');
  });

  test('omits the alias Opcional when the emitter has none', async () => {
    let body = '';
    const client = capturing(b => { body = b; }, 201, '1', RECEPTOR_RI.docNumber);
    await client.authorize(ticket, buildVatInvoiceCase({ documentType: 201, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, fce: fceEmission({ emitterAlias: null }), concept: 1 }).payload);
    expect(body).not.toContain('<Id>2102</Id>');
    expect(body).toContain('<Opcional><Id>2101</Id><Valor>2850590940090418135201</Valor></Opcional><Opcional><Id>27</Id><Valor>SCA</Valor></Opcional>');
  });

  test('encodes an FCE-C factura on the class-C money model (ImpIVA 0, no <Iva>) with FCE Opcionales', async () => {
    let body = '';
    const client = capturing(b => { body = b; }, 211, '1', '0');
    await client.authorize(ticket, buildVatInvoiceCase({ documentType: 211, receptor: RECEPTOR_CONSUMIDOR_FINAL, taxBreakdown: null, total: '9000.00', fce: fceEmission(), concept: 1 }).payload);
    expect(body).toContain('<ImpTotal>9000.00</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>9000.00</ImpNeto><ImpOpEx>0</ImpOpEx><ImpIVA>0</ImpIVA><ImpTrib>0</ImpTrib>');
    expect(body).not.toContain('<Iva>');
    expect(body).toContain('<Id>2101</Id>');
  });

  test('encodes an FCE-A nota de crédito with Opcional 22 and a CbtesAsoc to the FCE original (201)', async () => {
    let body = '';
    const client = capturing(b => { body = b; }, 203, '1', RECEPTOR_RI.docNumber);
    await client.authorize(ticket, buildVatAdjustmentCase({ documentType: 203, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, anulacion: 'N' }).payload);
    expect(body).toContain('<CbtesAsoc><CbteAsoc><Tipo>201</Tipo><PtoVta>4</PtoVta><Nro>81</Nro><Cuit>20123456786</Cuit></CbteAsoc></CbtesAsoc>');
    expect(body).toContain('<Opcionales><Opcional><Id>22</Id><Valor>N</Valor></Opcional></Opcionales>');
    expect(body).not.toContain('<Id>2101</Id>');
  });
});

describe('WSFEV1 FECompConsultar parsing — IVA lines + FchVtoPago', () => {
  test('parses the echoed Iva array, FchVtoPago and the associated document type', async () => {
    const client = new SoapWsfeAuthorityClient('homologation', async () => xmlResponse('FECompConsultar', `
      <ResultGet><Concepto>1</Concepto><DocTipo>80</DocTipo><DocNro>${RECEPTOR_RI.docNumber}</DocNro><CbteDesde>1</CbteDesde><CbteHasta>1</CbteHasta><CbteFch>20260711</CbteFch>
        <ImpTotal>12100.00</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>10000.00</ImpNeto><ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>2100.00</ImpIVA>
        <FchVtoPago>20260810</FchVtoPago><MonId>PES</MonId><MonCotiz>1</MonCotiz>
        <CbtesAsoc><CbteAsoc><Tipo>201</Tipo><PtoVta>4</PtoVta><Nro>81</Nro></CbteAsoc></CbtesAsoc>
        <Iva><AlicIva><Id>5</Id><BaseImp>10000.00</BaseImp><Importe>2100.00</Importe></AlicIva></Iva>
        <Resultado>A</Resultado><CodAutorizacion>71234567890123</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>20260721</FchVto><PtoVta>4</PtoVta><CbteTipo>203</CbteTipo></ResultGet>`));
    const document = await client.getDocument(ticket, 203, 4, '1');
    expect(document).toEqual(expect.objectContaining({
      documentType: 203, netAmount: '10000.00', vatAmount: '2100.00', paymentDueDate: '2026-08-10',
      ivaLineItems: [{ alicIvaId: 5, baseImp: '10000.00', importe: '2100.00' }],
      associatedDocument: { documentType: 201, pointOfSale: 4, invoiceNumber: '81' },
    }));
  });
});

function xmlResponse(action: string, result: string): Response {
  return new Response(`<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body><${action}Response xmlns="http://ar.gov.afip.dif.FEV1/"><${action}Result>${result}</${action}Result></${action}Response></soap:Body>
    </soap:Envelope>`, { status: 200, headers: { 'content-type': 'text/xml' } });
}
