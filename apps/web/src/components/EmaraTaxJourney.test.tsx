import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { unitedStatesTaxWidgetSnapshotV1Fixture } from '@tax-engine/browser-contracts/fixtures';
import type { TaxWidgetSnapshotV1 } from '@tax-engine/browser-contracts';

import { EmaraTaxJourney } from './EmaraTaxJourney';

test('renders a user-controlled Dubai Free Zone journey without claiming FTA acceptance', () => {
  const snapshot = {
    ...structuredClone(unitedStatesTaxWidgetSnapshotV1Fixture),
    profile: {
      ...unitedStatesTaxWidgetSnapshotV1Fixture.profile,
      jurisdiction: 'AE', entityType: 'fzco', regimeId: 'uae_free_zone_person',
    },
    jurisdictionProfileReadiness: {
      version: 'tax-jurisdiction-profile-readiness-v1', kind: 'ae_free_zone_entity', state: 'accountant_review',
      formationEmirate: 'AE-DU', entityStructure: 'free_zone_company', corporateTaxRegistration: 'submitted',
      vatThresholdState: 'needs_review', vatRegistration: 'submitted', qualifyingFreeZoneStatus: 'professional_review_required',
      accountantReviewRequired: true,
      limitationCodes: ['AE_VAT_THRESHOLD_REVIEW_REQUIRED', 'AE_FREE_ZONE_STATUS_REVIEW_REQUIRED', 'AE_SPECIALIST_ACCOUNTANT_REVIEW_REQUIRED'],
    },
  } as TaxWidgetSnapshotV1;
  const html = renderToStaticMarkup(<EmaraTaxJourney snapshot={snapshot} />);

  expect(html).toContain('Prepare taxes, then hand off to EmaraTax');
  expect(html).toContain('submitted and remains in FTA review');
  expect(html).toContain('not an acceptance or certificate');
  expect(html).toContain('Free Zone incorporation is not blanket 0%');
  expect(html).toContain('UAE PASS credentials never enter');
  expect(html).toContain('https://eservices.tax.gov.ae/');
});
