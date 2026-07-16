import {
  arcaOnboardingBrowserMutationV1Schema,
  arcaOnboardingBrowserRunV1Schema,
  type ArcaOnboardingBrowserRunV1,
} from '@tax-engine/browser-contracts';

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

  async listRuns(): Promise<readonly ArcaOnboardingBrowserRunV1[]> {
    const response = await this.request(`/v1/arca-onboarding/runs?${new URLSearchParams({
      workspaceId: this.authority.workspaceId,
    })}`);
    return arcaOnboardingBrowserRunV1Schema.array().parse(response);
  }

  async createRun(input: Readonly<{
    taxpayerReference: string;
    environment: 'homologation' | 'production';
    requestedServices: readonly ('wsfex' | 'wsfe')[];
  }>): Promise<ArcaOnboardingBrowserRunV1> {
    const onboardingId = crypto.randomUUID();
    const taxpayerReferenceHash = await hashBrowserAssertion({
      purpose: 'arca_taxpayer_reference',
      workspaceId: this.authority.workspaceId,
      reference: input.taxpayerReference,
    });
    const result = arcaOnboardingBrowserMutationV1Schema.parse(await this.request('/v1/arca-onboarding/runs', {
      onboardingId,
      workspaceId: this.authority.workspaceId,
      taxpayerReferenceHash,
      environment: input.environment,
      requestedServices: input.requestedServices,
      actorId: this.authority.actorId,
      idempotencyKey: `create-${onboardingId}`,
    }));
    return result.run;
  }

  async completeLoginHandoff(run: ArcaOnboardingBrowserRunV1): Promise<ArcaOnboardingBrowserRunV1> {
    this.assertRunScope(run);
    const browserSessionReferenceHash = await hashBrowserAssertion({
      purpose: 'arca_user_controlled_login_handoff',
      onboardingId: run.onboardingId,
      nonce: crypto.randomUUID(),
    });
    return this.applyStep(run, 'login_handoff', { browserSessionReferenceHash });
  }

  async completeHumanAuth(run: ArcaOnboardingBrowserRunV1): Promise<ArcaOnboardingBrowserRunV1> {
    this.assertRunScope(run);
    const completedAt = new Date().toISOString();
    const completionReceiptHash = await hashBrowserAssertion({
      purpose: 'arca_human_auth_completion',
      onboardingId: run.onboardingId,
      workspaceId: run.workspaceId,
      revision: run.revision,
      capturePolicyHash: run.humanAuth.capturePolicyHash,
      nonce: crypto.randomUUID(),
    });
    return this.applyStep(run, 'human_auth', {
      completionReceiptHash,
      capturePolicyHash: run.humanAuth.capturePolicyHash,
      completedAt,
    });
  }

  async confirmServiceAdherence(run: ArcaOnboardingBrowserRunV1): Promise<ArcaOnboardingBrowserRunV1> {
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

  async recordPointOfSale(run: ArcaOnboardingBrowserRunV1, pointOfSale: number): Promise<ArcaOnboardingBrowserRunV1> {
    this.assertRunScope(run);
    const evidenceHash = await hashBrowserAssertion({
      kind: 'arca_point_of_sale_creation_confirmation',
      onboardingId: run.onboardingId,
      workspaceId: run.workspaceId,
      pointOfSale,
      revision: run.revision,
    });
    const result = arcaOnboardingBrowserMutationV1Schema.parse(await this.request(
      `/v1/arca-onboarding/runs/${encodeURIComponent(run.onboardingId)}/steps/point_of_sale_creation`,
      {
        actorId: this.authority.actorId,
        exportPointOfSale: pointOfSale,
        evidenceHash,
        idempotencyKey: crypto.randomUUID(),
      },
    ));
    return result.run;
  }

  async selectPointOfSale(run: ArcaOnboardingBrowserRunV1, pointOfSale: number): Promise<ArcaOnboardingBrowserRunV1> {
    this.assertRunScope(run);
    const result = arcaOnboardingBrowserMutationV1Schema.parse(await this.request(
      `/v1/arca-onboarding/runs/${encodeURIComponent(run.onboardingId)}/point-of-sale-selection`,
      {
        actorId: this.authority.actorId,
        exportPointOfSale: pointOfSale,
        idempotencyKey: crypto.randomUUID(),
      },
    ));
    return result.run;
  }

  private assertRunScope(run: ArcaOnboardingBrowserRunV1): void {
    if (run.workspaceId !== this.authority.workspaceId) throw new Error('ARCA_ONBOARDING_WORKSPACE_MISMATCH');
  }

  private async applyStep(
    run: ArcaOnboardingBrowserRunV1,
    step: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<ArcaOnboardingBrowserRunV1> {
    const result = arcaOnboardingBrowserMutationV1Schema.parse(await this.request(
      `/v1/arca-onboarding/runs/${encodeURIComponent(run.onboardingId)}/steps/${step}`,
      { ...fields, actorId: this.authority.actorId, idempotencyKey: crypto.randomUUID() },
    ));
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
