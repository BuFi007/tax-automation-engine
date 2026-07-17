import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArcaOnboardingJourney } from './ArcaOnboardingJourney';
import { ARCA_ONBOARDING_UI_STEPS, parseArcaPointOfSale } from './ArcaOnboardingJourney.model';

test('renders the deterministic ARCA onboarding order and credential boundary', () => {
  const html = renderToStaticMarkup(<ArcaOnboardingJourney />);
  expect(ARCA_ONBOARDING_UI_STEPS.map(step => step.id)).toEqual([
    'login_handoff',
    'human_auth',
    'service_adherence',
    'point_of_sale_discovery',
    'point_of_sale_creation',
    'ws_delegation',
    'api_verification',
    'zk_evidence',
    'ready',
  ]);
  expect(html).toContain('Clave Fiscal stays between you and ARCA');
  expect(html).toContain('Motora pauses capture while you authenticate');
  expect(html).toContain('Reclaim no puede crear el punto ni la delegación');
  expect(html).toContain('Export + local · WSFEX and WSFE');
  expect(html).toContain('Creá el punto para Factura E por Webservices');
  expect(html).toContain('0 puntos FEEWS activos');
  expect(html).toContain('Comprobantes de Exportación - Webservices');
  expect(html).toContain('Guardar punto y continuar');
  expect(html).toContain('system=padron-puc-consulta-internet');
});

test('accepts only the five-digit ARCA point-of-sale range', () => {
  expect(parseArcaPointOfSale('00004')).toBe(4);
  expect(parseArcaPointOfSale('99998')).toBe(99_998);
  expect(parseArcaPointOfSale('00000')).toBeNull();
  expect(parseArcaPointOfSale('99999')).toBeNull();
  expect(parseArcaPointOfSale('4')).toBeNull();
});

test('requires an explicit selector when ARCA returns multiple active FEEWS points', () => {
  const html = renderToStaticMarkup(<ArcaOnboardingJourney activeFeeWsPoints={[4, 7]} />);
  expect(html).toContain('ARCA devolvió <strong>2 puntos FEEWS activos</strong>');
  expect(html).toContain('Seleccioná un punto');
  expect(html).toContain('00004 · FEEWS activo');
  expect(html).toContain('00007 · FEEWS activo');
  expect(html).toContain('Motora no selecciona uno silenciosamente');
});
