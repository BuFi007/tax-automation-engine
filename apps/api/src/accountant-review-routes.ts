import {
  ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1,
  ACCOUNTANT_REVIEW_POLICY_VERSION_V1,
  ACCOUNTANT_REVIEW_REASON_CODES_V1,
  accountantReviewQueueEnvelopeV1Schema,
  type AccountantReviewQueueItemV1,
} from '@tax-engine/browser-contracts';
import {
  assertActiveAccountantMandate,
  type AccountantMandateScope,
  type AccountantMandateV1,
} from '@tax-engine/core';

import type { TaxProfileStore } from './store';
import type { TaxTenantPrincipalV2 } from './tenant-principal';

export async function handleAccountantReviewRoute(
  request: Request,
  url: URL,
  store: TaxProfileStore,
  principal: TaxTenantPrincipalV2 | null,
  now = new Date(),
): Promise<Response | null> {
  if (request.method !== 'GET' || url.pathname !== '/v1/accountant-review-queue') {
    return null;
  }
  if (!principal || principal.capability !== 'accountant:review-queue') {
    throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
  }

  const at = now.toISOString();
  const mandates = store.listAccountantMandatesForPortfolio(
    principal.actorId,
    principal.workspaceId,
  );
  const workspaceIds = [...new Set(mandates.map(mandate => mandate.workspaceId))].sort();
  const items: AccountantReviewQueueItemV1[] = [];
  const unavailableClients: Array<{
    workspaceId: string;
    code:
      | 'ACCOUNTANT_REVIEW_SNAPSHOT_MISSING'
      | 'ACCOUNTANT_REVIEW_SNAPSHOT_STALE'
      | 'ACCOUNTANT_REVIEW_SNAPSHOT_INVALID';
  }> = [];

  for (const workspaceId of workspaceIds) {
    const reviewMandate = selectActiveMandate(
      mandates,
      workspaceId,
      principal.actorId,
      'review_tax_obligation',
      at,
    );
    const packetMandate = selectActiveMandate(
      mandates,
      workspaceId,
      principal.actorId,
      'export_accountant_packet',
      at,
    );
    if (!reviewMandate && !packetMandate) continue;

    let source: ReturnType<TaxProfileStore['getCurrentAccountantReviewSnapshot']>;
    try {
      source = store.getCurrentAccountantReviewSnapshot(workspaceId, at);
    } catch (error) {
      unavailableClients.push({
        workspaceId,
        code:
          error instanceof Error && error.message === 'ACCOUNTANT_REVIEW_PROJECTION_STALE'
            ? 'ACCOUNTANT_REVIEW_SNAPSHOT_STALE'
            : 'ACCOUNTANT_REVIEW_SNAPSHOT_INVALID',
      });
      continue;
    }
    if (!source) {
      unavailableClients.push({
        workspaceId,
        code: 'ACCOUNTANT_REVIEW_SNAPSHOT_MISSING',
      });
      continue;
    }

    if (reviewMandate) {
      for (const obligation of source.snapshot.obligations) {
        if (obligation.preparationState !== 'under_accountant_review') continue;
        items.push({
          version: 'accountant-review-queue-item-v1',
          workspaceId,
          mandateId: reviewMandate.mandateId,
          caseRef: source.caseRef,
          subject: { kind: 'tax_obligation', ref: obligation.obligationRef },
          title: obligation.title,
          dueAt: obligation.dueAt,
          reviewState: 'ready_for_review',
          snapshotRevision: source.snapshot.cacheIdentity.snapshotRevision,
          caseRevision: source.caseRevision,
          evidenceHashes: [source.snapshotHash],
          ruleVersionIds: [...(obligation.ruleVersionRefs ?? [])],
          policyVersionIds: [ACCOUNTANT_REVIEW_POLICY_VERSION_V1],
          limitationCodes: [
            ...(source.snapshot.filingReadiness?.limitationCodes ?? []),
          ].slice(0, 32),
          allowedOutcomes: [...ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1],
          allowedReasonCodes: [...ACCOUNTANT_REVIEW_REASON_CODES_V1],
        });
      }
    }

    const packet = source.snapshot.accountantPacket;
    if (packetMandate && packet?.state === 'ready_for_review' && packet.packetRef) {
      items.push({
        version: 'accountant-review-queue-item-v1',
        workspaceId,
        mandateId: packetMandate.mandateId,
        caseRef: source.caseRef,
        subject: { kind: 'accountant_packet', ref: packet.packetRef },
        title: 'Accountant packet review',
        dueAt: null,
        reviewState: 'ready_for_review',
        snapshotRevision: source.snapshot.cacheIdentity.snapshotRevision,
        caseRevision: source.caseRevision,
        evidenceHashes: [source.snapshotHash],
        ruleVersionIds: [],
        policyVersionIds: [ACCOUNTANT_REVIEW_POLICY_VERSION_V1],
        limitationCodes: [...packet.limitationCodes].slice(0, 32),
        allowedOutcomes: [...ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1],
        allowedReasonCodes: [...ACCOUNTANT_REVIEW_REASON_CODES_V1],
      });
    }
  }

  items.sort((left, right) => (
    compareNullableInstants(left.dueAt, right.dueAt)
      || left.workspaceId.localeCompare(right.workspaceId)
      || left.subject.kind.localeCompare(right.subject.kind)
      || left.subject.ref.localeCompare(right.subject.ref)
  ));
  const body = accountantReviewQueueEnvelopeV1Schema.parse({
    data: {
      version: 'accountant-review-queue-v1',
      accountantActorId: principal.actorId,
      accountantOrganizationId: principal.workspaceId,
      asOf: at,
      items,
      unavailableClients,
    },
  });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
      vary: 'authorization, x-tax-tenant-principal, x-tax-tenant-signature',
    },
  });
}

function selectActiveMandate(
  mandates: readonly AccountantMandateV1[],
  workspaceId: string,
  actorId: string,
  scope: AccountantMandateScope,
  at: string,
): AccountantMandateV1 | null {
  const active = mandates.filter(mandate => {
    try {
      assertActiveAccountantMandate(mandate, {
        workspaceId,
        accountantActorId: actorId,
        scope,
        at,
      });
      return true;
    } catch {
      return false;
    }
  });
  return active.sort((left, right) => (
    right.expiresAt.localeCompare(left.expiresAt)
      || right.grantedAt.localeCompare(left.grantedAt)
      || left.mandateId.localeCompare(right.mandateId)
  ))[0] ?? null;
}

function compareNullableInstants(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}
