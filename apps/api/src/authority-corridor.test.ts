import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FacturaEAuthorityExecutionService,
  FacturaEAuthorityExecutionStore,
  type FacturaEAuthorityRemoteEffect,
} from './authority-execution';
import { handleFacturaEAuthorityCorridorRoute } from './authority-corridor-routes';
import {
  createTaxAuthorityPrincipalHeaders,
  verifyTaxAuthorityPrincipal,
} from './authority-principal';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const intentHash = 'a'.repeat(64);
const motoraSecret = 'motora-authority-secret-1111111111111111';
const approvalSecret = 'open-agents-approval-secret-2222222222';
const approvalRef = 'human_approval_abcdefghijklmnopqrstuvwx';

function fixture(
  recoverOutcomes: ReadonlyArray<'authority_accepted_unverified' | 'ambiguous'> = [
    'authority_accepted_unverified',
  ],
  storePath = ':memory:'
) {
  const calls = { prepare: 0, execute: 0, recover: 0, reconcile: 0 };
  const effect: FacturaEAuthorityRemoteEffect = {
    async prepare(input) {
      calls.prepare += 1;
      return {
        executionId: input.executionId,
        workspaceId: input.workspaceId,
        runId: input.runId,
        intentHash: input.intentHash,
        requestId: '41',
        authorityPayloadRef: 'vault://wsfex/33333333-3333-4333-8333-333333333333',
        authorityPayloadHash: 'b'.repeat(64),
      };
    },
    async execute() {
      calls.execute += 1;
      return { status: 'ambiguous', receiptHash: 'c'.repeat(64) };
    },
    async recover() {
      calls.recover += 1;
      const status = recoverOutcomes[calls.recover - 1] ?? recoverOutcomes.at(-1) ?? 'ambiguous';
      return {
        status,
        receiptHash: (status === 'authority_accepted_unverified' ? 'd' : 'e').repeat(64),
      };
    },
    async reconcile() {
      calls.reconcile += 1;
      return {
        status: 'officially_reconciled',
        receiptHash: 'f'.repeat(64),
        authorityIdentityHash: '1'.repeat(64),
      };
    },
  };
  const store = new FacturaEAuthorityExecutionStore(storePath, false);
  const service = new FacturaEAuthorityExecutionService(
    store,
    candidate => {
      if (candidate !== runId) throw new Error('AGENT_RUN_NOT_FOUND');
      return { workspaceId, intentHash, issuanceState: 'ready_for_wsfex' };
    },
    effect,
    true
  );
  return { store, service, calls, effect };
}

function signedRequest(
  path: string,
  body: unknown,
  input: Readonly<{
    capability:
      | 'factura-e:case:create'
      | 'factura-e:authority:attest'
      | 'factura-e:intent:approve'
      | 'factura-e:intent:create'
      | 'factura-e:approval:register'
      | 'factura-e:execute'
      | 'factura-e:recover'
      | 'factura-e:reconcile';
    actorId: string;
    secret: string;
  }>
) {
  const rawBody = JSON.stringify(body);
  return new Request(`https://tax.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...createTaxAuthorityPrincipalHeaders({
        secret: input.secret,
        workspaceId,
        actorId: input.actorId,
        capability: input.capability,
        method: 'POST',
        path,
        rawBody,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    },
    body: rawBody,
  });
}

function signedStatusRequest(candidateWorkspaceId: string, actorId = 'motora:user-1') {
  const path = `/v1/authority/factura-e/workspaces/${candidateWorkspaceId}/current`;
  return {
    path,
    request: new Request(`https://tax.test${path}`, {
      method: 'GET',
      headers: createTaxAuthorityPrincipalHeaders({
        secret: motoraSecret,
        workspaceId: candidateWorkspaceId,
        actorId,
        capability: 'factura-e:status:read',
        method: 'GET',
        path,
        rawBody: '',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }),
  };
}

function signedCaseStatusRequest(candidateWorkspaceId = workspaceId) {
  const path = `/v1/authority/factura-e/cases/${runId}`;
  return {
    path,
    request: new Request(`https://tax.test${path}`, {
      method: 'GET',
      headers: createTaxAuthorityPrincipalHeaders({
        secret: motoraSecret,
        workspaceId: candidateWorkspaceId,
        actorId: 'motora:desk-case-status',
        capability: 'factura-e:case:read',
        method: 'GET',
        path,
        rawBody: '',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }),
  };
}

describe('Tax-owned Factura E authority corridor', () => {
  test('reads one exact execution without switching to another invoice in the workspace', async () => {
    const { store, service } = fixture();
    try {
      const first = service.createIntent({
        workspaceId, runId, intentHash, actorId: 'user:creator',
        idempotencyKey: 'exact-status-first-123456', occurredAt: '2026-07-15T16:00:00.000Z',
      });
      const path = `/v1/authority/factura-e/intents/${first.executionId}/status`;
      const read = async (scope: string) => {
        const request = new Request(`https://tax.test${path}`, {
          method: 'GET', headers: createTaxAuthorityPrincipalHeaders({
            secret: motoraSecret, workspaceId: scope, actorId: 'motora:user-1',
            capability: 'factura-e:status:read', method: 'GET', path, rawBody: '',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        });
        const response = await handleFacturaEAuthorityCorridorRoute(
          request, new URL(request.url), service, {
            corridorEnabled: true,
            secrets: { motora: motoraSecret, openAgentsApproval: approvalSecret },
          },
        );
        return (await response!.json() as any).data;
      };
      expect(await read(workspaceId)).toMatchObject({ executionId: first.executionId });
      expect(await read('44444444-4444-4444-8444-444444444444')).toBeNull();
    } finally {
      store.close();
    }
  });

  test('returns the invoice-bound intent hash in the browser-safe TaxCase status', async () => {
    const { store, service } = fixture();
    const ledgerInvoiceId = '33333333-3333-4333-8333-333333333333';
    const calls: Record<string, unknown>[] = [];
    const taxCases = {
      invoiceTaxCaseStatus: (input: Record<string, unknown>) => {
        calls.push(input);
        if (input.workspaceId !== workspaceId) throw new Error('TAX_INVOICE_CASE_BINDING_CONFLICT');
        return {
          runId,
          workspaceId,
          ledgerInvoiceId,
          intentHash,
          revision: 7,
          readinessState: 'verified',
          intentState: 'frozen',
          approvalState: 'user_approved',
          issuanceState: 'ready_for_wsfex',
        };
      },
    } as unknown as import('./factura-e-agent').FacturaEAgentService;
    try {
      const signed = signedCaseStatusRequest();
      const response = await handleFacturaEAuthorityCorridorRoute(
        signed.request,
        new URL(`https://tax.test${signed.path}`),
        service,
        { corridorEnabled: true, secrets: { motora: motoraSecret }, taxCases },
      );
      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({
        data: expect.objectContaining({
          version: 'factura-e-tax-case-status-v1',
          runId,
          workspaceId,
          ledgerInvoiceId,
          intentHash,
          nextAction: 'persist_authority_intent',
        }),
      });
      expect(calls).toEqual([{ workspaceId, runId }]);

      const denied = signedCaseStatusRequest('99999999-9999-4999-8999-999999999999');
      const deniedResponse = await handleFacturaEAuthorityCorridorRoute(
        denied.request,
        new URL(`https://tax.test${denied.path}`),
        service,
        { corridorEnabled: true, secrets: { motora: motoraSecret }, taxCases },
      );
      expect(deniedResponse?.status).toBe(409);
    } finally {
      store.close();
    }
  });

  test('releases an invoice-bound authority tuple only after official reconciliation', async () => {
    const { store, service } = fixture();
    const ledgerInvoiceId = '33333333-3333-4333-8333-333333333333';
    let attestationCalls = 0;
    const taxCases = {
      getRun: () => ({ runId, workspaceId, intentHash }),
      invoiceAuthorityAttestation: (input: Record<string, unknown>) => {
        attestationCalls += 1;
        return {
          version: 'factura-e-invoice-authority-attestation-v1',
          authorityExecutionId: input.authorityExecutionId,
          workspaceId,
          ledgerInvoiceId,
          runId,
          intentHash,
          revision: 12,
          authorityState: 'officially_reconciled',
          authorityEnvironment: input.authorityEnvironment,
          authorityProviderId: input.authorityProviderId,
          invoice: {
            documentType: 19,
            pointOfSale: 4,
            invoiceNumber: '51',
            cae: '98765432109876',
            caeExpiry: '2026-07-21',
            currencyId: 'DOL',
            currencyQuote: '1200.25',
            authorizedAt: '2026-07-15T16:05:00.000Z',
            authorityReceiptHash: input.authorityReceiptHash,
            issueDate: '2026-07-15',
          },
        };
      },
    } as unknown as import('./factura-e-agent').FacturaEAgentService;
    const path = `/v1/authority/factura-e/cases/${runId}/authority-attestation`;
    const body = {
      version: 'factura-e-invoice-authority-attestation-request-v1',
      workspaceId,
      ledgerInvoiceId,
      intentHash,
    } as const;
    const request = () => signedRequest(path, body, {
      capability: 'factura-e:authority:attest',
      actorId: 'motora:desk-authority-sync',
      secret: motoraSecret,
    });
    try {
      const beforeOfficial = await handleFacturaEAuthorityCorridorRoute(
        request(),
        new URL(`https://tax.test${path}`),
        service,
        { corridorEnabled: true, secrets: { motora: motoraSecret }, taxCases },
      );
      expect(beforeOfficial?.status).toBe(409);
      expect(await beforeOfficial?.json()).toEqual({
        error: 'TAX_AUTHORITY_OFFICIAL_ATTESTATION_STATE_CONFLICT',
      });
      expect(attestationCalls).toBe(0);

      const intent = service.createIntent({
        workspaceId,
        runId,
        intentHash,
        actorId: 'user:creator',
        idempotencyKey: 'create-authority-attestation-1',
        occurredAt: '2026-07-15T16:00:00.000Z',
      });
      service.registerApproval({
        executionId: intent.executionId,
        workspaceId,
        intentHash,
        approvalRef: 'human_approval_authority_attestation_abcdefghijkl',
        actorId: 'user:approver',
        idempotencyKey: 'register-authority-attestation-1',
        occurredAt: '2026-07-15T16:01:00.000Z',
      });
      await service.execute({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'execute-authority-attestation-1',
        occurredAt: '2026-07-15T16:02:00.000Z',
      });
      await service.recover({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-attestation-1',
        occurredAt: '2026-07-15T16:03:00.000Z',
      });
      await service.reconcile({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'reconcile-authority-attestation-1',
        occurredAt: '2026-07-15T16:05:00.000Z',
      });

      const response = await handleFacturaEAuthorityCorridorRoute(
        request(),
        new URL(`https://tax.test${path}`),
        service,
        { corridorEnabled: true, secrets: { motora: motoraSecret }, taxCases },
      );
      expect(response?.status).toBe(200);
      expect(response?.headers.get('cache-control')).toBe('private, no-store');
      expect(await response?.json()).toEqual({ data: expect.objectContaining({
        version: 'factura-e-invoice-authority-attestation-v1',
        authorityExecutionId: intent.executionId,
        workspaceId,
        ledgerInvoiceId,
        runId,
        intentHash,
        authorityState: 'officially_reconciled',
        authorityEnvironment: 'homologation',
        invoice: expect.objectContaining({
          cae: '98765432109876',
          authorityReceiptHash: 'f'.repeat(64),
        }),
      }) });
      expect(attestationCalls).toBe(1);
    } finally {
      store.close();
    }
  });

  test('approves a frozen intent through Motora and rejects cross-tenant run access', async () => {
    const { store, service } = fixture();
    const calls: Record<string, unknown>[] = [];
    const run = {
      runId,
      workspaceId,
      approvalState: 'user_approved',
      issuanceState: 'ready_for_wsfex',
    };
    const taxCases = {
      getRun: (candidateRunId: string) => {
        calls.push({ kind: 'read', runId: candidateRunId });
        return run;
      },
      approveIntent: (input: Record<string, unknown>) => {
        calls.push({ kind: 'approve', ...input });
        return { run, replayed: false };
      },
    } as unknown as import('./factura-e-agent').FacturaEAgentService;
    const path = `/v1/authority/factura-e/cases/${runId}/intent-approval`;
    const body = {
      version: 'factura-e-intent-approve-v1',
      workspaceId,
      intentHash,
      idempotencyKey: 'motora-approve-intent-1',
    } as const;
    try {
      const response = await handleFacturaEAuthorityCorridorRoute(
        signedRequest(path, body, {
          capability: 'factura-e:intent:approve',
          actorId: 'user:human-approver-1',
          secret: motoraSecret,
        }),
        new URL(`https://tax.test${path}`),
        service,
        { corridorEnabled: true, secrets: { motora: motoraSecret }, taxCases },
      );
      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({ data: {
        version: 'factura-e-intent-approval-receipt-v1',
        runId,
        workspaceId,
        intentHash,
        approvalState: 'user_approved',
        issuanceState: 'ready_for_wsfex',
        replayed: false,
      } });
      expect(calls).toEqual([
        { kind: 'read', runId },
        expect.objectContaining({
          kind: 'approve',
          runId,
          actorId: 'user:human-approver-1',
          intentHash,
        }),
      ]);

      const otherWorkspaceId = '99999999-9999-4999-8999-999999999999';
      const crossTenantRun = {
        ...run,
        workspaceId: otherWorkspaceId,
      };
      const crossTenantCases = {
        getRun: () => crossTenantRun,
        approveIntent: () => {
          throw new Error('CROSS_TENANT_APPROVAL_MUST_NOT_RUN');
        },
      } as unknown as import('./factura-e-agent').FacturaEAgentService;
      const denied = await handleFacturaEAuthorityCorridorRoute(
        signedRequest(path, body, {
          capability: 'factura-e:intent:approve',
          actorId: 'user:human-approver-1',
          secret: motoraSecret,
        }),
        new URL(`https://tax.test${path}`),
        service,
        { corridorEnabled: true, secrets: { motora: motoraSecret }, taxCases: crossTenantCases },
      );
      expect(denied?.status).toBe(403);
      expect(await denied?.json()).toEqual({
        error: 'TAX_AUTHORITY_PRINCIPAL_SCOPE_UNAUTHORIZED',
      });
    } finally {
      store.close();
    }
  });

  test('creates and binds a manual TaxCase without drafting, approving, or issuing', async () => {
    const { store, service } = fixture();
    const calls: Record<string, unknown>[] = [];
    const taxCases = {
      createRun: (input: Record<string, unknown>) => {
        calls.push({ kind: 'create', ...input });
        return { run: { runId: input.runId, workspaceId: input.workspaceId }, replayed: false };
      },
      bindLedgerInvoice: (input: Record<string, unknown>) => {
        calls.push({ kind: 'bind', ...input });
        return { run: { runId: input.runId, workspaceId }, replayed: false };
      },
    } as unknown as import('./factura-e-agent').FacturaEAgentService;
    const path = '/v1/authority/factura-e/cases';
    const body = {
      version: 'factura-e-tax-case-create-v1', workspaceId, runId,
      ledgerInvoiceId: '33333333-3333-4333-8333-333333333333',
      issuancePath: 'reclaim_copilot', idempotencyKey: 'motora-create-case-1',
    } as const;
    try {
      const response = await handleFacturaEAuthorityCorridorRoute(
        signedRequest(path, body, { capability: 'factura-e:case:create', actorId: 'motora:user-1', secret: motoraSecret }),
        new URL(`https://tax.test${path}`), service,
        { corridorEnabled: true, secrets: { motora: motoraSecret }, taxCases },
      );
      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({ data: {
        version: 'factura-e-tax-case-receipt-v1', runId, workspaceId,
        ledgerInvoiceId: body.ledgerInvoiceId, state: 'case_created', replayed: false,
        nextAction: 'collect_verified_evidence',
      } });
      expect(calls).toEqual([
        expect.objectContaining({ kind: 'create', runId, workspaceId, issuancePath: 'reclaim_copilot' }),
        expect.objectContaining({ kind: 'bind', runId, ledgerInvoiceId: body.ledgerInvoiceId }),
      ]);
    } finally { store.close(); }
  });

  test('persists intent, consumes a distinct one-use approval, and recovers exactly', async () => {
    const { store, service, calls } = fixture();
    try {
      const intent = service.createIntent({
        workspaceId,
        runId,
        intentHash,
        actorId: 'user:creator',
        idempotencyKey: 'create-authority-intent-1',
        occurredAt: '2026-07-15T16:00:00.000Z',
      });
      expect(intent).toMatchObject({ state: 'intent_persisted', replayed: false });
      expect(
        service.createIntent({
          workspaceId,
          runId,
          intentHash,
          actorId: 'user:creator',
          idempotencyKey: 'create-authority-intent-1',
          occurredAt: '2026-07-15T16:00:01.000Z',
        })
      ).toMatchObject({ executionId: intent.executionId, replayed: true });
      expect(() =>
        service.registerApproval({
          executionId: intent.executionId,
          workspaceId,
          intentHash,
          approvalRef,
          actorId: 'user:creator',
          idempotencyKey: 'register-approval-self-1',
          occurredAt: '2026-07-15T16:01:00.000Z',
        })
      ).toThrow('TAX_AUTHORITY_SELF_APPROVAL_FORBIDDEN');

      expect(
        service.registerApproval({
          executionId: intent.executionId,
          workspaceId,
          intentHash,
          approvalRef,
          actorId: 'oa:approval:run-1',
          idempotencyKey: 'register-oa-approval-1',
          occurredAt: '2026-07-15T16:02:00.000Z',
        })
      ).toMatchObject({ state: 'approved' });

      const ambiguous = await service.execute({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'execute-authority-intent-1',
        occurredAt: '2026-07-15T16:03:00.000Z',
      });
      expect(ambiguous).toMatchObject({
        state: 'recovery_required',
        nextAction: 'recover_exactly',
      });
      expect(calls).toEqual({ prepare: 1, execute: 1, recover: 0, reconcile: 0 });

      const replay = await service.execute({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'execute-authority-intent-1',
        occurredAt: '2026-07-15T16:03:30.000Z',
      });
      expect(replay).toMatchObject({ state: 'recovery_required', replayed: true });
      expect(calls.execute).toBe(1);

      const recovered = await service.recover({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-intent-1',
        occurredAt: '2026-07-15T16:04:00.000Z',
      });
      expect(recovered).toMatchObject({
        state: 'authority_accepted_unverified',
        nextAction: 'reconcile_authority_exactly',
      });
      expect(calls.recover).toBe(1);
      expect(JSON.stringify(recovered)).not.toMatch(/"(?:vault|cuit|cae)"/i);

      const reconciled = await service.reconcile({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'reconcile-authority-intent-1',
        occurredAt: '2026-07-15T16:05:00.000Z',
      });
      expect(reconciled).toMatchObject({ state: 'officially_reconciled', nextAction: 'none' });
      expect(calls.reconcile).toBe(1);
      expect(JSON.stringify(reconciled)).not.toMatch(/identity|vault|cuit|cae/i);
    } finally {
      store.close();
    }
  });

  test('waits for a live preparation and resumes only the same stalled pre-dispatch attempt', async () => {
    for (const stalledState of ['preparing', 'prepared'] as const) {
      const { store, service, calls, effect } = fixture();
      try {
        const startedAt = new Date(Date.now() - 31_000).toISOString();
        const execution = service.createIntent({
          workspaceId, runId, intentHash, actorId: 'user:creator',
          idempotencyKey: `create-${stalledState}`, occurredAt: startedAt,
        });
        service.registerApproval({
          executionId: execution.executionId, workspaceId, intentHash, approvalRef,
          actorId: 'oa:approval:resume', idempotencyKey: `approve-${stalledState}`,
          occurredAt: startedAt,
        });
        const command = {
          executionId: execution.executionId, workspaceId,
          actorId: 'motora:authority-corridor', idempotencyKey: `execute-${stalledState}`,
        };
        store.beginExecution({ ...command, occurredAt: startedAt });
        if (stalledState === 'prepared') {
          store.prepared(execution.executionId, {
            ...command, runId, intentHash, requestId: '41',
            authorityPayloadRef: 'vault://wsfex/33333333-3333-4333-8333-333333333333',
            authorityPayloadHash: 'b'.repeat(64),
          }, startedAt);
          effect.prepare = async input => {
            calls.prepare += 1;
            return {
              ...input,
              requestId: '42',
              authorityPayloadRef: 'vault://wsfex/55555555-5555-4555-8555-555555555555',
              authorityPayloadHash: 'd'.repeat(64),
            };
          };
        }
        expect(service.exactStatus(workspaceId, execution.executionId)).toMatchObject({
          state: 'effect_pending', nextAction: 'execute_with_one_use_approval',
        });
        const resumed = await service.execute({ ...command, occurredAt: new Date().toISOString() });
        expect(resumed).toMatchObject({ state: 'recovery_required', replayed: true });
        expect(calls.prepare).toBe(1);
        if (stalledState === 'prepared') {
          expect(store.get(execution.executionId)).toMatchObject({
            requestId: '42',
            authorityPayloadRef: 'vault://wsfex/55555555-5555-4555-8555-555555555555',
          });
        }
        expect(calls.execute).toBe(1);
        await service.execute({ ...command, occurredAt: new Date().toISOString() });
        expect(calls.execute).toBe(1);
      } finally {
        store.close();
      }
    }
  });

  test('does not repeat preparation while the first attempt can still be running', async () => {
    const { store, service, calls } = fixture();
    try {
      const startedAt = new Date().toISOString();
      const execution = service.createIntent({
        workspaceId, runId, intentHash, actorId: 'user:creator',
        idempotencyKey: 'create-fresh', occurredAt: startedAt,
      });
      service.registerApproval({
        executionId: execution.executionId, workspaceId, intentHash, approvalRef,
        actorId: 'oa:approval:fresh', idempotencyKey: 'approve-fresh', occurredAt: startedAt,
      });
      const command = {
        executionId: execution.executionId, workspaceId,
        actorId: 'motora:authority-corridor', idempotencyKey: 'execute-fresh',
      };
      store.beginExecution({ ...command, occurredAt: startedAt });
      expect(service.exactStatus(workspaceId, execution.executionId)).toMatchObject({
        state: 'effect_pending', nextAction: 'wait',
      });
      expect(await service.execute({ ...command, occurredAt: startedAt })).toMatchObject({
        state: 'effect_pending', nextAction: 'wait', replayed: true,
      });
      expect(calls.prepare).toBe(0);
      expect(calls.execute).toBe(0);
    } finally {
      store.close();
    }
  });

  test('resumes a prepared execution after a Tax process restart without a new approval', async () => {
    const databasePath = join(tmpdir(), `tax-authority-prepared-${crypto.randomUUID()}.sqlite`);
    const initial = fixture(undefined, databasePath);
    let restartedStore: FacturaEAuthorityExecutionStore | null = null;
    try {
      const startedAt = new Date(Date.now() - 31_000).toISOString();
      const execution = initial.service.createIntent({
        workspaceId, runId, intentHash, actorId: 'user:creator',
        idempotencyKey: 'create-restarted-preparation', occurredAt: startedAt,
      });
      initial.service.registerApproval({
        executionId: execution.executionId, workspaceId, intentHash, approvalRef,
        actorId: 'oa:approval:restart', idempotencyKey: 'approve-restarted-preparation',
        occurredAt: startedAt,
      });
      const command = {
        executionId: execution.executionId, workspaceId,
        actorId: 'motora:authority-corridor', idempotencyKey: 'execute-restarted-preparation',
      };
      initial.store.beginExecution({ ...command, occurredAt: startedAt });
      initial.store.prepared(execution.executionId, {
        ...command, runId, intentHash, requestId: '41',
        authorityPayloadRef: 'vault://wsfex/33333333-3333-4333-8333-333333333333',
        authorityPayloadHash: 'b'.repeat(64),
      }, startedAt);
      initial.store.close();
      restartedStore = new FacturaEAuthorityExecutionStore(databasePath, false);
      const resumed = new FacturaEAuthorityExecutionService(
        restartedStore,
        () => ({ workspaceId, intentHash, issuanceState: 'ready_for_wsfex' }),
        initial.effect,
        true
      );
      expect(resumed.exactStatus(workspaceId, execution.executionId)).toMatchObject({
        state: 'effect_pending', nextAction: 'execute_with_one_use_approval',
      });
      expect(await resumed.execute({ ...command, occurredAt: new Date().toISOString() }))
        .toMatchObject({ state: 'recovery_required', replayed: true });
      expect(initial.calls.prepare).toBe(1);
      expect(initial.calls.execute).toBe(1);
    } finally {
      try { initial.store.close(); } catch { /* Simulated process already stopped. */ }
      restartedStore?.close();
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-wal`, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
    }
  });

  test('binds HMAC authority to workspace, actor, capability, method, path and body', () => {
    const path = '/v1/authority/factura-e/intents';
    const body = JSON.stringify({ value: 'safe' });
    const headers = createTaxAuthorityPrincipalHeaders({
      secret: motoraSecret,
      workspaceId,
      actorId: 'motora:desk-user',
      capability: 'factura-e:intent:create',
      method: 'POST',
      path,
      rawBody: body,
      expiresAt: '2026-07-15T16:01:00.000Z',
    });
    const request = new Request(`https://tax.test${path}`, {
      method: 'POST',
      headers,
      body,
    });
    expect(
      verifyTaxAuthorityPrincipal({
        request,
        rawBody: body,
        capability: 'factura-e:intent:create',
        secrets: { motora: motoraSecret },
        now: new Date('2026-07-15T16:00:00.000Z'),
      })
    ).toMatchObject({ workspaceId, actorId: 'motora:desk-user' });
    expect(() =>
      verifyTaxAuthorityPrincipal({
        request,
        rawBody: JSON.stringify({ value: 'tampered' }),
        capability: 'factura-e:intent:create',
        secrets: { motora: motoraSecret },
        now: new Date('2026-07-15T16:00:00.000Z'),
      })
    ).toThrow('TAX_AUTHORITY_PRINCIPAL_SCOPE_UNAUTHORIZED');
  });

  test('replays an ambiguous recovery key without refiring and permits a new exact recovery attempt', async () => {
    const { store, service, calls } = fixture([
      'ambiguous',
      'authority_accepted_unverified',
    ]);
    try {
      const intent = service.createIntent({
        workspaceId,
        runId,
        intentHash,
        actorId: 'user:creator',
        idempotencyKey: 'create-authority-intent-recovery',
        occurredAt: '2026-07-15T16:00:00.000Z',
      });
      service.registerApproval({
        executionId: intent.executionId,
        workspaceId,
        intentHash,
        approvalRef,
        actorId: 'oa:approval:run-recovery',
        idempotencyKey: 'register-oa-approval-recovery',
        occurredAt: '2026-07-15T16:01:00.000Z',
      });
      await service.execute({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'execute-authority-recovery',
        occurredAt: '2026-07-15T16:02:00.000Z',
      });
      const first = await service.recover({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-attempt-1',
        occurredAt: '2026-07-15T16:03:00.000Z',
      });
      expect(first).toMatchObject({ state: 'recovery_required', replayed: false });
      const replay = await service.recover({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-attempt-1',
        occurredAt: '2026-07-15T16:03:30.000Z',
      });
      expect(replay).toMatchObject({ state: 'recovery_required', replayed: true });
      expect(calls.recover).toBe(1);
      const acceptedUnverified = await service.recover({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-attempt-2',
        occurredAt: '2026-07-15T16:04:00.000Z',
      });
      expect(acceptedUnverified).toMatchObject({
        state: 'authority_accepted_unverified',
        replayed: false,
      });
      expect(calls.recover).toBe(2);
    } finally {
      store.close();
    }
  });

  test('reclaims a stale recovery lease after restart and fences the killed recovery worker', async () => {
    const databasePath = join(tmpdir(), `tax-authority-recovery-${crypto.randomUUID()}.sqlite`);
    const initial = fixture(['authority_accepted_unverified'], databasePath);
    let restartedStore: FacturaEAuthorityExecutionStore | null = null;
    try {
      const intent = initial.service.createIntent({
        workspaceId,
        runId,
        intentHash,
        actorId: 'user:creator',
        idempotencyKey: 'create-authority-recovery-restart',
        occurredAt: '2026-07-15T16:00:00.000Z',
      });
      initial.service.registerApproval({
        executionId: intent.executionId,
        workspaceId,
        intentHash,
        approvalRef: 'human_approval_recovery_restart_abcdefghijkl',
        actorId: 'oa:approval:recovery-restart',
        idempotencyKey: 'register-authority-recovery-restart',
        occurredAt: '2026-07-15T16:01:00.000Z',
      });
      await initial.service.execute({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'execute-authority-recovery-restart',
        occurredAt: '2026-07-15T16:02:00.000Z',
      });
      const killedWorkerClaim = initial.store.beginRecovery({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-restart-same-key',
        occurredAt: '2026-07-15T16:03:00.000Z',
      });
      expect(killedWorkerClaim.fenceToken).toBeTruthy();
      initial.store.close();

      restartedStore = new FacturaEAuthorityExecutionStore(databasePath, false);
      const restartedService = new FacturaEAuthorityExecutionService(
        restartedStore,
        () => ({ workspaceId, intentHash, issuanceState: 'ready_for_wsfex' }),
        initial.effect,
        true
      );
      await expect(restartedService.recover({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-restart-same-key',
        occurredAt: '2026-07-15T16:03:10.000Z',
      })).resolves.toMatchObject({ state: 'recovery_required', replayed: true });
      expect(initial.calls.recover).toBe(0);

      let releaseRecovery:
        | ((outcome: { status: 'authority_accepted_unverified'; receiptHash: string }) => void)
        | undefined;
      initial.effect.recover = async () => {
        initial.calls.recover += 1;
        return await new Promise(resolve => {
          releaseRecovery = resolve;
        });
      };
      const restartedAttempt = restartedService.recover({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-restart-same-key',
        occurredAt: '2026-07-15T16:03:31.000Z',
      });
      expect(initial.calls.recover).toBe(1);
      expect(() => restartedStore!.complete(
        intent.executionId,
        { status: 'authority_accepted_unverified', receiptHash: '7'.repeat(64) },
        '2026-07-15T16:03:32.000Z',
        killedWorkerClaim.fenceToken!
      )).toThrow('TAX_AUTHORITY_RECOVERY_FENCE_LOST');
      releaseRecovery!({
        status: 'authority_accepted_unverified',
        receiptHash: '7'.repeat(64),
      });
      await expect(restartedAttempt).resolves.toMatchObject({
        state: 'authority_accepted_unverified',
        replayed: false,
      });
    } finally {
      try {
        initial.store.close();
      } catch {
        // The simulated killed worker already closed its handle.
      }
      restartedStore?.close();
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-wal`, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
    }
  });

  test('blocks approval or execution when a persisted authority provider context changes', () => {
    const { store, service, effect } = fixture();
    try {
      const intent = service.createIntent({
        workspaceId,
        runId,
        intentHash,
        actorId: 'user:creator',
        idempotencyKey: 'create-old-provider-context',
        occurredAt: '2026-07-15T16:00:00.000Z',
      });
      const rebound = new FacturaEAuthorityExecutionService(
        store,
        () => ({ workspaceId, intentHash, issuanceState: 'ready_for_wsfex' }),
        effect,
        true,
        {
          environment: 'homologation',
          providerId: 'tax-engine-wsfex-signer-v1',
        }
      );
      expect(() => rebound.registerApproval({
        executionId: intent.executionId,
        workspaceId,
        intentHash,
        approvalRef,
        actorId: 'oa:approval:context',
        idempotencyKey: 'register-new-provider-context',
        occurredAt: '2026-07-15T16:01:00.000Z',
      })).toThrow('TAX_AUTHORITY_EXECUTION_CONTEXT_MISMATCH');
    } finally {
      store.close();
    }
  });

  test('reclaims a stale reconciliation lease after restart and fences the killed worker', async () => {
    const databasePath = join(tmpdir(), `tax-authority-${crypto.randomUUID()}.sqlite`);
    const initial = fixture(['authority_accepted_unverified'], databasePath);
    let restartedStore: FacturaEAuthorityExecutionStore | null = null;
    try {
      const intent = initial.service.createIntent({
        workspaceId,
        runId,
        intentHash,
        actorId: 'user:creator',
        idempotencyKey: 'create-authority-restart-1',
        occurredAt: '2026-07-15T16:00:00.000Z',
      });
      initial.service.registerApproval({
        executionId: intent.executionId,
        workspaceId,
        intentHash,
        approvalRef: 'human_approval_restart_abcdefghijklmnop',
        actorId: 'oa:approval:restart',
        idempotencyKey: 'register-authority-restart-1',
        occurredAt: '2026-07-15T16:01:00.000Z',
      });
      await initial.service.execute({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'execute-authority-restart-1',
        occurredAt: '2026-07-15T16:02:00.000Z',
      });
      await initial.service.recover({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'recover-authority-restart-1',
        occurredAt: '2026-07-15T16:03:00.000Z',
      });
      const killedWorkerClaim = initial.store.beginReconciliation({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'reconcile-authority-restart-1',
        occurredAt: '2026-07-15T16:04:00.000Z',
      });
      expect(killedWorkerClaim.fenceToken).toBeTruthy();
      initial.store.close();

      restartedStore = new FacturaEAuthorityExecutionStore(databasePath, false);
      const restartedService = new FacturaEAuthorityExecutionService(
        restartedStore,
        () => ({ workspaceId, intentHash, issuanceState: 'ready_for_wsfex' }),
        initial.effect,
        true
      );
      const activeLease = await restartedService.reconcile({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'reconcile-authority-restart-1',
        occurredAt: '2026-07-15T16:04:10.000Z',
      });
      expect(activeLease).toMatchObject({
        state: 'effect_pending',
        replayed: true,
        nextAction: 'wait',
      });
      expect(initial.calls.reconcile).toBe(0);

      let releaseOfficialRead:
        | ((outcome: {
            status: 'officially_reconciled';
            receiptHash: string;
            authorityIdentityHash: string;
          }) => void)
        | undefined;
      initial.effect.reconcile = async () => {
        initial.calls.reconcile += 1;
        return await new Promise(resolve => {
          releaseOfficialRead = resolve;
        });
      };
      const restartedAttempt = restartedService.reconcile({
        executionId: intent.executionId,
        workspaceId,
        actorId: 'motora:authority-corridor',
        idempotencyKey: 'reconcile-authority-restart-1',
        occurredAt: '2026-07-15T16:04:31.000Z',
      });
      expect(initial.calls.reconcile).toBe(1);
      expect(() =>
        restartedStore!.completeReconciliation(
          intent.executionId,
          {
            status: 'officially_reconciled',
            receiptHash: '8'.repeat(64),
            authorityIdentityHash: '9'.repeat(64),
          },
          '2026-07-15T16:04:32.000Z',
          killedWorkerClaim.fenceToken!
        )
      ).toThrow('TAX_AUTHORITY_RECONCILIATION_FENCE_LOST');
      releaseOfficialRead!({
        status: 'officially_reconciled',
        receiptHash: '8'.repeat(64),
        authorityIdentityHash: '9'.repeat(64),
      });
      await expect(restartedAttempt).resolves.toMatchObject({
        state: 'officially_reconciled',
        replayed: false,
      });
    } finally {
      try {
        initial.store.close();
      } catch {
        // The simulated killed worker already closed its handle.
      }
      restartedStore?.close();
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-wal`, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
    }
  });

  test('exposes only safe receipts through the Motora human-authority principal', async () => {
    const { store, service } = fixture();
    const ledgerInvoiceId = '33333333-3333-4333-8333-333333333333';
    const taxCases = {
      authorityPreparationBinding: () => ({
        version: 'factura-e-authority-preparation-binding-v1',
        ledgerInvoiceId,
        taxpayerReferenceHash: '2'.repeat(64),
        foreignCustomerReferenceHash: '3'.repeat(64),
      }),
    } as unknown as import('./factura-e-agent').FacturaEAgentService;
    const options = {
      corridorEnabled: true,
      secrets: { motora: motoraSecret },
      taxCases,
    };
    try {
      const createBody = {
        version: 'factura-e-authority-intent-create-v1',
        workspaceId,
        runId,
        ledgerInvoiceId,
        intentHash,
        idempotencyKey: 'motora-create-authority-1',
      } as const;
      const createPath = '/v1/authority/factura-e/intents';
      const executionId = service.createIntent({
        workspaceId, runId, intentHash, actorId: 'motora:user-1',
        idempotencyKey: createBody.idempotencyKey,
        occurredAt: '2026-07-15T16:00:00.000Z',
      }).executionId;

      const approvePath = `/v1/authority/factura-e/intents/${executionId}/approvals`;
      const approved = await handleFacturaEAuthorityCorridorRoute(
        signedRequest(
          approvePath,
          {
            version: 'factura-e-authority-approval-register-v1',
            workspaceId,
            intentHash,
            approvalRef,
            idempotencyKey: 'motora-register-human-approval-1',
          },
          {
            capability: 'factura-e:approval:register',
            actorId: 'motora:human-approver-1',
            secret: motoraSecret,
          }
        ),
        new URL(`https://tax.test${approvePath}`),
        service,
        options
      );
      expect(approved?.status).toBe(200);

      const executePath = `/v1/authority/factura-e/intents/${executionId}/execute`;
      const executed = await handleFacturaEAuthorityCorridorRoute(
        signedRequest(
          executePath,
          {
            version: 'factura-e-authority-execute-v1',
            workspaceId,
            idempotencyKey: 'motora-execute-authority-1',
          },
          {
            capability: 'factura-e:execute',
            actorId: 'motora:authority-corridor',
            secret: motoraSecret,
          }
        ),
        new URL(`https://tax.test${executePath}`),
        service,
        options
      );
      expect(executed?.status).toBe(200);
      const serialized = JSON.stringify(await executed!.json());
      expect(serialized).toContain('recovery_required');
      expect(serialized).not.toMatch(/vault|cuit|cae|token|certificate/i);

      const currentRequest = signedStatusRequest(workspaceId);
      const current = await handleFacturaEAuthorityCorridorRoute(
        currentRequest.request,
        new URL(`https://tax.test${currentRequest.path}`),
        service,
        options
      );
      expect(current?.status).toBe(200);
      const currentBody = await current!.json();
      expect(currentBody.data).toMatchObject({
        executionId,
        workspaceId,
        state: 'recovery_required',
        replayed: false,
        nextAction: 'recover_exactly',
      });
      expect(JSON.stringify(currentBody)).not.toMatch(
        /intentHash|runId|vault|cuit|cae|token|certificate/i
      );

      const otherWorkspaceId = '99999999-9999-4999-8999-999999999999';
      const otherRequest = signedStatusRequest(otherWorkspaceId);
      const empty = await handleFacturaEAuthorityCorridorRoute(
        otherRequest.request,
        new URL(`https://tax.test${otherRequest.path}`),
        service,
        options
      );
      expect(empty?.status).toBe(200);
      expect(await empty!.json()).toEqual({ data: null });

      const crossTenant = await handleFacturaEAuthorityCorridorRoute(
        currentRequest.request,
        new URL(`https://tax.test${otherRequest.path}`),
        service,
        options
      );
      expect(crossTenant?.status).toBe(403);

      const wrongSecret = await handleFacturaEAuthorityCorridorRoute(
        signedRequest(createPath, createBody, {
          capability: 'factura-e:intent:create',
          actorId: 'motora:user-1',
          secret: approvalSecret,
        }),
        new URL(`https://tax.test${createPath}`),
        service,
        options
      );
      expect(wrongSecret?.status).toBe(403);
      expect(await wrongSecret!.json()).toEqual({
        error: 'TAX_AUTHORITY_PRINCIPAL_UNAUTHORIZED',
      });
    } finally {
      store.close();
    }
  });

  test('cancels an oversized chunked authority request before buffering it', async () => {
    const { store, service } = fixture();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(9_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const path = '/v1/authority/factura-e/intents';
    try {
      const response = await handleFacturaEAuthorityCorridorRoute(
        new Request(`https://tax.test${path}`, {
          method: 'POST',
          body: stream,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' }),
        new URL(`https://tax.test${path}`),
        service,
        {
          corridorEnabled: true,
          secrets: { motora: motoraSecret },
        },
      );
      expect(response?.status).toBe(413);
      expect(await response?.json()).toEqual({ error: 'TAX_AUTHORITY_REQUEST_TOO_LARGE' });
      expect(cancelled).toBe(true);
    } finally {
      store.close();
    }
  });
});
