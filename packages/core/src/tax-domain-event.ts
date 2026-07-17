import { createHash } from 'node:crypto';

import { z } from 'zod';

/**
 * The only event shape an agentic consumer may receive from the Tax Engine.
 *
 * It deliberately contains state, opaque references, version IDs, and hashes
 * only. Tax identifiers, money, authority payloads, credentials, and raw
 * evidence remain in their owning authoritative stores.
 */
export const TAX_DOMAIN_EVENT_VERSION_V1 = 'tax-domain-event-v1' as const;

export const TAX_DOMAIN_EVENT_KINDS_V1 = [
  'arca.api_verification_completed',
  'reclaim.proof_verified',
  'factura_e.authority_verified',
  'invoice.settlement_finalized',
  'evidence.gap_changed',
  'obligation.due',
  'consent.revoked',
  'accountant.decision_recorded',
  'factura_e_feature_published',
] as const;

const opaqueRefSchema = z.string().min(1).max(200).regex(/^[A-Za-z][A-Za-z0-9:_-]*$/)
  .refine(value => !/^\d{9,}$/.test(value), 'Opaque references cannot be raw identifiers');
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

const eventSourceSchema = z.object({
  system: z.enum(['arca', 'reclaim', 'invoice_ledger', 'tax_engine', 'evidence_graph', 'accountant_workspace', 'factoring']),
  sourceEventHash: hashSchema,
  verifiedAt: isoDateTimeSchema,
}).strict();

const authenticationSchema = z.object({
  method: z.enum(['provider_webhook', 'authority_receipt', 'm2m_signed_grant', 'internal_outbox']),
  principalRef: opaqueRefSchema,
  credentialVersion: z.string().min(1).max(120),
  signatureHash: hashSchema,
}).strict();

const consentSchema = z.object({
  purpose: z.enum(['tax_workspace_processing', 'provider_submission', 'factura_e_factoring']),
  version: z.string().min(1).max(120),
  scopeHash: hashSchema,
  state: z.enum(['active', 'revoked']),
}).strict();

export const taxDomainEventV1Schema = z.object({
  version: z.literal(TAX_DOMAIN_EVENT_VERSION_V1),
  eventId: z.uuid(),
  workspaceId: opaqueRefSchema,
  caseRef: opaqueRefSchema.nullable(),
  kind: z.enum(TAX_DOMAIN_EVENT_KINDS_V1),
  state: z.enum(['pending', 'ready', 'verified', 'recorded', 'blocked', 'ambiguous', 'rejected', 'revoked', 'stale']),
  occurredAt: isoDateTimeSchema,
  idempotencyKey: opaqueRefSchema,
  correlationRef: opaqueRefSchema,
  source: eventSourceSchema,
  authentication: authenticationSchema,
  consent: consentSchema,
  evidenceHashes: z.array(hashSchema).max(16),
  ruleVersionIds: z.array(opaqueRefSchema).max(16),
  policyVersionIds: z.array(opaqueRefSchema).max(16),
  actionRefs: z.array(opaqueRefSchema).max(16),
}).strict();

export type TaxDomainEventV1 = z.infer<typeof taxDomainEventV1Schema>;

/** A durable delivery envelope. The target persists this before it wakes an agent workflow. */
export const taxDomainEventDeliveryV1Schema = z.object({
  version: z.literal('tax-domain-event-delivery-v1'),
  deliveryId: z.uuid(),
  event: taxDomainEventV1Schema,
  payloadHash: hashSchema,
  deliveredAt: isoDateTimeSchema,
}).strict().superRefine((value, context) => {
  if (value.payloadHash !== hashTaxDomainEventV1(value.event)) {
    context.addIssue({ code: 'custom', message: 'TAX_DOMAIN_EVENT_PAYLOAD_HASH_INVALID', path: ['payloadHash'] });
  }
});

export type TaxDomainEventDeliveryV1 = z.infer<typeof taxDomainEventDeliveryV1Schema>;

export function assertTaxDomainEventV1(value: unknown): TaxDomainEventV1 {
  return taxDomainEventV1Schema.parse(value);
}

export function assertTaxDomainEventDeliveryV1(value: unknown): TaxDomainEventDeliveryV1 {
  return taxDomainEventDeliveryV1Schema.parse(value);
}

export function hashTaxDomainEventV1(event: TaxDomainEventV1): string {
  return createHash('sha256').update(stableJson(event)).digest('hex');
}

export function createTaxDomainEventDeliveryV1(input: Omit<TaxDomainEventDeliveryV1, 'version' | 'payloadHash'>): TaxDomainEventDeliveryV1 {
  const event = assertTaxDomainEventV1(input.event);
  return assertTaxDomainEventDeliveryV1({
    version: 'tax-domain-event-delivery-v1',
    deliveryId: input.deliveryId,
    event,
    payloadHash: hashTaxDomainEventV1(event),
    deliveredAt: input.deliveredAt,
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
