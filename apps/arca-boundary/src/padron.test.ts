import { expect, test } from 'bun:test';

import { parseIssuerPadron } from './padron';

const now = '2026-09-28T12:00:00.000Z';
const cuit = '20123456786';

test('maps official issuer activities and active IVA without returning credentials', () => {
  const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns:getPersona_v2Response><personaReturn><datosGenerales><idPersona>${cuit}</idPersona><nombre>ANA</nombre><apellido>PEREZ</apellido></datosGenerales><datosRegimenGeneral><actividad><idActividad>620900</idActividad><descripcionActividad>SERVICIOS DE INFORMATICA</descripcionActividad></actividad><impuesto><idImpuesto>30</idImpuesto><estadoImpuesto>AC</estadoImpuesto></impuesto></datosRegimenGeneral></personaReturn></ns:getPersona_v2Response></soap:Body></soap:Envelope>`;
  const result = parseIssuerPadron(xml, cuit, now);
  expect(result).toEqual({ version: 'arca-issuer-padron-result-v1', cuit,
    legalName: 'ANA PEREZ', vatCondition: 'responsable_inscripto',
    activities: [{ code: '620900', description: 'SERVICIOS DE INFORMATICA' }],
    source: 'arca-constancia-inscripcion', observedAt: now });
  expect(() => parseIssuerPadron(xml, '27300000008', now)).toThrow('ARCA_PADRON_CUIT_MISMATCH');
});

test('does not interpret missing or inactive IVA enrollment as Responsable Inscripto', () => {
  const xml = `<Envelope><Body><getPersona_v2Response><personaReturn><datosGenerales><idPersona>${cuit}</idPersona><razonSocial>ESTUDIO SA</razonSocial></datosGenerales><datosRegimenGeneral><impuesto><idImpuesto>30</idImpuesto><estadoImpuesto>BA</estadoImpuesto></impuesto></datosRegimenGeneral></personaReturn></getPersona_v2Response></Body></Envelope>`;
  expect(parseIssuerPadron(xml, cuit, now).vatCondition).toBe('unknown');
  expect(() => parseIssuerPadron('<Envelope><Body><Fault/></Body></Envelope>', cuit, now))
    .toThrow('ARCA_PADRON_SOAP_FAULT');
  expect(() => parseIssuerPadron(`<Envelope><Body><getPersona_v2Response><personaReturn><datosGenerales><idPersona>${cuit}</idPersona></datosGenerales></personaReturn></getPersona_v2Response></Body></Envelope>`, cuit, now))
    .toThrow('ARCA_PADRON_RECORD_INCOMPLETE');
});
