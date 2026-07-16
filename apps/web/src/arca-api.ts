import type { ArcaOnboardingRunV1 } from '@tax-engine/core';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4100';

export type ArcaOnboardingBrowserAuthority = Readonly<{
  workspaceId: string;
  actorId: string;
  principal: string;
  signature: string;
}>;

export class ArcaOnboardingApiClient {
  constructor(
    private readonly authority: ArcaOnboardingBrowserAuthority,
    private readonly apiUrl = API_URL,
  ) {}

  async listRuns(): Promise<readonly ArcaOnboardingRunV1[]> {
    const response = await this.request(`/v1/arca-onboarding/runs?${new URLSearchParams({
      workspaceId: this.authority.workspaceId,
    })}`);
    return response as readonly ArcaOnboardingRunV1[];
  }

  async createRun(input: Readonly<{
    taxpayerReference: string;
    environment: 'homologation' | 'production';
    requestedServices: readonly ('wsfex' | 'wsfe')[];
  }>): Promise<ArcaOnboardingRunV1> {
    const onboardingId = crypto.randomUUID();
    const taxpayerReferenceHash = await hashBrowserAssertion({
      purpose: 'arca_taxpayer_reference',
      workspaceId: this.authority.workspaceId,
      reference: input.taxpayerReference,
    });
    const result = await this.request('/v1/arca-onboarding/runs', {
      onboardingId,
      workspaceId: this.authority.workspaceId,
      taxpayerReferenceHash,
      environment: input.environment,
      requestedServices: input.requestedServices,
      actorId: this.authority.actorId,
      idempotencyKey: `create-${onboardingId}`,
    }) as { run: ArcaOnboardingRunV1 };
    return result.run;
  }

  async completeLoginHandoff(run: ArcaOnboardingRunV1): Promise<ArcaOnboardingRunV1> {
    this.assertRunScope(run);
    const browserSessionReferenceHash = await hashBrowserAssertion({
      purpose: 'arca_user_controlled_login_handoff',
      onboardingId: run.onboardingId,
      nonce: crypto.randomUUID(),
    });
    return this.applyStep(run, 'login_handoff', { browserSessionReferenceHash });
  }

  async confirmServiceAdherence(run: ArcaOnboardingRunV1): Promise<ArcaOnboardingRunV1> {
    this.assertRunScope(run);
    const evidenceHash = await hashBrowserAssertion({
      kind: 'arca_service_adherence_user_confirmation',
      onboardingId: run.onboardingId,
      workspaceId: run.workspaceId,
      revision: run.revision,
    });
    return this.applyStep(run, 'service_adherence', {
      pointOfSaleAdministrationActive: true,
      relationshipManagerActive: true,
      evidenceHash,
    });
  }

  async recordPointOfSale(run: ArcaOnboardingRunV1, pointOfSale: number): Promise<ArcaOnboardingRunV1> {
    this.assertRunScope(run);
    const evidenceHash = await hashBrowserAssertion({
      kind: 'arca_point_of_sale_creation_confirmation',
      onboardingId: run.onboardingId,
      workspaceId: run.workspaceId,
      pointOfSale,
      revision: run.revision,
    });
    const result = await this.request(
      `/v1/arca-onboarding/runs/${encodeURIComponent(run.onboardingId)}/steps/point_of_sale_creation`,
      {
        actorId: this.authority.actorId,
        exportPointOfSale: pointOfSale,
        evidenceHash,
        idempotencyKey: crypto.randomUUID(),
      },
    ) as { run: ArcaOnboardingRunV1 };
    return result.run;
  }

  async selectPointOfSale(run: ArcaOnboardingRunV1, pointOfSale: number): Promise<ArcaOnboardingRunV1> {
    this.assertRunScope(run);
    const result = await this.request(
      `/v1/arca-onboarding/runs/${encodeURIComponent(run.onboardingId)}/point-of-sale-selection`,
      {
        actorId: this.authority.actorId,
        exportPointOfSale: pointOfSale,
        idempotencyKey: crypto.randomUUID(),
      },
    ) as { run: ArcaOnboardingRunV1 };
    return result.run;
  }

  private assertRunScope(run: ArcaOnboardingRunV1): void {
    if (run.workspaceId !== this.authority.workspaceId) throw new Error('ARCA_ONBOARDING_WORKSPACE_MISMATCH');
  }

  private async applyStep(
    run: ArcaOnboardingRunV1,
    step: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<ArcaOnboardingRunV1> {
    const result = await this.request(
      `/v1/arca-onboarding/runs/${encodeURIComponent(run.onboardingId)}/steps/${step}`,
      { ...fields, actorId: this.authority.actorId, idempotencyKey: crypto.randomUUID() },
    ) as { run: ArcaOnboardingRunV1 };
    return result.run;
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-tax-tenant-principal': this.authority.principal,
        'x-tax-tenant-signature': this.authority.signature,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json() as { data?: unknown; error?: string };
    if (!response.ok || payload.data === undefined) {
      throw new Error(payload.error ?? `ARCA onboarding request failed (${response.status})`);
    }
    return payload.data;
  }
}

async function hashBrowserAssertion(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
