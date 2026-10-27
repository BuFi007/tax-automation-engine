import {
  assertArgentinaProductionBoundary,
  listJurisdictionProviders,
  taxWorkspaceIdSchema,
} from '@tax-engine/core';
import { ContabiliumSandboxProvider } from '@tax-engine/erp';
import { z } from 'zod';
import type { SqlDatabase } from '@tax-engine/sql-store';
import { createHash, timingSafeEqual } from 'node:crypto';

import { applyCors } from './cors';
import { handleAgentRoute } from './agent-routes';
import { handleInvoiceSettlementAdapterRoute } from './invoice-settlement-adapter-routes';
import { FacturaEAgentService } from './factura-e-agent';
import { HttpReclaimProofVault } from './proof-vault';
import { ReclaimProtocolGateway } from './reclaim';
import { TaxProfileStore, resolveTaxEngineDatabasePath } from './store';
import { ArcaIssuerProfileRegistry } from './arca-issuer-profile-registry';
import { HttpWsfexGateway } from './wsfex';
import { HttpWsfePointOfSaleGateway } from './wsfe';
import { HttpAuthorityPayloadWriter } from './authority-payload';
import { ArcaOnboardingService } from './arca-onboarding';
import { HttpArcaWorkbenchPublisher } from './arca-workbench';
import { ReclaimArcaOnboardingGateway } from './arca-onboarding-reclaim';
import { handleArcaOnboardingRoute } from './arca-onboarding-routes';
import { ArcaSetupAutomationService } from './arca-setup-automation';
import { HttpArcaSetupBoundaryGateway, HttpArcaSetupExecutorGateway } from './arca-setup-clients';
import { handleArcaSetupProviderRoute, handleArcaSetupReceiptRoute, handleArcaSetupUserRoute, isArcaSetupUserPath } from './arca-setup-routes';
import { ArcaSetupStore } from './arca-setup-store';
import { HttpArcaBoundaryStatusReader, issuerAcceptanceForPrincipal, latestArcaConnectionProjectionForPrincipal, latestPrivateArcaConnectionProjection, privateArcaConnectionProjection, revokeArcaConnectionForPrincipal } from './arca-connection-projection';
import { PersonalWsfeAttemptStore } from './personal-wsfe-attempt';
import { handleWsfeAttemptRoute } from './wsfe-attempt-routes';
import { arcaFiscalBetaFromEnvironment } from './arca-fiscal-beta';
import { TaxEvidenceWorkspaceService } from './evidence-workspace';
import { handleTaxEvidenceRoute } from './evidence-routes';
import {
  resolveTaxBrowserReferenceSecret,
  TaxBrowserSnapshotProjector,
  TaxBrowserSnapshotService,
} from './browser-snapshot';
import { handleTaxBrowserSnapshotRoute } from './browser-snapshot-routes';
import { handleFacturaEFactoringBrowserRoute } from './factura-e-factoring-browser-routes';
import { classifyApiError } from './api-errors';
import {
  assertTaxTenantPrincipalScope,
  requiredTaxTenantPrincipalCapability,
  taxTenantPrincipalSecretForCapability,
  verifyBoundTaxTenantPrincipal,
  verifyBoundTaxTenantPrincipalForRawBody,
  verifyTaxTenantPrincipal,
} from './tenant-principal';
import {
  FacturaEAuthorityExecutionService,
  FacturaEAuthorityExecutionStore,
} from './authority-execution';
import { handleFacturaEAuthorityCorridorRoute } from './authority-corridor-routes';
import {
  assertTaxAuthoritySecretsDistinct,
  type TaxAuthorityPrincipalSecrets,
} from './authority-principal';
import {
  assertFacturaEFeatureDatabaseSeparateFromTaxEngine,
  FacturaEFeaturePublicationStore,
} from './factura-e-feature-publication';
import { FacturaEFeatureSourceReader } from './factura-e-feature-source';
import { HttpFacturaEFeatureSigningGateway } from './factura-e-feature-signer';
import { handleFacturaEFeatureRoute } from './factura-e-feature-routes';
import {
  assertFacturaEFeatureSecretsDistinct,
  type FacturaEFeaturePrincipalSecrets,
} from './factura-e-feature-principal';
import {
  drainFacturaEFeatureOutbox,
  HttpFacturaEFeatureEventPublisher,
} from './factura-e-feature-outbox';
import { HttpFacturaEAuthorityPreparationGateway } from './factura-e-authority-preparation';
import { TaxWsfexAuthorityRemoteEffect } from './factura-e-authority-remote-effect';
import {
  HttpDeskFacturaEPrivateDataGateway,
  TaxOwnedFacturaEAuthorityPreparationGateway,
} from './tax-owned-factura-e-authority-preparation';
import {
  FACTURA_E_FEATURE_RENEWAL_WINDOW_MS,
  facturaEFeatureRenewalCadenceReady,
  parseFacturaEFeaturePollInterval,
} from './factura-e-feature-worker-config';
import { createLateBoundFacturaEFeatureMutationFence } from './factura-e-feature-mutation-fence';
import {
  assertFacturaETerminalReceiptVerifiers,
  type FacturaETerminalReceiptVerifiers,
} from './factura-e-feature-terminal-receipt';
import { taxDemoRoutesEnabled } from './demo-route-policy';
import { readBoundedBody } from './bounded-body';
import { handleAccountantMandateRoute } from './accountant-mandate-routes';
import { handleExternalAccountantDecisionRoute } from './accountant-decision-routes';
import { handleAccountantReviewRoute } from './accountant-review-routes';
import { handleAccountantInvoiceRoute } from './accountant-invoice-routes';
import { handleAccountantInvoiceAuthorityRoute } from './accountant-invoice-authority-routes';
import {
  assertNoTaxEngineFundingAuthority,
  resolveArgentinaLaunchPolicyReadiness,
} from './argentina-launch-policy';
import {
  drainTaxDomainEventOutbox,
  HttpTaxDomainEventPublisher,
} from './tax-domain-event-outbox';


type Environment = Readonly<Record<string, string | undefined>>;

/** Logical stores. Bun maps each to its `*_DB_PATH` file; a Durable Object gives them all one database. */
export type TaxApiDatabaseName =
  | 'tax-engine'
  | 'arca-setup'
  | 'authority-execution'
  | 'factura-e-feature'
  | 'personal-wsfe';

/** A Service Binding (or anything with its `fetch`). Absent means the global `fetch` to the configured URL. */
export type ServiceFetcher = Readonly<{
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}>;

export type TaxApiOptions = Readonly<{
  env: Environment;
  openDatabase(name: TaxApiDatabaseName): string | SqlDatabase;
  fetchers?: Readonly<{
    boundary?: ServiceFetcher;
    /** The boundary's admin entrypoint, reached only through the Worker's operator proxy. */
    boundaryAdmin?: ServiceFetcher;
    wsfe?: ServiceFetcher;
    wsfex?: ServiceFetcher;
    executor?: ServiceFetcher;
  }>;
  /** Launch policy JSON text (a bundled module on the Worker); the path form stays on Bun. */
  argentinaLaunchPolicyJson?: string;
}>;

type TaxApiLoop = Readonly<{ intervalMs: number; run(): Promise<void> }>;

export type TaxApi = Readonly<{
  fetch(request: Request): Promise<Response>;
  /** Runs the three background loop bodies once. */
  tick(): Promise<void>;
  loops: Readonly<{
    facturaEFeatures: TaxApiLoop | null;
    taxDomainEvents: TaxApiLoop | null;
    arcaSetup: TaxApiLoop | null;
  }>;
  executionMode: 'human_gated_agent' | 'manual_only';
}>;

/** Today's Bun files and fallbacks for each logical store. */
export function taxApiDatabasePath(name: TaxApiDatabaseName, env: Environment): string {
  switch (name) {
    case 'tax-engine': return resolveTaxEngineDatabasePath(env.TAX_ENGINE_DB_PATH, env.NODE_ENV);
    case 'arca-setup': return env.TAX_ARCA_SETUP_DB_PATH ?? env.TAX_ENGINE_DB_PATH ?? ':memory:';
    case 'authority-execution': return env.TAX_AUTHORITY_EXECUTION_DB_PATH ?? ':memory:';
    case 'factura-e-feature': return env.TAX_FACTURA_E_FEATURE_DB_PATH ?? ':memory:';
    case 'personal-wsfe': return env.TAX_WSFE_DB_PATH ?? env.TAX_PERSONAL_WSFE_DB_PATH ?? '';
  }
}

export function createTaxApi(options: TaxApiOptions): TaxApi {
  const { env, openDatabase } = options;
  const boundaryFetch = serviceFetch(options.fetchers?.boundary);
  const apiKey = env.TAX_ENGINE_API_KEY;
  if (env.NODE_ENV === 'production' && !apiKey) {
    throw new Error('TAX_ENGINE_API_KEY is required in production');
  }
  const userApprovalToken = env.TAX_ENGINE_USER_APPROVAL_TOKEN ?? null;
  const accountantApprovalToken = env.TAX_ENGINE_ACCOUNTANT_APPROVAL_TOKEN ?? null;
  const evidenceIngestToken = env.TAX_ENGINE_EVIDENCE_INGEST_TOKEN ?? null;
  const consentEventToken = env.TAX_ENGINE_CONSENT_EVENT_TOKEN ?? null;
  const snapshotProjectorToken = env.TAX_ENGINE_SNAPSHOT_PROJECTOR_TOKEN ?? null;
  const userPrincipalSecret = env.TAX_ENGINE_USER_PRINCIPAL_HMAC_SECRET ?? null;
  const motoraOnboardingPrincipalSecret =
    env.TAX_ENGINE_MOTORA_ONBOARDING_PRINCIPAL_HMAC_SECRET ?? null;
  const deskArcaProjectionPrincipalSecret =
    env.TAX_ENGINE_DESK_ARCA_PROJECTION_PRINCIPAL_HMAC_SECRET ?? null;
  const deskArcaIssuePrincipalSecret =
    env.TAX_ENGINE_DESK_ARCA_ISSUE_PRINCIPAL_HMAC_SECRET ?? null;
  const fiscalBeta = arcaFiscalBetaFromEnvironment();
  const personalWsfeEnabled = env.ARCA_FISCAL_BETA_ENABLED === 'true';
  if (deskArcaProjectionPrincipalSecret && (
    Buffer.byteLength(deskArcaProjectionPrincipalSecret) < 32
    || deskArcaProjectionPrincipalSecret === motoraOnboardingPrincipalSecret
  )) throw new Error('TAX_ENGINE_DESK_ARCA_PROJECTION_PRINCIPAL_CONFIGURATION_INVALID');
  if (personalWsfeEnabled && (
    !deskArcaIssuePrincipalSecret || Buffer.byteLength(deskArcaIssuePrincipalSecret) < 32
    || deskArcaIssuePrincipalSecret === deskArcaProjectionPrincipalSecret
    || deskArcaIssuePrincipalSecret === motoraOnboardingPrincipalSecret
    || deskArcaIssuePrincipalSecret === userPrincipalSecret
    || fiscalBeta.deploymentEnvironment !== 'development'
    || fiscalBeta.authorityEnvironment !== 'homologation'
  )) throw new Error('TAX_PERSONAL_WSFE_CONFIGURATION_INVALID');
  const arcaBoundaryStatusReader = HttpArcaBoundaryStatusReader.fromEnvironment(boundaryFetch);
  const accountantDecisionPrincipalSecret =
    env.TAX_ENGINE_ACCOUNTANT_DECISION_PRINCIPAL_HMAC_SECRET ?? null;
  const accountantDecisionIngressEnabled =
    env.TAX_ENGINE_ACCOUNTANT_DECISION_INGRESS_ENABLED === 'true';
  const snapshotProjectorPrincipalSecret = env.TAX_ENGINE_SNAPSHOT_PROJECTOR_PRINCIPAL_HMAC_SECRET ?? null;
  const evidencePublisherPrincipalSecret = env.TAX_ENGINE_EVIDENCE_PUBLISHER_PRINCIPAL_HMAC_SECRET ?? null;
  const consentAuthorityPrincipalSecret = env.TAX_ENGINE_CONSENT_AUTHORITY_PRINCIPAL_HMAC_SECRET ?? null;
  const openAgentsAgentPrincipalSecret =
    env.TAX_ENGINE_OPEN_AGENTS_AGENT_PRINCIPAL_HMAC_SECRET ?? null;
  const deskAgentPrincipalSecret =
    env.TAX_ENGINE_DESK_AGENT_PRINCIPAL_HMAC_SECRET ?? null;
  const deskInvoiceSettlementPrincipalSecret =
    env.TAX_ENGINE_DESK_INVOICE_SETTLEMENT_PRINCIPAL_HMAC_SECRET ?? null;
  const taxDomainEventDeliveryEnabled =
    env.TAX_DOMAIN_EVENT_DELIVERY_ENABLED === 'true';
  const taxDomainEventIngressToken =
    env.TAX_DOMAIN_EVENT_OPEN_AGENTS_TOKEN ?? null;
  const taxDomainEventHmacSecret =
    env.TAX_DOMAIN_EVENT_HMAC_SECRET ?? null;
  const taxDomainEventPollIntervalMs = parseTaxDomainEventPollInterval(
    env.TAX_DOMAIN_EVENT_POLL_INTERVAL_MS
  );
  const authorityCorridorEnabled = env.TAX_ENGINE_ARCA_AUTHORITY_CORRIDOR_ENABLED === 'true';
  const authorityRemoteEffectsEnabled = env.TAX_ENGINE_ARCA_REMOTE_EFFECTS_ENABLED === 'true';
  const arcaAuthorityEnvironment = parseArcaAuthorityEnvironment(
    env.ARCA_ENVIRONMENT
  );
  const arcaProductionAuthority = arcaAuthorityEnvironment === 'production';
  const authorityPreparationSecret =
    env.TAX_ENGINE_ARCA_PREPARATION_HMAC_SECRET ?? null;
  const authorityPrincipalSecrets: TaxAuthorityPrincipalSecrets = {
    motora: env.TAX_ENGINE_MOTORA_AUTHORITY_PRINCIPAL_HMAC_SECRET ?? null,
  };
  const facturaEFeatureEnabled = env.TAX_FACTURA_E_FEATURE_PUBLICATION_ENABLED === 'true';
  const argentinaLaunchPolicy = resolveArgentinaLaunchPolicyReadiness(env, new Date(), options.argentinaLaunchPolicyJson);
  assertNoTaxEngineFundingAuthority(env);
  const facturaEFeaturePollIntervalMs = facturaEFeatureEnabled
    ? parseFacturaEFeaturePollInterval(
        env.TAX_FACTURA_E_FEATURE_POLL_INTERVAL_MS
      )
    : null;
  const facturaEFeaturePrincipalSecrets: FacturaEFeaturePrincipalSecrets = {
    deskConsent: env.TAX_FACTURA_E_FEATURE_DESK_CONSENT_HMAC_SECRET ?? null,
    projector: env.TAX_FACTURA_E_FEATURE_PROJECTOR_HMAC_SECRET ?? null,
    creReader: env.TAX_FACTURA_E_FEATURE_CRE_READER_API_KEY ?? null,
    creReservation:
      env.TAX_FACTURA_E_FEATURE_CRE_RESERVATION_API_KEY ?? null,
  };
  const facturaEFeatureCommitmentSecret =
    env.TAX_FACTURA_E_FEATURE_COMMITMENT_HMAC_SECRET ?? null;
  const facturaEFeatureSignerSecret =
    env.TAX_FACTURA_E_FEATURE_SIGNER_HMAC_SECRET ?? null;
  const facturaEFeatureEventSecret =
    env.TAX_FACTURA_E_FEATURE_EVENT_HMAC_SECRET ?? null;
  const facturaETerminalReceiptVerifiers: FacturaETerminalReceiptVerifiers = {
    deskEffect: {
      enabled:
        env.TAX_FACTURA_E_FEATURE_DESK_EFFECT_RECEIPT_ENABLED === 'true',
      keyId: env.TAX_FACTURA_E_FEATURE_DESK_EFFECT_RECEIPT_KEY_ID ?? null,
      publicKey:
        env.TAX_FACTURA_E_FEATURE_DESK_EFFECT_RECEIPT_ED25519_PUBLIC_KEY_PEM
          ?? null,
      transportSecret:
        env.TAX_FACTURA_E_FEATURE_DESK_EFFECT_RECEIPT_API_KEY ?? null,
    },
    noEffectRecovery: {
      enabled:
        env.TAX_FACTURA_E_FEATURE_NO_EFFECT_RECOVERY_ENABLED === 'true',
      keyId: env.TAX_FACTURA_E_FEATURE_NO_EFFECT_RECOVERY_KEY_ID ?? null,
      publicKey:
        env.TAX_FACTURA_E_FEATURE_NO_EFFECT_RECOVERY_ED25519_PUBLIC_KEY_PEM
          ?? null,
      transportSecret:
        env.TAX_FACTURA_E_FEATURE_NO_EFFECT_RECOVERY_API_KEY ?? null,
    },
  };
  const browserReferenceSecret = resolveTaxBrowserReferenceSecret();
  const legacyEvidenceAppendEnabled = env.NODE_ENV !== 'production'
    && env.TAX_ENGINE_LEGACY_EVIDENCE_APPEND_ENABLED === 'true';
  if (env.NODE_ENV === 'production' && (!userApprovalToken
    || !accountantApprovalToken
    || !evidenceIngestToken
    || !consentEventToken
    || !snapshotProjectorToken
    || !userPrincipalSecret
    || !motoraOnboardingPrincipalSecret
    || !snapshotProjectorPrincipalSecret
    || !evidencePublisherPrincipalSecret
    || !consentAuthorityPrincipalSecret
    || !deskAgentPrincipalSecret || !deskInvoiceSettlementPrincipalSecret)) {
    throw new Error('Required Tax Engine production credentials are missing, including TAX_ENGINE_DESK_AGENT_PRINCIPAL_HMAC_SECRET and TAX_ENGINE_DESK_INVOICE_SETTLEMENT_PRINCIPAL_HMAC_SECRET');
  }
  if (
    accountantDecisionIngressEnabled
    && Buffer.byteLength(accountantDecisionPrincipalSecret ?? '') < 32
  ) throw new Error('TAX_ENGINE_ACCOUNTANT_DECISION_PRINCIPAL_CONFIGURATION_REQUIRED');
  if (env.NODE_ENV === 'production') {
    const tenantSecrets = [
      userPrincipalSecret,
      motoraOnboardingPrincipalSecret,
      deskArcaProjectionPrincipalSecret,
      ...(accountantDecisionIngressEnabled ? [accountantDecisionPrincipalSecret] : []),
      snapshotProjectorPrincipalSecret,
      evidencePublisherPrincipalSecret,
      consentAuthorityPrincipalSecret,
      deskAgentPrincipalSecret,
      browserReferenceSecret,
    ].filter((value): value is string => Boolean(value));
    if (new Set(tenantSecrets).size !== tenantSecrets.length) {
      throw new Error('TAX_ENGINE_TENANT_AND_BROWSER_REFERENCE_SECRETS_MUST_BE_DISTINCT');
    }
  }
  if (taxDomainEventDeliveryEnabled) {
    const domainEventSecrets = [
      taxDomainEventIngressToken,
      taxDomainEventHmacSecret,
      deskAgentPrincipalSecret,
      deskInvoiceSettlementPrincipalSecret,
      accountantDecisionIngressEnabled ? accountantDecisionPrincipalSecret : null,
      evidencePublisherPrincipalSecret,
      consentAuthorityPrincipalSecret,
    ].filter((value): value is string => Boolean(value));
    if (
      !taxDomainEventIngressToken
      || !taxDomainEventHmacSecret
      || new Set(domainEventSecrets).size !== domainEventSecrets.length
    ) throw new Error('TAX_DOMAIN_EVENT_DELIVERY_SECRETS_MUST_BE_DISTINCT');
  }
  if (authorityCorridorEnabled) {
    assertTaxAuthoritySecretsDistinct(authorityPrincipalSecrets, [
      userPrincipalSecret,
      motoraOnboardingPrincipalSecret,
      accountantDecisionIngressEnabled ? accountantDecisionPrincipalSecret : null,
      snapshotProjectorPrincipalSecret,
      evidencePublisherPrincipalSecret,
      consentAuthorityPrincipalSecret,
      openAgentsAgentPrincipalSecret,
      browserReferenceSecret,
      authorityPreparationSecret,
      env.ARCA_SIGNER_TOKEN ?? null,
      env.ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN ?? null,
    ]);
    if (
      arcaProductionAuthority &&
      env.TAX_ENGINE_ARCA_AUTHORITY_PRODUCTION_APPROVED !== 'true'
    )
      throw new Error('TAX_ENGINE_ARCA_AUTHORITY_PRODUCTION_APPROVAL_REQUIRED');
  }
  if (authorityRemoteEffectsEnabled && !authorityCorridorEnabled) {
    throw new Error('TAX_ARCA_REMOTE_EFFECTS_REQUIRE_AUTHORITY_CORRIDOR');
  }
  if (
    arcaProductionAuthority &&
    authorityRemoteEffectsEnabled &&
    env.TAX_ENGINE_ARCA_REMOTE_EFFECTS_PRODUCTION_APPROVED !== 'true'
  )
    throw new Error('TAX_ENGINE_ARCA_REMOTE_EFFECTS_PRODUCTION_APPROVAL_REQUIRED');
  if (facturaEFeatureEnabled) {
    assertFacturaEFeatureSecretsDistinct(facturaEFeaturePrincipalSecrets, [
      userPrincipalSecret,
      motoraOnboardingPrincipalSecret,
      accountantDecisionIngressEnabled ? accountantDecisionPrincipalSecret : null,
      snapshotProjectorPrincipalSecret,
      evidencePublisherPrincipalSecret,
      consentAuthorityPrincipalSecret,
      openAgentsAgentPrincipalSecret,
      browserReferenceSecret,
      authorityPrincipalSecrets.motora,
      facturaEFeatureCommitmentSecret,
      facturaEFeatureSignerSecret,
      facturaEFeatureEventSecret,
      facturaETerminalReceiptVerifiers.deskEffect.publicKey,
      facturaETerminalReceiptVerifiers.deskEffect.transportSecret ?? null,
      facturaETerminalReceiptVerifiers.noEffectRecovery.publicKey,
      facturaETerminalReceiptVerifiers.noEffectRecovery.transportSecret ?? null,
    ]);
    assertFacturaETerminalReceiptVerifiers(facturaETerminalReceiptVerifiers, [
      userPrincipalSecret,
      motoraOnboardingPrincipalSecret,
      accountantDecisionIngressEnabled ? accountantDecisionPrincipalSecret : null,
      snapshotProjectorPrincipalSecret,
      evidencePublisherPrincipalSecret,
      consentAuthorityPrincipalSecret,
      openAgentsAgentPrincipalSecret,
      browserReferenceSecret,
      authorityPrincipalSecrets.motora,
      facturaEFeaturePrincipalSecrets.deskConsent,
      facturaEFeaturePrincipalSecrets.projector,
      facturaEFeaturePrincipalSecrets.creReader,
      facturaEFeaturePrincipalSecrets.creReservation,
      facturaEFeatureCommitmentSecret,
      facturaEFeatureSignerSecret,
      facturaEFeatureEventSecret,
    ]);
    if (!facturaEFeatureCommitmentSecret) {
      throw new Error('TAX_FACTURA_E_FEATURE_COMMITMENT_SECRET_REQUIRED');
    }
    if (
      arcaProductionAuthority
      && env.TAX_FACTURA_E_FEATURE_PRODUCTION_APPROVED !== 'true'
    ) throw new Error('TAX_FACTURA_E_FEATURE_PRODUCTION_APPROVAL_REQUIRED');
    if (
      env.NODE_ENV === 'production'
      && env.ARCA_ENVIRONMENT !== 'production'
    ) throw new Error('TAX_FACTURA_E_FEATURE_PRODUCTION_ARCA_REQUIRED');
    if (
      !facturaETerminalReceiptVerifiers.deskEffect.enabled
      || !facturaETerminalReceiptVerifiers.noEffectRecovery.enabled
    ) throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPTS_REQUIRED');
    if (
      arcaProductionAuthority
      && facturaETerminalReceiptVerifiers.deskEffect.enabled
      && env.TAX_FACTURA_E_FEATURE_DESK_EFFECT_RECEIPT_PRODUCTION_APPROVED !== 'true'
    ) throw new Error('TAX_FACTURA_E_FEATURE_DESK_EFFECT_RECEIPT_PRODUCTION_APPROVAL_REQUIRED');
    if (
      arcaProductionAuthority
      && facturaETerminalReceiptVerifiers.noEffectRecovery.enabled
      && env.TAX_FACTURA_E_FEATURE_NO_EFFECT_RECOVERY_PRODUCTION_APPROVED !== 'true'
    ) throw new Error('TAX_FACTURA_E_FEATURE_NO_EFFECT_RECOVERY_PRODUCTION_APPROVAL_REQUIRED');
  }
  if (
    arcaProductionAuthority
    && (authorityCorridorEnabled || authorityRemoteEffectsEnabled || facturaEFeatureEnabled)
  ) assertArgentinaProductionBoundary(argentinaLaunchPolicy);

  // Before TaxProfileStore migrates its outbox: the feature store must not share its file.
  const facturaEFeatureDatabase = openDatabase('factura-e-feature');
  if (facturaEFeatureEnabled && typeof facturaEFeatureDatabase === 'string')
    assertFacturaEFeatureDatabaseSeparateFromTaxEngine(facturaEFeatureDatabase, env.TAX_ENGINE_DB_PATH);
  const store = new TaxProfileStore(openDatabase('tax-engine'));
  const taxDomainEventPublisher = taxDomainEventDeliveryEnabled
    ? HttpTaxDomainEventPublisher.fromEnvironment()
    : null;
  if (taxDomainEventDeliveryEnabled && !taxDomainEventPublisher) {
    throw new Error('TAX_DOMAIN_EVENT_DELIVERY_CONFIGURATION_REQUIRED');
  }
  const taxEvidenceWorkspace = new TaxEvidenceWorkspaceService(store);
  const taxBrowserSnapshotProjector = browserReferenceSecret
    ? new TaxBrowserSnapshotProjector(browserReferenceSecret)
    : null;
  const taxBrowserSnapshots = new TaxBrowserSnapshotService(
    store,
    taxEvidenceWorkspace,
    taxBrowserSnapshotProjector,
  );
  const argentinaErp = new ContabiliumSandboxProvider(null);
  const reclaimGateway = ReclaimProtocolGateway.fromEnvironment();
  const wsfexGateway = HttpWsfexGateway.fromEnvironment(serviceFetch(options.fetchers?.wsfex));
  const wsfePointOfSaleGateway = HttpWsfePointOfSaleGateway.fromEnvironment(serviceFetch(options.fetchers?.wsfe));
  const personalWsfeAttempts = personalWsfeEnabled
    ? new PersonalWsfeAttemptStore(openDatabase('personal-wsfe'))
    : null;
  const arcaEnvironment = arcaProductionAuthority ? 'production' as const : 'homologacion' as const;
  const proofVault = HttpReclaimProofVault.fromEnvironment();
  const proofCustodyRequired = env.RECLAIM_PROOF_CUSTODY_REQUIRED === 'true';
  const authorityPayloadWriter = HttpAuthorityPayloadWriter.fromEnvironment(boundaryFetch);
  const externalAuthorityPreparation = HttpFacturaEAuthorityPreparationGateway.fromEnvironment();
  const deskFacturaEPrivateData = HttpDeskFacturaEPrivateDataGateway.fromEnvironment();
  const issuerProfileRegistry = new ArcaIssuerProfileRegistry(
    openDatabase('tax-engine'),
    TaxOwnedFacturaEAuthorityPreparationGateway.profileRegistryFromEnvironment() ?? new Map(),
  );
  if (personalWsfeEnabled && (!wsfePointOfSaleGateway || !authorityPayloadWriter)) {
    throw new Error('TAX_PERSONAL_WSFE_CONFIGURATION_REQUIRED');
  }
  let facturaEFeatures: FacturaEFeaturePublicationStore | null = null;
  const facturaEFeatureMutationFence = createLateBoundFacturaEFeatureMutationFence({
    enabled: () => facturaEFeatureEnabled,
    currentStore: () => facturaEFeatures,
  });
  const facturaEAgent = new FacturaEAgentService(
    store,
    reclaimGateway,
    wsfexGateway,
    proofVault,
    proofCustodyRequired,
    authorityPayloadWriter,
    facturaEFeatureMutationFence,
  );
  const taxOwnedAuthorityPreparation =
    deskFacturaEPrivateData && issuerProfileRegistry && wsfexGateway
      ? new TaxOwnedFacturaEAuthorityPreparationGateway(
          facturaEAgent,
          store,
          issuerProfileRegistry,
          TaxOwnedFacturaEAuthorityPreparationGateway.currencyRegistryFromEnvironment(),
          deskFacturaEPrivateData,
          wsfexGateway,
          arcaAuthorityEnvironment
        )
      : null;
  const authorityPreparation = taxOwnedAuthorityPreparation ?? externalAuthorityPreparation;
  const facturaEAuthorityStore = new FacturaEAuthorityExecutionStore(
    openDatabase('authority-execution'),
    (env.NODE_ENV === 'production' || arcaProductionAuthority || fiscalBeta.enabled)
      && (authorityCorridorEnabled || authorityRemoteEffectsEnabled || facturaEFeatureEnabled)
  );
  if (
    authorityRemoteEffectsEnabled
    && (!authorityPreparation || !authorityPayloadWriter || !wsfexGateway)
  ) throw new Error('TAX_ARCA_REMOTE_EFFECTS_CONFIGURATION_REQUIRED');
  if (arcaProductionAuthority && authorityRemoteEffectsEnabled && !taxOwnedAuthorityPreparation)
    throw new Error('TAX_OWNED_ARCA_PREPARATION_REQUIRED_IN_PRODUCTION');
  const facturaEAuthorityRemoteEffect =
    authorityPreparation && authorityPayloadWriter && wsfexGateway
      ? new TaxWsfexAuthorityRemoteEffect(
          facturaEAgent,
          authorityPreparation,
          authorityPayloadWriter,
          wsfexGateway,
          arcaAuthorityEnvironment
        )
      : null;
  const facturaEAuthorityExecution = new FacturaEAuthorityExecutionService(
    facturaEAuthorityStore,
    runId => {
      const run = facturaEAgent.getRun(runId);
      return {
        workspaceId: run.workspaceId,
        intentHash: run.intentHash,
        issuanceState: run.issuanceState,
        intentState: run.intentState,
        approvalState: run.approvalState,
        accountantReviewRequired: run.accountantReviewRequired,
        ...(run.approvalMode ? { approvalMode: run.approvalMode } : {}),
      };
    },
    facturaEAuthorityRemoteEffect,
    authorityRemoteEffectsEnabled,
    {
      environment: arcaAuthorityEnvironment,
      providerId: wsfexGateway?.providerId ?? 'unconfigured',
      approvalPolicy: fiscalBeta.enabled ? 'mandated_accountant_beta' : 'human',
      ...(fiscalBeta.enabled ? { beta: fiscalBeta } : {}),
    }
  );
  const facturaEFeatureSigner = facturaEFeatureEnabled
    ? HttpFacturaEFeatureSigningGateway.fromEnvironment()
    : null;
  const facturaEFeatureEventPublisher = facturaEFeatureEnabled
    ? HttpFacturaEFeatureEventPublisher.fromEnvironment()
    : null;
  if (facturaEFeatureEnabled && (!facturaEFeatureSigner || !facturaEFeatureEventPublisher)) {
    throw new Error('TAX_FACTURA_E_FEATURE_PUBLICATION_CONFIGURATION_REQUIRED');
  }
  const facturaEFeatureSource = new FacturaEFeatureSourceReader(
    facturaEAuthorityStore,
    facturaEAgent
  );
  facturaEFeatures = facturaEFeatureEnabled && facturaEFeatureSigner
    ? new FacturaEFeaturePublicationStore({
        readSource: executionId => facturaEFeatureSource.read(executionId),
        signer: facturaEFeatureSigner,
        commitmentSecret: facturaEFeatureCommitmentSecret!,
        policyVersion:
          env.TAX_FACTURA_E_FEATURE_POLICY_VERSION
          ?? 'ar-factura-e-factoring-v1',
        ...(typeof facturaEFeatureDatabase === 'string'
          ? { databasePath: facturaEFeatureDatabase }
          : { database: facturaEFeatureDatabase }),
        requireDurable: env.NODE_ENV === 'production' || arcaProductionAuthority,
        singleWriter:
          env.TAX_FACTURA_E_FEATURE_SINGLE_WRITER === 'true',
      })
    : null;
  const arcaOnboarding = new ArcaOnboardingService(
    store,
    ReclaimArcaOnboardingGateway.fromEnvironment(),
    proofVault,
    proofCustodyRequired,
    wsfexGateway,
    wsfePointOfSaleGateway,
    HttpArcaWorkbenchPublisher.fromEnvironment(),
  );
  const arcaSetupEnabled = env.TAX_ARCA_SETUP_ENABLED === 'true';
  const arcaSetupSecrets = [
    env.ARCA_SETUP_ORDER_SECRET,
    env.ARCA_SETUP_RECEIPT_SECRET,
    env.ARCA_SETUP_HANDOFF_SECRET,
    env.TAX_ENGINE_ARCA_PROVIDER_OPERATOR_TOKEN,
    env.ARCA_BOUNDARY_SETUP_TOKEN,
  ];
  if (arcaSetupEnabled && (
    arcaSetupSecrets.some(secret => !secret || secret.length < 32)
    || new Set(arcaSetupSecrets).size !== arcaSetupSecrets.length
  )) throw new Error('TAX_ARCA_SETUP_SECRETS_REQUIRED_AND_DISTINCT');
  const arcaSetupDatabase = openDatabase('arca-setup');
  if (arcaSetupEnabled && env.NODE_ENV === 'production'
    && (typeof arcaSetupDatabase === 'string'
      ? !env.TAX_ARCA_SETUP_DB_PATH && !env.TAX_ENGINE_DB_PATH
      : !arcaSetupDatabase.durable))
    throw new Error('TAX_ARCA_SETUP_DURABLE_STORE_REQUIRED');
  const arcaSetup = arcaSetupEnabled
    ? new ArcaSetupAutomationService({
        store: new ArcaSetupStore(arcaSetupDatabase),
        onboarding: arcaOnboarding,
        executor: HttpArcaSetupExecutorGateway.fromEnvironment(serviceFetch(options.fetchers?.executor)),
        boundary: HttpArcaSetupBoundaryGateway.fromEnvironment(boundaryFetch),
        handoffSecret: env.ARCA_SETUP_HANDOFF_SECRET ?? null,
        receiptSecret: env.ARCA_SETUP_RECEIPT_SECRET ?? null,
        providerDelegationAvailable: env.ARCA_SETUP_PROVIDER_DELEGATION_ENABLED === 'true',
        reclaimAvailable: ReclaimArcaOnboardingGateway.fromEnvironment() !== null,
      })
    : null;
  const arcaProviderOperatorToken = env.TAX_ENGINE_ARCA_PROVIDER_OPERATOR_TOKEN ?? null;
  const jurisdictionSchema = z.enum(['AR', 'US', 'AE']);
  const founderResidencySchema = z.enum(['local', 'foreign']);
  const profileSchema = z.object({
    profileId: z.string().min(1),
    workspaceId: taxWorkspaceIdSchema,
    jurisdiction: jurisdictionSchema,
    entityType: z.string().min(1),
    regimeId: z.string().min(1),
    ownerDomicileCountries: z.array(z.string().length(2)),
    ownerTaxResidenceCountries: z.array(z.string().length(2)),
    formationSubdivision: z.string().nullable(),
    operatingSubdivisions: z.array(z.string()),
    answers: z.array(z.object({
      questionId: z.string(),
      value: z.union([z.string(), z.boolean(), z.number(), z.array(z.string())]),
      confirmationState: z.enum(['user_confirmed', 'accountant_confirmed']),
    })),
    catalogueVersion: z.string(),
    version: z.string(),
    confirmationState: z.enum(['user_confirmed', 'accountant_confirmed']),
  }).strict();

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return applyCors(new Response(null, { status: 204 }), request);

    try {
      if (request.method === 'POST' && url.pathname === '/v1/arca-onboarding/issuer-bindings') {
        const adminToken = env.TAX_ARCA_ISSUER_BINDING_ADMIN_TOKEN;
        if (!adminToken || !safeBearerToken(request, adminToken))
          return applyCors(json({ error: 'UNAUTHORIZED' }, 401), request);
        if (!arcaBoundaryStatusReader)
          throw new Error('ARCA_BOUNDARY_STATUS_CONFIGURATION_REQUIRED');
        const body = z.object({
          onboardingId: z.uuid(),
          issuerProfileRef: z.string().regex(/^[A-Za-z0-9._:/-]{1,500}$/),
        }).strict().parse(JSON.parse(await readBoundedBody(request, 2048, 'ARCA_ISSUER_BINDING_REQUEST_TOO_LARGE')) as unknown);
        const run = arcaOnboarding.getRun(body.onboardingId);
        if (run.environment !== 'homologation' || run.status === 'failed')
          throw new Error('ARCA_ISSUER_BINDING_RUN_INVALID');
        const boundary = await arcaBoundaryStatusReader.read(run.workspaceId, body.issuerProfileRef);
        if (boundary.workspaceId !== run.workspaceId || boundary.issuerProfileRef !== body.issuerProfileRef
          || boundary.environment !== 'homologation' || !boundary.configured || !boundary.active
          || !boundary.delegationConfirmed || !boundary.certificate.current
          || boundary.taxpayerReferenceHash !== run.taxpayerReferenceHash)
          throw new Error('ARCA_ISSUER_BINDING_BOUNDARY_MISMATCH');
        issuerProfileRegistry.bind(run.workspaceId, body.issuerProfileRef, new Date().toISOString());
        return applyCors(json({ data: { bound: true, workspaceId: run.workspaceId } }), request);
      }
      const arcaSetupReceipt = await handleArcaSetupReceiptRoute(request, url, arcaSetup);
      if (arcaSetupReceipt) return applyCors(arcaSetupReceipt, request);
      const arcaSetupProvider = await handleArcaSetupProviderRoute(request, url, arcaSetup, arcaProviderOperatorToken);
      if (arcaSetupProvider) return applyCors(arcaSetupProvider, request);
      if (url.pathname === '/v1/reclaim/arca-onboarding/callback') {
        const callbackResponse = await handleArcaOnboardingRoute(request, url, arcaOnboarding, { userApprovalToken, evidenceIngestToken });
        return applyCors(callbackResponse ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (url.pathname === '/v1/reclaim/callback') {
        const callbackResponse = await handleAgentRoute(request, url, facturaEAgent, { userApprovalToken, accountantApprovalToken, evidenceIngestToken, agentPrincipalSecret: [deskAgentPrincipalSecret, openAgentsAgentPrincipalSecret], accountantMandates: store, legacyEvidenceAppendEnabled });
        return applyCors(callbackResponse ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (request.method === 'POST'
        && (url.pathname === '/v1/evidence/batches' || url.pathname === '/v1/evidence/consent-events' || url.pathname === '/v1/digital-assets/events')) {
        const scopedPrincipal = verifyTaxTenantPrincipal(
          request,
          url.pathname === '/v1/evidence/batches' || url.pathname === '/v1/digital-assets/events'
            ? evidencePublisherPrincipalSecret
            : consentAuthorityPrincipalSecret,
          url.pathname === '/v1/evidence/batches' || url.pathname === '/v1/digital-assets/events' ? 'evidence:publish' : 'consent:publish',
        );
        const scopedResponse = await handleTaxEvidenceRoute(request, url, taxEvidenceWorkspace, { evidenceIngestToken, consentEventToken, snapshotProjectorToken, tenantPrincipal: scopedPrincipal });
        return applyCors(scopedResponse ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (request.method === 'POST'
        && /^\/v1\/snapshot-projections\/[^/]+(?:\/[^/]+)?$/.test(url.pathname)) {
        const scopedPrincipal = verifyTaxTenantPrincipal(
          request,
          snapshotProjectorPrincipalSecret,
          'snapshot:project',
        );
        const scopedResponse = await handleTaxEvidenceRoute(request, url, taxEvidenceWorkspace, {
          evidenceIngestToken,
          consentEventToken,
          snapshotProjectorToken,
          tenantPrincipal: scopedPrincipal,
        });
        return applyCors(scopedResponse ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (
        request.method === 'GET'
        && (url.pathname === '/v1/arca-onboarding/private-connection-projection'
          || /^\/v1\/arca-onboarding\/runs\/[^/]+\/private-connection-projection$/.test(url.pathname))
      ) {
        const scopedPrincipal = await verifyBoundTaxTenantPrincipal(
          request, deskArcaProjectionPrincipalSecret, 'arca:onboard',
        );
        const projection = url.pathname === '/v1/arca-onboarding/private-connection-projection'
          ? await latestPrivateArcaConnectionProjection(request, url, scopedPrincipal, arcaOnboarding, issuerProfileRegistry, arcaBoundaryStatusReader)
          : await privateArcaConnectionProjection(request, url, scopedPrincipal, arcaOnboarding, issuerProfileRegistry, arcaBoundaryStatusReader);
        return applyCors(json(projection), request);
      }
      if (request.method === 'GET' && url.pathname === '/v1/arca-onboarding/issuer-acceptance') {
        const scopedPrincipal = await verifyBoundTaxTenantPrincipal(
          request, deskArcaProjectionPrincipalSecret, 'arca:onboard',
        );
        if (url.searchParams.size !== 1) throw new Error('ARCA_ISSUER_ACCEPTANCE_INVALID_REQUEST');
        const onboardingId = z.uuid().parse(url.searchParams.get('onboardingId'));
        const result = await issuerAcceptanceForPrincipal(
          scopedPrincipal, onboardingId, arcaOnboarding, issuerProfileRegistry, arcaBoundaryStatusReader,
        );
        return applyCors(json(result), request);
      }
      if (request.method === 'POST'
        && url.pathname === '/v1/arca-onboarding/connection/revoke') {
        const rawBody = await readBoundedBody(request, 1024, 'ARCA_CONNECTION_REVOKE_REQUEST_TOO_LARGE');
        const scopedPrincipal = verifyBoundTaxTenantPrincipalForRawBody(
          request, rawBody, deskArcaProjectionPrincipalSecret, 'arca:onboard',
        );
        const expected = z.object({
          issuerProfileRef: z.string().min(1).max(500),
          certificateFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        }).strict().parse(JSON.parse(rawBody) as unknown);
        const result = await revokeArcaConnectionForPrincipal(
          scopedPrincipal, expected, issuerProfileRegistry, arcaBoundaryStatusReader,
          env.ARCA_BOUNDARY_ISSUER_REVOKE_TOKEN ?? null,
        );
        issuerProfileRegistry.unbind(scopedPrincipal.workspaceId, expected.issuerProfileRef);
        return applyCors(json({ data: result }), request);
      }
      const wsfeResponse = await handleWsfeAttemptRoute(request, url, {
        principalSecret: deskArcaIssuePrincipalSecret, beta: fiscalBeta,
        attempts: personalWsfeAttempts, signer: wsfePointOfSaleGateway, vault: authorityPayloadWriter,
        projection: async principal => (await latestArcaConnectionProjectionForPrincipal(
          principal, arcaOnboarding, issuerProfileRegistry, arcaBoundaryStatusReader,
        )).data,
      });
      if (wsfeResponse) return applyCors(wsfeResponse, request);
      if (
        /^\/v1\/arca-onboarding(?:\/|$)/.test(url.pathname)
        && request.headers.has('x-tax-tenant-principal')
      ) {
        if (isArcaSetupUserPath(url.pathname)) {
          const rawBody = request.method === 'GET'
            ? ''
            : await readBoundedBody(request, 64 * 1024, 'ARCA_SETUP_REQUEST_TOO_LARGE');
          const automationPrincipal = verifyBoundTaxTenantPrincipalForRawBody(
            request, rawBody, motoraOnboardingPrincipalSecret, 'arca:onboard',
          );
          const automationResponse = await handleArcaSetupUserRoute(request, url, arcaSetup, automationPrincipal, rawBody);
          return applyCors(automationResponse ?? json({ error: 'NOT_FOUND' }, 404), request);
        }
        const scopedPrincipal = await verifyBoundTaxTenantPrincipal(
          request,
          motoraOnboardingPrincipalSecret,
          'arca:onboard',
        );
        const scopedResponse = await handleArcaOnboardingRoute(
          request,
          url,
          arcaOnboarding,
          { userApprovalToken, evidenceIngestToken, tenantPrincipal: scopedPrincipal,
            issuerProfiles: issuerProfileRegistry, boundaryReader: arcaBoundaryStatusReader },
        );
        return applyCors(scopedResponse ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (
        request.method === 'POST'
        && url.pathname === '/v1/accountant-decisions'
        && accountantDecisionIngressEnabled
        && request.headers.has('x-tax-tenant-principal')
      ) {
        const rawBody = await readBoundedBody(
          request,
          32 * 1024,
          'ACCOUNTANT_DECISION_REQUEST_TOO_LARGE',
        );
        const scopedPrincipal = verifyBoundTaxTenantPrincipalForRawBody(
          request,
          rawBody,
          accountantDecisionPrincipalSecret,
          'accountant:decision',
        );
        const scopedResponse = await handleExternalAccountantDecisionRoute(
          request,
          url,
          store,
          scopedPrincipal,
          new Date(),
          rawBody,
        );
        return applyCors(scopedResponse ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (url.pathname === '/v1/accountant-invoice-authority-approvals') {
        if (!accountantDecisionIngressEnabled) throw new Error('ACCOUNTANT_DECISION_CONFIGURATION_REQUIRED');
        const response = await handleAccountantInvoiceAuthorityRoute(request, url, {
          store, agent: facturaEAgent, authority: facturaEAuthorityExecution,
          beta: fiscalBeta, principalSecret: accountantDecisionPrincipalSecret,
        });
        return applyCors(response ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (request.method === 'POST' && url.pathname === '/v1/accountant-invoice-approvals') {
        if (!accountantDecisionIngressEnabled) throw new Error('ACCOUNTANT_DECISION_CONFIGURATION_REQUIRED');
        const rawBody = await readBoundedBody(request, 16 * 1024, 'ACCOUNTANT_INVOICE_REQUEST_TOO_LARGE');
        const scopedPrincipal = verifyBoundTaxTenantPrincipalForRawBody(
          request, rawBody, accountantDecisionPrincipalSecret, 'accountant:decision',
        );
        const response = await handleAccountantInvoiceRoute(
          request, url, store, facturaEAgent, scopedPrincipal, new Date(), rawBody,
          { authority: facturaEAuthorityExecution, beta: fiscalBeta },
        );
        return applyCors(response ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      const authorityCorridorResponse = await handleFacturaEAuthorityCorridorRoute(
        request,
        url,
        facturaEAuthorityExecution,
        {
          corridorEnabled: authorityCorridorEnabled,
          beta: fiscalBeta,
          secrets: authorityPrincipalSecrets,
          agent: facturaEAgent,
          store,
          ...(deskFacturaEPrivateData ? { commercialGateway: deskFacturaEPrivateData } : {}),
          ...(issuerProfileRegistry ? { issuerProfiles: issuerProfileRegistry } : {}),
          environment: arcaAuthorityEnvironment,
          taxCases: facturaEAgent,
        }
      );
      if (authorityCorridorResponse)
        return applyCors(authorityCorridorResponse, request);
      const featureResponse = await handleFacturaEFeatureRoute(
        request,
        url,
        facturaEFeatures,
        {
          enabled: facturaEFeatureEnabled,
          secrets: facturaEFeaturePrincipalSecrets,
          terminalReceiptVerifiers: facturaETerminalReceiptVerifiers,
        }
      );
      if (featureResponse) return applyCors(featureResponse, request);
      if (!authorized(request)) return applyCors(json({ error: 'UNAUTHORIZED' }, 401), request);
      if (request.method === 'POST'
        && (url.pathname === '/v1/accountant-mandates'
          || /^\/v1\/accountant-mandates\/[^/]+\/revoke$/.test(url.pathname))) {
        const rawBody = await readBoundedBody(request, 64 * 1024, 'ACCOUNTANT_MANDATE_REQUEST_TOO_LARGE');
        const principal = verifyBoundTaxTenantPrincipalForRawBody(
          request, rawBody, userPrincipalSecret, 'accountant:mandate',
        );
        const response = await handleAccountantMandateRoute(
          request, url, store, principal, new Date(), rawBody,
        );
        return applyCors(response ?? json({ error: 'NOT_FOUND' }, 404), request);
      }
      const tenantCapability = /^\/v1\/arca-onboarding(?:\/|$)/.test(url.pathname)
        || url.pathname === '/v1/accountant-decisions'
        ? null
        : requiredTaxTenantPrincipalCapability(request.method, url.pathname);
      const tenantPrincipal = tenantCapability
        ? verifyTaxTenantPrincipal(
            request,
            taxTenantPrincipalSecretForCapability(tenantCapability, {
              user: userPrincipalSecret,
              snapshotProjector: snapshotProjectorPrincipalSecret,
            }),
            tenantCapability,
          )
        : null;
      const accountantMandateResponse = await handleAccountantMandateRoute(request, url, store, tenantPrincipal);
      if (accountantMandateResponse) return applyCors(accountantMandateResponse, request);
      const accountantReviewResponse = await handleAccountantReviewRoute(
        request,
        url,
        store,
        tenantPrincipal,
      );
      if (accountantReviewResponse) return applyCors(accountantReviewResponse, request);
      const accountantInvoiceResponse = await handleAccountantInvoiceRoute(
        request, url, store, facturaEAgent, tenantPrincipal, new Date(), undefined,
        { authority: facturaEAuthorityExecution, beta: fiscalBeta },
      );
      if (accountantInvoiceResponse) return applyCors(accountantInvoiceResponse, request);
      const onboardingResponse = await handleArcaOnboardingRoute(request, url, arcaOnboarding, {
        userApprovalToken,
        evidenceIngestToken,
        tenantPrincipal: null,
      });
      if (onboardingResponse) return applyCors(onboardingResponse, request);
      const browserSnapshotResponse = handleTaxBrowserSnapshotRoute(request, url, taxBrowserSnapshots, tenantPrincipal);
      if (browserSnapshotResponse) return applyCors(browserSnapshotResponse, request);
      const factoringBrowserResponse = await handleFacturaEFactoringBrowserRoute(
        request,
        url,
        store,
        taxBrowserSnapshotProjector,
        tenantPrincipal,
      );
      if (factoringBrowserResponse) return applyCors(factoringBrowserResponse, request);
      const evidenceResponse = await handleTaxEvidenceRoute(request, url, taxEvidenceWorkspace, { evidenceIngestToken, consentEventToken, snapshotProjectorToken, tenantPrincipal });
      if (evidenceResponse) return applyCors(evidenceResponse, request);
      const settlementResponse = await handleInvoiceSettlementAdapterRoute(request, url, store, deskInvoiceSettlementPrincipalSecret);
      if (settlementResponse) return applyCors(settlementResponse, request);
      const agentResponse = await handleAgentRoute(request, url, facturaEAgent, { userApprovalToken, accountantApprovalToken, evidenceIngestToken, agentPrincipalSecret: [deskAgentPrincipalSecret, openAgentsAgentPrincipalSecret], accountantMandates: store, legacyEvidenceAppendEnabled, arcaSetup });
      if (agentResponse) return applyCors(agentResponse, request);
      if (request.method === 'GET' && url.pathname === '/health') {
        return applyCors(json({
          status: 'ok',
          execution: wsfexGateway ? 'human_gated_agent' : 'manual_only',
          authorityEnvironment: arcaEnvironment,
          argentinaLaunchPolicy,
          filingEnabled: Boolean(
            authorityCorridorEnabled
            && authorityRemoteEffectsEnabled
            && facturaEAuthorityRemoteEffect
            && arcaProductionAuthority
            && env.TAX_ENGINE_ARCA_AUTHORITY_PRODUCTION_APPROVED === 'true'
            && env.TAX_ENGINE_ARCA_REMOTE_EFFECTS_PRODUCTION_APPROVED === 'true'
            && authorityPreparation
            && authorityPayloadWriter
            && wsfexGateway
          ),
          facturaEAuthorityCorridor: authorityCorridorEnabled
            ? facturaEAuthorityExecution.readiness()
            : { remoteEffects: 'dark', downstreamEligibility: 'blocked' },
          agent: facturaEAgent.capabilities(),
          arcaOnboarding: arcaOnboarding.capabilities(),
          arcaSetup: arcaSetup ? arcaSetup.capabilities() : { state: 'dark' },
          facturaEFeaturePublication: facturaEFeatureEnabled
            ? {
                state: 'armed',
                signer: facturaEFeatureSigner ? 'configured' : 'configuration_required',
                eventDelivery: facturaEFeatureEventPublisher
                  ? 'configured'
                  : 'configuration_required',
                renewalCadence: facturaEFeatureRenewalCadenceReady(
                  facturaEFeaturePollIntervalMs
                ) ? 'ready' : 'configuration_required',
                pollIntervalMs: facturaEFeaturePollIntervalMs,
                renewalWindowMs: FACTURA_E_FEATURE_RENEWAL_WINDOW_MS,
                mutationFence: facturaEFeatures
                  ? 'ready'
                  : 'configuration_required',
                deskEffectReceipts: facturaETerminalReceiptVerifiers.deskEffect.enabled
                  ? 'armed'
                  : 'dark',
                noEffectRecovery: facturaETerminalReceiptVerifiers.noEffectRecovery.enabled
                  ? 'armed'
                  : 'dark',
              }
            : { state: 'dark' },
          taxDomainEventDelivery: taxDomainEventDeliveryEnabled
            ? {
                state: taxDomainEventPublisher ? 'configured' : 'configuration_required',
                contract: 'tax-domain-event-v1',
                inboxAckRequired: true,
                pollIntervalMs: taxDomainEventPollIntervalMs,
              }
            : { state: 'dark' },
          externalAccountantDecisionIngress: accountantDecisionIngressEnabled
            ? { state: 'armed', authority: 'external_accountant_workspace' }
            : { state: 'dark' },
        }), request);
      }
      if (request.method === 'GET' && url.pathname === '/v1/catalogues') {
        return applyCors(json({ data: listJurisdictionProviders().map(provider => provider.catalogue) }), request);
      }
      if (request.method === 'GET' && url.pathname === '/v1/snapshots/demo') {
        if (!taxDemoRoutesEnabled()) return applyCors(json({ error: 'NOT_FOUND' }, 404), request);
        const jurisdiction = jurisdictionSchema.parse(url.searchParams.get('jurisdiction') ?? 'AR');
        const regimeId = url.searchParams.get('regime') ?? undefined;
        const founderResidency = founderResidencySchema.parse(url.searchParams.get('founderResidency') ?? 'foreign');
        const { demoSnapshot } = await import('@tax-engine/core');
        return applyCors(json({ data: await demoSnapshot(jurisdiction, regimeId, founderResidency) }), request);
      }
      if (request.method === 'GET' && url.pathname === '/v1/providers/argentina-erp') {
        const tenantId = url.searchParams.get('tenantId') ?? 'unconfigured';
        return applyCors(json({
          data: {
            providerId: argentinaErp.providerId,
            capabilities: await argentinaErp.getImportCapabilities(tenantId),
            productionClaim: false,
            safeErrorCode: 'AUTHORIZED_SANDBOX_REQUIRED',
          },
        }), request);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/v1/profiles/')) {
        const workspaceId = taxWorkspaceIdSchema.parse(decodeURIComponent(url.pathname.slice('/v1/profiles/'.length)));
        assertTaxTenantPrincipalScope(tenantPrincipal, workspaceId);
        const profile = store.get(workspaceId);
        return applyCors(profile ? json({ data: profile }) : json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (request.method === 'POST' && url.pathname === '/v1/profiles/confirm') {
        const body = z.object({
          actorId: z.string().min(1),
          expectedVersion: z.string().nullable(),
          profile: profileSchema,
        }).strict().parse(JSON.parse(await readBoundedBody(
          request,
          64 * 1024,
          'TAX_PROFILE_REQUEST_TOO_LARGE',
        )) as unknown);
        assertTaxTenantPrincipalScope(tenantPrincipal, body.profile.workspaceId, body.actorId);
        const profile = store.confirm({ ...body, occurredAt: new Date().toISOString() });
        return applyCors(json({ data: profile }), request);
      }
      return applyCors(json({ error: 'NOT_FOUND' }, 404), request);
    } catch (error) {
      const safeError = classifyApiError(error);
      return applyCors(json({ error: safeError.code }, safeError.status), request);
    }
  }

  function authorized(request: Request): boolean {
    if (!apiKey) return true;
    return request.headers.get('authorization') === `Bearer ${apiKey}`;
  }

  let facturaEFeatureTickRunning = false;
  async function tickFacturaEFeatures(): Promise<void> {
    if (
      facturaEFeatureTickRunning
      || !facturaEFeatures
      || !facturaEFeatureEventPublisher
    ) return;
    facturaEFeatureTickRunning = true;
    try {
      for (const executionId of facturaEFeatures.projectionCandidates(100)) {
        try {
          await facturaEFeatures.project(executionId);
        } catch (error) {
          console.error('Factura E feature projection failed:', classifyApiError(error).code);
        }
      }
      await drainFacturaEFeatureOutbox(
        facturaEFeatures,
        facturaEFeatureEventPublisher,
        { limit: 50, leaseSeconds: 30 }
      );
    } catch (error) {
      console.error('Factura E feature worker failed:', classifyApiError(error).code);
    } finally {
      facturaEFeatureTickRunning = false;
    }
  }
  let taxDomainEventTickRunning = false;
  async function tickTaxDomainEvents(): Promise<void> {
    if (taxDomainEventTickRunning || !taxDomainEventPublisher) return;
    taxDomainEventTickRunning = true;
    try {
      const outboxes = facturaEFeatures ? [store, facturaEFeatures] : [store];
      for (const outbox of outboxes) {
        try {
          await drainTaxDomainEventOutbox(outbox, taxDomainEventPublisher, {
            limit: 50,
            leaseSeconds: 30,
          });
        } catch (error) {
          console.error('Tax domain event outbox failed:', classifyApiError(error).code);
        }
      }
    } catch (error) {
      console.error('Tax domain event worker failed:', classifyApiError(error).code);
    } finally {
      taxDomainEventTickRunning = false;
    }
  }
  let arcaSetupTickRunning = false;
  async function tickArcaSetup(): Promise<void> {
    if (arcaSetupTickRunning || !arcaSetup) return;
    arcaSetupTickRunning = true;
    try {
      await arcaSetup.tick();
    } catch (error) {
      console.error('ARCA setup tick failed:', classifyApiError(error).code);
    } finally {
      arcaSetupTickRunning = false;
    }
  }
  const arcaSetupInterval = Number(env.TAX_ARCA_SETUP_TICK_MS ?? 30_000);

  return {
    fetch: handle,
    async tick() {
      await tickFacturaEFeatures();
      await tickTaxDomainEvents();
      await tickArcaSetup();
    },
    loops: {
      facturaEFeatures: facturaEFeatureEnabled
        ? { intervalMs: facturaEFeaturePollIntervalMs!, run: tickFacturaEFeatures }
        : null,
      taxDomainEvents: taxDomainEventDeliveryEnabled
        ? { intervalMs: taxDomainEventPollIntervalMs, run: tickTaxDomainEvents }
        : null,
      arcaSetup: arcaSetup
        ? {
            intervalMs: Number.isInteger(arcaSetupInterval) && arcaSetupInterval >= 5_000 ? arcaSetupInterval : 30_000,
            run: tickArcaSetup,
          }
        : null,
    },
    executionMode: wsfexGateway ? 'human_gated_agent' : 'manual_only',
  };
}

function serviceFetch(
  fetcher: ServiceFetcher | undefined,
): ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined {
  return fetcher ? (input, init) => fetcher.fetch(input, init) : undefined;
}

function safeBearerToken(request: Request, expected: string): boolean {
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? '';
  const a = createHash('sha256').update(actual).digest();
  const b = createHash('sha256').update(expected).digest();
  return actual.length > 0 && timingSafeEqual(a, b);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function parseArcaAuthorityEnvironment(
  raw: string | undefined
): 'homologation' | 'production' {
  if (raw === 'production') return 'production';
  if (raw === 'homologacion' || raw === 'homologation') return 'homologation';
  throw new Error('ARCA_ENVIRONMENT_INVALID');
}

function parseTaxDomainEventPollInterval(raw: string | undefined): number {
  const value = raw === undefined ? 5_000 : Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw new Error('TAX_DOMAIN_EVENT_POLL_INTERVAL_INVALID');
  }
  return value;
}
