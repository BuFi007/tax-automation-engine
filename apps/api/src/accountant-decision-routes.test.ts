import { describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  hashTaxEvidenceConsentScope,
  type ExternalAccountantDecisionV1,
} from '@tax-engine/core';

import { handleExternalAccountantDecisionRoute } from './accountant-decision-routes';
import { TaxProfileStore } from './store';
import {
  verifyBoundTaxTenantPrincipalForRawBody,
  type TaxTenantCapability,
} from './tenant-principal';

const SECRET = 'external-accountant-principal-secret-v1';
const NOW = new Date('2026-07-17T12:01:00.000Z');
const HASH = 'a'.repeat(64);

function decision(
  overrides: Partial<ExternalAccountantDecisionV1> = {},
): ExternalAccountantDecisionV1 {
  return {
    version: 'external-accountant-decision-v1',
    decisionId: '81000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace:1',
    accountantActorId: 'accountant:1',
    mandateId: 'mandate:review:1',
    caseRef: 'taxcase:1',
    subject: { kind: 'tax_obligation', ref: 'obligation:us:1' },
    outcome: 'approved',
    reasonCodes: [],
    evidenceHashes: [HASH],
    ruleVersionIds: ['rule:us:entity:1'],
    policyVersionIds: ['external-accountant-decision-policy-v1'],
    occurredAt: '2026-07-17T12:00:00.000Z',
    idempotencyKey: 'accountant-decision:1',
    ...overrides,
  };
}

describe('external accountant decision ingress', () => {
  test('commits the outside decision and minimized event atomically, then converges replay', async () => {
    const store = readyStore();
    const first = await call(store, decision());
    expect(first.status).toBe(201);
    const firstReceipt = (await first.json() as any).data;
    expect(firstReceipt).toMatchObject({
      version: 'external-accountant-decision-receipt-v1',
      decisionId: decision().decisionId,
      workspaceId: 'workspace:1',
      outcome: 'approved',
      replayed: false,
    });
    expect(store.listPendingTaxDomainEvents()).toEqual([
      expect.objectContaining({
        eventId: firstReceipt.eventId,
        workspaceId: 'workspace:1',
        caseRef: 'taxcase:1',
        kind: 'accountant.decision_recorded',
        state: 'recorded',
        source: expect.objectContaining({ system: 'accountant_workspace' }),
        authentication: expect.objectContaining({
          method: 'm2m_signed_grant',
          principalRef: 'external_accountant_decision_ingress',
        }),
      }),
    ]);
    expect(JSON.stringify(store.listPendingTaxDomainEvents()))
      .not.toContain('mandate:review:1');
    expect(JSON.stringify(store.listPendingTaxDomainEvents()))
      .not.toContain(HASH);

    const replay = await call(store, decision());
    expect(replay.status).toBe(200);
    expect((await replay.json() as any).data).toEqual({
      ...firstReceipt,
      replayed: true,
    });
    expect(store.listPendingTaxDomainEvents()).toHaveLength(1);
    store.close();
  });

  test('preserves rejected and needs-information decisions as non-approval states', async () => {
    const rejectedStore = readyStore();
    await call(rejectedStore, decision({
      outcome: 'rejected',
      reasonCodes: ['EVIDENCE_CONTRADICTORY'],
    }));
    expect(rejectedStore.listPendingTaxDomainEvents()[0]?.state).toBe('rejected');
    rejectedStore.close();

    const blockedStore = readyStore();
    await call(blockedStore, decision({
      outcome: 'needs_information',
      reasonCodes: ['EVIDENCE_INCOMPLETE'],
    }));
    expect(blockedStore.listPendingTaxDomainEvents()[0]?.state).toBe('blocked');
    blockedStore.close();
  });

  test('rejects conflicting and stale delivery without appending another event', async () => {
    const store = readyStore();
    await call(store, decision());
    await expect(call(store, decision({ outcome: 'rejected', reasonCodes: ['EVIDENCE_INCOMPLETE'] })))
      .rejects.toThrow('ACCOUNTANT_DECISION_IDEMPOTENCY_CONFLICT');
    await expect(call(store, decision({
      decisionId: '81000000-0000-4000-8000-000000000002',
      idempotencyKey: 'accountant-decision:2',
      occurredAt: '2026-07-17T11:59:00.000Z',
    }))).rejects.toThrow('ACCOUNTANT_DECISION_STALE');
    expect(store.listPendingTaxDomainEvents()).toHaveLength(1);
    store.close();
  });

  test('fails closed for wrong actor/workspace, mandate, consent, or request binding', async () => {
    const wrongActor = readyStore();
    await expect(call(wrongActor, decision(), { actorId: 'accountant:other' }))
      .rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    expect(wrongActor.listPendingTaxDomainEvents()).toHaveLength(0);
    expect(wrongActor.getExternalAccountantDecision(decision().decisionId)).toBeNull();
    wrongActor.close();

    const wrongWorkspace = readyStore();
    await expect(call(wrongWorkspace, decision(), { workspaceId: 'workspace:other' }))
      .rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    expect(wrongWorkspace.getExternalAccountantDecision(decision().decisionId)).toBeNull();
    wrongWorkspace.close();

    const noConsent = readyStore({ consent: false });
    await expect(call(noConsent, decision())).rejects.toThrow('ACCOUNTANT_DECISION_CONSENT_REQUIRED');
    expect(noConsent.listPendingTaxDomainEvents()).toHaveLength(0);
    expect(noConsent.getExternalAccountantDecision(decision().decisionId)).toBeNull();
    noConsent.close();

    const expiredMandate = readyStore({ expiresAt: '2026-07-17T11:00:00.000Z' });
    await expect(call(expiredMandate, decision())).rejects.toThrow('ACCOUNTANT_MANDATE_EXPIRED');
    expect(expiredMandate.listPendingTaxDomainEvents()).toHaveLength(0);
    expect(expiredMandate.getExternalAccountantDecision(decision().decisionId)).toBeNull();
    expiredMandate.close();

    const store = readyStore();
    const raw = JSON.stringify(decision());
    const request = signedRequest(raw, { bodyHash: createHash('sha256').update('tampered').digest('hex') });
    expect(() => verifyBoundTaxTenantPrincipalForRawBody(
      request,
      raw,
      SECRET,
      'accountant:decision',
      NOW,
    )).toThrow('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    expect(store.listPendingTaxDomainEvents()).toHaveLength(0);
    store.close();
  });

  test('requires the exact packet scope and a live principal', async () => {
    const wrongScope = readyStore();
    const packet = decision({
      subject: { kind: 'accountant_packet', ref: 'packet:1' },
    });
    await expect(call(wrongScope, packet)).rejects.toThrow('ACCOUNTANT_MANDATE_SCOPE_UNAUTHORIZED');
    expect(wrongScope.getExternalAccountantDecision(packet.decisionId)).toBeNull();
    wrongScope.close();

    const packetStore = readyStore({ scopes: ['export_accountant_packet'] });
    const acceptedPacket = await call(packetStore, packet);
    expect(acceptedPacket.status).toBe(201);
    expect(packetStore.listPendingTaxDomainEvents()[0]).toMatchObject({
      kind: 'accountant.decision_recorded',
      state: 'recorded',
    });
    packetStore.close();

    const raw = JSON.stringify(decision());
    const expired = signedRequest(raw, { expiresAt: '2026-07-17T12:00:00.000Z' });
    expect(() => verifyBoundTaxTenantPrincipalForRawBody(
      expired,
      raw,
      SECRET,
      'accountant:decision',
      NOW,
    )).toThrow('TAX_TENANT_PRINCIPAL_EXPIRED');
  });

  test('survives restart with one canonical decision and one pending event', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tax-accountant-decision-'));
    const path = join(directory, 'tax.sqlite');
    try {
      const firstStore = readyStore({ path });
      const first = await call(firstStore, decision());
      const firstReceipt = (await first.json() as any).data;
      firstStore.close();

      const reopened = new TaxProfileStore(path, 'test-tax-domain-event-commitment-secret-v1');
      const replay = await call(reopened, decision());
      expect((await replay.json() as any).data).toEqual({ ...firstReceipt, replayed: true });
      expect(reopened.getExternalAccountantDecision(decision().decisionId)).toEqual(decision());
      expect(reopened.listPendingTaxDomainEvents()).toHaveLength(1);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects decisions after consent or mandate revocation', async () => {
    const revokedConsent = readyStore();
    const sourceIds = ['accountant-workspace'];
    revokedConsent.appendEvidenceConsentEvent({
      version: 'tax-evidence-consent-event-v1',
      eventId: '82000000-0000-4000-8000-000000000002',
      workspaceId: 'workspace:1',
      sequence: 2,
      action: 'revoke',
      authoritySource: 'desk_subscription',
      actorReferenceHash: hashTaxEvidenceConsentScope('actor-v1', ['user:owner']),
      consent: {
        purpose: 'tax_workspace_processing',
        version: 'consent-v1',
        scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
        sourceIds,
      },
      occurredAt: '2026-07-17T11:30:00.000Z',
    });
    await expect(call(revokedConsent, decision()))
      .rejects.toThrow('ACCOUNTANT_DECISION_CONSENT_REQUIRED');
    expect(revokedConsent.getExternalAccountantDecision(decision().decisionId)).toBeNull();
    expect(revokedConsent.listPendingTaxDomainEvents().map(event => event.kind))
      .toEqual(['consent.revoked']);
    revokedConsent.close();

    const revokedMandate = readyStore();
    revokedMandate.revokeAccountantMandate(
      'mandate:review:1',
      'workspace:1',
      'user:owner',
      '2026-07-17T11:30:00.000Z',
    );
    await expect(call(revokedMandate, decision()))
      .rejects.toThrow('ACCOUNTANT_MANDATE_REVOKED');
    expect(revokedMandate.getExternalAccountantDecision(decision().decisionId)).toBeNull();
    expect(revokedMandate.listPendingTaxDomainEvents()).toHaveLength(0);
    revokedMandate.close();
  });

  test('rejects raw tax data and unmodeled free text before persistence', async () => {
    const store = readyStore();
    await expect(call(store, { ...decision(), ein: '12-3456789' } as never)).rejects.toThrow();
    await expect(call(store, { ...decision(), note: 'approved in chat' } as never)).rejects.toThrow();
    expect(store.listPendingTaxDomainEvents()).toHaveLength(0);
    store.close();
  });
});

function readyStore(options: {
  consent?: boolean;
  expiresAt?: string;
  path?: string;
  scopes?: readonly ('review_tax_obligation' | 'export_accountant_packet')[];
} = {}): TaxProfileStore {
  const store = new TaxProfileStore(
    options.path ?? ':memory:',
    'test-tax-domain-event-commitment-secret-v1',
  );
  if (options.consent !== false) {
    const sourceIds = ['accountant-workspace'];
    store.appendEvidenceConsentEvent({
      version: 'tax-evidence-consent-event-v1',
      eventId: '82000000-0000-4000-8000-000000000001',
      workspaceId: 'workspace:1',
      sequence: 1,
      action: 'grant',
      authoritySource: 'desk_subscription',
      actorReferenceHash: hashTaxEvidenceConsentScope('actor-v1', ['user:owner']),
      consent: {
        purpose: 'tax_workspace_processing',
        version: 'consent-v1',
        scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
        sourceIds,
      },
      occurredAt: '2026-07-17T10:00:00.000Z',
    });
  }
  store.grantAccountantMandate({
    version: 'accountant-mandate-v1',
    mandateId: 'mandate:review:1',
    workspaceId: 'workspace:1',
    accountantActorId: 'accountant:1',
    accountantOrganizationId: 'firm:1',
    scopes: options.scopes ?? ['review_tax_obligation'],
    grantedByActorId: 'user:owner',
    grantedAt: '2026-07-17T10:00:00.000Z',
    expiresAt: options.expiresAt ?? '2026-08-17T00:00:00.000Z',
    revokedAt: null,
  });
  return store;
}

async function call(
  store: TaxProfileStore,
  payload: ExternalAccountantDecisionV1,
  principalOverrides: { actorId?: string; workspaceId?: string } = {},
): Promise<Response> {
  const raw = JSON.stringify(payload);
  const request = signedRequest(raw, principalOverrides);
  const principal = verifyBoundTaxTenantPrincipalForRawBody(
    request,
    raw,
    SECRET,
    'accountant:decision',
    NOW,
  );
  const response = await handleExternalAccountantDecisionRoute(
    request,
    new URL(request.url),
    store,
    principal,
    NOW,
    raw,
  );
  if (!response) throw new Error('ROUTE_NOT_HANDLED');
  return response;
}

function signedRequest(
  body: string,
  overrides: {
    actorId?: string;
    workspaceId?: string;
    bodyHash?: string;
    capability?: TaxTenantCapability;
    expiresAt?: string;
  } = {},
): Request {
  const path = '/v1/accountant-decisions';
  const encoded = Buffer.from(JSON.stringify({
    version: 'tax-tenant-principal-v3',
    workspaceId: overrides.workspaceId ?? 'workspace:1',
    actorId: overrides.actorId ?? 'accountant:1',
    capability: overrides.capability ?? 'accountant:decision',
    method: 'POST',
    path,
    bodyHash: overrides.bodyHash ?? createHash('sha256').update(body).digest('hex'),
    expiresAt: overrides.expiresAt ?? '2026-07-17T12:05:00.000Z',
  }), 'utf8').toString('base64url');
  return new Request(`http://tax.test${path}`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-tax-tenant-principal': encoded,
      'x-tax-tenant-signature': createHmac('sha256', SECRET).update(encoded).digest('hex'),
    },
  });
}
