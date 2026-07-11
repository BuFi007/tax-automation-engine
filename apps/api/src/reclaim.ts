import {
  hashCanonical,
  type ArcaCaeClaimsV1,
  type ArcaReadinessClaimsV1,
  type FacturaEAgentRunV1,
  type FacturaEProofPurpose,
  type ReclaimSessionReferenceV1,
  type VerifiedReclaimProofV1,
} from '@tax-engine/core';
import { ReclaimProofRequest, verifyProof, type Proof } from '@reclaimprotocol/js-sdk';

export type ReclaimRequestResult = Readonly<{
  session: ReclaimSessionReferenceV1;
  requestUrl: string;
  requestConfig: string;
  statusUrl: string;
}>;

export interface ReclaimGateway {
  createRequest(run: FacturaEAgentRunV1, purpose: FacturaEProofPurpose, occurredAt: string, subjectId?: string | null): Promise<ReclaimRequestResult>;
  verifyCallback(run: FacturaEAgentRunV1, session: ReclaimSessionReferenceV1, proofPayload: unknown, occurredAt: string): Promise<VerifiedReclaimProofV1>;
}

export type ReclaimGatewayConfig = Readonly<{
  appId: string;
  appSecret: string;
  callbackBaseUrl: string;
  taxpayerReadinessProviderId: string;
  caeConstatementProviderId: string;
  requireTeeAttestation: boolean;
}>;

export class ReclaimProtocolGateway implements ReclaimGateway {
  constructor(private readonly config: ReclaimGatewayConfig) {}

  static fromEnvironment(): ReclaimProtocolGateway | null {
    const config = {
      appId: process.env.RECLAIM_APP_ID ?? '',
      appSecret: process.env.RECLAIM_APP_SECRET ?? '',
      callbackBaseUrl: process.env.RECLAIM_CALLBACK_BASE_URL ?? '',
      taxpayerReadinessProviderId: process.env.RECLAIM_ARCA_TAXPAYER_PROVIDER_ID ?? '',
      caeConstatementProviderId: process.env.RECLAIM_ARCA_CAE_PROVIDER_ID ?? '',
      requireTeeAttestation: process.env.RECLAIM_REQUIRE_TEE === 'true',
    };
    return config.appId && config.appSecret && config.callbackBaseUrl && config.taxpayerReadinessProviderId && config.caeConstatementProviderId
      ? new ReclaimProtocolGateway(config)
      : null;
  }

  async createRequest(run: FacturaEAgentRunV1, purpose: FacturaEProofPurpose, occurredAt: string, subjectId: string | null = null): Promise<ReclaimRequestResult> {
    const providerId = purpose === 'arca_taxpayer_readiness'
      ? this.config.taxpayerReadinessProviderId
      : this.config.caeConstatementProviderId;
    const request = await ReclaimProofRequest.init(this.config.appId, this.config.appSecret, providerId, {
      acceptAiProviders: false,
      acceptTeeAttestation: this.config.requireTeeAttestation,
    });
    const subject = proofSubject(run, purpose, subjectId);
    const context = {
      version: 'motora-arca-proof-context-v1',
      runId: run.runId,
      workspaceId: run.workspaceId,
      purpose,
      subjectId: subject.id,
      subjectHash: subject.hash,
    };
    request.setJsonContext(context);
    request.setAppCallbackUrl(`${this.config.callbackBaseUrl.replace(/\/$/, '')}/v1/reclaim/callback`, true);
    const providerVersion = request.getProviderVersion();
    const requestedAt = new Date(occurredAt);
    const expiresAt = new Date(requestedAt.getTime() + 10 * 60 * 1000).toISOString();
    return {
      session: {
        sessionId: request.getSessionId(),
        purpose,
        providerId: providerVersion.providerId,
        providerVersion: providerVersion.providerVersion,
        contextHash: hashCanonical(context),
        subjectId: subject.id,
        subjectHash: subject.hash,
        requestedAt: occurredAt,
        expiresAt,
        state: 'pending',
      },
      requestUrl: await request.getRequestUrl(),
      requestConfig: request.toJsonString(),
      statusUrl: request.getStatusUrl(),
    };
  }

  async verifyCallback(
    run: FacturaEAgentRunV1,
    session: ReclaimSessionReferenceV1,
    proofPayload: unknown,
    occurredAt: string
  ): Promise<VerifiedReclaimProofV1> {
    if (Date.parse(occurredAt) > Date.parse(session.expiresAt)) throw new Error('RECLAIM_SESSION_EXPIRED');
    const proofs = normalizeProofs(proofPayload);
    const verification = await verifyProof(proofs, {
      providerId: session.providerId,
      providerVersion: session.providerVersion,
      allowedTags: [],
      ...(this.config.requireTeeAttestation ? { teeAttestation: { appSecret: this.config.appSecret } } : {}),
    });
    if (!verification.isVerified) throw new Error('RECLAIM_PROOF_INVALID');
    if (this.config.requireTeeAttestation && !verification.isTeeAttestationVerified) throw new Error('RECLAIM_TEE_ATTESTATION_REQUIRED');
    const expectedContext = {
      version: 'motora-arca-proof-context-v1',
      runId: run.runId,
      workspaceId: run.workspaceId,
      purpose: session.purpose,
      subjectId: session.subjectId,
      subjectHash: session.subjectHash,
    };
    if (hashCanonical(expectedContext) !== session.contextHash) throw new Error('RECLAIM_SESSION_CONTEXT_MISMATCH');
    for (const trusted of verification.data) {
      if (hashCanonical(pickProofContext(trusted.context)) !== session.contextHash) throw new Error('RECLAIM_PROOF_CONTEXT_MISMATCH');
      const reclaimSessionId = trusted.context.reclaimSessionId;
      if (typeof reclaimSessionId === 'string' && reclaimSessionId !== session.sessionId) throw new Error('RECLAIM_PROOF_SESSION_MISMATCH');
    }
    const extracted = Object.assign({}, ...verification.data.map(item => item.extractedParameters));
    return {
      proofHash: hashCanonical(proofs),
      sessionId: session.sessionId,
      purpose: session.purpose,
      providerId: session.providerId,
      providerVersion: session.providerVersion,
      verifiedAt: occurredAt,
      attestation: {
        teeRequired: this.config.requireTeeAttestation,
        teeVerified: verification.isTeeAttestationVerified === true,
      },
      custodyReceipt: null,
      claims: session.purpose === 'arca_taxpayer_readiness'
        ? readinessClaims(extracted)
        : caeClaims(extracted),
    };
  }
}

function normalizeProofs(payload: unknown): Proof[] {
  const decoded = typeof payload === 'string' ? JSON.parse(decodeURIComponent(payload)) as unknown : payload;
  const candidates = Array.isArray(decoded) ? decoded : [decoded];
  if (!candidates.length || candidates.some(candidate => !candidate || typeof candidate !== 'object' || Array.isArray(candidate))) throw new Error('RECLAIM_PROOF_PAYLOAD_INVALID');
  return candidates as Proof[];
}

function pickProofContext(context: Record<string, unknown>): Record<string, unknown> {
  return {
    version: context.version,
    runId: context.runId,
    workspaceId: context.workspaceId,
    purpose: context.purpose,
    subjectId: context.subjectId ?? null,
    subjectHash: context.subjectHash ?? null,
  };
}

function readinessClaims(values: Record<string, string>): ArcaReadinessClaimsV1 {
  const regime = values.taxRegime;
  if (regime !== 'monotributo' && regime !== 'responsable_inscripto') throw new Error('RECLAIM_READINESS_REGIME_INVALID');
  if (values.exportActivityEnabled !== 'true' || values.exportPointOfSaleActive !== 'true') throw new Error('RECLAIM_READINESS_NOT_ELIGIBLE');
  const pointOfSale = positiveInteger(values.exportPointOfSale, 'RECLAIM_EXPORT_POINT_OF_SALE_INVALID');
  return {
    regime,
    category: values.taxCategory || null,
    exportActivityEnabled: true,
    exportPointOfSaleActive: true,
    exportPointOfSale: pointOfSale,
  };
}

function caeClaims(values: Record<string, string>): ArcaCaeClaimsV1 {
  if (!['19', '20', '21'].includes(values.documentType ?? '')) throw new Error('RECLAIM_CAE_DOCUMENT_TYPE_INVALID');
  const documentType = Number(values.documentType) as 19 | 20 | 21;
  const decimal = values.total;
  if (!decimal || !/^\d+(?:\.\d+)?$/.test(decimal)) throw new Error('RECLAIM_CAE_TOTAL_INVALID');
  const currency = values.currency;
  if (!currency || !/^[A-Z]{3,10}$/.test(currency)) throw new Error('RECLAIM_CAE_CURRENCY_INVALID');
  const issuedAt = values.issuedAt;
  if (!issuedAt || !/^\d{4}-\d{2}-\d{2}$/.test(issuedAt)) throw new Error('RECLAIM_CAE_ISSUE_DATE_INVALID');
  const cae = values.cae;
  if (!cae || !/^\d{10,20}$/.test(cae)) throw new Error('RECLAIM_CAE_CODE_INVALID');
  const association = documentType === 19
    ? { associatedDocumentType: null, associatedPointOfSale: null, associatedInvoiceNumber: null }
    : {
        associatedDocumentType: values.associatedDocumentType === '19' ? 19 as const : fail('RECLAIM_ADJUSTMENT_ASSOCIATED_TYPE_INVALID'),
        associatedPointOfSale: positiveInteger(values.associatedPointOfSale, 'RECLAIM_ADJUSTMENT_ASSOCIATED_POINT_OF_SALE_INVALID'),
        associatedInvoiceNumber: positiveIntegerString(values.associatedInvoiceNumber, 'RECLAIM_ADJUSTMENT_ASSOCIATED_INVOICE_INVALID'),
      };
  return {
    documentType,
    pointOfSale: positiveInteger(values.pointOfSale, 'RECLAIM_CAE_POINT_OF_SALE_INVALID'),
    invoiceNumber: positiveIntegerString(values.invoiceNumber, 'RECLAIM_CAE_INVOICE_NUMBER_INVALID'),
    cae,
    issuedAt,
    total: { decimal, currency },
    ...association,
  };
}

function proofSubject(run: FacturaEAgentRunV1, purpose: FacturaEProofPurpose, subjectId: string | null): Readonly<{ id: string | null; hash: string | null }> {
  if (purpose === 'arca_taxpayer_readiness') return { id: null, hash: null };
  if (purpose === 'arca_cae_constatement') {
    if (!run.intent || !run.intentHash) throw new Error('INVOICE_INTENT_REQUIRED');
    return { id: run.intent.intentId, hash: run.intentHash };
  }
  const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === subjectId);
  if (!adjustment) throw new Error('ADJUSTMENT_NOT_FOUND');
  return { id: adjustment.adjustmentId, hash: adjustment.intentHash };
}

function fail(code: string): never {
  throw new Error(code);
}

function positiveInteger(value: string | undefined, code: string): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function positiveIntegerString(value: string | undefined, code: string): string {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new Error(code);
  return value;
}
