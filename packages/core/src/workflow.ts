import { createHash, randomUUID } from 'node:crypto';

import type { PreparationState, SatisfactionState, SubmissionState, TaxAgentEvent, TaxAuthorityReceipt, TaxObligation } from './types';

export type WorkflowCommand =
  | Readonly<{ kind: 'start_preparation'; obligationId: string; idempotencyKey: string }>
  | Readonly<{ kind: 'request_accountant_review'; obligationId: string; idempotencyKey: string }>
  | Readonly<{ kind: 'approve_by_accountant'; obligationId: string; idempotencyKey: string }>
  | Readonly<{ kind: 'record_user_approved_submission'; obligationId: string; idempotencyKey: string }>
  | Readonly<{ kind: 'ingest_verified_receipt'; obligationId: string; receipt: TaxAuthorityReceipt; idempotencyKey: string }>
  | Readonly<{ kind: 'mark_satisfied'; obligationId: string; idempotencyKey: string }>;

export type ComplianceWorkspaceState = Readonly<{
  workspaceId: string;
  obligations: readonly TaxObligation[];
  receipts: readonly TaxAuthorityReceipt[];
  events: readonly TaxAgentEvent[];
  processedCommandKeys: readonly string[];
}>;

export function applyWorkflowCommand(
  state: ComplianceWorkspaceState,
  command: WorkflowCommand,
  actorId: string,
  occurredAt: string
): ComplianceWorkspaceState {
  if (state.processedCommandKeys.includes(command.idempotencyKey)) return state;
  const current = state.obligations.find(obligation => obligation.id === command.obligationId);
  if (!current) throw new Error('Unknown obligation');

  let preparationState: PreparationState = current.preparationState;
  let submissionState: SubmissionState = current.submissionState;
  let satisfactionState: SatisfactionState = current.satisfactionState;
  let receipts = state.receipts;

  switch (command.kind) {
    case 'start_preparation':
      preparationState = 'in_progress';
      break;
    case 'request_accountant_review':
      if (preparationState !== 'in_progress' && preparationState !== 'ready_for_review') throw new Error('Preparation is not reviewable');
      preparationState = 'under_accountant_review';
      break;
    case 'approve_by_accountant':
      if (preparationState !== 'under_accountant_review') throw new Error('Accountant review has not started');
      preparationState = 'accountant_approved';
      submissionState = 'ready_for_submission';
      break;
    case 'record_user_approved_submission':
      if (preparationState !== 'accountant_approved' || submissionState !== 'ready_for_submission') throw new Error('Submission is not approved');
      submissionState = 'submitted';
      break;
    case 'ingest_verified_receipt':
      if (command.receipt.workspaceId !== state.workspaceId || command.receipt.obligationId !== current.id || !command.receipt.verifiedAt) {
        throw new Error('Receipt is not verified for this workspace obligation');
      }
      if (submissionState !== 'submitted' && submissionState !== 'authority_receipt_pending') throw new Error('No submission awaits a receipt');
      submissionState = command.receipt.status === 'accepted' ? 'accepted' : command.receipt.status === 'rejected' ? 'rejected' : 'authority_receipt_pending';
      receipts = [...receipts, command.receipt];
      break;
    case 'mark_satisfied':
      if (submissionState !== 'accepted') throw new Error('Acceptance is required before satisfaction');
      satisfactionState = 'satisfied';
      break;
  }

  const obligations = state.obligations.map(obligation =>
    obligation.id === current.id ? { ...obligation, preparationState, submissionState, satisfactionState } : obligation
  );
  const event: TaxAgentEvent = {
    eventId: randomUUID(),
    workspaceId: state.workspaceId,
    actorId,
    action: command.kind,
    outcome: 'succeeded',
    correlationId: createHash('sha256').update(command.idempotencyKey).digest('hex').slice(0, 24),
    consentVersion: null,
    ruleVersionIds: current.ruleVersionIds,
    occurredAt,
    safeMetadata: { obligationId: current.id },
  };
  return {
    workspaceId: state.workspaceId,
    obligations,
    receipts,
    events: [...state.events, event],
    processedCommandKeys: [...state.processedCommandKeys, command.idempotencyKey],
  };
}
