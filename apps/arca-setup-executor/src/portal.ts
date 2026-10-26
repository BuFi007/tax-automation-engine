/**
 * What the executor can do on ARCA's portal.
 *
 * Every method is a postcondition-checked unit: it either leaves ARCA in the
 * described state or throws an `ArcaPortalError` with a stable code. Raw CUITs
 * appear only in `readIdentity`, `readPendingDesignations` and the arguments
 * that need them; callers send them to the boundary and nowhere else.
 */

export type ArcaService = 'wsfex' | 'wsfe';
export type RelationshipState = 'none' | 'customer_alias' | 'provider_pending' | 'provider_active';

export interface ArcaPortal {
  /** Open the official login page in the session's single tab. */
  openLogin(): Promise<void>;
  /** True once ARCA shows an authenticated portal for some user. Reads no credential field. */
  isAuthenticated(): Promise<boolean>;
  /** The logged-in user's CUIT/CUIL and every CUIT they can act for. */
  readIdentity(): Promise<Readonly<{ loginCuit: string; representableCuits: readonly string[] }>>;
  /** Act for this CUIT in subsequent services. */
  selectRepresented(cuit: string): Promise<void>;
  readServices(): Promise<Readonly<{
    relationshipManager: boolean;
    pointOfSaleAdministration: boolean;
    certificateAdministration: boolean;
  }>>;
  adhereService(service: 'point_of_sale_administration' | 'certificate_administration'): Promise<void>;
  readCertificates(alias: string): Promise<Readonly<{
    intendedAliasExists: boolean;
    intendedAliasCertificateValidUntil: string | null;
    otherAliasCount: number;
  }>>;
  readRelationships(input: Readonly<{ alias: string; providerCuit: string | null }>): Promise<Readonly<Record<ArcaService, RelationshipState>>>;
  readPointsOfSale(): Promise<Readonly<{
    exportWebServices: readonly number[];
    domesticWebServices: readonly number[];
    usedNumbers: readonly number[];
    domicileCount: number;
  }>>;
  /** Fill the form; returns `domicile_choice_required` when ARCA lists several domiciles. */
  createPointOfSale(input: Readonly<{ number: number; system: 'export_web_services' | 'domestic_web_services' }>): Promise<'submitted' | 'domicile_choice_required'>;
  /** Upload the CSR from bytes. Creates the alias or adds a certificate to it. */
  submitCsr(input: Readonly<{ alias: string; csrPem: string; aliasExists: boolean }>): Promise<void>;
  /** Retrieve the newest certificate for the alias as bytes, never through a local path. */
  downloadCertificate(alias: string): Promise<string>;
  relateAliasToService(input: Readonly<{ alias: string; service: ArcaService }>): Promise<void>;
  delegateToProvider(input: Readonly<{ providerCuit: string; service: ArcaService }>): Promise<void>;
  /** Provider side: CUITs whose designation of BUFI is pending acceptance for a service. */
  readPendingDesignations(service: ArcaService): Promise<readonly string[]>;
  acceptDesignation(input: Readonly<{ representedCuit: string; service: ArcaService }>): Promise<void>;
  /** Provider side: CUITs BUFI can already act for (accepted designations). */
  readRepresentedTaxpayers(): Promise<readonly string[]>;
  /** Idempotent: does nothing when the alias is already related for that taxpayer and service. */
  bindProviderAlias(input: Readonly<{ representedCuit: string; service: ArcaService; alias: string }>): Promise<void>;
}

export class ArcaPortalError extends Error {
  constructor(
    readonly code:
      | 'ARCA_SESSION_EXPIRED'
      | 'ARCA_UNAVAILABLE'
      | 'ARCA_AUTOMATION_BLOCKED'
      | 'ARCA_PAGE_UNRECOGNIZED'
      | 'ARCA_SUBMISSION_UNCONFIRMED'
      | 'ARCA_CERTIFICATE_NOT_AVAILABLE'
      | 'ARCA_SERVICE_NOT_AVAILABLE'
      | 'ARCA_DESIGNATION_NOT_FOUND'
      | 'BROWSER_SESSION_GONE',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ArcaPortalError';
  }
}
