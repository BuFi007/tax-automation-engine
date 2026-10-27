import { createHash } from 'node:crypto';

import type { ArcaOnboardingRunV1, ArcaOnboardingStep } from '@tax-engine/core';
import { refuseRedirect } from './bounded-body';

const SOURCE = 'tax_engine';
const WORKFLOW = 'arca-credentialless-onboarding';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type WorkbenchState = 'awaiting_input' | 'succeeded' | 'skipped' | 'failed';

const STEP_LABELS: Record<ArcaOnboardingStep, string> = {
  login_handoff: 'Hand off ARCA login to the taxpayer',
  human_auth: 'Confirm credentialless human authentication',
  service_adherence: 'Confirm required ARCA services',
  point_of_sale_discovery: 'Discover active FEEWS point of sale',
  point_of_sale_creation: 'Create FEEWS point of sale',
  ws_delegation: 'Confirm revocable Web Service delegation',
  api_verification: 'Verify delegated WSFEX API access',
  zk_evidence: 'Verify privacy-preserving onboarding evidence',
  ready: 'Mark ARCA authority onboarding ready',
};

const STATE_MAP: Record<Exclude<ArcaOnboardingRunV1['steps'][number]['state'], 'pending'>, WorkbenchState> = {
  action_required: 'awaiting_input',
  completed: 'succeeded',
  skipped: 'skipped',
  failed: 'failed',
};

export interface ArcaWorkbenchPublisher {
  publish(run: ArcaOnboardingRunV1): Promise<void>;
}

/**
 * Publishes only a commitment-level projection after the canonical onboarding
 * revision has been durably stored. Taxpayer identifiers, CUIT, point-of-sale
 * values, credentials, browser state, evidence and Reclaim payloads never
 * enter this boundary.
 */
export class HttpArcaWorkbenchPublisher implements ArcaWorkbenchPublisher {
  readonly #endpoint: URL;

  constructor(
    endpoint: URL,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.#endpoint = new URL(endpoint.href);
    assertEndpoint(this.#endpoint);
    if (Buffer.byteLength(secret) < 32) throw new Error('TAX_WORKBENCH_INGEST_SECRET_REQUIRED');
  }

  static fromEnvironment(
    env: Readonly<Record<string, string | undefined>> = process.env
  ): HttpArcaWorkbenchPublisher | null {
    const endpoint = env.TAX_WORKBENCH_INGEST_URL ?? null;
    const secret = env.TAX_WORKBENCH_INGEST_SECRET ?? null;
    if (!endpoint && !secret) return null;
    if (!endpoint || !secret) throw new Error('TAX_WORKBENCH_INGEST_CONFIGURATION_REQUIRED');
    return new HttpArcaWorkbenchPublisher(new URL(endpoint), secret);
  }

  async publish(run: ArcaOnboardingRunV1): Promise<void> {
    const runId = `arca-onboarding:${hash(run.onboardingId)}`;
    const teamHash = hash(run.workspaceId);
    const entityHash = hash(run.onboardingId);

    for (const [ordinal, step] of run.steps.entries()) {
      if (step.state === 'pending') continue;
      const state = STATE_MAP[step.state];
      const occurredAt = step.completedAt ?? run.updatedAt;
      const label = STEP_LABELS[step.step];
      const eventId = `arca-event:${hash(
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
            state === 'failed'
              ? 'error'
              : step.step === 'zk_evidence'
                ? 'proof'
                : step.step === 'api_verification' || step.step === 'ready'
                  ? 'callback'
                  : 'step',
          step: {
            id: `arca-onboarding-${step.step.replaceAll('_', '-')}`,
            name: label,
            ordinal,
            state,
          },
          workflow: WORKFLOW,
          traceId: runId,
          teamHash,
          entity: { type: 'arca_onboarding', hash: entityHash },
          privacyLevel: 'commitment_only',
          summary:
            state === 'awaiting_input'
              ? `${label} requires taxpayer action`
              : state === 'succeeded'
                ? `${label} completed`
                : state === 'skipped'
                  ? `${label} skipped by the deterministic path`
                  : `${label} failed`,
          error:
            state === 'failed'
              ? { code: `ARCA_ONBOARDING_${step.step.toUpperCase()}_FAILED`, retryable: false }
              : undefined,
        }),
        signal: AbortSignal.timeout(1_500),
        redirect: 'manual',
      }).then(refuseRedirect);
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
