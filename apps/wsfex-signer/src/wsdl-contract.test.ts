import { describe, expect, test } from 'bun:test';
import {
  fetchAndVerifyOfficialWsfexWsdl,
  OFFICIAL_WSFEX_HOMOLOGATION_WSDL,
  verifyWsfexWsdl,
} from './wsdl-contract';

const getCmp = [
  ['Id', 'long'], ['Fecha_cbte', 'string'], ['Cbte_tipo', 'short'],
  ['Punto_vta', 'int'], ['Cbte_nro', 'long'], ['Tipo_expo', 'short'],
  ['Dst_cmp', 'short'], ['Cliente', 'string'], ['Cuit_pais_cliente', 'long'],
  ['Domicilio_cliente', 'string'], ['Id_impositivo', 'string'],
  ['Moneda_Id', 'string'], ['Moneda_ctz', 'decimal'], ['CanMisMonExt', 'string'],
  ['Obs_comerciales', 'string'], ['Imp_total', 'decimal'], ['Obs', 'string'],
  ['Cmps_asoc', 'ArrayOfCmp_asoc'], ['Forma_pago', 'string'],
  ['Idioma_cbte', 'short'], ['Items', 'ArrayOfItem'], ['Fch_venc_Cae', 'string'],
  ['Cae', 'string'], ['Resultado', 'string'], ['Fecha_pago', 'string'],
] as const;
const association = [
  ['Cbte_tipo', 'short'], ['Cbte_punto_vta', 'int'], ['Cbte_nro', 'long'],
  ['Cbte_cuit', 'long'],
] as const;
const item = [
  ['Pro_codigo', 'string'], ['Pro_ds', 'string'], ['Pro_qty', 'decimal'],
  ['Pro_umed', 'int'], ['Pro_precio_uni', 'decimal'],
  ['Pro_bonificacion', 'decimal'], ['Pro_total_item', 'decimal'],
] as const;

function fixture(): string {
  const type = (name: string, fields: ReadonlyArray<readonly [string, string]>) =>
    `<xsd:complexType name="${name}"><xsd:sequence>${fields.map(([field, fieldType]) =>
      `<xsd:element name="${field}" type="xsd:${fieldType}"/>`).join('')}</xsd:sequence></xsd:complexType>`;
  return `<definitions xmlns:xsd="http://www.w3.org/2001/XMLSchema"><types><xsd:schema><xsd:element name="FEXGetCMP"/>${type('ClsFEXGetCMPR', getCmp)}${type('Cmp_asoc', association)}${type('Item', item)}</xsd:schema></types></definitions>`;
}

describe('official WSFEX WSDL activation contract', () => {
  test('requires every field used by exact FEXGetCMP reconciliation', () => {
    expect(verifyWsfexWsdl(fixture())).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyWsfexWsdl(fixture().replace(' name="Cbte_cuit"', ' name="Other_cuit"')))
      .toThrow('WSFEX_WSDL_CMP_ASOC_CBTE_CUIT_MISSING');
  });

  test('uses the pinned official HTTPS URL, refuses redirects, and bounds the body', async () => {
    let requestUrl = '';
    let redirect = '';
    const receipt = await fetchAndVerifyOfficialWsfexWsdl(async (input, init) => {
      requestUrl = String(input);
      redirect = String(init?.redirect);
      return new Response(fixture(), { status: 200 });
    });
    expect(requestUrl).toBe(OFFICIAL_WSFEX_HOMOLOGATION_WSDL);
    expect(redirect).toBe('error');
    expect(receipt).toEqual(expect.objectContaining({
      contract: 'wsfexv1-fexgetcmp-exact-reconciliation-v1',
      url: OFFICIAL_WSFEX_HOMOLOGATION_WSDL,
    }));

    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
      cancel() { cancelled = true; },
    });
    await expect(fetchAndVerifyOfficialWsfexWsdl(async () =>
      new Response(oversized, { status: 200 })))
      .rejects.toThrow('WSFEX_WSDL_TOO_LARGE');
    expect(cancelled).toBe(true);
  });
});
