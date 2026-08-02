import { createHash, randomUUID } from 'node:crypto';

import type { IsoDateTime } from './types';

export const UAE_EINVOICING_ONBOARDING_STEPS = [
  'emaratax_asp_selection',
  'commercial_agreement',
  'asp_participant_registration',
  'pint_ae_validation',
  'network_connectivity',
  'fta_reporting_validation',
  'ready',
] as const;

export type UaeEinvoicingOnboardingStep =
  (typeof UAE_EINVOICING_ONBOARDING_STEPS)[number];
export type UaeEinvoicingOnboardingEnvironment = 'pilot' | 'production';
export type UaeEinvoicingRevenueBand =
  | 'aed_50m_or_more'
  | 'below_aed_50m'
  | 'government'
  | 'voluntary';
export type UaeEinvoicingStepState =
  | 'pending'
  | 'action_required'
  | 'completed'
  | 'failed';

export type UaeEinvoicingStepRecordV1 = Readonly<{
  step: UaeEinvoicingOnboardingStep;
  state: UaeEinvoicingStepState;
  requiresUserAction: boolean;
  completedAt: IsoDateTime | null;
  receiptHashes: readonly string[];
}>;

export type UaeEinvoicingOnboardingEventV1 = Readonly<{
  version: 'uae-einvoicing-onboarding-event-v1';
  eventId: string;
  onboardingId: string;
  workspaceId: string;
  actorId: string;
  action: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>;

export type UaeEinvoicingOnboardingRunV1 = Readonly<{
  version: 'uae-einvoicing-onboarding-run-v1';
  onboardingId: string;
  workspaceId: string;
  taxpayerReferenceHash: string;
  legalEntityReferenceHash: string;
  environment: UaeEinvoicingOnboardingEnvironment;
  revenueBand: UaeEinvoicingRevenueBand;
  revision: number;
  status: 'active' | 'ready' | 'failed';
  currentStep: UaeEinvoicingOnboardingStep;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  steps: readonly UaeEinvoicingStepRecordV1[];
  aspSelection: Readonly<{
    aspReferenceHash: string | null;
    selectionReceiptHash: string | null;
    selectedAt: IsoDateTime | null;
  }>;
  commercialAgreement: Readonly<{
    agreementReferenceHash: string | null;
    effectiveAt: IsoDateTime | null;
  }>;
  participantRegistration: Readonly<{
    participantReferenceHash: string | null;
    registrationReceiptHash: string | null;
  }>;
  pintAeValidation: Readonly<{
    specificationVersion: string | null;
    validationReceiptHash: string | null;
  }>;
  networkConnectivity: Readonly<{
    exchangeReceiptHash: string | null;
  }>;
  ftaReportingValidation: Readonly<{
    reportingReceiptHash: string | null;
    observedAt: IsoDateTime | null;
  }>;
  processedCommandKeys: readonly string[];
  eventIds: readonly string[];
}>;

export type UaeEinvoicingOnboardingCommand =
  | Readonly<{
      kind: 'record_emaratax_asp_selection';
      aspReferenceHash: string;
      selectionReceiptHash: string;
      selectedAt: IsoDateTime;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_commercial_agreement';
      agreementReferenceHash: string;
      effectiveAt: IsoDateTime;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_asp_participant_registration';
      participantReferenceHash: string;
      registrationReceiptHash: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_pint_ae_validation';
      specificationVersion: string;
      validationReceiptHash: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_network_connectivity';
      exchangeReceiptHash: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_fta_reporting_validation';
      reportingReceiptHash: string;
      observedAt: IsoDateTime;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_provider_failure';
      step: Exclude<UaeEinvoicingOnboardingStep, 'ready'>;
      errorCode: string;
      idempotencyKey: string;
    }>;

export function createUaeEinvoicingOnboardingRun(
  input: Readonly<{
    onboardingId?: string;
    workspaceId: string;
    taxpayerReferenceHash: string;
    legalEntityReferenceHash: string;
    environment: UaeEinvoicingOnboardingEnvironment;
    revenueBand: UaeEinvoicingRevenueBand;
    actorId: string;
    occurredAt: IsoDateTime;
    idempotencyKey: string;
  }>
): Readonly<{
  run: UaeEinvoicingOnboardingRunV1;
  event: UaeEinvoicingOnboardingEventV1;
}> {
  assertNoPrivateAuthorityMaterial(input);
  assertHash(input.taxpayerReferenceHash, 'UAE_TAXPAYER_REFERENCE_HASH_INVALID');
  assertHash(input.legalEntityReferenceHash, 'UAE_LEGAL_ENTITY_REFERENCE_HASH_INVALID');
  const onboardingId = input.onboardingId ?? randomUUID();
  const event = createEvent(
    onboardingId,
    input.workspaceId,
    input.actorId,
    'uae_einvoicing_onboarding_created',
    input.occurredAt,
    input.idempotencyKey
  );

  return {
    run: {
      version: 'uae-einvoicing-onboarding-run-v1',
      onboardingId,
      workspaceId: input.workspaceId,
      taxpayerReferenceHash: input.taxpayerReferenceHash,
      legalEntityReferenceHash: input.legalEntityReferenceHash,
      environment: input.environment,
      revenueBand: input.revenueBand,
      revision: 1,
      status: 'active',
      currentStep: 'emaratax_asp_selection',
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      steps: UAE_EINVOICING_ONBOARDING_STEPS.map(step => ({
        step,
        state: step === 'emaratax_asp_selection' ? 'action_required' : 'pending',
        requiresUserAction:
          step === 'emaratax_asp_selection' || step === 'commercial_agreement',
        completedAt: null,
        receiptHashes: [],
      })),
      aspSelection: {
        aspReferenceHash: null,
        selectionReceiptHash: null,
        selectedAt: null,
      },
      commercialAgreement: { agreementReferenceHash: null, effectiveAt: null },
      participantRegistration: {
        participantReferenceHash: null,
        registrationReceiptHash: null,
      },
      pintAeValidation: {
        specificationVersion: null,
        validationReceiptHash: null,
      },
      networkConnectivity: { exchangeReceiptHash: null },
      ftaReportingValidation: { reportingReceiptHash: null, observedAt: null },
      processedCommandKeys: [input.idempotencyKey],
      eventIds: [event.eventId],
    },
    event,
  };
}

export function applyUaeEinvoicingOnboardingCommand(
  run: UaeEinvoicingOnboardingRunV1,
  command: UaeEinvoicingOnboardingCommand,
  actorId: string,
  occurredAt: IsoDateTime
): Readonly<{
  run: UaeEinvoicingOnboardingRunV1;
  event: UaeEinvoicingOnboardingEventV1 | null;
}> {
  assertNoPrivateAuthorityMaterial(command);
  if (run.processedCommandKeys.includes(command.idempotencyKey)) {
    return { run, event: null };
  }
  if (run.status === 'ready') throw new Error('UAE_EINVOICING_ONBOARDING_ALREADY_READY');

  if (command.kind === 'record_provider_failure') {
    if (command.step !== run.currentStep) {
      throw new Error('UAE_EINVOICING_ONBOARDING_STEP_OUT_OF_ORDER');
    }
    if (!/^UAE_[A-Z0-9_]{1,100}$/u.test(command.errorCode)) {
      throw new Error('UAE_EINVOICING_PROVIDER_ERROR_CODE_INVALID');
    }
    return revision(
      {
        ...run,
        status: 'failed',
        steps: updateStep(run.steps, command.step, {
          state: 'failed',
          completedAt: occurredAt,
        }),
      },
      command,
      actorId,
      occurredAt
    );
  }

  const expectedStep = stepForCommand(command);
  if (run.currentStep !== expectedStep) {
    throw new Error('UAE_EINVOICING_ONBOARDING_STEP_OUT_OF_ORDER');
  }
  assertCommandHashes(command);

  let next: UaeEinvoicingOnboardingRunV1;
  switch (command.kind) {
    case 'record_emaratax_asp_selection':
      next = {
        ...run,
        aspSelection: {
          aspReferenceHash: command.aspReferenceHash,
          selectionReceiptHash: command.selectionReceiptHash,
          selectedAt: command.selectedAt,
        },
      };
      break;
    case 'record_commercial_agreement':
      next = {
        ...run,
        commercialAgreement: {
          agreementReferenceHash: command.agreementReferenceHash,
          effectiveAt: command.effectiveAt,
        },
      };
      break;
    case 'record_asp_participant_registration':
      next = {
        ...run,
        participantRegistration: {
          participantReferenceHash: command.participantReferenceHash,
          registrationReceiptHash: command.registrationReceiptHash,
        },
      };
      break;
    case 'record_pint_ae_validation':
      if (!/^[A-Za-z0-9._-]{1,50}$/u.test(command.specificationVersion)) {
        throw new Error('UAE_PINT_AE_SPECIFICATION_VERSION_INVALID');
      }
      next = {
        ...run,
        pintAeValidation: {
          specificationVersion: command.specificationVersion,
          validationReceiptHash: command.validationReceiptHash,
        },
      };
      break;
    case 'record_network_connectivity':
      next = {
        ...run,
        networkConnectivity: { exchangeReceiptHash: command.exchangeReceiptHash },
      };
      break;
    case 'record_fta_reporting_validation':
      next = {
        ...run,
        ftaReportingValidation: {
          reportingReceiptHash: command.reportingReceiptHash,
          observedAt: command.observedAt,
        },
      };
      break;
  }

  return revision(completeCurrentStep(next, occurredAt), command, actorId, occurredAt);
}

export function uaeEinvoicingOnboardingNextActions(
  run: UaeEinvoicingOnboardingRunV1
): readonly string[] {
  if (run.status === 'ready') return [];
  if (run.status === 'failed') return ['RETRY_WITH_SELECTED_ACCREDITED_SERVICE_PROVIDER'];
  switch (run.currentStep) {
    case 'emaratax_asp_selection':
      return ['USER_SELECT_ACCREDITED_SERVICE_PROVIDER_IN_EMARATAX'];
    case 'commercial_agreement':
      return ['USER_ACCEPT_COMMERCIAL_AGREEMENT_WITH_SELECTED_ASP'];
    case 'asp_participant_registration':
      return ['ASP_REGISTER_PEPPOL_PARTICIPANT'];
    case 'pint_ae_validation':
      return ['ASP_VALIDATE_PINT_AE_SAMPLE'];
    case 'network_connectivity':
      return ['ASP_COMPLETE_PEPPOL_EXCHANGE_TEST'];
    case 'fta_reporting_validation':
      return ['ASP_VERIFY_FTA_TAX_DATA_DOCUMENT_REPORTING'];
    case 'ready':
      return [];
  }
}

function completeCurrentStep(
  run: UaeEinvoicingOnboardingRunV1,
  occurredAt: IsoDateTime
): UaeEinvoicingOnboardingRunV1 {
  const index = UAE_EINVOICING_ONBOARDING_STEPS.indexOf(run.currentStep);
  const nextStep = UAE_EINVOICING_ONBOARDING_STEPS[index + 1];
  const receiptHashes = receiptHashesFor(run.currentStep, run);
  let steps = updateStep(run.steps, run.currentStep, {
    state: 'completed',
    completedAt: occurredAt,
    receiptHashes,
  });
  if (nextStep) {
    steps = updateStep(steps, nextStep, {
      state: nextStep === 'ready' ? 'completed' : 'action_required',
      ...(nextStep === 'ready' ? { completedAt: occurredAt } : {}),
    });
  }
  return {
    ...run,
    steps,
    currentStep: nextStep ?? 'ready',
    status: nextStep === 'ready' || !nextStep ? 'ready' : 'active',
  };
}

function revision(
  run: UaeEinvoicingOnboardingRunV1,
  command: UaeEinvoicingOnboardingCommand,
  actorId: string,
  occurredAt: IsoDateTime
): Readonly<{
  run: UaeEinvoicingOnboardingRunV1;
  event: UaeEinvoicingOnboardingEventV1;
}> {
  const event = createEvent(
    run.onboardingId,
    run.workspaceId,
    actorId,
    command.kind,
    occurredAt,
    command.idempotencyKey
  );
  return {
    run: {
      ...run,
      revision: run.revision + 1,
      updatedAt: occurredAt,
      processedCommandKeys: [...run.processedCommandKeys, command.idempotencyKey],
      eventIds: [...run.eventIds, event.eventId],
    },
    event,
  };
}

function createEvent(
  onboardingId: string,
  workspaceId: string,
  actorId: string,
  action: string,
  occurredAt: IsoDateTime,
  idempotencyKey: string
): UaeEinvoicingOnboardingEventV1 {
  return {
    version: 'uae-einvoicing-onboarding-event-v1',
    eventId: createHash('sha256')
      .update(`${onboardingId}:${action}:${idempotencyKey}`)
      .digest('hex'),
    onboardingId,
    workspaceId,
    actorId,
    action,
    occurredAt,
    idempotencyKey,
  };
}

function stepForCommand(
  command: Exclude<
    UaeEinvoicingOnboardingCommand,
    Readonly<{ kind: 'record_provider_failure' }>
  >
): Exclude<UaeEinvoicingOnboardingStep, 'ready'> {
  switch (command.kind) {
    case 'record_emaratax_asp_selection':
      return 'emaratax_asp_selection';
    case 'record_commercial_agreement':
      return 'commercial_agreement';
    case 'record_asp_participant_registration':
      return 'asp_participant_registration';
    case 'record_pint_ae_validation':
      return 'pint_ae_validation';
    case 'record_network_connectivity':
      return 'network_connectivity';
    case 'record_fta_reporting_validation':
      return 'fta_reporting_validation';
  }
}

function receiptHashesFor(
  step: UaeEinvoicingOnboardingStep,
  run: UaeEinvoicingOnboardingRunV1
): readonly string[] {
  switch (step) {
    case 'emaratax_asp_selection':
      return requiredHashes(run.aspSelection.selectionReceiptHash);
    case 'commercial_agreement':
      return requiredHashes(run.commercialAgreement.agreementReferenceHash);
    case 'asp_participant_registration':
      return requiredHashes(run.participantRegistration.registrationReceiptHash);
    case 'pint_ae_validation':
      return requiredHashes(run.pintAeValidation.validationReceiptHash);
    case 'network_connectivity':
      return requiredHashes(run.networkConnectivity.exchangeReceiptHash);
    case 'fta_reporting_validation':
      return requiredHashes(run.ftaReportingValidation.reportingReceiptHash);
    case 'ready':
      return [];
  }
}

function requiredHashes(value: string | null): readonly string[] {
  if (!value) throw new Error('UAE_EINVOICING_AUTHORITY_RECEIPT_REQUIRED');
  return [value];
}

function updateStep(
  steps: readonly UaeEinvoicingStepRecordV1[],
  step: UaeEinvoicingOnboardingStep,
  update: Partial<UaeEinvoicingStepRecordV1>
): readonly UaeEinvoicingStepRecordV1[] {
  return steps.map(record => (record.step === step ? { ...record, ...update } : record));
}

function assertCommandHashes(command: UaeEinvoicingOnboardingCommand): void {
  for (const [key, value] of Object.entries(command)) {
    if (key.endsWith('Hash')) assertHash(value, `UAE_${key.toUpperCase()}_INVALID`);
  }
}

function assertHash(value: unknown, error: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(error);
}

function assertNoPrivateAuthorityMaterial(value: unknown): void {
  const forbidden =
    /(?:^|_)(?:trn|tin|cuit|taxpayer|credential|credentials|password|secret|token|cookie|browser|browser_state|invoice|proof|private_key|authority_payload|provider_payload|fta_response)(?:$|_)/iu;
  const visit = (input: unknown): void => {
    if (!input || typeof input !== 'object') return;
    for (const [key, nested] of Object.entries(input)) {
      const normalized = key
        .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
        .toLowerCase();
      const isCommitment = normalized.endsWith('_hash');
      if (!isCommitment && forbidden.test(normalized)) {
        throw new Error('UAE_PRIVATE_AUTHORITY_MATERIAL_FORBIDDEN');
      }
      visit(nested);
    }
  };
  visit(value);
}
