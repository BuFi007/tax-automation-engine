import { hashCanonical, type FacturaEAgentRunV1 } from '@tax-engine/core';
import { z } from 'zod';

export type WsfexAuthorityResult = Readonly<{
  providerId: string;
  requestId: string;
  status: 'accepted' | 'rejected' | 'ambiguous';
  invoiceNumber: string | null;
  cae: string | null;
  reprocessed: boolean | null;
  receiptHash: string;
}>;

export interface WsfexGateway {
  readonly providerId: string;
  authorize(input: Readonly<{ run: FacturaEAgentRunV1; requestId: string; authorityPayloadRef: string }>): Promise<WsfexAuthorityResult>;
  recover(input: Readonly<{ run: FacturaEAgentRunV1; requestId: string; authorityPayloadRef: string }>): Promise<WsfexAuthorityResult>;
  authorizeAdjustment(input: Readonly<{ run: FacturaEAgentRunV1; adjustmentId: string; requestId: string; authorityPayloadRef: string }>): Promise<WsfexAuthorityResult>;
  recoverAdjustment(input: Readonly<{ run: FacturaEAgentRunV1; adjustmentId: string; requestId: string; authorityPayloadRef: string }>): Promise<WsfexAuthorityResult>;
}

type WsfexFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const moneySchema = z.object({ decimal: z.string().regex(/^\d+(?:\.\d+)?$/), currency: z.string().regex(/^[A-Z]{3,10}$/) }).strict();
const invoiceDocumentSchema = z.object({
  intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  documentType: z.literal(19),
  operationType: z.literal(2),
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  total: moneySchema,
}).strict();
const adjustmentDocumentSchema = z.object({
  intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  documentType: z.union([z.literal(20), z.literal(21)]),
  operationType: z.literal(2),
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  total: moneySchema,
  associatedDocument: z.object({
    documentType: z.literal(19),
    pointOfSale: z.number().int().positive().max(99998),
    invoiceNumber: z.string().regex(/^[1-9]\d{0,7}$/),
  }).strict(),
}).strict();
const responseSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(['accepted', 'rejected', 'ambiguous']),
  invoiceNumber: z.string().regex(/^[1-9]\d{0,7}$/).nullable(),
  cae: z.string().regex(/^\d{10,20}$/).nullable(),
  reprocessed: z.boolean().nullable(),
  authorizedDocument: z.union([invoiceDocumentSchema, adjustmentDocumentSchema]).nullable(),
  safeErrors: z.array(z.object({ code: z.string(), message: z.string() })).default([]),
}).strict();

export class HttpWsfexGateway implements WsfexGateway {
  readonly providerId = 'motora-arca-signer-v1';

  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string; environment: 'homologation' | 'production' }>,
    private readonly fetcher: WsfexFetch = (input, init) => fetch(input, init)
  ) {
    if (config.environment === 'production' && !config.baseUrl.startsWith('https://')) throw new Error('ARCA_SIGNER_HTTPS_REQUIRED');
  }

  static fromEnvironment(): HttpWsfexGateway | null {
    const baseUrl = process.env.ARCA_SIGNER_URL ?? '';
    const token = process.env.ARCA_SIGNER_TOKEN ?? '';
    const environment = process.env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
    return baseUrl && token ? new HttpWsfexGateway({ baseUrl, token, environment }) : null;
  }

  authorize(input: Readonly<{ run: FacturaEAgentRunV1; requestId: string; authorityPayloadRef: string }>): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/authorize', input);
  }

  recover(input: Readonly<{ run: FacturaEAgentRunV1; requestId: string; authorityPayloadRef: string }>): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/recover', input);
  }

  authorizeAdjustment(input: Readonly<{ run: FacturaEAgentRunV1; adjustmentId: string; requestId: string; authorityPayloadRef: string }>): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/authorize', input, input.adjustmentId);
  }

  recoverAdjustment(input: Readonly<{ run: FacturaEAgentRunV1; adjustmentId: string; requestId: string; authorityPayloadRef: string }>): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/recover', input, input.adjustmentId);
  }

  private async call(
    path: string,
    input: Readonly<{ run: FacturaEAgentRunV1; requestId: string; authorityPayloadRef: string }>,
    adjustmentId: string | null = null
  ): Promise<WsfexAuthorityResult> {
    if (!input.run.intentHash || !input.run.intent) throw new Error('FROZEN_INTENT_REQUIRED');
    if (!/^[1-9]\d{0,14}$/.test(input.requestId)) throw new Error('WSFEX_REQUEST_ID_INVALID');
    const adjustment = adjustmentId ? input.run.adjustments.find(candidate => candidate.adjustmentId === adjustmentId) : null;
    if (adjustmentId && !adjustment) throw new Error('ADJUSTMENT_NOT_FOUND');
    const intentHash = adjustment?.intentHash ?? input.run.intentHash;
    const expected = adjustment
      ? {
          documentType: adjustment.documentType,
          operationType: 2 as const,
          pointOfSale: adjustment.associatedDocument.pointOfSale,
          issueDate: adjustment.issueDate,
          total: adjustment.amount,
          associatedDocument: adjustment.associatedDocument,
        }
      : {
          documentType: 19 as const,
          operationType: 2 as const,
          pointOfSale: input.run.intent.pointOfSale,
          issueDate: input.run.intent.issueDate,
          total: input.run.intent.total,
        };
    const safeRequest = {
      version: 'motora-wsfex-boundary-v1',
      environment: this.config.environment,
      workspaceId: input.run.workspaceId,
      runId: input.run.runId,
      requestId: input.requestId,
      subjectId: adjustment?.adjustmentId ?? input.run.intent.intentId,
      intentHash,
      authorityPayloadRef: input.authorityPayloadRef,
      expected,
    };
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
          'idempotency-key': input.requestId,
        },
        body: JSON.stringify(safeRequest),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return {
        providerId: this.providerId,
        requestId: input.requestId,
        status: 'ambiguous',
        invoiceNumber: null,
        cae: null,
        reprocessed: null,
        receiptHash: hashCanonical({ requestId: input.requestId, outcome: 'network_ambiguous', errorType: error instanceof Error ? error.name : 'unknown' }),
      };
    }
    if (!response.ok) {
      const body = await response.text();
      if (response.status >= 500) {
        return {
          providerId: this.providerId,
          requestId: input.requestId,
          status: 'ambiguous',
          invoiceNumber: null,
          cae: null,
          reprocessed: null,
          receiptHash: hashCanonical({ requestId: input.requestId, status: response.status, bodyHash: hashCanonical(body) }),
        };
      }
      throw new Error(`ARCA_SIGNER_REJECTED_REQUEST_${response.status}`);
    }
    const parsed = responseSchema.parse(await response.json());
    if (parsed.requestId !== input.requestId) throw new Error('ARCA_SIGNER_REQUEST_ID_MISMATCH');
    if (parsed.status === 'accepted' && (!parsed.cae || !parsed.invoiceNumber || !parsed.authorizedDocument)) throw new Error('ARCA_SIGNER_ACCEPTED_RESULT_INCOMPLETE');
    if (parsed.authorizedDocument) {
      if (hashCanonical(parsed.authorizedDocument) !== hashCanonical({ intentHash, ...expected })) throw new Error('ARCA_SIGNER_AUTHORIZED_DOCUMENT_MISMATCH');
    }
    return {
      providerId: this.providerId,
      requestId: parsed.requestId,
      status: parsed.status,
      invoiceNumber: parsed.invoiceNumber,
      cae: parsed.cae,
      reprocessed: parsed.reprocessed,
      receiptHash: hashCanonical(parsed),
    };
  }
}
