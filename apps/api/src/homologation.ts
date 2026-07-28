import { hashCanonical } from '@tax-engine/core';
import { z } from 'zod';

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export type HomologationGateV1 = Readonly<{
  id: string;
  required: true;
  state: 'ready' | 'missing' | 'unsafe';
  safeReason: string;
}>;

export type HomologationPreflightV1 = Readonly<{
  version: 'arca-homologation-preflight-v1';
  authorityEnvironment: 'homologacion' | 'production';
  state: 'ready_for_authorized_homologation' | 'blocked';
  productionActivationAllowed: false;
  gates: readonly HomologationGateV1[];
}>;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const reclaimResultSchema = z.object({
  purpose: z.enum([
    'arca_onboarding_readiness',
    'arca_taxpayer_readiness',
    'arca_cae_constatement',
    'arca_adjustment_constatement',
  ]),
  providerIdHash: hashSchema,
  providerVersion: z.string().min(1),
  proofHash: hashSchema,
  custodyReceiptHash: hashSchema,
  teeRequired: z.boolean(),
  teeVerified: z.boolean(),
  negativeBindingCasesRejected: z.boolean(),
}).strict();
const wsfexResultSchema = z.object({
  documentType: z.union([z.literal(19), z.literal(20), z.literal(21)]),
  acceptedReceiptHash: hashSchema,
  ambiguousOutcomeObserved: z.boolean(),
  exactRecoveryReceiptHash: hashSchema,
  mismatchedEchoRejected: z.boolean(),
  canonicalPayloadMismatchRejected: z.boolean(),
  encryptedPayloadAtRestVerified: z.boolean(),
  wsaaKeyIsolationVerified: z.boolean(),
}).strict();
// Domestic Factura C lane (WSFEV1): comprobante types 11 / 12 / 13.
const wsfeResultSchema = z.object({
  documentType: z.union([z.literal(11), z.literal(12), z.literal(13)]),
  acceptedReceiptHash: hashSchema,
  ambiguousOutcomeObserved: z.boolean(),
  exactRecoveryReceiptHash: hashSchema,
  reprocessObservedForResend: z.boolean(),
  mismatchedEchoRejected: z.boolean(),
  caeAloneRejected: z.boolean(),
  sequenceConflictRejected: z.boolean(),
  encryptedPayloadAtRestVerified: z.boolean(),
  wsaaKeyIsolationVerified: z.boolean(),
}).strict();
const journeySchema = z.object({
  path: z.enum(['reclaim_copilot', 'wsfex_delegated']),
  eventSequenceHash: hashSchema,
  accountingAttestationPacketHash: hashSchema,
  separateSettlementFxTaxStatesObserved: z.boolean(),
}).strict();

export const homologationEvidenceSchema = z.object({
  version: z.literal('arca-homologation-evidence-v1'),
  executedAt: z.iso.datetime({ offset: true }),
  authorityEnvironment: z.literal('homologacion'),
  effectiveRuleVersionIds: z.array(z.string().min(1)).min(3),
  reclaim: z.array(reclaimResultSchema).length(4),
  wsfex: z.array(wsfexResultSchema).length(3),
  wsfe: z.array(wsfeResultSchema).length(3),
  journeys: z.array(journeySchema).length(2),
  reviews: z.object({
    accountantAccepted: z.boolean(),
    securityAccepted: z.boolean(),
    ownerAcceptedForProductionReview: z.boolean(),
    redactedEvidenceReferenceHash: hashSchema,
  }).strict(),
  secretsDetected: z.literal(false),
  productionEnabled: z.literal(false),
}).strict();

export type HomologationEvidenceV1 = z.infer<typeof homologationEvidenceSchema>;

type HomologationFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const signerHealthSchema = z.object({
  version: z.literal('motora-wsfex-signer-health-v1'),
  environment: z.literal('homologation'),
  signerVersion: z.string().min(1),
  wsfexVersion: z.string().min(1),
  certificateDelegationConfigured: z.literal(true),
  wsaaReady: z.literal(true),
}).strict();
const wsfeSignerHealthSchema = z.object({
  schema: z.literal('motora-wsfe-signer-health-v1'),
  environment: z.literal('homologacion'),
  certificateDelegationConfigured: z.literal(true),
  wsaaReady: z.literal(true),
}).strict();
const proofVaultHealthSchema = z.object({
  version: z.literal('reclaim-proof-vault-health-v1'),
  encryptionReady: z.literal(true),
  activePolicyCount: z.number().int().positive(),
}).strict();

const liveSmokeSchema = z.object({
  version: z.literal('arca-wsfex-live-smoke-v1'),
  authorityEnvironment: z.literal('homologacion'),
  wsaa: z.object({
    ticketReady: z.literal(true),
    wsfexTicketReady: z.literal(true),
  }).passthrough(),
  wsfex: z.object({
    signerProbeState: z.literal('ready'),
  }).passthrough(),
  feeWsPointOfSale: z.object({
    activePoints: z.array(z.unknown()),
    responseErrorCode: z.string(),
    gateState: z.enum(['ready', 'missing', 'unsafe']),
  }).passthrough(),
  productionEnabled: z.literal(false),
  secretsDetected: z.literal(false),
}).passthrough();

export function validateLiveWsfexSmoke(input: unknown): Readonly<{
  version: 'arca-wsfex-live-smoke-validation-v1';
  state: 'blocked' | 'ready_for_invoice_homologation';
  failedGateIds: readonly string[];
  safeSummary: Readonly<{
    authorityEnvironment: 'homologacion';
    activeFeeWsPointCount: number;
    productionEnabled: false;
    limitation: string;
  }>;
}> {
  const smoke = liveSmokeSchema.parse(input);
  const failedGateIds: string[] = [];
  if (smoke.feeWsPointOfSale.activePoints.length === 0) {
    failedGateIds.push('feews_point_of_sale_missing');
  }
  if (smoke.feeWsPointOfSale.responseErrorCode !== '0') {
    failedGateIds.push('feews_point_of_sale_api_error');
  }
  if (smoke.feeWsPointOfSale.gateState !== 'ready') {
    failedGateIds.push('feews_point_of_sale_gate_not_ready');
  }
  return {
    version: 'arca-wsfex-live-smoke-validation-v1',
    state: failedGateIds.length === 0 ? 'ready_for_invoice_homologation' : 'blocked',
    failedGateIds,
    safeSummary: {
      authorityEnvironment: 'homologacion',
      activeFeeWsPointCount: smoke.feeWsPointOfSale.activePoints.length,
      productionEnabled: false,
      limitation: 'This proves only the current homologation smoke state; production still requires independent authority, signer, delegation, and owner gates.',
    },
  };
}

export function buildHomologationPreflight(environment: EnvironmentSource = process.env): HomologationPreflightV1 {
  const authorityEnvironment = environment.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologacion' as const;
  const trustedHumanChannelSecrets = [
    environment.TAX_ENGINE_API_KEY,
    environment.TAX_ENGINE_USER_APPROVAL_TOKEN,
    environment.TAX_ENGINE_ACCOUNTANT_APPROVAL_TOKEN,
    environment.TAX_ENGINE_EVIDENCE_INGEST_TOKEN,
    environment.TAX_ENGINE_CONSENT_EVENT_TOKEN,
    environment.TAX_ENGINE_SNAPSHOT_PROJECTOR_TOKEN,
    environment.TAX_ENGINE_AUTHORITY_PAYLOAD_TOKEN,
  ];
  const tenantPrincipalSecrets = [
    environment.TAX_ENGINE_USER_PRINCIPAL_HMAC_SECRET,
    environment.TAX_ENGINE_MOTORA_ONBOARDING_PRINCIPAL_HMAC_SECRET,
    environment.TAX_ENGINE_SNAPSHOT_PROJECTOR_PRINCIPAL_HMAC_SECRET,
    environment.TAX_ENGINE_EVIDENCE_PUBLISHER_PRINCIPAL_HMAC_SECRET,
    environment.TAX_ENGINE_CONSENT_AUTHORITY_PRINCIPAL_HMAC_SECRET,
    environment.TAX_ENGINE_OPEN_AGENTS_AGENT_PRINCIPAL_HMAC_SECRET,
    environment.TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET,
  ];
  const workbenchCommitmentSecrets = [
    environment.TAX_WORKBENCH_INGEST_SECRET,
  ];
  const gates: HomologationGateV1[] = [
    booleanGate('explicit_homologation_authority', environment.ARCA_HOMOLOGATION_AUTHORIZED === 'true', 'Explicit homologation authority has not been recorded.'),
    booleanGate('approved_test_identity', environment.ARCA_HOMOLOGATION_TEST_IDENTITY_APPROVED === 'true', 'No approved homologation test identity is recorded.'),
    distinctConfiguredGate('trusted_human_channels', trustedHumanChannelSecrets, 'The Tax API, user approval, accountant approval, evidence-ingest, consent-event, snapshot-projector, and authority-payload channels must all be configured with distinct secrets.'),
    distinctConfiguredGate('tenant_principal_boundaries', tenantPrincipalSecrets, 'The user, onboarding gateway, snapshot-projector, evidence-publisher, consent-authority, Open Agents, and browser-reference tenant boundaries must all be configured with distinct scoped secrets.'),
    distinctConfiguredGate('security_channel_isolation', [...trustedHumanChannelSecrets, ...tenantPrincipalSecrets, ...workbenchCommitmentSecrets], 'Bearer-channel, tenant-signing, and commitment-ingest secrets must be globally distinct; no channel credential may be reused across authority, principal, browser-reference, or Workbench boundaries.'),
    configuredGate('reclaim_application', [environment.RECLAIM_APP_ID, environment.RECLAIM_APP_SECRET, environment.RECLAIM_CALLBACK_BASE_URL], 'Reclaim application and callback configuration is incomplete.'),
    booleanAndConfiguredGate('reviewed_reclaim_readiness_provider', environment.RECLAIM_ARCA_TAXPAYER_PROVIDER_REVIEWED === 'true', environment.RECLAIM_ARCA_TAXPAYER_PROVIDER_ID, 'The readiness provider is missing or has not been explicitly reviewed.'),
    booleanAndConfiguredGate('reviewed_reclaim_cae_provider', environment.RECLAIM_ARCA_CAE_PROVIDER_REVIEWED === 'true', environment.RECLAIM_ARCA_CAE_PROVIDER_ID, 'The CAE provider is missing or has not been explicitly reviewed.'),
    booleanAndConfiguredGate('reviewed_reclaim_onboarding_provider', environment.RECLAIM_ARCA_ONBOARDING_PROVIDER_REVIEWED === 'true', environment.RECLAIM_ARCA_ONBOARDING_PROVIDER_ID, 'The ARCA onboarding provider is missing or has not passed the prover-side WITNESS review.'),
    configuredGate('encrypted_proof_custody', [environment.RECLAIM_PROOF_VAULT_URL, environment.RECLAIM_PROOF_VAULT_TOKEN, environment.RECLAIM_PROOF_RETENTION_POLICY_ID], 'Encrypted proof-vault custody and retention policy must be configured for acceptance.'),
    configuredGate('commitment_only_workbench_ingest', [
      environment.TAX_WORKBENCH_COMMITMENT_PUBLISHING_ENABLED === 'true' ? 'enabled' : undefined,
      environment.TAX_WORKBENCH_INGEST_URL,
      environment.TAX_WORKBENCH_INGEST_SECRET,
    ], 'Commitment-only Workbench publishing must be explicitly enabled with its HTTPS endpoint and independent ingest secret.'),
    configuredGate('isolated_wsfex_signer', [environment.ARCA_SIGNER_URL, environment.ARCA_SIGNER_TOKEN], 'The isolated WSFEX signer is not configured.'),
    configuredGate('isolated_wsfe_signer', [environment.ARCA_WSFE_SIGNER_URL, environment.ARCA_WSFE_SIGNER_TOKEN], 'The isolated WSFE (Factura C) signer is not configured.'),
    configuredGate('encrypted_arca_boundary', [environment.ARCA_BOUNDARY_URL, environment.ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN], 'The encrypted ARCA payload boundary is not configured.'),
    booleanGate('wsfex_certificate_delegation', environment.ARCA_WSFEX_DELEGATION_CONFIRMED === 'true', 'Authorized WSFEX certificate delegation has not been confirmed.'),
    booleanGate('wsfe_certificate_delegation', environment.ARCA_WSFE_DELEGATION_CONFIRMED === 'true', 'Authorized WSFE certificate delegation has not been confirmed.'),
    booleanGate('feews_point_of_sale', environment.ARCA_FEEWS_POINT_OF_SALE_CONFIRMED === 'true', 'An active FEEWS point of sale has not been confirmed.'),
    safeEnvironmentGate(authorityEnvironment, environment.TAX_ENGINE_PRODUCTION_APPROVED === 'true'),
    httpsGate('reclaim_callback_https', environment.RECLAIM_CALLBACK_BASE_URL, 'Reclaim callback must use HTTPS for homologation.'),
    httpsGate('proof_vault_https', environment.RECLAIM_PROOF_VAULT_URL, 'Proof vault must use HTTPS for homologation.'),
    httpsGate('workbench_ingest_https', environment.TAX_WORKBENCH_INGEST_URL, 'Workbench commitment ingest must use HTTPS for homologation.'),
    httpsGate('wsfex_signer_https', environment.ARCA_SIGNER_URL, 'WSFEX signer must use HTTPS for homologation.'),
    httpsGate('wsfe_signer_https', environment.ARCA_WSFE_SIGNER_URL, 'WSFE signer must use HTTPS for homologation.'),
    httpsGate('arca_boundary_https', environment.ARCA_BOUNDARY_URL, 'ARCA authority boundary must use HTTPS for homologation.'),
  ];
  return {
    version: 'arca-homologation-preflight-v1',
    authorityEnvironment,
    state: gates.every(gate => gate.state === 'ready') ? 'ready_for_authorized_homologation' : 'blocked',
    productionActivationAllowed: false,
    gates,
  };
}

export function validateHomologationEvidence(
  input: unknown,
  environment: EnvironmentSource = process.env,
): Readonly<{
  version: 'arca-homologation-validation-v1';
  state: 'structurally_complete_for_human_production_review' | 'rejected';
  failedGateIds: readonly string[];
  safeSummary: Readonly<{
    reclaimPurposes: readonly string[];
    wsfexDocumentTypes: readonly number[];
    wsfeDocumentTypes: readonly number[];
    journeyPaths: readonly string[];
    productionEnabled: false;
    limitation: string;
  }>;
}> {
  const evidence = homologationEvidenceSchema.parse(input);
  const failed: string[] = [];
  requireUniqueCoverage(
    'reclaim_coverage',
    evidence.reclaim.map(item => item.purpose),
    [
      'arca_onboarding_readiness',
      'arca_taxpayer_readiness',
      'arca_cae_constatement',
      'arca_adjustment_constatement',
    ],
    failed,
  );
  requireUniqueCoverage('wsfex_coverage', evidence.wsfex.map(item => item.documentType), [19, 20, 21], failed);
  requireUniqueCoverage('wsfe_coverage', evidence.wsfe.map(item => item.documentType), [11, 12, 13], failed);
  requireUniqueCoverage('journey_coverage', evidence.journeys.map(item => item.path), ['reclaim_copilot', 'wsfex_delegated'], failed);
  const reviewedProviderIds = reviewedReclaimProviderIds(environment);
  if (!reviewedProviderIds) {
    failed.push('reclaim_provider_review_binding');
  } else if (evidence.reclaim.some(item => (
    item.providerIdHash !== hashCanonical(reviewedProviderIds[item.purpose])
  ))) {
    failed.push('reclaim_provider_identity_binding');
  }
  if (evidence.reclaim.some(item => !item.negativeBindingCasesRejected || (item.teeRequired && !item.teeVerified))) failed.push('reclaim_negative_or_tee_gate');
  if (evidence.wsfex.some(item => !item.ambiguousOutcomeObserved || !item.mismatchedEchoRejected)) failed.push('wsfex_recovery_or_echo_gate');
  if (evidence.wsfex.some(item => !item.canonicalPayloadMismatchRejected || !item.encryptedPayloadAtRestVerified || !item.wsaaKeyIsolationVerified)) failed.push('wsfex_boundary_gate');
  if (evidence.wsfe.some(item => !item.ambiguousOutcomeObserved || !item.mismatchedEchoRejected || !item.reprocessObservedForResend)) failed.push('wsfe_recovery_or_echo_gate');
  if (evidence.wsfe.some(item => !item.caeAloneRejected || !item.sequenceConflictRejected)) failed.push('wsfe_domestic_discipline_gate');
  if (evidence.wsfe.some(item => !item.encryptedPayloadAtRestVerified || !item.wsaaKeyIsolationVerified)) failed.push('wsfe_boundary_gate');
  if (evidence.journeys.some(item => !item.separateSettlementFxTaxStatesObserved)) failed.push('state_separation_gate');
  if (!evidence.reviews.accountantAccepted || !evidence.reviews.securityAccepted || !evidence.reviews.ownerAcceptedForProductionReview) failed.push('human_review_gate');
  return {
    version: 'arca-homologation-validation-v1',
    state: failed.length ? 'rejected' : 'structurally_complete_for_human_production_review',
    failedGateIds: failed,
    safeSummary: {
      reclaimPurposes: evidence.reclaim.map(item => item.purpose),
      wsfexDocumentTypes: evidence.wsfex.map(item => item.documentType),
      wsfeDocumentTypes: evidence.wsfe.map(item => item.documentType),
      journeyPaths: evidence.journeys.map(item => item.path),
      productionEnabled: false,
      limitation: 'This validates redacted report structure and claimed outcomes; independent reviewers must verify the referenced evidence before production approval.',
    },
  };
}

export async function probeWsfexHomologationSigner(
  config: Readonly<{ baseUrl: string; token: string }>,
  fetcher: HomologationFetch = (input, init) => fetch(input, init)
): Promise<Readonly<{
  version: 'wsfex-homologation-probe-v1';
  state: 'ready';
  signerVersion: string;
  wsfexVersion: string;
  safeHealthReceiptHash: string;
}>> {
  if (!config.baseUrl.startsWith('https://')) throw new Error('ARCA_SIGNER_HTTPS_REQUIRED');
  if (!config.token) throw new Error('ARCA_SIGNER_TOKEN_REQUIRED');
  const response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}/health`, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ARCA_SIGNER_HEALTH_REJECTED_${response.status}`);
  const health = signerHealthSchema.parse(await response.json());
  return {
    version: 'wsfex-homologation-probe-v1',
    state: 'ready',
    signerVersion: health.signerVersion,
    wsfexVersion: health.wsfexVersion,
    safeHealthReceiptHash: hashCanonical(health),
  };
}

export async function probeWsfeHomologationSigner(
  config: Readonly<{ baseUrl: string; token: string }>,
  fetcher: HomologationFetch = (input, init) => fetch(input, init)
): Promise<Readonly<{ version: 'wsfe-homologation-probe-v1'; state: 'ready'; safeHealthReceiptHash: string }>> {
  if (!config.baseUrl.startsWith('https://')) throw new Error('ARCA_WSFE_SIGNER_HTTPS_REQUIRED');
  if (!config.token) throw new Error('ARCA_WSFE_SIGNER_TOKEN_REQUIRED');
  const response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}/health`, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ARCA_WSFE_SIGNER_HEALTH_REJECTED_${response.status}`);
  const health = wsfeSignerHealthSchema.parse(await response.json());
  return { version: 'wsfe-homologation-probe-v1', state: 'ready', safeHealthReceiptHash: hashCanonical(health) };
}

export async function probeReclaimProofVault(
  config: Readonly<{ baseUrl: string; token: string }>,
  fetcher: HomologationFetch = (input, init) => fetch(input, init)
): Promise<Readonly<{ version: 'reclaim-proof-vault-probe-v1'; state: 'ready'; safeHealthReceiptHash: string }>> {
  if (!config.baseUrl.startsWith('https://')) throw new Error('RECLAIM_PROOF_VAULT_HTTPS_REQUIRED');
  if (!config.token) throw new Error('RECLAIM_PROOF_VAULT_TOKEN_REQUIRED');
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}/health`, { method: 'GET', headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(15_000) });
  } catch { throw new Error('RECLAIM_PROOF_VAULT_TRANSPORT_FAILED'); }
  if (!response.ok) throw new Error(`RECLAIM_PROOF_VAULT_HEALTH_REJECTED_${response.status}`);
  const health = proofVaultHealthSchema.parse(await response.json());
  return { version: 'reclaim-proof-vault-probe-v1', state: 'ready', safeHealthReceiptHash: hashCanonical(health) };
}

function booleanGate(id: string, ready: boolean, missingReason: string): HomologationGateV1 {
  return { id, required: true, state: ready ? 'ready' : 'missing', safeReason: ready ? 'Configured.' : missingReason };
}

function configuredGate(id: string, values: readonly (string | undefined)[], missingReason: string): HomologationGateV1 {
  return booleanGate(id, values.every(Boolean), missingReason);
}

function distinctConfiguredGate(id: string, values: readonly (string | undefined)[], missingReason: string): HomologationGateV1 {
  if (!values.every(Boolean)) {
    return { id, required: true, state: 'missing', safeReason: missingReason };
  }
  if (new Set(values).size !== values.length) {
    return { id, required: true, state: 'unsafe', safeReason: missingReason };
  }
  return { id, required: true, state: 'ready', safeReason: 'Configured.' };
}

function booleanAndConfiguredGate(id: string, reviewed: boolean, value: string | undefined, missingReason: string): HomologationGateV1 {
  return booleanGate(id, reviewed && Boolean(value), missingReason);
}

function httpsGate(id: string, value: string | undefined, unsafeReason: string): HomologationGateV1 {
  const ready = Boolean(value?.startsWith('https://'));
  return { id, required: true, state: ready ? 'ready' : value ? 'unsafe' : 'missing', safeReason: ready ? 'Configured.' : unsafeReason };
}

function safeEnvironmentGate(authorityEnvironment: 'homologacion' | 'production', productionApproved: boolean): HomologationGateV1 {
  const ready = authorityEnvironment === 'homologacion' && !productionApproved;
  return {
    id: 'production_disabled_during_homologation',
    required: true,
    state: ready ? 'ready' : 'unsafe',
    safeReason: ready ? 'Production remains disabled.' : 'Acceptance harness refuses production mode or an already-enabled production approval.',
  };
}

function requireUniqueCoverage<T extends string | number>(id: string, actual: readonly T[], expected: readonly T[], failed: string[]): void {
  const values = new Set(actual);
  if (values.size !== expected.length || expected.some(value => !values.has(value))) failed.push(id);
}

function reviewedReclaimProviderIds(environment: EnvironmentSource): Readonly<Record<HomologationEvidenceV1['reclaim'][number]['purpose'], string>> | null {
  const onboarding = environment.RECLAIM_ARCA_ONBOARDING_PROVIDER_ID;
  const taxpayer = environment.RECLAIM_ARCA_TAXPAYER_PROVIDER_ID;
  const cae = environment.RECLAIM_ARCA_CAE_PROVIDER_ID;
  if (
    environment.RECLAIM_ARCA_ONBOARDING_PROVIDER_REVIEWED !== 'true'
    || environment.RECLAIM_ARCA_TAXPAYER_PROVIDER_REVIEWED !== 'true'
    || environment.RECLAIM_ARCA_CAE_PROVIDER_REVIEWED !== 'true'
    || !onboarding
    || !taxpayer
    || !cae
  ) return null;
  return {
    arca_onboarding_readiness: onboarding,
    arca_taxpayer_readiness: taxpayer,
    arca_cae_constatement: cae,
    arca_adjustment_constatement: cae,
  };
}
