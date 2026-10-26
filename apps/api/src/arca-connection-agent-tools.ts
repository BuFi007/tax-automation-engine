import type { ArcaSetupProgressV1 } from '@tax-engine/core';
import { z } from 'zod';

import type { ArcaSetupAutomationService } from './arca-setup-automation';

/**
 * Agent tools for automated ARCA connection.
 *
 * Agent authority covers starting, reading, resuming and cancelling. It never
 * covers consent, authentication or decisions: those come only from the
 * customer through BUFI's authenticated UI. Results carry safe progress and
 * what the customer must do next; never a link, a ticket or ARCA data.
 */

const workspaceId = z.string().min(1).max(200);
const uuid = z.uuid();

const startInput = z.object({ workspaceId, onboardingId: uuid }).strict();
const statusInput = z.object({ workspaceId, executionId: uuid.optional(), onboardingId: uuid.optional() }).strict()
  .refine(value => Boolean(value.executionId) !== Boolean(value.onboardingId), { message: 'EXACTLY_ONE_REFERENCE_REQUIRED' });
const executionInput = z.object({ workspaceId, executionId: uuid }).strict();

export const ARCA_CONNECTION_AGENT_TOOL_IDS = [
  'tax_ar_arca_connection_start',
  'tax_ar_arca_connection_get_status',
  'tax_ar_arca_connection_resume',
  'tax_ar_arca_connection_cancel',
] as const;
export type ArcaConnectionAgentToolId = (typeof ARCA_CONNECTION_AGENT_TOOL_IDS)[number];

export const ARCA_CONNECTION_AGENT_TOOLS = [
  definition('tax_ar_arca_connection_start', 'Start or resume the automated ARCA connection for an existing onboarding run. BUFI then asks the customer, in the app, to authorize the setup and sign in to ARCA in a hosted browser. This never asks for or receives credentials and never issues an invoice.', z.toJSONSchema(startInput), 'user_interaction_required'),
  definition('tax_ar_arca_connection_get_status', 'Read the safe progress of an automated ARCA connection: phase, what is being done, and what the customer must do next in the BUFI app.', {
    type: 'object', additionalProperties: false, required: ['workspaceId'],
    properties: { workspaceId: { type: 'string' }, executionId: { type: 'string', format: 'uuid' }, onboardingId: { type: 'string', format: 'uuid' } },
  }, 'read_only'),
  definition('tax_ar_arca_connection_resume', 'Continue an automated ARCA connection after the customer acted in the app (authorized, signed in, chose a point of sale) or after ARCA recovered. It cannot authorize, sign in or decide on the customer\'s behalf.', z.toJSONSchema(executionInput), 'automatic'),
  definition('tax_ar_arca_connection_cancel', 'Cancel an automated ARCA connection and close its hosted browser session. Work already completed in ARCA is not undone.', z.toJSONSchema(executionInput), 'automatic'),
] as const;

export function isArcaConnectionAgentTool(toolId: string): toolId is ArcaConnectionAgentToolId {
  return (ARCA_CONNECTION_AGENT_TOOL_IDS as readonly string[]).includes(toolId);
}

export type ArcaConnectionAgentResult = Readonly<{
  progress: ArcaSetupProgressV1 | null;
  /** What to tell the customer. Fixed vocabulary, no ARCA text. */
  customerNextStep:
    | 'authorize_in_bufi'
    | 'sign_in_to_arca_in_bufi'
    | 'choose_in_bufi'
    | 'complete_proof_in_bufi'
    | 'retry_in_bufi'
    | 'wait_for_bufi'
    | 'wait_for_arca'
    | 'connected'
    | 'stopped'
    | 'none';
}>;

export async function invokeArcaConnectionAgentTool(
  toolId: ArcaConnectionAgentToolId,
  input: unknown,
  context: Readonly<{ actorId: string; idempotencyKey: string; principalWorkspaceId: string }>,
  service: ArcaSetupAutomationService | null,
): Promise<ArcaConnectionAgentResult> {
  if (!service) throw new Error('ARCA_SETUP_AUTOMATION_CONFIGURATION_REQUIRED');
  const agentActor = context.actorId.startsWith('agent:') ? context.actorId : `agent:${context.actorId}`;
  switch (toolId) {
    case 'tax_ar_arca_connection_start': {
      const parsed = startInput.parse(input);
      bind(parsed.workspaceId, context.principalWorkspaceId);
      return result(await service.start({
        onboardingId: parsed.onboardingId,
        workspaceId: parsed.workspaceId,
        startedBy: { kind: 'agent', actorId: agentActor },
        idempotencyKey: context.idempotencyKey,
      }));
    }
    case 'tax_ar_arca_connection_get_status': {
      const parsed = statusInput.parse(input);
      bind(parsed.workspaceId, context.principalWorkspaceId);
      const progress = parsed.executionId ? service.status(parsed.executionId) : service.statusForOnboarding(parsed.onboardingId!);
      if (progress) bind(progress.workspaceId, context.principalWorkspaceId);
      return result(progress);
    }
    case 'tax_ar_arca_connection_resume': {
      const parsed = executionInput.parse(input);
      bind(parsed.workspaceId, context.principalWorkspaceId);
      bind(service.status(parsed.executionId).workspaceId, context.principalWorkspaceId);
      await service.advance(parsed.executionId);
      return result(service.status(parsed.executionId));
    }
    case 'tax_ar_arca_connection_cancel': {
      const parsed = executionInput.parse(input);
      bind(parsed.workspaceId, context.principalWorkspaceId);
      bind(service.status(parsed.executionId).workspaceId, context.principalWorkspaceId);
      const cancelled = await service.cancel({ executionId: parsed.executionId, actorId: agentActor, reason: 'agent_cancelled', idempotencyKey: context.idempotencyKey });
      return result(cancelled.progress);
    }
  }
}

function bind(workspace: string, principalWorkspace: string): void {
  if (workspace !== principalWorkspace) throw new Error('TAX_AGENT_PRINCIPAL_WORKSPACE_UNAUTHORIZED');
}

function result(progress: ArcaSetupProgressV1 | null): ArcaConnectionAgentResult {
  return { progress, customerNextStep: nextStep(progress) };
}

function nextStep(progress: ArcaSetupProgressV1 | null): ArcaConnectionAgentResult['customerNextStep'] {
  if (!progress) return 'none';
  switch (progress.phase) {
    case 'awaiting_user_authorization': return 'authorize_in_bufi';
    case 'awaiting_user_authentication': return 'sign_in_to_arca_in_bufi';
    case 'awaiting_user_decision': return 'choose_in_bufi';
    case 'waiting_for_proof': return progress.blocker ? 'wait_for_bufi' : 'complete_proof_in_bufi';
    case 'recoverable_action_required': return 'retry_in_bufi';
    case 'waiting_for_propagation': return 'wait_for_arca';
    case 'connected': return 'connected';
    case 'cancelled':
    case 'failed': return 'stopped';
    default: return 'wait_for_bufi';
  }
}

function definition(name: string, description: string, parameters: Record<string, unknown>, executionPolicy: string) {
  return { type: 'function', function: { name, description, parameters }, metadata: { executionPolicy } } as const;
}
