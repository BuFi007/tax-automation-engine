import { describe, expect, test } from 'bun:test';

import {
  applyUaeEinvoicingOnboardingCommand,
  createUaeEinvoicingOnboardingRun,
  uaeEinvoicingOnboardingNextActions,
  type UaeEinvoicingOnboardingCommand,
} from './uae-einvoicing-onboarding';

const HASHES = Array.from({ length: 20 }, (_, index) =>
  index.toString(16).padStart(64, '0')
);

describe('UAE eInvoicing authority onboarding', () => {
  test('requires the real EmaraTax and accredited-provider corridor in order', () => {
    let { run } = createRun();
    expect(run.currentStep).toBe('emaratax_asp_selection');
    expect(uaeEinvoicingOnboardingNextActions(run)).toEqual([
      'USER_SELECT_ACCREDITED_SERVICE_PROVIDER_IN_EMARATAX',
    ]);

    const commands: readonly UaeEinvoicingOnboardingCommand[] = [
      {
        kind: 'record_emaratax_asp_selection',
        aspReferenceHash: HASHES[2]!,
        selectionReceiptHash: HASHES[3]!,
        selectedAt: '2026-07-28T03:01:00.000Z',
        idempotencyKey: 'select-asp',
      },
      {
        kind: 'record_commercial_agreement',
        agreementReferenceHash: HASHES[4]!,
        effectiveAt: '2026-07-28T03:02:00.000Z',
        idempotencyKey: 'accept-agreement',
      },
      {
        kind: 'record_asp_participant_registration',
        participantReferenceHash: HASHES[5]!,
        registrationReceiptHash: HASHES[6]!,
        idempotencyKey: 'register-participant',
      },
      {
        kind: 'record_pint_ae_validation',
        specificationVersion: 'PINT-AE-1.0',
        validationReceiptHash: HASHES[7]!,
        idempotencyKey: 'validate-pint-ae',
      },
      {
        kind: 'record_network_connectivity',
        exchangeReceiptHash: HASHES[8]!,
        idempotencyKey: 'test-network',
      },
      {
        kind: 'record_fta_reporting_validation',
        reportingReceiptHash: HASHES[9]!,
        observedAt: '2026-07-28T03:06:00.000Z',
        idempotencyKey: 'verify-fta-reporting',
      },
    ];

    for (const [index, command] of commands.entries()) {
      const applied = applyUaeEinvoicingOnboardingCommand(
        run,
        command,
        index < 2 ? 'user:owner' : 'asp:verified',
        `2026-07-28T03:0${index + 1}:00.000Z`
      );
      run = applied.run;
    }

    expect(run.status).toBe('ready');
    expect(run.currentStep).toBe('ready');
    expect(run.ftaReportingValidation.reportingReceiptHash).toBe(HASHES[9]!);
    expect(uaeEinvoicingOnboardingNextActions(run)).toEqual([]);
  });

  test('cannot skip ASP selection or become ready from user assertions', () => {
    const { run } = createRun();
    expect(() =>
      applyUaeEinvoicingOnboardingCommand(
        run,
        {
          kind: 'record_fta_reporting_validation',
          reportingReceiptHash: HASHES[9]!,
          observedAt: '2026-07-28T03:06:00.000Z',
          idempotencyKey: 'forge-ready',
        },
        'user:owner',
        '2026-07-28T03:06:00.000Z'
      )
    ).toThrow('UAE_EINVOICING_ONBOARDING_STEP_OUT_OF_ORDER');
  });

  test('is idempotent and rejects private authority material mechanically', () => {
    const { run } = createRun();
    const command = {
      kind: 'record_emaratax_asp_selection' as const,
      aspReferenceHash: HASHES[2]!,
      selectionReceiptHash: HASHES[3]!,
      selectedAt: '2026-07-28T03:01:00.000Z',
      idempotencyKey: 'select-asp',
    };
    const first = applyUaeEinvoicingOnboardingCommand(
      run,
      command,
      'user:owner',
      '2026-07-28T03:01:00.000Z'
    );
    const replay = applyUaeEinvoicingOnboardingCommand(
      first.run,
      command,
      'user:owner',
      '2026-07-28T03:02:00.000Z'
    );
    expect(replay.event).toBeNull();
    expect(replay.run).toBe(first.run);

    expect(() =>
      createUaeEinvoicingOnboardingRun({
        ...createInput(),
        credentials: { password: 'never' },
      } as never)
    ).toThrow('UAE_PRIVATE_AUTHORITY_MATERIAL_FORBIDDEN');
    expect(() =>
      applyUaeEinvoicingOnboardingCommand(
        run,
        { ...command, browser_state: { cookies: 'never' } } as never,
        'user:owner',
        '2026-07-28T03:01:00.000Z'
      )
    ).toThrow('UAE_PRIVATE_AUTHORITY_MATERIAL_FORBIDDEN');
    for (const privateMaterial of [
      { browserState: { cookies: ['never'] } },
      { proofContents: 'never' },
      { invoiceSample: '<Invoice>never</Invoice>' },
      { cuit: '20123456789' },
      { credentials: { clientSecret: 'never' } },
      { ftaResponseBody: { status: 'never' } },
    ]) {
      expect(() =>
        createUaeEinvoicingOnboardingRun({
          ...createInput(),
          ...privateMaterial,
        } as never)
      ).toThrow('UAE_PRIVATE_AUTHORITY_MATERIAL_FORBIDDEN');
    }
  });
});

function createInput() {
  return {
    onboardingId: '70000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace-ae-1',
    taxpayerReferenceHash: HASHES[0]!,
    legalEntityReferenceHash: HASHES[1]!,
    environment: 'pilot' as const,
    revenueBand: 'below_aed_50m' as const,
    actorId: 'user:owner',
    occurredAt: '2026-07-28T03:00:00.000Z',
    idempotencyKey: 'create-uae-onboarding',
  };
}

function createRun() {
  return createUaeEinvoicingOnboardingRun(createInput());
}
