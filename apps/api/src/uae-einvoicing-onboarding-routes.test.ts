import { describe, expect, test } from 'bun:test';

import { TaxProfileStore } from './store';
import { UaeEinvoicingOnboardingService } from './uae-einvoicing-onboarding';
import { handleUaeEinvoicingOnboardingRoute } from './uae-einvoicing-onboarding-routes';

const USER_TOKEN = 'uae-user-approval-token';
const EVIDENCE_TOKEN = 'uae-provider-evidence-token';
const ONBOARDING_ID = '70000000-0000-4000-8000-000000000011';
const WORKSPACE_ID = 'workspace-ae-1';
const HASHES = Array.from({ length: 20 }, (_, index) =>
  index.toString(16).padStart(64, '0')
);

describe('UAE eInvoicing onboarding HTTP boundary', () => {
  test('is dark by default and never persists a disabled request', async () => {
    const store = new TaxProfileStore(':memory:');
    const response = await handle(
      store,
      jsonRequest('/v1/uae-einvoicing-onboarding/runs', createBody()),
      { enabled: false }
    );
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: 'UAE_EINVOICING_ONBOARDING_DISABLED',
    });
    expect(store.getUaeEinvoicingOnboardingRun(ONBOARDING_ID)).toBeNull();
  });

  test('strictly rejects TRNs, credentials, browser state, and invoice contents', async () => {
    const forbidden = [
      ['trn', '100000000000003'],
      ['credentials', { password: 'never' }],
      ['browserState', { cookies: 'never' }],
      ['invoice', { buyer: 'never' }],
      ['proof', { contents: 'never' }],
    ] as const;
    for (const [field, value] of forbidden) {
      const store = new TaxProfileStore(':memory:');
      await expect(
        handle(
          store,
          jsonRequest('/v1/uae-einvoicing-onboarding/runs', {
            ...createBody(),
            [field]: value,
          })
        )
      ).rejects.toThrow();
      expect(store.getUaeEinvoicingOnboardingRun(ONBOARDING_ID)).toBeNull();
    }
  });

  test('requires provider evidence and reaches ready only after FTA reporting validation', async () => {
    const store = new TaxProfileStore(':memory:');
    const create = await handle(
      store,
      jsonRequest('/v1/uae-einvoicing-onboarding/runs', createBody())
    );
    expect(create?.status).toBe(201);
    expect(JSON.stringify(await create?.json())).not.toMatch(
      /taxpayerReferenceHash|legalEntityReferenceHash|ReceiptHash|processedCommandKeys|eventIds/
    );

    const commands = [
      [
        'emaratax_asp_selection',
        {
          actorId: 'user:owner',
          idempotencyKey: 'select-accredited-asp',
          aspReferenceHash: HASHES[2],
          selectionReceiptHash: HASHES[3],
          selectedAt: '2026-07-28T04:01:00.000Z',
        },
        true,
      ],
      [
        'commercial_agreement',
        {
          actorId: 'user:owner',
          idempotencyKey: 'accept-asp-agreement',
          agreementReferenceHash: HASHES[4],
          effectiveAt: '2026-07-28T04:02:00.000Z',
        },
        true,
      ],
      [
        'asp_participant_registration',
        {
          actorId: 'asp:verified',
          idempotencyKey: 'register-peppol-participant',
          participantReferenceHash: HASHES[5],
          registrationReceiptHash: HASHES[6],
        },
        false,
      ],
      [
        'pint_ae_validation',
        {
          actorId: 'asp:verified',
          idempotencyKey: 'validate-pint-ae-sample',
          specificationVersion: 'PINT-AE-1.0',
          validationReceiptHash: HASHES[7],
        },
        false,
      ],
      [
        'network_connectivity',
        {
          actorId: 'asp:verified',
          idempotencyKey: 'complete-network-test',
          exchangeReceiptHash: HASHES[8],
        },
        false,
      ],
      [
        'fta_reporting_validation',
        {
          actorId: 'asp:verified',
          idempotencyKey: 'verify-fta-reporting',
          reportingReceiptHash: HASHES[9],
          observedAt: '2026-07-28T04:06:00.000Z',
        },
        false,
      ],
    ] as const;

    await expect(
      handle(
        store,
        jsonRequest(
          `/v1/uae-einvoicing-onboarding/runs/${ONBOARDING_ID}/steps/asp_participant_registration`,
          commands[2][1],
          { 'x-tax-user-approval-token': USER_TOKEN }
        )
      )
    ).rejects.toThrow('EVIDENCE_INGEST_UNAUTHORIZED');

    for (const [step, body, userAction] of commands) {
      const response = await handle(
        store,
        jsonRequest(
          `/v1/uae-einvoicing-onboarding/runs/${ONBOARDING_ID}/steps/${step}`,
          body,
          userAction
            ? { 'x-tax-user-approval-token': USER_TOKEN }
            : { 'x-tax-evidence-ingest-token': EVIDENCE_TOKEN }
        )
      );
      expect(response?.status).toBe(200);
      expect(JSON.stringify(await response?.json())).not.toMatch(
        /ReferenceHash|ReceiptHash|processedCommandKeys|eventIds/
      );
    }

    const run = store.getUaeEinvoicingOnboardingRun(ONBOARDING_ID);
    expect(run?.status).toBe('ready');
    expect(run?.currentStep).toBe('ready');
    expect(run?.ftaReportingValidation.reportingReceiptHash).toBe(HASHES[9]!);
  });
});

function handle(
  store: TaxProfileStore,
  request: Request,
  overrides: Partial<{
    enabled: boolean;
    userApprovalToken: string | null;
    evidenceIngestToken: string | null;
  }> = {}
) {
  return handleUaeEinvoicingOnboardingRoute(
    request,
    new URL(request.url),
    new UaeEinvoicingOnboardingService(store),
    {
      enabled: true,
      userApprovalToken: USER_TOKEN,
      evidenceIngestToken: EVIDENCE_TOKEN,
      ...overrides,
    }
  );
}

function createBody() {
  return {
    onboardingId: ONBOARDING_ID,
    workspaceId: WORKSPACE_ID,
    taxpayerReferenceHash: HASHES[0],
    legalEntityReferenceHash: HASHES[1],
    environment: 'pilot',
    revenueBand: 'below_aed_50m',
    actorId: 'user:owner',
    idempotencyKey: 'create-uae-einvoicing-run',
  };
}

function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {
    'x-tax-user-approval-token': USER_TOKEN,
  }
): Request {
  return new Request(`https://tax.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
