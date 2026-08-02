import { createHash } from 'node:crypto';

import type {
  UaeEinvoicingOnboardingRunV1,
  UaeEinvoicingOnboardingStep,
} from '@tax-engine/core';

const SOURCE = 'tax_engine';
const WORKFLOW = 'uae-peppol-einvoicing-onboarding';

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
type WorkbenchState = 'awaiting_input' | 'succeeded' | 'failed';

const STEP_LABELS: Record<UaeEinvoicingOnboardingStep, string> = {
  emaratax_asp_selection: 'Select an accredited service provider in EmaraTax',
  commercial_agreement: 'Accept the commercial agreement with the selected provider',
  asp_participant_registration: 'Register the business as a Peppol participant',
  pint_ae_validation: 'Validate a PINT-AE invoice sample',
  network_connectivity: 'Complete the Peppol network exchange test',
  fta_reporting_validation: 'Verify FTA tax data document reporting',
  ready: 'Mark UAE eInvoicing onboarding ready',
};

export interface UaeWorkbenchPublisher {
  publish(run: UaeEinvoicingOnboardingRunV1): Promise<void>;
}

/**
 * Commitment-only UAE onboarding projection. Tax registration numbers,
 * credentials, agreements, participant identifiers, invoice samples, browser
 * state, and authority/provider response bodies never cross this boundary.
 */
export class HttpUaeWorkbenchPublisher implements UaeWorkbenchPublisher {
  readonly #endpoint: URL;

  constructor(
    endpoint: URL,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.#endpoint = new URL(endpoint.href);
    assertEndpoint(this.#endpoint);
    if (Buffer.byteLength(secret) < 32) {
      throw new Error('TAX_WORKBENCH_INGEST_SECRET_REQUIRED');
    }
  }

  static fromEnvironment(
    env: Readonly<Record<string, string | undefined>> = process.env
  ): HttpUaeWorkbenchPublisher | null {
    const endpoint = env.TAX_WORKBENCH_INGEST_URL ?? null;
    const secret = env.TAX_WORKBENCH_INGEST_SECRET ?? null;
    if (!endpoint && !secret) return null;
    if (!endpoint || !secret) {
      throw new Error('TAX_WORKBENCH_INGEST_CONFIGURATION_REQUIRED');
    }
    return new HttpUaeWorkbenchPublisher(new URL(endpoint), secret);
  }

  async publish(run: UaeEinvoicingOnboardingRunV1): Promise<void> {
    const runId = `uae-einvoicing:${hash(run.onboardingId)}`;
    const teamHash = hash(run.workspaceId);
    const entityHash = hash(run.onboardingId);

    for (const [ordinal, step] of run.steps.entries()) {
      if (step.state === 'pending') continue;
      const state: WorkbenchState =
        step.state === 'action_required'
          ? 'awaiting_input'
          : step.state === 'failed'
            ? 'failed'
            : 'succeeded';
      const occurredAt = step.completedAt ?? run.updatedAt;
      const label = STEP_LABELS[step.step];
      const eventId = `uae-einvoicing-event:${hash(
        `${SOURCE}:${runId}:${step.step}:${step.state}:${occurredAt}${
          step.state === 'action_required' ? `:r${run.revision}` : ''
        }`
      )}`;
      const response = await this.fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.secret}`,
          'content-type': 'application/json',
          'x-trace-id': runId,
          'x-workbench-run-id': runId,
        },
        body: JSON.stringify({
          version: 1,
          runId,
          eventId,
          source: SOURCE,
          product: 'tax',
          environment: run.environment === 'production' ? 'live' : 'testnet',
          mode: 'execution',
          state,
          occurredAt,
          kind:
            step.step === 'fta_reporting_validation' || step.step === 'ready'
              ? 'callback'
              : state === 'failed'
                ? 'error'
                : 'step',
          step: {
            id: `uae-einvoicing-${step.step.replaceAll('_', '-')}`,
            name: label,
            ordinal,
            state,
          },
          workflow: WORKFLOW,
          traceId: runId,
          teamHash,
          entity: { type: 'uae_einvoicing_onboarding', hash: entityHash },
          privacyLevel: 'commitment_only',
          summary:
            state === 'awaiting_input'
              ? `${label} requires business action`
              : state === 'succeeded'
                ? `${label} completed`
                : `${label} failed`,
          error:
            state === 'failed'
              ? {
                  code: `UAE_EINVOICING_${step.step.toUpperCase()}_FAILED`,
                  retryable: false,
                }
              : undefined,
        }),
        signal: AbortSignal.timeout(1_500),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('TAX_WORKBENCH_INGEST_REJECTED');
    }
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertEndpoint(endpoint: URL): void {
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('TAX_WORKBENCH_INGEST_URL_INVALID');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:')) {
    throw new Error('TAX_WORKBENCH_INGEST_HTTPS_REQUIRED');
  }
}

