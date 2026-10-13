import { describe, expect, test } from 'bun:test';

import {
  FACTURA_E_FACTORING_STATES_V1,
  facturaEFactoringProjectionV1Schema,
  taxCaseV1Schema,
  taxWidgetSnapshotV1Schema,
} from './contracts';
import { taxCommandProblemV1Schema } from './problems';
import {
  TAX_BROWSER_SCENARIO_FIXTURES_V1,
  TAX_BROWSER_SCENARIO_FIXTURES_V1_SHA256,
} from './scenario-fixtures';

describe('complete Tax browser scenario catalogue', () => {
  test('covers the frozen AR, US, and Dubai Free Zone entity stories', () => {
    const cases = TAX_BROWSER_SCENARIO_FIXTURES_V1.cases;
    expect(Object.values(cases).every(value => taxCaseV1Schema.safeParse(value).success)).toBe(true);
    expect(cases.argentinaMonotributistaExporter.profile?.regimeId).toBe('monotributo_exportador');
    expect(cases.argentinaResponsibleInscripto.profile?.regimeId).toBe('responsable_inscripto');
    expect(cases.usDomesticLlc.profile?.regimeId).toBe('llc_single_member_domestic');
    expect(cases.usForeignOwnedLlc.profile?.regimeId).toBe('llc_single_member_foreign_owned');
    expect(cases.usCCorp.profile?.regimeId).toBe('c_corp');
    expect(cases.uaeDubaiFreeZone.profile?.regimeId).toBe('uae_free_zone_person');
  });

  test('covers stale, offline, partial, and failed providers without optimistic health', () => {
    const scenarios = TAX_BROWSER_SCENARIO_FIXTURES_V1.sourceHealth;
    expect(Object.values(scenarios).every(value => taxWidgetSnapshotV1Schema.safeParse(value).success)).toBe(true);
    expect(scenarios.partial.sourceHealth.state).toBe('degraded');
    expect(scenarios.stale.sourceHealth.state).toBe('degraded');
    expect(scenarios.offline.sourceHealth.state).toBe('not_connected');
    expect(scenarios.providerFailure.sourceHealth.state).toBe('blocked');
  });

  test('covers every Factura E factoring presentation state', () => {
    const factoring = TAX_BROWSER_SCENARIO_FIXTURES_V1.factoring;
    expect(Object.keys(factoring).sort()).toEqual([...FACTURA_E_FACTORING_STATES_V1].sort());
    expect(Object.values(factoring).every(value => facturaEFactoringProjectionV1Schema.safeParse(value).success)).toBe(true);
    expect(factoring.needs_consent.consentState).toBe('missing');
    expect(factoring.missing_collection.state).toBe('missing_collection');
    expect(factoring.funded.offer.state).toBe('funded');
  });

  test('covers accountant changes and ARCA rejection, ambiguity, and reconciliation', () => {
    const cases = TAX_BROWSER_SCENARIO_FIXTURES_V1.cases;
    expect(cases.accountantChangesRequested.approvals[0]?.state).toBe('rejected');
    expect(cases.arcaRejected.steps[0]?.limitationCodes).toContain('ARCA_AUTHORITY_REJECTED');
    expect(cases.arcaAmbiguous.steps[0]?.limitationCodes).toContain('ARCA_AUTHORITY_OUTCOME_AMBIGUOUS');
    expect(cases.arcaReconciled.steps[0]?.completionEvidenceRefs).toHaveLength(1);
  });

  test('publishes safe cross-tenant, OCC, idempotency, and ambiguous-effect problems', () => {
    const problems = TAX_BROWSER_SCENARIO_FIXTURES_V1.commandProblems;
    expect(Object.values(problems).every(value => taxCommandProblemV1Schema.safeParse(value).success)).toBe(true);
    expect(problems.crossTenantDenied).toMatchObject({ status: 403, state: 'forbidden', retryable: false });
    expect(problems.optimisticConcurrency).toMatchObject({ status: 409, state: 'refresh_required', retryable: true, currentCaseRevision: 9 });
    expect(problems.authorityAmbiguous).toMatchObject({ status: 425, state: 'reconcile_required', retryable: false });
  });

  test('pins the entire acceptance catalogue for cross-repository upgrades', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(TAX_BROWSER_SCENARIO_FIXTURES_V1));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    expect(actual).toBe(TAX_BROWSER_SCENARIO_FIXTURES_V1_SHA256);
  });
});
