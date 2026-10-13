import { XMLParser } from 'fast-xml-parser';

import { readBoundedBody } from './bounded-body';
import type { ArcaBoundaryService } from './service';

const ENDPOINT = 'https://awshomo.arca.gob.ar/sr-padron/webservices/personaServiceA5';
const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true, processEntities: false });

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function queryIssuerPadron(
  service: ArcaBoundaryService,
  input: Readonly<{ templateWorkspaceId: string; templateIssuerProfileRef: string; cuit: string }>,
  occurredAt: string,
  fetcher: Fetcher = (url, init) => fetch(url, init),
) {
  const ticket = await service.getTicket({
    version: 'wsaa-ticket-request-v1',
    service: 'ws_sr_constancia_inscripcion',
    environment: 'homologation',
    workspaceId: input.templateWorkspaceId,
    issuerProfileRef: input.templateIssuerProfileRef,
  }, occurredAt);
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/"><soapenv:Body><a5:getPersona_v2><token>${escapeXml(ticket.token)}</token><sign>${escapeXml(ticket.sign)}</sign><cuitRepresentada>${ticket.representedCuit}</cuitRepresentada><idPersona>${input.cuit}</idPersona></a5:getPersona_v2></soapenv:Body></soapenv:Envelope>`;
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'text/xml; charset=utf-8' },
      body: envelope, signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error('ARCA_PADRON_TRANSPORT_FAILED');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('ARCA_PADRON_HTTP_REJECTED');
  }
  const raw = await readBoundedBody(response, 1_048_576, 'ARCA_PADRON_RESPONSE_TOO_LARGE');
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('ARCA_PADRON_UNSAFE_XML');
  return parseIssuerPadron(raw, input.cuit, occurredAt);
}

export function parseIssuerPadron(xml: string, expectedCuit: string, observedAt: string) {
  const root = node(parser.parse(xml));
  const body = node(node(root.Envelope).Body);
  if ('Fault' in body) throw new Error('ARCA_PADRON_SOAP_FAULT');
  const result = node(node(body.getPersona_v2Response).personaReturn);
  if (result.errorConstancia)
    throw new Error('ARCA_PADRON_RECORD_UNAVAILABLE');
  const general = node(result.datosGenerales);
  if (String(general.idPersona ?? '') !== expectedCuit)
    throw new Error('ARCA_PADRON_CUIT_MISMATCH');
  const regimen = node(result.datosRegimenGeneral);
  const mono = node(result.datosMonotributo);
  const activities = [...array(regimen.actividad), ...array(mono.actividadMonotributista)]
    .map(value => node(value))
    .filter(value => /^\d{1,8}$/.test(String(value.idActividad ?? '')))
    .map(value => ({
      code: String(value.idActividad),
      description: String(value.descripcionActividad ?? '').trim().slice(0, 300),
    }));
  const taxes = [...array(regimen.impuesto), ...array(mono.impuesto)].map(value => node(value));
  const active = (id: string) => taxes.some(tax => String(tax.idImpuesto) === id && tax.estadoImpuesto === 'AC');
  const legalName = String(general.razonSocial ?? `${general.nombre ?? ''} ${general.apellido ?? ''}`).trim();
  if (!legalName) throw new Error('ARCA_PADRON_RECORD_INCOMPLETE');
  return {
    version: 'arca-issuer-padron-result-v1' as const,
    cuit: expectedCuit,
    legalName: legalName.slice(0, 300),
    vatCondition: active('20') ? 'monotributo' as const : active('30') ? 'responsable_inscripto' as const : 'unknown' as const,
    activities,
    source: 'arca-constancia-inscripcion' as const,
    observedAt,
  };
}

function node(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
