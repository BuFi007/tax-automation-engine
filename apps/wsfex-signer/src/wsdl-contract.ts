import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { readBoundedBody } from './bounded-body';

export const OFFICIAL_WSFEX_HOMOLOGATION_WSDL =
  'https://wswhomo.afip.gov.ar/wsfexv1/service.asmx?WSDL';

const MAXIMUM_WSDL_BYTES = 2 * 1024 * 1024;

const getCmpFields = [
  ['Id', 'long'],
  ['Fecha_cbte', 'string'],
  ['Cbte_tipo', 'short'],
  ['Punto_vta', 'int'],
  ['Cbte_nro', 'long'],
  ['Tipo_expo', 'short'],
  ['Dst_cmp', 'short'],
  ['Cliente', 'string'],
  ['Cuit_pais_cliente', 'long'],
  ['Domicilio_cliente', 'string'],
  ['Id_impositivo', 'string'],
  ['Moneda_Id', 'string'],
  ['Moneda_ctz', 'decimal'],
  ['CanMisMonExt', 'string'],
  ['Obs_comerciales', 'string'],
  ['Imp_total', 'decimal'],
  ['Obs', 'string'],
  ['Cmps_asoc', 'ArrayOfCmp_asoc'],
  ['Forma_pago', 'string'],
  ['Idioma_cbte', 'short'],
  ['Items', 'ArrayOfItem'],
  ['Fch_venc_Cae', 'string'],
  ['Cae', 'string'],
  ['Resultado', 'string'],
  ['Fecha_pago', 'string'],
] as const;

const associationFields = [
  ['Cbte_tipo', 'short'],
  ['Cbte_punto_vta', 'int'],
  ['Cbte_nro', 'long'],
  ['Cbte_cuit', 'long'],
] as const;

const itemFields = [
  ['Pro_codigo', 'string'],
  ['Pro_ds', 'string'],
  ['Pro_qty', 'decimal'],
  ['Pro_umed', 'int'],
  ['Pro_precio_uni', 'decimal'],
  ['Pro_bonificacion', 'decimal'],
  ['Pro_total_item', 'decimal'],
] as const;

export type WsfexWsdlVerificationReceipt = Readonly<{
  contract: 'wsfexv1-fexgetcmp-exact-reconciliation-v1';
  url: typeof OFFICIAL_WSFEX_HOMOLOGATION_WSDL;
  schemaSha256: string;
}>;

export type WsfexWsdlFetcher = (
  input: string,
  init: RequestInit
) => Promise<Response>;

/**
 * Verifies only the public schema surface required for exact FEXGetCMP
 * reconciliation. This is an activation guard, not a substitute for querying an
 * authenticated, authorized invoice in homologation: several response fields are
 * optional in the XSD and their real empty/null representation must remain tested.
 */
export function verifyWsfexWsdl(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('WSFEX_WSDL_DTD_OR_ENTITY_FORBIDDEN');
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      removeNSPrefix: true,
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseTagValue: false,
      processEntities: false,
      trimValues: true,
    }).parse(xml) as unknown;
  } catch {
    throw new Error('WSFEX_WSDL_XML_INVALID');
  }
  const definitions = objectField(parsed, 'definitions', 'WSFEX_WSDL_DEFINITIONS_MISSING');
  const types = objectField(definitions, 'types', 'WSFEX_WSDL_TYPES_MISSING');
  const schemas = objectArray(types.schema);
  if (schemas.length === 0) throw new Error('WSFEX_WSDL_SCHEMA_MISSING');
  const topLevelElements = schemas.flatMap(schema => objectArray(schema.element));
  if (!topLevelElements.some(element => element.name === 'FEXGetCMP'))
    throw new Error('WSFEX_WSDL_FEXGETCMP_OPERATION_MISSING');

  const complexTypes = schemas.flatMap(schema => objectArray(schema.complexType));
  assertFields(complexTypes, 'ClsFEXGetCMPR', getCmpFields);
  assertFields(complexTypes, 'Cmp_asoc', associationFields);
  assertFields(complexTypes, 'Item', itemFields);

  return createHash('sha256').update(xml, 'utf8').digest('hex');
}

export async function fetchAndVerifyOfficialWsfexWsdl(
  fetcher: WsfexWsdlFetcher = (input, init) => fetch(input, init)
): Promise<WsfexWsdlVerificationReceipt> {
  let response: Response;
  try {
    response = await fetcher(OFFICIAL_WSFEX_HOMOLOGATION_WSDL, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'text/xml, application/wsdl+xml' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('WSFEX_WSDL_TRANSPORT_FAILED');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('WSFEX_WSDL_HTTP_FAILED');
  }
  const xml = await readBoundedBody(
    response,
    MAXIMUM_WSDL_BYTES,
    'WSFEX_WSDL_TOO_LARGE'
  );
  return {
    contract: 'wsfexv1-fexgetcmp-exact-reconciliation-v1',
    url: OFFICIAL_WSFEX_HOMOLOGATION_WSDL,
    schemaSha256: verifyWsfexWsdl(xml),
  };
}

function assertFields(
  complexTypes: readonly Record<string, unknown>[],
  typeName: string,
  fields: ReadonlyArray<readonly [string, string]>
): void {
  const complexType = complexTypes.find(type => type.name === typeName);
  if (!complexType) throw new Error(`WSFEX_WSDL_TYPE_${safeCode(typeName)}_MISSING`);
  const sequence = objectField(
    complexType,
    'sequence',
    `WSFEX_WSDL_${safeCode(typeName)}_SEQUENCE_MISSING`
  );
  const elements = objectArray(sequence.element);
  for (const [field, xsdType] of fields) {
    const matches = elements.some(element =>
      element.name === field
      && typeof element.type === 'string'
      && element.type.split(':').at(-1) === xsdType
    );
    if (!matches)
      throw new Error(`WSFEX_WSDL_${safeCode(typeName)}_${safeCode(field)}_MISSING`);
  }
}

function objectField(
  value: unknown,
  field: string,
  errorCode: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(errorCode);
  const candidate = (value as Record<string, unknown>)[field];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    throw new Error(errorCode);
  return candidate as Record<string, unknown>;
}

function objectArray(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.filter((candidate): candidate is Record<string, unknown> =>
    !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
  );
}

function safeCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}
