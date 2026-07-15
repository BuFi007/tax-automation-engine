import { createPublicKey, verify } from 'node:crypto';

import { z } from 'zod';

import { hashCanonical } from './factura-e-agent';
import type { FacturaEFeatureSigningGateway } from './factura-e-feature';

const SHA256 = /^[a-f0-9]{64}$/;
const PURPOSE_REF = /^hmac-sha256:v1:[a-f0-9]{64}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:/-]{1,200}$/;
const BASE64URL = /^[A-Za-z0-9_-]{86}$/;

const unsignedTaxFacturaEFeatureHeadV1Schema = z.object({
  version: z.literal('factura-e-feature-head-v1'),
  schemaVersion: z.literal('factura-e-feature-head-v1'),
  featureId: z.uuid(),
  featureHash: z.string().regex(SHA256),
  workspaceCommitment: z.string().regex(SHA256),
  invoiceCommitment: z.string().regex(SHA256),
  featureLifecycle: z.literal('active'),
  eligibleCurrentUnpaid: z.literal(true),
  officialIssuanceReconciled: z.literal(true),
  undisputed: z.literal(true),
  consentVersion: z.string().regex(SAFE_REFERENCE),
  consentState: z.literal('active'),
  featureRevision: z.number().int().positive().safe(),
  previousFeatureHash: z.string().regex(SHA256).nullable(),
  featureValidUntil: z.iso.datetime({ offset: true }),
  settlementObservationState: z.literal('unobserved'),
  evidenceHeadRef: z.string().regex(PURPOSE_REF),
  headRevision: z.number().int().positive().safe(),
  observedAt: z.iso.datetime({ offset: true }),
  keyVersion: z.string().regex(SAFE_REFERENCE),
  restrictedAuthority: z.object({
    scheme: z.literal('BUFI_ARCA_FACTURA_E_AUTHORITY_INVOICE_ID_V1'),
    authorityId: z.string().regex(SHA256),
    evidenceCommitment: z.string().regex(SHA256),
  }).strict(),
}).strict().superRefine((head, context) => {
  if (Date.parse(head.featureValidUntil) <= Date.parse(head.observedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['featureValidUntil'],
      message: 'Restricted head must be observed before feature expiry',
    });
  }
  if ((head.featureRevision === 1) !== (head.previousFeatureHash === null)) {
    context.addIssue({
      code: 'custom',
      path: ['previousFeatureHash'],
      message: 'Restricted head predecessor must match feature revision',
    });
  }
});

export const taxFacturaEFeatureHeadV1Schema = unsignedTaxFacturaEFeatureHeadV1Schema.and(
  z.object({
    headHash: z.string().regex(SHA256),
    signature: z.object({
      algorithm: z.literal('Ed25519'),
      keyId: z.string().regex(SAFE_REFERENCE),
      value: z.string().regex(BASE64URL),
    }).strict(),
  }).strict()
).superRefine((head, context) => {
  if (head.signature.keyId !== head.keyVersion) {
    context.addIssue({
      code: 'custom',
      path: ['signature', 'keyId'],
      message: 'Restricted head signature key must match keyVersion',
    });
  }
  if (head.headHash !== hashTaxFacturaEFeatureHeadV1(head)) {
    context.addIssue({
      code: 'custom',
      path: ['headHash'],
      message: 'Restricted head hash does not match canonical payload',
    });
  }
});

export type UnsignedTaxFacturaEFeatureHeadV1 = z.infer<
  typeof unsignedTaxFacturaEFeatureHeadV1Schema
>;
export type TaxFacturaEFeatureHeadV1 = z.infer<typeof taxFacturaEFeatureHeadV1Schema>;

export function parseUnsignedTaxFacturaEFeatureHeadV1(
  value: unknown
): UnsignedTaxFacturaEFeatureHeadV1 {
  return unsignedTaxFacturaEFeatureHeadV1Schema.parse(value);
}

export function parseTaxFacturaEFeatureHeadV1(value: unknown): TaxFacturaEFeatureHeadV1 {
  return taxFacturaEFeatureHeadV1Schema.parse(value);
}

export function hashTaxFacturaEFeatureHeadV1(
  value: UnsignedTaxFacturaEFeatureHeadV1 | TaxFacturaEFeatureHeadV1
): string {
  const { headHash: _headHash, signature: _signature, ...unsigned } = value as
    TaxFacturaEFeatureHeadV1;
  return hashCanonical(unsigned);
}

export async function signTaxFacturaEFeatureHeadV1(
  value: unknown,
  signer: FacturaEFeatureSigningGateway
): Promise<TaxFacturaEFeatureHeadV1> {
  const unsigned = parseUnsignedTaxFacturaEFeatureHeadV1(value);
  if (unsigned.keyVersion !== signer.keyVersion) {
    throw new Error('FACTURA_E_FEATURE_HEAD_SIGNING_KEY_VERSION_MISMATCH');
  }
  const headHash = hashTaxFacturaEFeatureHeadV1(unsigned);
  const signature = await signer.signDigest(headHash);
  return parseTaxFacturaEFeatureHeadV1({
    ...unsigned,
    headHash,
    signature: {
      algorithm: 'Ed25519',
      keyId: signer.keyVersion,
      value: signature,
    },
  });
}

export function verifyTaxFacturaEFeatureHeadV1Signature(
  value: unknown,
  publicKeyPem: string,
  now = new Date()
): TaxFacturaEFeatureHeadV1 {
  const head = parseTaxFacturaEFeatureHeadV1(value);
  const observedAt = Date.parse(head.observedAt);
  if (
    observedAt > now.getTime() + 30_000
    || now.getTime() - observedAt > 60_000
    || Date.parse(head.featureValidUntil) <= now.getTime()
  ) throw new Error('FACTURA_E_FEATURE_HEAD_STALE');
  const valid = verify(
    null,
    Buffer.from(head.headHash, 'hex'),
    createPublicKey(publicKeyPem),
    Buffer.from(head.signature.value, 'base64url')
  );
  if (!valid) throw new Error('FACTURA_E_FEATURE_HEAD_SIGNATURE_INVALID');
  return head;
}
