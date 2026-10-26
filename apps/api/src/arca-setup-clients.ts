import {
  arcaSetupCancelReceiptSchema,
  signArcaSetupMessage,
  verifyArcaSetupMessage,
  type ArcaSetupWireCancelReceipt,
  type ArcaSetupWireOrder,
} from '@tax-engine/arca-setup-contract';
import { z } from 'zod';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ArcaSetupExecutorGateway {
  dispatch(order: ArcaSetupWireOrder): Promise<'accepted' | 'duplicate' | 'busy'>;
  cancel(executionId: string, reason: 'customer_cancelled' | 'agent_cancelled' | 'superseded' | 'completed' | 'failed'): Promise<ArcaSetupWireCancelReceipt>;
  handoffUrl(executionId: string, ticket: string): string;
}

export interface ArcaSetupBoundaryGateway {
  createSession(input: Readonly<{
    executionId: string;
    onboardingId: string;
    workspaceId: string;
    environment: 'homologation' | 'production';
    taxpayerReferenceHash: string;
    issuerProfileRef: string;
    mode: 'provider_delegation' | 'customer_certificate';
  }>): Promise<Readonly<{ setupRef: string }>>;
  createEnrollment(input: Readonly<{ setupRef: string; alias: string }>): Promise<Readonly<{ enrollmentRef: string; csrHash: string }>>;
  provision(input: Readonly<{ setupRef: string; relationshipEvidenceHash: string; providerAcceptanceEvidenceHash: string | null }>): Promise<Readonly<{
    certificateFingerprint: string;
    representedCuitCommitment: string;
    delegationConfirmed: boolean;
  }>>;
  status(setupRef: string): Promise<Readonly<{ state: string; representedCuitCommitment: string | null; certificateFingerprint: string | null }>>;
}

function httpsOrigin(value: string, code: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && loopback && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash)
    throw new Error(code);
  return url.origin;
}

export class HttpArcaSetupExecutorGateway implements ArcaSetupExecutorGateway {
  readonly #origin: string;

  constructor(
    baseUrl: string,
    private readonly orderSecret: string,
    private readonly receiptSecret: string,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {
    this.#origin = httpsOrigin(baseUrl, 'ARCA_SETUP_EXECUTOR_URL_INVALID');
    if (orderSecret.length < 32 || receiptSecret.length < 32 || orderSecret === receiptSecret)
      throw new Error('ARCA_SETUP_EXECUTOR_SECRETS_INVALID');
  }

  static fromEnvironment(): HttpArcaSetupExecutorGateway | null {
    const url = process.env.ARCA_SETUP_EXECUTOR_URL;
    const order = process.env.ARCA_SETUP_ORDER_SECRET;
    const receipt = process.env.ARCA_SETUP_RECEIPT_SECRET;
    return url && order && receipt ? new HttpArcaSetupExecutorGateway(url, order, receipt) : null;
  }

  async dispatch(order: ArcaSetupWireOrder): Promise<'accepted' | 'duplicate' | 'busy'> {
    const body = JSON.stringify(order);
    let response: Response;
    try {
      response = await this.fetcher(new URL('/v1/orders', this.#origin), {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', ...(await signArcaSetupMessage(this.orderSecret, 'order', body)) },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('ARCA_SETUP_EXECUTOR_UNAVAILABLE');
    }
    const payload = await response.json().catch(() => null) as { duplicate?: boolean; error?: string } | null;
    if (response.status === 202) return payload?.duplicate ? 'duplicate' : 'accepted';
    if (response.status === 409 && payload?.error === 'ARCA_SETUP_ORDER_IN_PROGRESS') return 'busy';
    throw new Error(typeof payload?.error === 'string' && /^[A-Z0-9_]+$/.test(payload.error) ? payload.error : 'ARCA_SETUP_EXECUTOR_REJECTED');
  }

  async cancel(executionId: string, reason: Parameters<ArcaSetupExecutorGateway['cancel']>[1]): Promise<ArcaSetupWireCancelReceipt> {
    const body = JSON.stringify({ version: 'arca-setup-cancel-v1', executionId, reason, requestedAt: new Date().toISOString() });
    let response: Response;
    try {
      response = await this.fetcher(new URL('/v1/cancellations', this.#origin), {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', ...(await signArcaSetupMessage(this.orderSecret, 'cancel', body)) },
        body,
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new Error('ARCA_SETUP_EXECUTOR_UNAVAILABLE');
    }
    const text = await response.text();
    if (!response.ok) throw new Error('ARCA_SETUP_EXECUTOR_CANCEL_REJECTED');
    await verifyArcaSetupMessage(this.receiptSecret, 'cancel-receipt', response.headers, text);
    const receipt = arcaSetupCancelReceiptSchema.parse(JSON.parse(text));
    if (receipt.executionId !== executionId) throw new Error('ARCA_SETUP_EXECUTOR_CANCEL_MISMATCH');
    return receipt;
  }

  handoffUrl(executionId: string, ticket: string): string {
    const url = new URL(`/handoff/${encodeURIComponent(executionId)}`, this.#origin);
    url.searchParams.set('ticket', ticket);
    return url.toString();
  }
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export class HttpArcaSetupBoundaryGateway implements ArcaSetupBoundaryGateway {
  readonly #origin: string;

  constructor(baseUrl: string, private readonly token: string, private readonly fetcher: Fetcher = (input, init) => fetch(input, init)) {
    this.#origin = httpsOrigin(baseUrl, 'ARCA_BOUNDARY_URL_INVALID');
    if (token.length < 32) throw new Error('ARCA_BOUNDARY_SETUP_TOKEN_REQUIRED');
  }

  static fromEnvironment(): HttpArcaSetupBoundaryGateway | null {
    const url = process.env.ARCA_BOUNDARY_URL;
    const token = process.env.ARCA_BOUNDARY_SETUP_TOKEN;
    return url && token ? new HttpArcaSetupBoundaryGateway(url, token) : null;
  }

  async createSession(input: Parameters<ArcaSetupBoundaryGateway['createSession']>[0]) {
    return z.object({ setupRef: z.string().regex(/^setup:\/\/[0-9a-f-]{36}$/) }).passthrough()
      .parse(await this.post('/v1/setup/sessions', { version: 'arca-setup-session-create-v1', ...input }));
  }

  async createEnrollment(input: Parameters<ArcaSetupBoundaryGateway['createEnrollment']>[0]) {
    return z.object({ enrollmentRef: z.string().regex(/^enrollment:\/\/[0-9a-f-]{36}$/), csrHash: sha256 }).passthrough()
      .parse(await this.post('/v1/setup/sessions/enrollment', { version: 'arca-setup-enrollment-create-v1', ...input }));
  }

  async provision(input: Parameters<ArcaSetupBoundaryGateway['provision']>[0]) {
    return z.object({ certificateFingerprint: sha256, representedCuitCommitment: sha256, delegationConfirmed: z.boolean() }).passthrough()
      .parse(await this.post('/v1/setup/sessions/provision', { version: 'arca-setup-provision-v1', ...input }));
  }

  async status(setupRef: string) {
    return z.object({ state: z.string(), representedCuitCommitment: sha256.nullable(), certificateFingerprint: sha256.nullable() }).passthrough()
      .parse(await this.post('/v1/setup/sessions/status', { setupRef }));
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.#origin), {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error('ARCA_BOUNDARY_SETUP_UNAVAILABLE');
    }
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(typeof payload?.error === 'string' && /^[A-Z0-9_]+$/.test(payload.error) ? payload.error : 'ARCA_BOUNDARY_SETUP_REJECTED');
    return payload;
  }
}
