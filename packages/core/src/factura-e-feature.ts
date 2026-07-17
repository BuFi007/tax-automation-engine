import { createPublicKey, verify } from 'node:crypto';

import { z } from 'zod';

import { hashCanonical } from './factura-e-agent';

const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]{86}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:/-]{1,200}$/;
const MAX_FEATURE_VALIDITY_MS = 5 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 30_000;

export const FACTURA_E_FACTORING_CONSENT_PURPOSE = 'factura_e_factoring' as const;

export const FACTURA_E_FEATURE_WITHDRAWAL_REASONS = [
  'CONSENT_REVOKED',
  'CONSENT_EXPIRED',
  'SETTLEMENT_OBSERVED',
  'DISPUTED',
  'VOIDED_OR_ADJUSTED',
  'AUTHORITY_REVOKED',
  'FEATURE_EXPIRED',
] as const;

const unsignedFacturaEFeatureV1Schema = z.object({
  version: z.literal('factura-e-feature-v1'),
  eventId: z.uuid(),
  featureId: z.uuid(),
  purpose: z.literal(FACTURA_E_FACTORING_CONSENT_PURPOSE),
  workspaceCommitment: z.string().regex(SHA256),
  invoiceCommitment: z.string().regex(SHA256),
  lifecycle: z.enum(['active', 'withdrawn']),
  predicates: z.object({
    eligibleCurrentUnpaid: z.boolean(),
    officialIssuanceReconciled: z.boolean(),
    undisputed: z.boolean(),
  }).strict(),
  consent: z.object({
    purpose: z.literal(FACTURA_E_FACTORING_CONSENT_PURPOSE),
    version: z.string().regex(SAFE_REFERENCE),
    state: z.enum(['active', 'revoked', 'expired']),
  }).strict(),
  schemaVersion: z.literal('factura-e-feature-v1'),
  policyVersion: z.string().regex(SAFE_REFERENCE),
  keyVersion: z.string().regex(SAFE_REFERENCE),
  revision: z.number().int().positive().safe(),
  previousFeatureHash: z.string().regex(SHA256).nullable(),
  withdrawalReason: z.enum(FACTURA_E_FEATURE_WITHDRAWAL_REASONS).nullable(),
  producedAt: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }),
}).strict().superRefine((feature, context) => {
  if (Date.parse(feature.validUntil) <= Date.parse(feature.producedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'Feature validity must end after production',
    });
  }
  if ((feature.revision === 1) !== (feature.previousFeatureHash === null)) {
    context.addIssue({
      code: 'custom',
      path: ['previousFeatureHash'],
      message: 'Only the first feature revision may omit its predecessor',
    });
  }
  if (feature.lifecycle === 'active') {
    if (
      feature.consent.state !== 'active'
      || feature.withdrawalReason !== null
      || !feature.predicates.eligibleCurrentUnpaid
      || !feature.predicates.officialIssuanceReconciled
      || !feature.predicates.undisputed
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lifecycle'],
        message: 'Active feature requires active consent and every eligibility predicate',
      });
    }
  } else if (
    feature.withdrawalReason === null
    || feature.predicates.eligibleCurrentUnpaid
    || (feature.withdrawalReason === 'CONSENT_REVOKED' && feature.consent.state !== 'revoked')
    || (feature.withdrawalReason === 'CONSENT_EXPIRED' && feature.consent.state !== 'expired')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['lifecycle'],
      message: 'Withdrawn feature requires a reason and cannot remain eligible',
    });
  }
});

export const facturaEFeatureV1Schema = unsignedFacturaEFeatureV1Schema.and(z.object({
  featureHash: z.string().regex(SHA256),
  signature: z.object({
    algorithm: z.literal('Ed25519'),
    keyId: z.string().regex(SAFE_REFERENCE),
    value: z.string().regex(BASE64URL),
  }).strict(),
}).strict()).superRefine((feature, context) => {
  if (feature.signature.keyId !== feature.keyVersion) {
    context.addIssue({
      code: 'custom',
      path: ['signature', 'keyId'],
      message: 'Signature key must match the declared feature key version',
    });
  }
  if (feature.featureHash !== hashFacturaEFeatureV1(feature)) {
    context.addIssue({
      code: 'custom',
      path: ['featureHash'],
      message: 'Feature hash does not match its canonical unsigned payload',
    });
  }
});

export type UnsignedFacturaEFeatureV1 = z.infer<typeof unsignedFacturaEFeatureV1Schema>;
export type FacturaEFeatureV1 = z.infer<typeof facturaEFeatureV1Schema>;
export type FacturaEFeatureVerificationContext = Readonly<{
  workspaceCommitment: string;
  invoiceCommitment: string;
  keyVersion: string;
  minimumRevision?: number;
}>;

export type FacturaEFeatureSourceState = Readonly<{
  authorityState:
    | 'unverified'
    | 'ambiguous'
    | 'officially_reconciled'
    | 'revoked';
  consentState: 'missing' | 'active' | 'revoked' | 'expired';
  settlementState: 'unobserved' | 'observed' | 'final' | 'reversed' | 'disputed';
  invoiceState: 'current' | 'expired' | 'voided';
  hasAdjustment: boolean;
  hadActiveFeature: boolean;
}>;

export type FacturaEFeatureDecision = Readonly<{
  publication: 'active' | 'withdrawn' | 'none';
  predicates: Readonly<{
    eligibleCurrentUnpaid: boolean;
    officialIssuanceReconciled: boolean;
    undisputed: boolean;
  }>;
  withdrawalReason: (typeof FACTURA_E_FEATURE_WITHDRAWAL_REASONS)[number] | null;
}>;

/** Server-side KMS/HSM adapter. Private key material never enters this contract. */
export interface FacturaEFeatureSigningGateway {
  readonly keyVersion: string;
  signDigest(digestHex: string): Promise<string>;
}

export function parseUnsignedFacturaEFeatureV1(value: unknown): UnsignedFacturaEFeatureV1 {
  return unsignedFacturaEFeatureV1Schema.parse(value);
}

export function parseFacturaEFeatureV1(value: unknown): FacturaEFeatureV1 {
  return facturaEFeatureV1Schema.parse(value);
}

export function hashFacturaEFeatureV1(
  feature: UnsignedFacturaEFeatureV1 | FacturaEFeatureV1
): string {
  const { featureHash: _featureHash, signature: _signature, ...unsigned } = feature as
    FacturaEFeatureV1;
  return hashCanonical(unsigned);
}

export async function signFacturaEFeatureV1(
  value: unknown,
  signer: FacturaEFeatureSigningGateway
): Promise<FacturaEFeatureV1> {
  const unsigned = parseUnsignedFacturaEFeatureV1(value);
  if (unsigned.keyVersion !== signer.keyVersion) {
    throw new Error('FACTURA_E_FEATURE_SIGNING_KEY_VERSION_MISMATCH');
  }
  const featureHash = hashFacturaEFeatureV1(unsigned);
  const signature = await signer.signDigest(featureHash);
  return parseFacturaEFeatureV1({
    ...unsigned,
    featureHash,
    signature: {
      algorithm: 'Ed25519',
      keyId: signer.keyVersion,
      value: signature,
    },
  });
}

export function verifyFacturaEFeatureV1Signature(
  value: unknown,
  publicKeyPem: string,
  context: FacturaEFeatureVerificationContext,
  now = new Date()
): FacturaEFeatureV1 {
  const feature = parseFacturaEFeatureV1(value);
  if (!Number.isFinite(now.getTime())) {
    throw new Error('FACTURA_E_FEATURE_EVALUATION_TIME_INVALID');
  }
  if (
    feature.workspaceCommitment !== context.workspaceCommitment
    || feature.invoiceCommitment !== context.invoiceCommitment
    || feature.keyVersion !== context.keyVersion
  ) {
    throw new Error('FACTURA_E_FEATURE_CONTEXT_MISMATCH');
  }
  if (
    context.minimumRevision !== undefined
    && feature.revision < context.minimumRevision
  ) {
    throw new Error('FACTURA_E_FEATURE_REVISION_STALE');
  }
  const producedAt = Date.parse(feature.producedAt);
  const validUntil = Date.parse(feature.validUntil);
  if (
    producedAt > now.getTime() + MAX_FUTURE_CLOCK_SKEW_MS
    || validUntil <= now.getTime()
    || validUntil > producedAt + MAX_FEATURE_VALIDITY_MS
  ) {
    throw new Error('FACTURA_E_FEATURE_EXPIRED');
  }
  const valid = verify(
    null,
    Buffer.from(feature.featureHash, 'hex'),
    createPublicKey(publicKeyPem),
    Buffer.from(feature.signature.value, 'base64url')
  );
  if (!valid) throw new Error('FACTURA_E_FEATURE_SIGNATURE_INVALID');
  return feature;
}

export function assertFacturaEFeatureV1LockEligible(
  feature: FacturaEFeatureV1
): FacturaEFeatureV1 {
  if (
    feature.lifecycle !== 'active'
    || feature.consent.state !== 'active'
    || !feature.predicates.eligibleCurrentUnpaid
    || !feature.predicates.officialIssuanceReconciled
    || !feature.predicates.undisputed
  ) {
    throw new Error('FACTURA_E_FEATURE_NOT_LOCK_ELIGIBLE');
  }
  return feature;
}

/**
 * Factoring eligibility is deliberately independent from the historical
 * `financeEligibility` Tax conclusion. A current receivable is eligible only
 * before any settlement observation and after a separate official authority
 * read. Unknown or ambiguous state never publishes an active feature.
 */
export function deriveFacturaEFeatureDecision(
  source: FacturaEFeatureSourceState
): FacturaEFeatureDecision {
  const officialIssuanceReconciled = source.authorityState === 'officially_reconciled';
  const undisputed = source.settlementState !== 'disputed' && !source.hasAdjustment;
  const eligibleCurrentUnpaid =
    officialIssuanceReconciled
    && source.consentState === 'active'
    && source.settlementState === 'unobserved'
    && source.invoiceState === 'current'
    && undisputed;
  if (eligibleCurrentUnpaid) {
    return {
      publication: 'active',
      predicates: { eligibleCurrentUnpaid, officialIssuanceReconciled, undisputed },
      withdrawalReason: null,
    };
  }
  const predicates = { eligibleCurrentUnpaid, officialIssuanceReconciled, undisputed };
  if (!source.hadActiveFeature) {
    return { publication: 'none', predicates, withdrawalReason: null };
  }
  if (source.consentState === 'revoked') {
    return { publication: 'withdrawn', predicates, withdrawalReason: 'CONSENT_REVOKED' };
  }
  if (source.consentState === 'expired') {
    return { publication: 'withdrawn', predicates, withdrawalReason: 'CONSENT_EXPIRED' };
  }
  if (source.settlementState !== 'unobserved') {
    return {
      publication: 'withdrawn',
      predicates,
      withdrawalReason:
        source.settlementState === 'disputed' ? 'DISPUTED' : 'SETTLEMENT_OBSERVED',
    };
  }
  if (source.hasAdjustment || source.invoiceState === 'voided') {
    return { publication: 'withdrawn', predicates, withdrawalReason: 'VOIDED_OR_ADJUSTED' };
  }
  if (source.invoiceState === 'expired') {
    return { publication: 'withdrawn', predicates, withdrawalReason: 'FEATURE_EXPIRED' };
  }
  return { publication: 'withdrawn', predicates, withdrawalReason: 'AUTHORITY_REVOKED' };
}
