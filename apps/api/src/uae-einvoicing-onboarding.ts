import {
  applyUaeEinvoicingOnboardingCommand,
  createUaeEinvoicingOnboardingRun,
  hashCanonical,
  uaeEinvoicingOnboardingNextActions,
  type UaeEinvoicingOnboardingCommand,
  type UaeEinvoicingOnboardingEventV1,
  type UaeEinvoicingOnboardingRunV1,
} from '@tax-engine/core';

import type { TaxProfileStore } from './store';
import type { UaeWorkbenchPublisher } from './uae-workbench';

export type UaeEinvoicingOnboardingMutationResult = Readonly<{
  run: UaeEinvoicingOnboardingRunV1;
  replayed: boolean;
  nextActions: readonly string[];
}>;

export type UserUaeEinvoicingCommand = Extract<
  UaeEinvoicingOnboardingCommand,
  Readonly<
    | { kind: 'record_emaratax_asp_selection' }
    | { kind: 'record_commercial_agreement' }
  >
>;

export type ProviderUaeEinvoicingCommand = Exclude<
  UaeEinvoicingOnboardingCommand,
  UserUaeEinvoicingCommand
>;

export class UaeEinvoicingOnboardingService {
  private workbenchPublishTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: TaxProfileStore,
    private readonly workbench: UaeWorkbenchPublisher | null = null
  ) {}

  capabilities(): Readonly<Record<string, unknown>> {
    return {
      version: 'uae-einvoicing-onboarding-capabilities-v1',
      authority: 'UAE Federal Tax Authority',
      network: 'Peppol 4-corner through a UAE accredited service provider',
      officialPortal: 'https://eservices.tax.gov.ae/',
      deterministicSteps: [
        'emaratax_asp_selection',
        'commercial_agreement',
        'asp_participant_registration',
        'pint_ae_validation',
        'network_connectivity',
        'fta_reporting_validation',
        'ready',
      ],
      invariants: [
        'desk_and_tax_engine_never_collect_emaratax_credentials',
        'business_selects_its_accredited_service_provider_in_emaratax',
        'provider_receipts_are_required_for_registration_validation_and_reporting',
        'ready_requires_verified_fta_reporting_validation',
      ],
    };
  }

  createRun(
    input: Parameters<typeof createUaeEinvoicingOnboardingRun>[0]
  ): UaeEinvoicingOnboardingMutationResult {
    const onboardingId = input.onboardingId;
    if (!onboardingId) throw new Error('UAE_EINVOICING_ONBOARDING_ID_REQUIRED');
    const replay = this.store.getUaeEinvoicingOnboardingRunByIdempotency(
      onboardingId,
      input.idempotencyKey
    );
    if (replay) return result(replay, true);
    if (this.store.getUaeEinvoicingOnboardingRun(onboardingId)) {
      throw new Error('UAE_EINVOICING_ONBOARDING_ALREADY_EXISTS');
    }
    const created = createUaeEinvoicingOnboardingRun(input);
    return result(this.persist(created.run, created.event, input.occurredAt), false);
  }

  getRun(onboardingId: string): UaeEinvoicingOnboardingRunV1 {
    const run = this.store.getUaeEinvoicingOnboardingRun(onboardingId);
    if (!run) throw new Error('UAE_EINVOICING_ONBOARDING_NOT_FOUND');
    return run;
  }

  listRuns(workspaceId: string): readonly UaeEinvoicingOnboardingRunV1[] {
    return this.store.listUaeEinvoicingOnboardingRuns(workspaceId);
  }

  listEvents(
    onboardingId: string
  ): readonly UaeEinvoicingOnboardingEventV1[] {
    return this.store.listUaeEinvoicingOnboardingEvents(onboardingId);
  }

  applyUserCommand(input: Readonly<{
    onboardingId: string;
    command: UserUaeEinvoicingCommand;
    actorId: string;
    occurredAt: string;
  }>): UaeEinvoicingOnboardingMutationResult {
    return this.apply(input);
  }

  applyProviderCommand(input: Readonly<{
    onboardingId: string;
    command: ProviderUaeEinvoicingCommand;
    actorId: string;
    occurredAt: string;
  }>): UaeEinvoicingOnboardingMutationResult {
    return this.apply(input);
  }

  private apply(input: Readonly<{
    onboardingId: string;
    command: UaeEinvoicingOnboardingCommand;
    actorId: string;
    occurredAt: string;
  }>): UaeEinvoicingOnboardingMutationResult {
    const replay = this.store.getUaeEinvoicingOnboardingRunByIdempotency(
      input.onboardingId,
      input.command.idempotencyKey
    );
    if (replay) return result(replay, true);
    const applied = applyUaeEinvoicingOnboardingCommand(
      this.getRun(input.onboardingId),
      input.command,
      input.actorId,
      input.occurredAt
    );
    if (!applied.event) return result(applied.run, true);
    return result(
      this.persist(applied.run, applied.event, input.occurredAt),
      false
    );
  }

  private persist(
    run: UaeEinvoicingOnboardingRunV1,
    event: UaeEinvoicingOnboardingEventV1,
    appendedAt: string
  ): UaeEinvoicingOnboardingRunV1 {
    const persisted = this.store.appendUaeEinvoicingOnboardingRevision({
      run,
      event,
      stateHash: hashCanonical(run),
      appendedAt,
    });
    if (this.workbench) {
      this.workbenchPublishTail = this.workbenchPublishTail
        .then(() => this.workbench?.publish(persisted))
        .then(() => undefined)
        .catch(() => undefined);
    }
    return persisted;
  }
}

export function projectUaeEinvoicingOnboardingResult(
  mutation: UaeEinvoicingOnboardingMutationResult
): Readonly<Record<string, unknown>> {
  return {
    version: 'uae-einvoicing-onboarding-browser-mutation-v1',
    run: projectUaeEinvoicingOnboardingRun(mutation.run),
    replayed: mutation.replayed,
    nextActions: mutation.nextActions,
  };
}

export function projectUaeEinvoicingOnboardingRun(
  run: UaeEinvoicingOnboardingRunV1
): Readonly<Record<string, unknown>> {
  return {
    version: 'uae-einvoicing-onboarding-browser-run-v1',
    onboardingId: run.onboardingId,
    environment: run.environment,
    status: run.status,
    currentStep: run.currentStep,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    steps: run.steps.map(step => ({
      step: step.step,
      state: step.state,
      requiresUserAction: step.requiresUserAction,
      completedAt: step.completedAt,
    })),
  };
}

function result(
  run: UaeEinvoicingOnboardingRunV1,
  replayed: boolean
): UaeEinvoicingOnboardingMutationResult {
  return {
    run,
    replayed,
    nextActions: uaeEinvoicingOnboardingNextActions(run),
  };
}

