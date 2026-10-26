import { describe, expect, test } from 'bun:test';

import type { ArcaSetupWireOrder } from '@tax-engine/arca-setup-contract';

import { cuits } from './arca-portal';
import { runArcaSetupOperation, type BoundaryExecutorClient, type OperationContext } from './operations';
import { ArcaPortalError, type ArcaPortal, type ArcaService, type RelationshipState } from './portal';

const TAXPAYER = '30712345674';
const LOGIN = '20123456786';
const OTHER = '27300000008';
const PROVIDER = '30711111118';
const H = (char: string) => char.repeat(64);

class FakePortal implements ArcaPortal {
  calls: string[] = [];
  authenticated = true;
  represented: string | null = null;
  services = { relationshipManager: true, pointOfSaleAdministration: true, certificateAdministration: true };
  certificate: { exists: boolean; issued: string | null } = { exists: false, issued: null };
  relationships: Record<ArcaService, RelationshipState> = { wsfex: 'none', wsfe: 'none' };
  points = { exportWebServices: [] as number[], domesticWebServices: [] as number[], usedNumbers: [] as number[], domicileCount: 1 };
  pending: Record<ArcaService, string[]> = { wsfex: [], wsfe: [] };
  createRecords = true;
  failWith: ArcaPortalError | Error | null = null;

  private guard(name: string) {
    this.calls.push(name);
    if (this.failWith) throw this.failWith;
  }
  async openLogin() { this.guard('openLogin'); }
  async isAuthenticated() { return this.authenticated; }
  async readIdentity() { this.guard('readIdentity'); return { loginCuit: LOGIN, representableCuits: [OTHER, TAXPAYER] }; }
  async selectRepresented(cuit: string) { this.guard(`select:${cuit}`); this.represented = cuit; }
  async readServices() { this.guard('readServices'); return { ...this.services }; }
  async adhereService(service: 'point_of_sale_administration' | 'certificate_administration') {
    this.guard(`adhere:${service}`);
    if (service === 'point_of_sale_administration') this.services.pointOfSaleAdministration = true;
    else this.services.certificateAdministration = true;
  }
  async readCertificates() {
    this.guard('readCertificates');
    return { intendedAliasExists: this.certificate.exists, intendedAliasCertificateValidUntil: null, otherAliasCount: 0 };
  }
  async readRelationships() { this.guard('readRelationships'); return { ...this.relationships }; }
  async readPointsOfSale() { this.guard('readPointsOfSale'); return { ...this.points }; }
  async createPointOfSale(input: { number: number; system: 'export_web_services' | 'domestic_web_services' }) {
    this.guard(`createPoint:${input.number}`);
    if (this.points.domicileCount > 1) return 'domicile_choice_required' as const;
    if (this.createRecords) {
      if (input.system === 'export_web_services') this.points.exportWebServices.push(input.number);
      else this.points.domesticWebServices.push(input.number);
      this.points.usedNumbers.push(input.number);
    }
    return 'submitted' as const;
  }
  async submitCsr(input: { alias: string; csrPem: string; aliasExists: boolean }) {
    this.guard(`submitCsr:${input.aliasExists}`);
    this.certificate = { exists: true, issued: `CERT-FOR:${input.csrPem}` };
  }
  async downloadCertificate() {
    this.guard('downloadCertificate');
    if (!this.certificate.issued) throw new ArcaPortalError('ARCA_CERTIFICATE_NOT_AVAILABLE');
    return this.certificate.issued;
  }
  async relateAliasToService(input: { service: ArcaService }) { this.guard(`relate:${input.service}`); this.relationships[input.service] = 'customer_alias'; }
  async delegateToProvider(input: { service: ArcaService }) { this.guard(`delegate:${input.service}`); this.relationships[input.service] = 'provider_pending'; }
  async readPendingDesignations(service: ArcaService) { this.guard(`pending:${service}`); return [...this.pending[service]]; }
  async acceptDesignation(input: { representedCuit: string; service: ArcaService }) {
    this.guard(`accept:${input.service}:${input.representedCuit}`);
    this.pending[input.service] = this.pending[input.service].filter(value => value !== input.representedCuit);
  }
  representedList: string[] = [];
  async readRepresentedTaxpayers() { this.guard('represented'); return [...this.representedList]; }
  async bindProviderAlias(input: { service: ArcaService }) { this.guard(`bind:${input.service}`); }
}

class FakeBoundary implements BoundaryExecutorClient {
  calls: string[] = [];
  csr = 'CSR-1';
  async matchTaxpayer(input: { candidates: readonly string[] }) {
    this.calls.push(`match:${input.candidates.length}`);
    const index = input.candidates.indexOf(TAXPAYER);
    return {
      matched: index >= 0,
      matchIndex: index >= 0 ? index : null,
      representedCuitCommitment: index >= 0 ? H('c') : null,
      loginIdentityHash: H('l'),
    };
  }
  async readCsr() { this.calls.push('readCsr'); return { csrPem: this.csr, csrHash: H('d') }; }
  async importCertificate(input: { certificatePem: string }) {
    this.calls.push('import');
    if (input.certificatePem !== `CERT-FOR:${this.csr}`) throw new Error('ARCA_SETUP_CERTIFICATE_KEY_MISMATCH');
    return { certificateFingerprint: H('f'), validUntil: '2028-10-26T00:00:00.000Z', chainVerified: true };
  }
}

function order(operation: ArcaSetupWireOrder['operation'], parameters: ArcaSetupWireOrder['parameters'] = {}): ArcaSetupWireOrder {
  return {
    version: 'arca-setup-order-v1',
    orderId: `order-${operation}`,
    executionId: '22222222-2222-4222-8222-222222222222',
    onboardingId: '11111111-1111-4111-8111-111111111111',
    workspaceId: 'workspace-1',
    environment: 'homologation',
    operation,
    authorizationId: 'auth-1',
    expectedRevision: 3,
    attempt: 1,
    parameters: { setupRef: 'setup://55555555-5555-4555-8555-555555555555', intendedAlias: 'bufi-arca-homo', ...parameters },
    issuedAt: '2026-10-26T12:00:00.000Z',
    expiresAt: '2026-10-26T12:30:00.000Z',
  };
}

function context(portal = new FakePortal(), boundary = new FakeBoundary()): OperationContext & { portal: FakePortal; boundary: FakeBoundary } {
  return { portal, boundary, providerCuit: PROVIDER, providerAlias: 'bufi-provider', now: () => new Date('2026-10-26T12:01:00.000Z') };
}

describe('ARCA setup operations', () => {
  test('authentication verifies the taxpayer through the boundary and selects it', async () => {
    const ctx = context();
    const receipt = await runArcaSetupOperation(order('authenticate'), ctx);
    expect(receipt.outcome).toBe('completed');
    expect(ctx.portal.represented).toBe(TAXPAYER);
    expect(JSON.stringify(receipt)).not.toContain(TAXPAYER);
    expect(JSON.stringify(receipt)).not.toContain(LOGIN);
  });

  test('a session without the intended taxpayer stops as wrong taxpayer', async () => {
    const ctx = context();
    ctx.portal.readIdentity = async () => ({ loginCuit: LOGIN, representableCuits: [OTHER] });
    const receipt = await runArcaSetupOperation(order('authenticate'), ctx);
    expect(receipt).toMatchObject({ outcome: 'blocked', code: 'ARCA_SETUP_WRONG_TAXPAYER' });
    expect(ctx.portal.represented).toBeNull();
  });

  test('inspection reports a safe inventory with stable evidence', async () => {
    const ctx = context();
    ctx.portal.points = { exportWebServices: [7, 3], domesticWebServices: [1], usedNumbers: [1, 3, 7], domicileCount: 2 };
    const receipt = await runArcaSetupOperation(order('inspect'), ctx);
    expect(receipt.inventory?.pointsOfSale.exportWebServices).toEqual([3, 7]);
    expect(receipt.inventory?.identity).toMatchObject({ representedMatches: true, representedCuitCommitment: H('c') });
    expect(receipt.inventory?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('a retried point-of-sale creation does not create a second point', async () => {
    const ctx = context();
    ctx.portal.points.exportWebServices = [4];
    const receipt = await runArcaSetupOperation(order('create_point_of_sale', { system: 'export_web_services', number: 5 }), ctx);
    expect(receipt).toMatchObject({ outcome: 'completed', result: { created: false, existing: true } });
    expect(ctx.portal.calls.some(call => call.startsWith('createPoint'))).toBe(false);
  });

  test('point creation skips used numbers, and is uncertain when ARCA does not show it', async () => {
    const ctx = context();
    ctx.portal.points.usedNumbers = [5, 6];
    ctx.portal.createRecords = false;
    const receipt = await runArcaSetupOperation(order('create_point_of_sale', { system: 'export_web_services', number: 5 }), ctx);
    expect(ctx.portal.calls).toContain('createPoint:7');
    expect(receipt).toMatchObject({ outcome: 'uncertain', code: 'ARCA_SUBMISSION_UNCONFIRMED' });
  });

  test('several domiciles hand the choice to the customer inside ARCA', async () => {
    const ctx = context();
    ctx.portal.points.domicileCount = 3;
    const receipt = await runArcaSetupOperation(order('create_point_of_sale', { system: 'export_web_services', number: 1 }), ctx);
    expect(receipt.outcome).toBe('handoff_required');
  });

  test('certificate enrollment uploads the CSR from the boundary and imports the issued certificate', async () => {
    const ctx = context();
    const receipt = await runArcaSetupOperation(order('enroll_certificate', {
      enrollmentRef: 'enrollment://66666666-6666-4666-8666-666666666666', alias: 'bufi-arca-homo', aliasExists: false,
    }), ctx);
    expect(receipt.outcome).toBe('completed');
    expect(ctx.portal.calls).toContain('submitCsr:false');
    expect(ctx.boundary.calls).toEqual(expect.arrayContaining(['readCsr', 'import']));
    expect(JSON.stringify(receipt)).not.toContain('CERT-FOR');
  });

  test('a retry after an uncertain upload imports the existing certificate instead of uploading again', async () => {
    const ctx = context();
    ctx.portal.certificate = { exists: true, issued: 'CERT-FOR:CSR-1' };
    const receipt = await runArcaSetupOperation(order('enroll_certificate', {
      enrollmentRef: 'enrollment://66666666-6666-4666-8666-666666666666', alias: 'bufi-arca-homo', aliasExists: true,
    }), ctx);
    expect(receipt.outcome).toBe('completed');
    expect(ctx.portal.calls.some(call => call.startsWith('submitCsr'))).toBe(false);
  });

  test('an older certificate on the alias is not ours: upload a new CSR to the same alias', async () => {
    const ctx = context();
    ctx.portal.certificate = { exists: true, issued: 'CERT-FOR:OLD-KEY' };
    const receipt = await runArcaSetupOperation(order('enroll_certificate', {
      enrollmentRef: 'enrollment://66666666-6666-4666-8666-666666666666', alias: 'bufi-arca-homo', aliasExists: true,
    }), ctx);
    expect(ctx.portal.calls).toContain('submitCsr:true');
    expect(receipt.outcome).toBe('completed');
  });

  test('existing delegation is reused instead of delegating twice', async () => {
    const ctx = context();
    ctx.portal.relationships.wsfex = 'provider_pending';
    const receipt = await runArcaSetupOperation(order('delegate_to_provider', { services: ['wsfex'] }), ctx);
    expect(receipt.outcome).toBe('completed');
    expect(ctx.portal.calls.some(call => call.startsWith('delegate:'))).toBe(false);
  });

  test('alias authorization relates only the missing services and verifies them', async () => {
    const ctx = context();
    ctx.portal.relationships.wsfe = 'customer_alias';
    const receipt = await runArcaSetupOperation(order('authorize_web_services', { alias: 'bufi-arca-homo', services: ['wsfex', 'wsfe'] }), ctx);
    expect(receipt.outcome).toBe('completed');
    expect(ctx.portal.calls.filter(call => call.startsWith('relate:'))).toEqual(['relate:wsfex']);
  });

  test('provider acceptance accepts only the designation of the run taxpayer', async () => {
    const ctx = context();
    ctx.portal.pending.wsfex = [OTHER, TAXPAYER];
    const receipt = await runArcaSetupOperation(order('provider_accept', { services: ['wsfex'] }), ctx);
    expect(receipt).toMatchObject({ outcome: 'completed', result: { acceptedServices: 'wsfex' } });
    expect(ctx.portal.calls).toContain(`accept:wsfex:${TAXPAYER}`);
    expect(ctx.portal.calls).not.toContain(`accept:wsfex:${OTHER}`);
  });

  test('an already accepted designation is bound to BUFI alias without accepting twice', async () => {
    const ctx = context();
    ctx.portal.representedList = [TAXPAYER];
    const receipt = await runArcaSetupOperation(order('provider_accept', { services: ['wsfex'] }), ctx);
    expect(receipt).toMatchObject({ outcome: 'completed', result: { acceptedServices: 'wsfex' } });
    expect(ctx.portal.calls.some(call => call.startsWith('accept:'))).toBe(false);
    expect(ctx.portal.calls).toContain('bind:wsfex');
  });

  test('an expired ARCA session is a recoverable block; an unexpected error is uncertain', async () => {
    const ctx = context();
    ctx.portal.failWith = new ArcaPortalError('ARCA_SESSION_EXPIRED');
    expect(await runArcaSetupOperation(order('inspect'), ctx)).toMatchObject({ outcome: 'blocked', code: 'ARCA_SESSION_EXPIRED' });
    ctx.portal.failWith = new Error('socket hang up');
    expect(await runArcaSetupOperation(order('delegate_to_provider', { services: ['wsfex'] }), ctx))
      .toMatchObject({ outcome: 'uncertain', code: 'ARCA_SETUP_EXECUTOR_ERROR' });
  });

  test('CUIT extraction accepts dashed and plain forms once', () => {
    expect(cuits('Usuario 20-12345678-6 [30712345674] 20123456786')).toEqual(['20123456786', '30712345674']);
  });
});
