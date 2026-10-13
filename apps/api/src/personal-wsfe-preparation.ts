import { hashCanonical } from '@tax-engine/core';
import { authorityPayloadSchema, signerRequestSchema, type AuthorityPayload } from '@tax-engine/wsfe-signer/contracts';
import { z } from 'zod';
import { fiscalWorkspaceIdSchema } from './arca-fiscal-beta';

import type { HttpAuthorityPayloadWriter } from './authority-payload';
import type { PersonalWsfeAttemptStore } from './personal-wsfe-attempt';
import type { HttpWsfePointOfSaleGateway } from './wsfe';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const personalWorkspace = fiscalWorkspaceIdSchema;
const receptor = z.object({
  docType: z.union([z.literal(80), z.literal(86), z.literal(96), z.literal(99)]),
  docNumber: z.string().regex(/^\d{1,11}$/),
  condicionIvaId: z.union([z.literal(1), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10), z.literal(13), z.literal(15), z.literal(16)]),
}).strict();
const requestSchema = z.object({
  version: z.enum(['personal-wsfe-preparation-v1', 'wsfe-preparation-v1']),
  invoiceId: z.uuid(),
  connectionId: z.uuid(),
  invoiceUpdatedAt: z.iso.datetime({ offset: true }),
  issuerProfileRef: z.string().min(1).max(500),
  taxpayerReferenceHash: sha256,
  representedCuitCommitment: sha256,
  pointOfSale: z.number().int().positive().max(99998),
  idempotencyKey: z.uuid(),
  issueDate: z.iso.date(),
  receptor,
  servicePeriod: z.object({ from: z.iso.date(), to: z.iso.date(), paymentDueDate: z.iso.date() }).strict(),
  total: z.object({ decimal: z.string().regex(/^[1-9]\d{0,14}\.\d{2}$/), currency: z.literal('ARS') }).strict(),
  description: z.string().trim().min(1).max(4000),
  requestHash: sha256,
}).strict();

export type PersonalWsfePreparationRequest = z.infer<typeof requestSchema>;
export type PersonalWsfeReadyProjection = Readonly<{
  workspaceId: string;
  environment: 'homologation';
  issuerProfileRef: string;
  taxpayerReferenceHash: string;
  representedCuitCommitment: string;
  wsfe: Readonly<{ status: 'ready' | 'reconnect' | 'requires_action'; pointOfSale: number | null }>;
}>;

/** Caller must verify the body-bound arca:issue principal and obtain a fresh Tax projection. */
export async function preparePersonalWsfeAttempt(
  raw: unknown,
  workspaceId: string,
  projection: PersonalWsfeReadyProjection,
  attempts: PersonalWsfeAttemptStore,
  signer: Pick<HttpWsfePointOfSaleGateway, 'getNextVoucher'>,
  vault: Pick<HttpAuthorityPayloadWriter, 'store'>,
  now: Date = new Date(),
) {
  const input = requestSchema.parse(raw);
  if (!personalWorkspace.safeParse(workspaceId).success || projection.workspaceId !== workspaceId
    || projection.environment !== 'homologation'
    || projection.issuerProfileRef !== input.issuerProfileRef
    || projection.taxpayerReferenceHash !== input.taxpayerReferenceHash
    || projection.representedCuitCommitment !== input.representedCuitCommitment
    || projection.wsfe.status !== 'ready' || projection.wsfe.pointOfSale !== input.pointOfSale)
    throw new Error('PERSONAL_WSFE_CONNECTION_NOT_READY');
  const { requestHash, ...frozenRequest } = input;
  if (hashCanonical(frozenRequest) !== requestHash) throw new Error('PERSONAL_WSFE_REQUEST_HASH_MISMATCH');
  if (Date.parse(input.invoiceUpdatedAt) > now.getTime() + 60_000)
    throw new Error('PERSONAL_WSFE_PREVIEW_STALE');

  const existing = attempts.get(input.invoiceId);
  const next = existing ? null : await signer.getNextVoucher({
    workspaceId, issuerProfileRef: input.issuerProfileRef, documentType: 11, pointOfSale: input.pointOfSale,
  });
  if (next && (next.workspaceId !== workspaceId
    || next.documentType !== 11 || next.pointOfSale !== input.pointOfSale
    || next.issuerProfileReferenceHash !== hashCanonical(input.issuerProfileRef)
    || next.environment !== 'homologation'
    || next.representedCuitCommitment !== input.representedCuitCommitment))
    throw new Error('PERSONAL_WSFE_VOUCHER_READ_MISMATCH');
  const voucherNumber = existing?.voucherNumber ?? next!.nextInvoiceNumber;
  const signerRequestId = (BigInt(`0x${hashCanonical(input.idempotencyKey).slice(0, 12)}`) + 1n).toString();
  const attempt = attempts.freeze({
    invoiceId: input.invoiceId, workspaceId, environment: 'homologation',
    connectionId: input.connectionId, invoiceUpdatedAt: input.invoiceUpdatedAt,
    issuerProfileRef: input.issuerProfileRef, taxpayerReferenceHash: input.taxpayerReferenceHash,
    representedCuitCommitment: input.representedCuitCommitment, pointOfSale: input.pointOfSale,
    voucherNumber, signerRequestId, idempotencyKey: input.idempotencyKey, requestHash,
  }, now);
  if (Date.parse(attempt.payloadExpiresAt) <= now.getTime() + 60_000)
    throw new Error('PERSONAL_WSFE_PAYLOAD_EXPIRED');
  const canonicalDocument = {
    version: 'factura-c-intent-v1' as const,
    intentId: input.invoiceId,
    workspaceId,
    taxpayerReferenceHash: input.taxpayerReferenceHash,
    receptorReferenceHash: hashCanonical(input.receptor),
    receptor: { docType: input.receptor.docType, condicionIvaId: input.receptor.condicionIvaId },
    documentType: 11 as const,
    concept: 2 as const,
    pointOfSale: input.pointOfSale,
    issueDate: input.issueDate,
    servicePeriod: input.servicePeriod,
    total: input.total,
    description: input.description,
    ruleVersionIds: ['ar-rg-5616-condicion-iva-v1', 'arca-wsfev1-domestic-v1', 'ar-monotributo-factura-c-v1'],
  };
  const intentHash = hashCanonical(canonicalDocument);
  const payload: AuthorityPayload = authorityPayloadSchema.parse({
    version: 'wsfe-authority-payload-v1', canonicalDocument,
    issuerProfileRef: input.issuerProfileRef, subjectId: input.invoiceId, intentHash,
    requestId: signerRequestId, invoiceNumber: voucherNumber,
    documentType: 11, concept: 2, pointOfSale: input.pointOfSale,
    issueDate: input.issueDate, receptor: input.receptor,
    servicePeriod: input.servicePeriod, total: input.total, associatedDocument: null,
  });
  let payloadReference = attempt.payloadReference;
  if (payloadReference) {
    if (attempt.payloadHash !== hashCanonical(payload)) throw new Error('PERSONAL_WSFE_PAYLOAD_CONFLICT');
  } else {
    const receipt = await vault.store({
      workspaceId, payload, expiresAt: attempt.payloadExpiresAt, idempotencyKey: input.idempotencyKey,
    });
    attempts.attachPayload(input.invoiceId, receipt.reference, receipt.payloadHash);
    payloadReference = receipt.reference;
  }
  const signerRequest = signerRequestSchema.parse({
    version: 'motora-wsfe-boundary-v1', environment: 'homologation', workspaceId,
    runId: input.invoiceId, requestId: signerRequestId, subjectId: input.invoiceId,
    intentHash, authorityPayloadRef: payloadReference,
    expected: {
      documentType: 11, concept: 2, pointOfSale: input.pointOfSale,
      issueDate: input.issueDate, receptorDocType: input.receptor.docType,
      receptorCondicionIvaId: input.receptor.condicionIvaId,
      total: input.total, servicePeriod: input.servicePeriod,
    },
  });
  attempts.attachSignerRequest(input.invoiceId, signerRequest);
  return { data: { invoiceId: input.invoiceId, status: 'prepared' as const, voucherNumber }, signerRequest };
}

/** Never report a CAE to Desk until FECompConsultar confirms this frozen voucher. */
export async function issuePersonalWsfeAttempt(
  raw: unknown,
  workspaceId: string,
  projection: PersonalWsfeReadyProjection,
  attempts: PersonalWsfeAttemptStore,
  signer: Pick<HttpWsfePointOfSaleGateway, 'getNextVoucher' | 'issueInvoice'>,
  vault: Pick<HttpAuthorityPayloadWriter, 'store'>,
  now: Date = new Date(),
) {
  const prepared = await preparePersonalWsfeAttempt(raw, workspaceId, projection, attempts, signer, vault, now);
  const result = await signer.issueInvoice(prepared.signerRequest);
  const projected = projectSignerResult(prepared.data.invoiceId, prepared.data.voucherNumber, prepared.signerRequest, result, now);
  if (result.status === 'rejected') attempts.releaseRejectedVoucher(prepared.data.invoiceId);
  return projected;
}

/** Status-only recovery uses the frozen signer request; no receptor PII or live projection is needed. */
export async function recoverPersonalWsfeAttempt(
  invoiceId: string,
  workspaceId: string,
  attempts: PersonalWsfeAttemptStore,
  signer: Pick<HttpWsfePointOfSaleGateway, 'issueInvoice'>,
  now: Date = new Date(),
) {
  z.uuid().parse(invoiceId);
  if (!personalWorkspace.safeParse(workspaceId).success) throw new Error('PERSONAL_WSFE_SCOPE_UNAUTHORIZED');
  const attempt = attempts.get(invoiceId);
  if (!attempt || attempt.workspaceId !== workspaceId) throw new Error('PERSONAL_WSFE_ATTEMPT_NOT_FOUND');
  if (!attempt.signerRequest) throw new Error('PERSONAL_WSFE_ATTEMPT_NOT_PREPARED');
  const result = await signer.issueInvoice(attempt.signerRequest);
  const projected = projectSignerResult(invoiceId, attempt.voucherNumber, attempt.signerRequest, result, now);
  if (result.status === 'rejected') attempts.releaseRejectedVoucher(invoiceId);
  return projected;
}

function projectSignerResult(
  invoiceId: string,
  voucherNumber: string,
  signerRequest: ReturnType<typeof signerRequestSchema.parse>,
  result: Awaited<ReturnType<HttpWsfePointOfSaleGateway['issueInvoice']>>,
  now: Date,
) {
  if (result.requestId !== signerRequest.requestId) throw new Error('PERSONAL_WSFE_SIGNER_RESULT_MISMATCH');
  if (result.status === 'rejected') {
    if (result.resultado !== 'R' || result.cbteTipo !== signerRequest.expected.documentType
      || result.ptoVta !== signerRequest.expected.pointOfSale || result.cbteNro !== voucherNumber
      || result.cae !== null || result.feCompConsultarEcho !== null)
      throw new Error('PERSONAL_WSFE_REJECTION_MISMATCH');
    return { data: { invoiceId, status: 'rejected' as const,
      errorCodes: result.safeErrors.map(error => error.code),
      rejectionEvidenceSha256: hashCanonical(result) } };
  }
  if (result.status !== 'accepted' || !result.feCompConsultarEcho)
    return { data: { invoiceId, status: 'pending' as const } };
  const echo = result.feCompConsultarEcho;
  if (result.resultado !== 'A' || result.cbteNro !== voucherNumber
    || result.cbteTipo !== 11 || result.ptoVta !== signerRequest.expected.pointOfSale
    || !result.authorizedDocument
    || hashCanonical(result.authorizedDocument) !== hashCanonical({ intentHash: signerRequest.intentHash, ...signerRequest.expected })
    || echo.documentType !== 11 || echo.concept !== 2
    || echo.pointOfSale !== signerRequest.expected.pointOfSale
    || echo.receptorDocType !== signerRequest.expected.receptorDocType
    || hashCanonical(echo.total) !== hashCanonical(signerRequest.expected.total)
    || echo.invoiceNumber !== voucherNumber || echo.cae !== result.cae
    || echo.caeExpiry !== result.caeFchVto || echo.issueDate !== signerRequest.expected.issueDate)
    throw new Error('PERSONAL_WSFE_OFFICIAL_READBACK_MISMATCH');
  return { data: {
    invoiceId,
    status: 'authorized' as const,
    pointOfSale: echo.pointOfSale,
    voucherNumber: echo.invoiceNumber,
    cae: echo.cae,
    caeExpiresOn: echo.caeExpiry,
    fiscalIssuedOn: echo.issueDate,
    fiscalTotal: echo.total.decimal,
    fiscalCurrency: echo.total.currency,
    authorityVerifiedAt: now.toISOString(),
    authorityEvidenceSha256: hashCanonical(echo),
  } };
}
