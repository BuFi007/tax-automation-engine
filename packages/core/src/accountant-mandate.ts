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

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/[zZ]|[+-]\d\d:\d\d$/.test(value)) throw new Error('ACCOUNTANT_MANDATE_INVALID_TIMESTAMP');
  return parsed;
}
