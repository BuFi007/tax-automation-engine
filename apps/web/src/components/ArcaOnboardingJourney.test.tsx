import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ARCA_ONBOARDING_UI_STEPS, ArcaOnboardingJourney } from './ArcaOnboardingJourney';

test('renders the deterministic ARCA onboarding order and credential boundary', () => {
  const html = renderToStaticMarkup(<ArcaOnboardingJourney />);
  expect(ARCA_ONBOARDING_UI_STEPS.map(step => step.id)).toEqual([
    'login_handoff',
    'service_adherence',
    'point_of_sale_discovery',
    'point_of_sale_creation',
    'ws_delegation',
    'api_verification',
    'zk_evidence',
    'ready',
  ]);
  expect(html).toContain('Clave Fiscal stays between you and ARCA');
  expect(html).toContain('Reclaim cannot create a point of sale or delegation');
  expect(html).toContain('Export + local · WSFEX and WSFE');
  expect(html).toContain('Continue with ARCA');
});
