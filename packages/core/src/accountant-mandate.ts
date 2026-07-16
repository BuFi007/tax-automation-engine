export type AccountantMandateScope =
  | 'review_tax_obligation'
  | 'approve_invoice_intent'
  | 'approve_invoice_adjustment'
  | 'verify_fx_ingress'
  | 'record_tax_declaration'
  | 'export_accountant_packet';

export type AccountantMandateV1 = Readonly<{
  version: 'accountant-mandate-v1';
  mandateId: string;
  workspaceId: string;
  accountantActorId: string;
  accountantOrganizationId: string;
  scopes: readonly AccountantMandateScope[];
  grantedByActorId: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}>;

export type AccountantClientCaseSummaryV1 = Readonly<{
  version: 'accountant-client-case-summary-v1';
  workspaceId: string;
  nextDueAt: string | null;
  outstandingObligationCount: number;
  professionalReviewCount: number;
  clientApprovalCount: number;
}>;

export type AccountantPortfolioProjectionV1 = Readonly<{
  version: 'accountant-portfolio-projection-v1';
  accountantActorId: string;
  accountantOrganizationId: string;
  asOf: string;
  clients: readonly AccountantClientCaseSummaryV1[];
  totals: Readonly<{
    authorizedClientCount: number;
    outstandingObligationCount: number;
    professionalReviewCount: number;
    clientApprovalCount: number;
  }>;
}>;

export function assertActiveAccountantMandate(
  mandate: AccountantMandateV1,
  input: Readonly<{
    workspaceId: string;
    accountantActorId: string;
    scope: AccountantMandateScope;
    at: string;
  }>,
): void {
  if (mandate.version !== 'accountant-mandate-v1') throw new Error('ACCOUNTANT_MANDATE_VERSION_UNSUPPORTED');
  if (mandate.workspaceId !== input.workspaceId) throw new Error('ACCOUNTANT_MANDATE_WORKSPACE_UNAUTHORIZED');
  if (mandate.accountantActorId !== input.accountantActorId) throw new Error('ACCOUNTANT_MANDATE_ACTOR_UNAUTHORIZED');
  if (!mandate.scopes.includes(input.scope)) throw new Error('ACCOUNTANT_MANDATE_SCOPE_UNAUTHORIZED');
  const at = instant(input.at);
  const grantedAt = instant(mandate.grantedAt);
  const expiresAt = instant(mandate.expiresAt);
  if (expiresAt <= grantedAt) throw new Error('ACCOUNTANT_MANDATE_INVALID_WINDOW');
  if (at < grantedAt) throw new Error('ACCOUNTANT_MANDATE_NOT_ACTIVE');
  if (at >= expiresAt) throw new Error('ACCOUNTANT_MANDATE_EXPIRED');
  if (mandate.revokedAt !== null && at >= instant(mandate.revokedAt)) throw new Error('ACCOUNTANT_MANDATE_REVOKED');
}

/**
 * Produces a deliberately non-financial firm view. A client appears only when
 * the exact actor + organization has an active review mandate for that tenant.
 * Canonical case data remains owned by the client workspace.
 */
export function buildAccountantPortfolioProjection(input: Readonly<{
  accountantActorId: string;
  accountantOrganizationId: string;
  at: string;
  mandates: readonly AccountantMandateV1[];
  clientCases: readonly AccountantClientCaseSummaryV1[];
}>): AccountantPortfolioProjectionV1 {
  instant(input.at);
  const caseByWorkspace = new Map<string, AccountantClientCaseSummaryV1>();
  for (const clientCase of input.clientCases) {
    validateClientCase(clientCase);
    if (caseByWorkspace.has(clientCase.workspaceId)) throw new Error('ACCOUNTANT_PORTFOLIO_CLIENT_DUPLICATED');
    caseByWorkspace.set(clientCase.workspaceId, clientCase);
  }

  const authorizedWorkspaceIds = new Set<string>();
  for (const mandate of input.mandates) {
    if (mandate.accountantOrganizationId !== input.accountantOrganizationId) continue;
    try {
      assertActiveAccountantMandate(mandate, {
        workspaceId: mandate.workspaceId,
        accountantActorId: input.accountantActorId,
        scope: 'review_tax_obligation',
        at: input.at,
      });
      authorizedWorkspaceIds.add(mandate.workspaceId);
    } catch {
      // An invalid, expired, revoked, differently scoped, or differently bound
      // mandate cannot add a tenant to the firm projection.
    }
  }

  const clients = [...authorizedWorkspaceIds]
    .map(workspaceId => caseByWorkspace.get(workspaceId))
    .filter((clientCase): clientCase is AccountantClientCaseSummaryV1 => clientCase !== undefined)
    .sort((left, right) => compareNullableInstants(left.nextDueAt, right.nextDueAt) || left.workspaceId.localeCompare(right.workspaceId));

  return {
    version: 'accountant-portfolio-projection-v1',
    accountantActorId: input.accountantActorId,
    accountantOrganizationId: input.accountantOrganizationId,
    asOf: input.at,
    clients,
    totals: {
      authorizedClientCount: clients.length,
      outstandingObligationCount: clients.reduce((total, client) => total + client.outstandingObligationCount, 0),
      professionalReviewCount: clients.reduce((total, client) => total + client.professionalReviewCount, 0),
      clientApprovalCount: clients.reduce((total, client) => total + client.clientApprovalCount, 0),
    },
  };
}

function validateClientCase(clientCase: AccountantClientCaseSummaryV1): void {
  if (clientCase.version !== 'accountant-client-case-summary-v1' || !clientCase.workspaceId) throw new Error('ACCOUNTANT_PORTFOLIO_CLIENT_INVALID');
  if (clientCase.nextDueAt !== null) instant(clientCase.nextDueAt);
  for (const count of [clientCase.outstandingObligationCount, clientCase.professionalReviewCount, clientCase.clientApprovalCount]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('ACCOUNTANT_PORTFOLIO_COUNT_INVALID');
  }
}

function compareNullableInstants(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return instant(left) - instant(right);
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/[zZ]|[+-]\d\d:\d\d$/.test(value)) throw new Error('ACCOUNTANT_MANDATE_INVALID_TIMESTAMP');
  return parsed;
}
