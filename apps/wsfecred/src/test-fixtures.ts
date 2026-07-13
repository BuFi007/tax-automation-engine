import type { LifecycleCoordinates } from './contracts';
import type { WsfecredAccessTicket } from './wsaa';

// 20123456786 is a check-digit-valid CUIT (shared with the signer fixtures).
export const CUIT_EMISOR = '20123456786';

export const ticket: WsfecredAccessTicket = {
  token: 'token<&',
  sign: 'sign>&',
  representedCuit: CUIT_EMISOR,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

export function coordinates(overrides: Partial<LifecycleCoordinates> = {}): LifecycleCoordinates {
  return { cuitEmisor: CUIT_EMISOR, pointOfSale: 4, comprobanteType: 201, invoiceNumber: '81', ...overrides };
}

export type CtaCteFixture = Readonly<{
  estadoCtaCte?: string | null;
  estadoCmp?: string | null;
  tipoAcep?: string | null;
  opcionTransferencia?: string | null;
  fechaEmision?: string | null;
  fechaHoraAcep?: string | null;
  fechaVenAcep?: string | null;
  codMoneda?: string | null;
  importeTotal?: string | null;
  saldoAceptado?: string | null;
  codCtaCte?: string | null;
}>;

// Builds a consultarCtaCteReturn envelope with the verified nested shape:
// estado wrapped in EstadoCmp/EstadoCtaCteType, `factura` embedded in `ctaCte`.
export function ctaCteResponse(fixture: CtaCteFixture = {}): Response {
  const f: Required<CtaCteFixture> = {
    estadoCtaCte: 'Aceptada',
    estadoCmp: 'Aceptado',
    tipoAcep: 'Expresa',
    opcionTransferencia: 'ADC',
    fechaEmision: '2026-07-01',
    fechaHoraAcep: '2026-07-10T12:00:00',
    fechaVenAcep: '2026-07-22',
    codMoneda: 'PES',
    importeTotal: '15000.00',
    saldoAceptado: '15000.00',
    codCtaCte: '778899',
    ...fixture,
  };
  const factura = [
    estadoBlock(f.estadoCmp),
    el('tipoAcep', f.tipoAcep),
    el('fechaHoraAcep', f.fechaHoraAcep),
    el('fechaVenAcep', f.fechaVenAcep),
    el('fechaEmision', f.fechaEmision),
    el('codMoneda', f.codMoneda),
    el('importeTotal', f.importeTotal),
    el('opcionTransferencia', f.opcionTransferencia),
    '<cuitEmisor>20123456786</cuitEmisor><ptovta>4</ptovta><nroCmp>81</nroCmp>',
  ].join('');
  const ctaCte = [
    el('codCtaCte', f.codCtaCte),
    f.estadoCtaCte === null ? '' : `<estadoCtaCte><estado>${f.estadoCtaCte}</estado><fechaHoraEstado>2026-07-10T12:00:00</fechaHoraEstado></estadoCtaCte>`,
    el('saldoAceptado', f.saldoAceptado),
    el('codMoneda', f.codMoneda),
    `<factura>${factura}</factura>`,
  ].join('');
  return soapResponse(`<consultarCtaCteReturn><arrayErrores/><arrayObservaciones/><ctaCte>${ctaCte}</ctaCte></consultarCtaCteReturn>`);
}

export function errorResponse(codigo: string, descripcion = 'error'): Response {
  return soapResponse(`<consultarCtaCteReturn><arrayErrores><codigoDescripcion><codigo>${codigo}</codigo><descripcion>${descripcion}</descripcion></codigoDescripcion></arrayErrores></consultarCtaCteReturn>`);
}

export function emptyResponse(): Response {
  return soapResponse('<consultarCtaCteReturn><arrayErrores/></consultarCtaCteReturn>');
}

function estadoBlock(value: string | null): string {
  if (value === null) return '';
  return `<estado><estado>${value}</estado><fechaHoraEstado>2026-07-10T12:00:00</fechaHoraEstado></estado>`;
}

function el(tag: string, value: string | null): string {
  return value === null ? '' : `<${tag}>${value}</${tag}>`;
}

function soapResponse(inner: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><ns:consultarCtaCteResponse xmlns:ns="http://ar.gob.afip.wsfecred/FECredService/">${inner}</ns:consultarCtaCteResponse></soapenv:Body></soapenv:Envelope>`,
    { status: 200, headers: { 'content-type': 'text/xml' } }
  );
}
