import { z } from 'zod';

import { hashTaxEvidenceConsentScope, taxWorkspaceIdSchema } from './batch';
import type { TaxEvidenceConsentEventV1 } from './types';

const SHA256_RE = /^[a-f0-9]{64}$/;
const safeOpaqueIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/-]+$/);

const consentEventSchema = z.object({
  version: z.literal('tax-evidence-consent-event-v1'),
  eventId: z.uuid(),
  workspaceId: taxWorkspaceIdSchema,
  sequence: z.number().int().positive().safe(),
  action: z.enum(['grant', 'revoke']),
  authoritySource: z.literal('desk_subscription'),
  actorReferenceHash: z.string().regex(SHA256_RE),
  consent: z.object({
    purpose: z.literal('tax_workspace_processing'),
    version: safeOpaqueIdSchema,
    scopeHash: z.string().regex(SHA256_RE),
    sourceIds: z.array(safeOpaqueIdSchema).min(1).max(100),
  }).strict(),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict();

export function parseTaxEvidenceConsentEventV1(value: unknown): TaxEvidenceConsentEventV1 {
  const event = consentEventSchema.parse(value) as TaxEvidenceConsentEventV1;
  const canonicalSourceIds = [...new Set(event.consent.sourceIds)].sort();
  if (canonicalSourceIds.length !== event.consent.sourceIds.length
    || canonicalSourceIds.some((sourceId, index) => sourceId !== event.consent.sourceIds[index])) {
    throw new Error('EVIDENCE_CONSENT_SOURCE_IDS_NOT_CANONICAL');
  }
  if (event.consent.scopeHash !== hashTaxEvidenceConsentScope(event.consent.version, canonicalSourceIds)) {
    throw new Error('EVIDENCE_CONSENT_SCOPE_HASH_INVALID');
  }
  return event;
}
