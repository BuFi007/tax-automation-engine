import {
  canonicalHash,
  type ArcaSetupWireInventory,
  type ArcaSetupWireOrder,
  type ArcaSetupWireReceipt,
} from '@tax-engine/arca-setup-contract';

import { ArcaPortalError, type ArcaPortal, type ArcaService } from './portal';

/** The executor's only window into key material: references in, public facts out. */
export interface BoundaryExecutorClient {
  matchTaxpayer(input: Readonly<{ setupRef: string; executionId: string; loginCuit: string; candidates: readonly string[] }>): Promise<Readonly<{
    matched: boolean;
    matchIndex: number | null;
    representedCuitCommitment: string | null;
    loginIdentityHash: string;
  }>>;
  readCsr(input: Readonly<{ setupRef: string; executionId: string; enrollmentRef: string }>): Promise<Readonly<{ csrPem: string; csrHash: string }>>;
  importCertificate(input: Readonly<{ setupRef: string; executionId: string; enrollmentRef: string; certificatePem: string }>): Promise<Readonly<{
    certificateFingerprint: string;
    validUntil: string;
    chainVerified: boolean;
  }>>;
}

export type OperationContext = Readonly<{
  portal: ArcaPortal;
  boundary: BoundaryExecutorClient;
  /** BUFI's representative CUIT for provider delegation. Public. */
  providerCuit: string | null;
  /** BUFI's computer alias that represents delegating taxpayers. */
  providerAlias: string | null;
  now: () => Date;
}>;

export type ReceiptDraft = Omit<ArcaSetupWireReceipt, 'version' | 'receiptId' | 'orderId' | 'executionId' | 'onboardingId' | 'workspaceId' | 'operation' | 'expectedRevision'>;

const NO_MATCH_COMMITMENT = '0'.repeat(64);

/**
 * Run one authorized order against an authenticated session.
 * The authentication handoff itself is owned by the session; by the time an
 * operation runs, `portal.isAuthenticated()` has been confirmed.
 */
export async function runArcaSetupOperation(order: ArcaSetupWireOrder, context: OperationContext): Promise<ReceiptDraft> {
  try {
    switch (order.operation) {
      case 'authenticate':
        return await authenticate(order, context);
      case 'inspect':
        return completed(context, await inspect(order, context), {});
      case 'adhere_services':
        return await adhereServices(order, context);
      case 'create_point_of_sale':
        return await createPointOfSale(order, context);
      case 'enroll_certificate':
        return await enrollCertificate(order, context);
      case 'authorize_web_services':
        return await authorizeWebServices(order, context);
      case 'delegate_to_provider':
        return await delegateToProvider(order, context);
      case 'provider_accept':
        return await providerAccept(order, context);
      case 'close_session':
        return completed(context, null, { closed: true });
    }
  } catch (error) {
    return failure(context, error);
  }
}

async function authenticate(order: ArcaSetupWireOrder, context: OperationContext): Promise<ReceiptDraft> {
  if (!(await context.portal.isAuthenticated()))
    return draft(context, 'blocked', 'ARCA_AUTHENTICATION_NOT_COMPLETED', null, {});
  const identity = await matchIdentity(order, context);
  if (!identity.matched)
    return draft(context, 'blocked', 'ARCA_SETUP_WRONG_TAXPAYER', null, { representedMatches: false });
  return completed(context, null, {
    representedMatches: true,
    loginIdentityHash: identity.loginIdentityHash,
    representedCuitCommitment: identity.commitment,
  });
}

async function matchIdentity(order: ArcaSetupWireOrder, context: OperationContext) {
  const setupRef = requiredString(order, 'setupRef');
  const identity = await context.portal.readIdentity();
  const candidates = [...new Set([identity.loginCuit, ...identity.representableCuits])].slice(0, 20);
  const match = await context.boundary.matchTaxpayer({
    setupRef, executionId: order.executionId, loginCuit: identity.loginCuit, candidates,
  });
  if (match.matched && match.matchIndex !== null) await context.portal.selectRepresented(candidates[match.matchIndex]!);
  return {
    matched: match.matched,
    loginIdentityHash: match.loginIdentityHash,
    commitment: match.representedCuitCommitment ?? NO_MATCH_COMMITMENT,
  };
}

async function inspect(order: ArcaSetupWireOrder, context: OperationContext): Promise<ArcaSetupWireInventory> {
  const alias = requiredString(order, 'intendedAlias');
  const identity = await matchIdentity(order, context);
  const services = await context.portal.readServices();
  const certificates = services.certificateAdministration
    ? await context.portal.readCertificates(alias)
    : { intendedAliasExists: false, intendedAliasCertificateValidUntil: null, otherAliasCount: 0 };
  const relationships = identity.matched
    ? await context.portal.readRelationships({ alias, providerCuit: context.providerCuit })
    : { wsfex: 'none' as const, wsfe: 'none' as const };
  const points = services.pointOfSaleAdministration && identity.matched
    ? await context.portal.readPointsOfSale()
    : { exportWebServices: [], domesticWebServices: [], usedNumbers: [], domicileCount: 0 };
  const observedAt = context.now().toISOString();
  const body = {
    version: 'arca-setup-inventory-v1' as const,
    observedAt,
    identity: {
      loginIdentityHash: identity.loginIdentityHash,
      representedCuitCommitment: identity.commitment,
      representedMatches: identity.matched,
    },
    services,
    certificates,
    relationships,
    pointsOfSale: {
      exportWebServices: sorted(points.exportWebServices),
      domesticWebServices: sorted(points.domesticWebServices),
      usedNumbers: sorted(points.usedNumbers),
      domicileCount: points.domicileCount,
    },
  };
  return { ...body, evidenceHash: await canonicalHash({ orderId: order.orderId, inventory: body }) };
}

async function adhereServices(order: ArcaSetupWireOrder, context: OperationContext): Promise<ReceiptDraft> {
  const wanted: ('point_of_sale_administration' | 'certificate_administration')[] = [];
  if (order.parameters.pointOfSaleAdministration === true) wanted.push('point_of_sale_administration');
  if (order.parameters.certificateAdministration === true) wanted.push('certificate_administration');
  const before = await context.portal.readServices();
  for (const service of wanted) {
    const present = service === 'point_of_sale_administration' ? before.pointOfSaleAdministration : before.certificateAdministration;
    if (!present) await context.portal.adhereService(service);
  }
  const inventory = await inspect(order, context);
  const missing = wanted.some(service => service === 'point_of_sale_administration'
    ? !inventory.services.pointOfSaleAdministration
    : !inventory.services.certificateAdministration);
  return missing
    ? draft(context, 'uncertain', 'ARCA_SUBMISSION_UNCONFIRMED', inventory, {})
    : completed(context, inventory, { adheredCount: wanted.length });
}

async function createPointOfSale(order: ArcaSetupWireOrder, context: OperationContext): Promise<ReceiptDraft> {
  const system = order.parameters.system === 'domestic_web_services' ? 'domestic_web_services' : 'export_web_services';
  const before = await context.portal.readPointsOfSale();
  const existing = system === 'export_web_services' ? before.exportWebServices : before.domesticWebServices;
  // A retry after an uncertain submission must not create a second point.
  if (existing.length > 0) return completed(context, await inspect(order, context), { created: false, existing: true });
  let number = typeof order.parameters.number === 'number' ? order.parameters.number : 1;
  const used = new Set(before.usedNumbers);
  while (used.has(number) && number < 99_998) number += 1;
  const outcome = await context.portal.createPointOfSale({ number, system });
  if (outcome === 'domicile_choice_required')
    return draft(context, 'handoff_required', null, null, { reason: 'choose_domicile_in_arca', number });
  const inventory = await inspect(order, context);
  const after = system === 'export_web_services' ? inventory.pointsOfSale.exportWebServices : inventory.pointsOfSale.domesticWebServices;
  return after.includes(number)
    ? completed(context, inventory, { created: true, number })
    : draft(context, 'uncertain', 'ARCA_SUBMISSION_UNCONFIRMED', inventory, { number });
}

async function enrollCertificate(order: ArcaSetupWireOrder, context: OperationContext): Promise<ReceiptDraft> {
  const setupRef = requiredString(order, 'setupRef');
  const enrollmentRef = requiredString(order, 'enrollmentRef');
  const alias = requiredString(order, 'alias');
  const reference = { setupRef, executionId: order.executionId, enrollmentRef };
  // First look for a certificate already issued for our key (retry after an uncertain upload).
  const before = await context.portal.readCertificates(alias);
  if (before.intendedAliasExists) {
    const imported = await tryImportNewest(alias, reference, context);
    if (imported) return completed(context, await inspect(order, context), imported);
  }
  const csr = await context.boundary.readCsr(reference);
  await context.portal.submitCsr({ alias, csrPem: csr.csrPem, aliasExists: before.intendedAliasExists });
  const imported = await tryImportNewest(alias, reference, context);
  if (!imported) return draft(context, 'uncertain', 'ARCA_CERTIFICATE_NOT_AVAILABLE', null, { csrHash: csr.csrHash });
  return completed(context, await inspect(order, context), { ...imported, csrHash: csr.csrHash });
}

async function tryImportNewest(
  alias: string,
  reference: Readonly<{ setupRef: string; executionId: string; enrollmentRef: string }>,
  context: OperationContext,
): Promise<Readonly<{ certificateFingerprintHash: string; chainVerified: boolean; validUntil: string }> | null> {
  let certificatePem: string;
  try {
    certificatePem = await context.portal.downloadCertificate(alias);
  } catch (error) {
    if (error instanceof ArcaPortalError && error.code === 'ARCA_CERTIFICATE_NOT_AVAILABLE') return null;
    throw error;
  }
  try {
    const receipt = await context.boundary.importCertificate({ ...reference, certificatePem });
    return {
      certificateFingerprintHash: await canonicalHash(receipt.certificateFingerprint),
      chainVerified: receipt.chainVerified,
      validUntil: receipt.validUntil,
    };
  } catch (error) {
    // The newest certificate belongs to another key (an older enrollment): not ours.
    if (error instanceof Error && error.message === 'ARCA_SETUP_CERTIFICATE_KEY_MISMATCH') return null;
    throw error;
  }
}

async function authorizeWebServices(order: ArcaSetupWireOrder, context: OperationContext): Promise<ReceiptDraft> {
  const alias = requiredString(order, 'alias');
  const services = requiredServices(order);
  const before = await context.portal.readRelationships({ alias, providerCuit: context.providerCuit });
  for (const service of services) {
    if (before[service] !== 'customer_alias') await context.portal.relateAliasToService({ alias, service });
  }
  const inventory = await inspect(order, context);
  const ok = services.every(service => inventory.relationships[service] === 'customer_alias');
  return ok
    ? completed(context, inventory, { relatedServices: services.join(',') })
    : draft(context, 'uncertain', 'ARCA_SUBMISSION_UNCONFIRMED', inventory, {});
}

async function delegateToProvider(order: ArcaSetupWireOrder, context: OperationContext): Promise<ReceiptDraft> {
  if (!context.providerCuit) return draft(context, 'failed', 'ARCA_SETUP_PROVIDER_NOT_CONFIGURED', null, {});
  const services = requiredServices(order);
  const alias = requiredString(order, 'intendedAlias');
  const before = await context.portal.readRelationships({ alias, providerCuit: context.providerCuit });
  for (const service of services) {
    if (before[service] === 'none' || before[service] === 'customer_alias')
      await context.portal.delegateToProvider({ providerCuit: context.providerCuit, service });
  }
  const inventory = await inspect(order, context);
  const ok = services.every(service => inventory.relationships[service] === 'provider_pending' || inventory.relationships[service] === 'provider_active');
  return ok
    ? completed(context, inventory, { delegatedServices: services.join(',') })
    : draft(context, 'uncertain', 'ARCA_SUBMISSION_UNCONFIRMED', inventory, {});
}

/** Runs in BUFI's own authenticated session: accept the designation and bind BUFI's alias. */
async function providerAccept(order: ArcaSetupWireOrder, context: OperationContext): Promise<ReceiptDraft> {
  if (!context.providerAlias) return draft(context, 'failed', 'ARCA_SETUP_PROVIDER_NOT_CONFIGURED', null, {});
  const setupRef = requiredString(order, 'setupRef');
  const services = requiredServices(order);
  const accepted: ArcaService[] = [];
  const identity = await context.portal.readIdentity();
  const represented = await context.portal.readRepresentedTaxpayers();
  for (const service of services) {
    const pending = await context.portal.readPendingDesignations(service);
    const candidates = [...new Set([...pending, ...represented])].slice(0, 20);
    if (candidates.length === 0) continue;
    const match = await context.boundary.matchTaxpayer({
      setupRef, executionId: order.executionId, loginCuit: identity.loginCuit, candidates,
    });
    if (!match.matched || match.matchIndex === null) continue;
    const representedCuit = candidates[match.matchIndex]!;
    if (pending.includes(representedCuit)) await context.portal.acceptDesignation({ representedCuit, service });
    await context.portal.bindProviderAlias({ representedCuit, service, alias: context.providerAlias });
    const still = await context.portal.readPendingDesignations(service);
    if (still.includes(representedCuit)) return draft(context, 'uncertain', 'ARCA_SUBMISSION_UNCONFIRMED', null, {});
    accepted.push(service);
  }
  if (accepted.length !== services.length)
    return draft(context, 'blocked', 'ARCA_DESIGNATION_NOT_FOUND', null, { acceptedServices: accepted.join(',') });
  return completed(context, null, { acceptedServices: accepted.join(',') });
}

function requiredServices(order: ArcaSetupWireOrder): ArcaService[] {
  const raw = order.parameters.services;
  const services = (Array.isArray(raw) ? raw : []).filter((value): value is ArcaService => value === 'wsfex' || value === 'wsfe');
  if (services.length === 0) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'ORDER_SERVICES_REQUIRED');
  return services;
}

function requiredString(order: ArcaSetupWireOrder, key: string): string {
  const value = order.parameters[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`ARCA_SETUP_ORDER_PARAMETER_${key.toUpperCase()}_REQUIRED`);
  return value;
}

function sorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

async function completed(
  context: OperationContext,
  inventory: ArcaSetupWireInventory | null,
  result: ReceiptDraft['result'],
): Promise<ReceiptDraft> {
  return draft(context, 'completed', null, inventory, result);
}

async function draft(
  context: OperationContext,
  outcome: ReceiptDraft['outcome'],
  code: string | null,
  inventory: ArcaSetupWireInventory | null,
  result: ReceiptDraft['result'],
): Promise<ReceiptDraft> {
  const observedAt = context.now().toISOString();
  return {
    outcome,
    code,
    observedAt,
    evidenceHash: await canonicalHash({ outcome, code, inventory: inventory?.evidenceHash ?? null, result, observedAt }),
    inventory,
    result,
  };
}

async function failure(context: OperationContext, error: unknown): Promise<ReceiptDraft> {
  if (error instanceof ArcaPortalError) {
    const retryable = error.code !== 'ARCA_SERVICE_NOT_AVAILABLE';
    return draft(context, error.code === 'ARCA_SUBMISSION_UNCONFIRMED' ? 'uncertain' : retryable ? 'blocked' : 'failed', error.code, null, {});
  }
  const message = error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message) ? error.message : 'ARCA_SETUP_EXECUTOR_ERROR';
  // An unexpected error mid-mutation leaves ARCA state unknown: inspect before anything else.
  return draft(context, 'uncertain', message, null, {});
}
