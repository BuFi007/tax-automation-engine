import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from 'node:crypto';

import { z } from 'zod';

const SHA256 = /^[a-f0-9]{64}$/;
const HEX32 = /^0x(?!0{64}$)[a-f0-9]{64}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:/-]{1,200}$/;
const PURPOSE_REFERENCE = /^hmac-sha256:v1:(?!0{64}$)[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,200}$/;
const MAX_FUTURE_SKEW_MS = 30_000;

const canonicalTimestamp = z.string().refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, 'must be a canonical UTC timestamp');

const effectPayloadSchema = z.object({
  action: z.literal('submitted'),
  handoffRef: z.string().regex(PURPOSE_REFERENCE),
  handoffIdempotencyKey: z.string().regex(HEX32),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY),
  reservationId: z.uuid(),
  operationId: z.string().regex(HEX32),
  headHash: z.string().regex(SHA256),
  featureId: z.uuid(),
  featureHash: z.string().regex(SHA256),
  featureRevision: z.number().int().positive().safe(),
  reportTxHash: z.string().regex(HEX32),
  recordedAt: canonicalTimestamp,
  effectReceiptCommitment: z.string().regex(HEX32),
}).strict();

const recoveryPayloadSchema = z.object({
  action: z.literal('confirmed_not_submitted'),
  reservationId: z.uuid(),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY),
  operationId: z.string().regex(HEX32),
  headHash: z.string().regex(SHA256),
  featureId: z.uuid(),
  featureHash: z.string().regex(SHA256),
  featureRevision: z.number().int().positive().safe(),
  recoveryEvidenceRef: z.string().regex(PURPOSE_REFERENCE),
  recordedAt: canonicalTimestamp,
  noEffectReceiptCommitment: z.string().regex(HEX32),
}).strict();

const signatureSchema = z.string().regex(/^ed25519:v1:[a-f0-9]{128}$/);

const effectEnvelopeSchema = z.object({
  version: z.literal('bufi.desk-tax-effect-receipt.v1'),
  keyId: z.string().regex(SAFE_REFERENCE),
  payload: effectPayloadSchema,
  signature: signatureSchema,
}).strict();

const recoveryEnvelopeSchema = z.object({
  version: z.literal('bufi.desk-tax-no-effect-recovery.v1'),
  keyId: z.string().regex(SAFE_REFERENCE),
  payload: recoveryPayloadSchema,
  signature: signatureSchema,
}).strict();

export type DeskTaxEffectReceiptEnvelopeV1 = z.infer<typeof effectEnvelopeSchema>;
export type DeskTaxNoEffectRecoveryEnvelopeV1 = z.infer<typeof recoveryEnvelopeSchema>;

export type FacturaETerminalReceiptVerifier = Readonly<{
  enabled: boolean;
  keyId: string | null;
  publicKey: string | null;
  transportSecret?: string | null;
}>;

export type FacturaETerminalReceiptVerifiers = Readonly<{
  deskEffect: FacturaETerminalReceiptVerifier;
  noEffectRecovery: FacturaETerminalReceiptVerifier;
}>;

export function verifyDeskTaxEffectReceipt(input: Readonly<{
  value: unknown;
  verifier: FacturaETerminalReceiptVerifier;
  now?: Date;
}>): DeskTaxEffectReceiptEnvelopeV1 {
  const envelope = effectEnvelopeSchema.parse(input.value);
  const key = requiredVerifier(input.verifier, envelope.keyId);
  verifyRecordedAt(envelope.payload.recordedAt, input.now ?? new Date());
  if (
    envelope.payload.effectReceiptCommitment
      !== computeDeskTaxEffectReceiptCommitment(envelope.payload)
  ) throw new Error('FACTURA_E_FEATURE_TERMINAL_EFFECT_COMMITMENT_INVALID');
  verifyEnvelopeSignature(
    key,
    canonicalDeskTaxEffectReceipt(envelope),
    envelope.signature,
    'FACTURA_E_FEATURE_TERMINAL_EFFECT_RECEIPT_UNAUTHORIZED'
  );
  return envelope;
}

export function verifyDeskTaxNoEffectRecoveryReceipt(input: Readonly<{
  value: unknown;
  verifier: FacturaETerminalReceiptVerifier;
  now?: Date;
}>): DeskTaxNoEffectRecoveryEnvelopeV1 {
  const envelope = recoveryEnvelopeSchema.parse(input.value);
  const key = requiredVerifier(input.verifier, envelope.keyId);
  verifyRecordedAt(envelope.payload.recordedAt, input.now ?? new Date());
  if (
    envelope.payload.noEffectReceiptCommitment
      !== computeDeskTaxNoEffectReceiptCommitment(envelope.payload)
  ) throw new Error('FACTURA_E_FEATURE_RECOVERY_NO_EFFECT_COMMITMENT_INVALID');
  verifyEnvelopeSignature(
    key,
    canonicalDeskTaxNoEffectRecoveryReceipt(envelope),
    envelope.signature,
    'FACTURA_E_FEATURE_RECOVERY_RECEIPT_UNAUTHORIZED'
  );
  return envelope;
}

export function canonicalDeskTaxEffectReceipt(
  envelope: Omit<DeskTaxEffectReceiptEnvelopeV1, 'signature'>
): string {
  const { payload } = envelope;
  return [
    envelope.version,
    envelope.keyId,
    payload.action,
    payload.handoffRef,
    payload.handoffIdempotencyKey,
    payload.idempotencyKey,
    payload.reservationId,
    payload.operationId,
    payload.headHash,
    payload.featureId,
    payload.featureHash,
    String(payload.featureRevision),
    payload.reportTxHash,
    payload.recordedAt,
    payload.effectReceiptCommitment,
  ].join('\n');
}

export function canonicalDeskTaxNoEffectRecoveryReceipt(
  envelope: Omit<DeskTaxNoEffectRecoveryEnvelopeV1, 'signature'>
): string {
  const { payload } = envelope;
  return [
    envelope.version,
    envelope.keyId,
    payload.action,
    payload.reservationId,
    payload.idempotencyKey,
    payload.operationId,
    payload.headHash,
    payload.featureId,
    payload.featureHash,
    String(payload.featureRevision),
    payload.recoveryEvidenceRef,
    payload.recordedAt,
    payload.noEffectReceiptCommitment,
  ].join('\n');
}

export function computeDeskTaxEffectReceiptCommitment(
  payload: Omit<z.infer<typeof effectPayloadSchema>, 'effectReceiptCommitment'>
): `0x${string}` {
  return commitment('BUFI_DESK_TAX_EFFECT_RECEIPT_V1', [
    payload.handoffRef,
    payload.handoffIdempotencyKey,
    payload.idempotencyKey,
    payload.reservationId,
    payload.operationId,
    payload.headHash,
    payload.featureId,
    payload.featureHash,
    String(payload.featureRevision),
    payload.reportTxHash,
    payload.recordedAt,
  ]);
}

export function computeDeskTaxNoEffectReceiptCommitment(
  payload: Omit<z.infer<typeof recoveryPayloadSchema>, 'noEffectReceiptCommitment'>
): `0x${string}` {
  return commitment('BUFI_DESK_TAX_NO_EFFECT_RECOVERY_V1', [
    payload.reservationId,
    payload.idempotencyKey,
    payload.operationId,
    payload.headHash,
    payload.featureId,
    payload.featureHash,
    String(payload.featureRevision),
    payload.recoveryEvidenceRef,
    payload.recordedAt,
  ]);
}

export function hashDeskTaxEffectReceiptEnvelope(
  envelope: DeskTaxEffectReceiptEnvelopeV1
): string {
  return createHash('sha256')
    .update(`${canonicalDeskTaxEffectReceipt(envelope)}\n${envelope.signature}`, 'utf8')
    .digest('hex');
}

export function hashDeskTaxNoEffectRecoveryEnvelope(
  envelope: DeskTaxNoEffectRecoveryEnvelopeV1
): string {
  return createHash('sha256')
    .update(`${canonicalDeskTaxNoEffectRecoveryReceipt(envelope)}\n${envelope.signature}`, 'utf8')
    .digest('hex');
}

export function assertFacturaETerminalReceiptVerifiers(
  verifiers: FacturaETerminalReceiptVerifiers,
  otherSecrets: readonly (string | null)[] = []
): void {
  const enabled = [verifiers.deskEffect, verifiers.noEffectRecovery]
    .filter(candidate => candidate.enabled);
  for (const verifier of enabled) {
    if (!verifier.keyId || !SAFE_REFERENCE.test(verifier.keyId) || !verifier.publicKey) {
      throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_CONFIGURATION_REQUIRED');
    }
    parseEd25519PublicKey(verifier.publicKey);
  }
  if (enabled.some(verifier => (
    !verifier.transportSecret
    || Buffer.byteLength(verifier.transportSecret) < 32
  ))) throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_CONFIGURATION_REQUIRED');
  const configured = [
    ...enabled.map(candidate => candidate.publicKey),
    ...enabled.map(candidate => candidate.transportSecret ?? null),
    ...otherSecrets,
  ].filter((value): value is string => Boolean(value));
  if (new Set(configured).size !== configured.length) {
    throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_KEYS_MUST_BE_DISTINCT');
  }
  if (
    verifiers.deskEffect.enabled
    && verifiers.noEffectRecovery.enabled
    && verifiers.deskEffect.keyId === verifiers.noEffectRecovery.keyId
  ) throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_KEYS_MUST_BE_DISTINCT');
}

function requiredVerifier(
  verifier: FacturaETerminalReceiptVerifier,
  actualKeyId: string
): KeyObject {
  if (!verifier.enabled || !verifier.keyId || !verifier.publicKey) {
    throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_CONFIGURATION_REQUIRED');
  }
  if (actualKeyId !== verifier.keyId) {
    throw new Error('FACTURA_E_FEATURE_TERMINAL_RECEIPT_KEY_UNAUTHORIZED');
  }
  return parseEd25519PublicKey(verifier.publicKey);
}

function parseEd25519PublicKey(value: string): KeyObject {
  if (Buffer.byteLength(value) < 32) {
    throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_CONFIGURATION_REQUIRED');
  }
  let key: KeyObject;
  try {
    key = createPublicKey(value.replaceAll('\\n', '\n'));
  } catch {
    throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_CONFIGURATION_REQUIRED');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_CONFIGURATION_REQUIRED');
  }
  return key;
}

function verifyRecordedAt(recordedAtValue: string, now: Date): void {
  const nowMs = now.getTime();
  const recordedAt = Date.parse(recordedAtValue);
  if (!Number.isFinite(nowMs)) {
    throw new Error('FACTURA_E_FEATURE_TERMINAL_RECEIPT_TIMESTAMP_INVALID');
  }
  // Submission/recovery outcomes are immutable and may need reconciliation
  // after a long outage. Their durable DB time is signed and must never be in
  // the future, but the receipt intentionally has no liveness-killing expiry.
  if (recordedAt > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new Error('FACTURA_E_FEATURE_TERMINAL_RECEIPT_TIMESTAMP_INVALID');
  }
}

function verifyEnvelopeSignature(
  key: KeyObject,
  preimage: string,
  encodedSignature: string,
  errorCode: string
): void {
  const signature = Buffer.from(encodedSignature.slice('ed25519:v1:'.length), 'hex');
  // Preserve a constant-length reject path before handing bytes to OpenSSL.
  if (signature.length !== 64) {
    throw new Error(errorCode);
  }
  if (!verify(null, Buffer.from(preimage, 'utf8'), key, signature)) {
    throw new Error(errorCode);
  }
}

function commitment(domain: string, fields: readonly string[]): `0x${string}` {
  return `0x${createHash('sha256').update([domain, ...fields].join('\n'), 'utf8').digest('hex')}`;
}
