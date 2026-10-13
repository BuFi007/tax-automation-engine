import { z } from 'zod';

import { isoDateTimeSchema, safeReferenceSchema } from './primitives';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pointOfSaleSchema = z.number().int().positive().max(99_999);
const safeMetadataValueSchema = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);
const safeMetadataSchema = z
  .record(z.string().min(1).max(100), safeMetadataValueSchema)
  .superRefine((metadata, context) => {
    if (Object.keys(metadata).length > 30) {
      context.addIssue({ code: 'custom', message: 'Safe metadata is bounded to 30 fields' });
    }
  });

export const arcaOnboardingStepsV1 = [
  'login_handoff',
  'human_auth',
  'service_adherence',
  'point_of_sale_discovery',
  'point_of_sale_creation',
  'ws_delegation',
  'api_verification',
  'zk_evidence',
  'ready',
] as const;

export const arcaOnboardingStepV1Schema = z.enum(arcaOnboardingStepsV1);
export type ArcaOnboardingStepV1 = z.infer<typeof arcaOnboardingStepV1Schema>;

const arcaOnboardingStepRecordV1Schema = z
  .object({
    step: arcaOnboardingStepV1Schema,
    state: z.enum(['pending', 'action_required', 'completed', 'skipped', 'failed']),
    requiresUserAction: z.boolean(),
    requiresExplicitConfirmation: z.boolean(),
    completedAt: isoDateTimeSchema.nullable(),
    safeMetadata: safeMetadataSchema,
  })
  .strict();

const humanAuthCapturePolicyV1Schema = z
  .object({
    inspectCredentialDom: z.literal(false),
    screenshots: z.literal(false),
    clipboard: z.literal(false),
    cookies: z.literal(false),
    browserStorage: z.literal(false),
    networkBodies: z.literal(false),
    rawTraces: z.literal(false),
  })
  .strict();

export const arcaOnboardingBrowserRunV1Schema = z
  .object({
    version: z.literal('arca-onboarding-browser-run-v1'),
    onboardingId: z.string().uuid(),
    workspaceId: safeReferenceSchema,
    environment: z.enum(['homologation', 'production']),
    requestedServices: z.array(z.enum(['wsfex', 'wsfe'])).min(1).max(2),
    revision: z.number().int().positive(),
    status: z.enum(['active', 'ready', 'failed']),
    currentStep: arcaOnboardingStepV1Schema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    steps: z.array(arcaOnboardingStepRecordV1Schema).length(arcaOnboardingStepsV1.length),
    pointOfSale: z
      .object({
        number: pointOfSaleSchema.nullable(),
        source: z.enum(['discovered', 'created']).nullable(),
        active: z.boolean(),
        candidates: z.array(pointOfSaleSchema).max(100),
      })
      .strict(),
    domesticPointOfSale: z.object({ number: pointOfSaleSchema.nullable(), active: z.boolean() }).strict(),
    delegation: z.object({ wsfex: z.boolean(), wsfe: z.boolean() }).strict(),
    apiVerification: z
      .object({
        wsfex: z.boolean(),
        wsfe: z.boolean(),
        observedAt: isoDateTimeSchema.nullable(),
      })
      .strict(),
    reclaimSession: z
      .object({
        sessionRef: safeReferenceSchema,
        providerId: safeReferenceSchema,
        providerVersion: safeReferenceSchema,
        expiresAt: isoDateTimeSchema,
        state: z.enum(['pending', 'verified', 'failed', 'expired', 'cancelled']),
      })
      .strict()
      .nullable(),
    humanAuth: z
      .object({
        capturePolicy: humanAuthCapturePolicyV1Schema,
        capturePolicyHash: sha256Schema,
        startedAt: isoDateTimeSchema.nullable(),
        expiresAt: isoDateTimeSchema.nullable(),
        completedAt: isoDateTimeSchema.nullable(),
        completionRecorded: z.boolean(),
      })
      .strict(),
    zkEvidence: z
      .object({
        providerId: safeReferenceSchema,
        providerVersion: safeReferenceSchema,
        verifiedAt: isoDateTimeSchema,
        teeVerified: z.boolean(),
        custodyRecorded: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    const steps = run.steps.map(step => step.step);
    if (steps.some((step, index) => step !== arcaOnboardingStepsV1[index])) {
      context.addIssue({ code: 'custom', message: 'Onboarding steps must use canonical order' });
    }
    if (run.status === 'ready' && run.currentStep !== 'ready') {
      context.addIssue({ code: 'custom', message: 'A ready run must be on the ready step' });
    }
    if (run.pointOfSale.active !== (run.pointOfSale.number !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Active point-of-sale state must agree with the selected point',
        path: ['pointOfSale'],
      });
    }
    if (run.domesticPointOfSale.active !== (run.domesticPointOfSale.number !== null)) {
      context.addIssue({ code: 'custom', message: 'Domestic point-of-sale state must agree with its number', path: ['domesticPointOfSale'] });
    }
    if (run.humanAuth.completionRecorded !== (run.humanAuth.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Human-auth completion state must agree with completedAt',
        path: ['humanAuth'],
      });
    }
  });

export type ArcaOnboardingBrowserRunV1 = z.infer<typeof arcaOnboardingBrowserRunV1Schema>;

export const arcaOnboardingBrowserMutationV1Schema = z
  .object({
    version: z.literal('arca-onboarding-browser-mutation-v1'),
    run: arcaOnboardingBrowserRunV1Schema,
    replayed: z.boolean(),
    nextActions: z.array(z.string().regex(/^[A-Z0-9_]+$/).max(160)).max(20),
  })
  .strict();

export type ArcaOnboardingBrowserMutationV1 = z.infer<
  typeof arcaOnboardingBrowserMutationV1Schema
>;

export const arcaOnboardingBrowserReadV1Schema = z
  .object({
    version: z.literal('arca-onboarding-browser-read-v1'),
    run: arcaOnboardingBrowserRunV1Schema,
    nextActions: z.array(z.string().regex(/^[A-Z0-9_]+$/).max(160)).max(20),
  })
  .strict();

export type ArcaOnboardingBrowserReadV1 = z.infer<typeof arcaOnboardingBrowserReadV1Schema>;

const browserCapabilityUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    context.addIssue({ code: 'custom', message: 'Browser capability URLs must use HTTPS' });
  }
  if (url.username || url.password) {
    context.addIssue({ code: 'custom', message: 'Browser capability URLs cannot contain userinfo' });
  }
});

export const arcaOnboardingBrowserReclaimRequestV1Schema = z
  .object({
    version: z.literal('arca-onboarding-browser-reclaim-request-v1'),
    mutation: arcaOnboardingBrowserMutationV1Schema,
    request: z
      .object({
        sessionRef: safeReferenceSchema,
        requestUrl: browserCapabilityUrlSchema,
        statusUrl: browserCapabilityUrlSchema,
        expiresAt: isoDateTimeSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const session = receipt.mutation.run.reclaimSession;
    if (!session || session.sessionRef !== receipt.request.sessionRef) {
      context.addIssue({ code: 'custom', message: 'Reclaim request must match the projected run session' });
    }
    if (session && session.expiresAt !== receipt.request.expiresAt) {
      context.addIssue({ code: 'custom', message: 'Reclaim request expiry must match the projected run session' });
    }
  });

export type ArcaOnboardingBrowserReclaimRequestV1 = z.infer<
  typeof arcaOnboardingBrowserReclaimRequestV1Schema
>;

export const arcaOnboardingBrowserEventV1Schema = z
  .object({
    version: z.literal('arca-onboarding-browser-event-v1'),
    action: z.string().regex(/^[a-z0-9_]+$/).max(160),
    occurredAt: isoDateTimeSchema,
    safeMetadata: safeMetadataSchema,
  })
  .strict();

export const arcaOnboardingBrowserHistoryV1Schema = z
  .object({
    version: z.literal('arca-onboarding-browser-history-v1'),
    read: arcaOnboardingBrowserReadV1Schema,
    events: z.array(arcaOnboardingBrowserEventV1Schema).max(500),
  })
  .strict();

export type ArcaOnboardingBrowserHistoryV1 = z.infer<
  typeof arcaOnboardingBrowserHistoryV1Schema
>;

const internalRunSchema = z
  .object({
    onboardingId: z.string().uuid(),
    workspaceId: safeReferenceSchema,
    environment: z.enum(['homologation', 'production']),
    requestedServices: z.array(z.enum(['wsfex', 'wsfe'])).min(1).max(2),
    revision: z.number().int().positive(),
    status: z.enum(['active', 'ready', 'failed']),
    currentStep: arcaOnboardingStepV1Schema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    steps: z.array(
      z
        .object({
          step: arcaOnboardingStepV1Schema,
          state: z.enum(['pending', 'action_required', 'completed', 'skipped', 'failed']),
          requiresUserAction: z.boolean(),
          requiresExplicitConfirmation: z.boolean(),
          completedAt: isoDateTimeSchema.nullable(),
          safeMetadata: safeMetadataSchema,
        })
        .passthrough()
    ),
    pointOfSale: z
      .object({
        number: pointOfSaleSchema.nullable(),
        source: z.enum(['discovered', 'created']).nullable(),
        active: z.boolean(),
        candidates: z.array(pointOfSaleSchema).max(100).optional(),
      })
      .passthrough(),
    domesticPointOfSale: z.object({ number: pointOfSaleSchema.nullable(), active: z.boolean() }).passthrough().optional(),
    delegation: z.object({ wsfex: z.boolean(), wsfe: z.boolean() }).passthrough(),
    apiVerification: z
      .object({ wsfex: z.boolean(), wsfe: z.boolean(), observedAt: isoDateTimeSchema.nullable() })
      .passthrough(),
    reclaimSession: z
      .object({
        sessionId: safeReferenceSchema,
        providerId: safeReferenceSchema,
        providerVersion: safeReferenceSchema,
        expiresAt: isoDateTimeSchema,
        state: z.enum(['pending', 'verified', 'failed', 'expired', 'cancelled']),
      })
      .passthrough()
      .nullable(),
    humanAuth: z
      .object({
        capturePolicy: humanAuthCapturePolicyV1Schema,
        capturePolicyHash: sha256Schema,
        startedAt: isoDateTimeSchema.nullable(),
        expiresAt: isoDateTimeSchema.nullable(),
        completionReceiptHash: sha256Schema.nullable(),
        completedAt: isoDateTimeSchema.nullable(),
      })
      .passthrough(),
    zkEvidence: z
      .object({
        providerId: safeReferenceSchema,
        providerVersion: safeReferenceSchema,
        verifiedAt: isoDateTimeSchema,
        teeVerified: z.boolean(),
        custodyReceipt: z.unknown().nullable(),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

const internalEventSchema = z
  .object({
    action: z.string().regex(/^[a-z0-9_]+$/).max(160),
    occurredAt: isoDateTimeSchema,
    safeMetadata: safeMetadataSchema,
  })
  .passthrough();

/**
 * The only supported conversion from Tax's internal onboarding state to a
 * browser contract. Sensitive commitments, evidence hashes, command keys,
 * event IDs, and raw Reclaim configuration are omitted by construction.
 */
export function projectArcaOnboardingBrowserRunV1(input: unknown): ArcaOnboardingBrowserRunV1 {
  const run = internalRunSchema.parse(input);
  return arcaOnboardingBrowserRunV1Schema.parse({
    version: 'arca-onboarding-browser-run-v1',
    onboardingId: run.onboardingId,
    workspaceId: run.workspaceId,
    environment: run.environment,
    requestedServices: run.requestedServices,
    revision: run.revision,
    status: run.status,
    currentStep: run.currentStep,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    steps: run.steps.map(step => ({
      step: step.step,
      state: step.state,
      requiresUserAction: step.requiresUserAction,
      requiresExplicitConfirmation: step.requiresExplicitConfirmation,
      completedAt: step.completedAt,
      safeMetadata: step.safeMetadata,
    })),
    pointOfSale: {
      number: run.pointOfSale.number,
      source: run.pointOfSale.source,
      active: run.pointOfSale.active,
      candidates: run.pointOfSale.candidates ?? [],
    },
    domesticPointOfSale: { number: run.domesticPointOfSale?.number ?? null, active: run.domesticPointOfSale?.active ?? false },
    delegation: { wsfex: run.delegation.wsfex, wsfe: run.delegation.wsfe },
    apiVerification: {
      wsfex: run.apiVerification.wsfex,
      wsfe: run.apiVerification.wsfe,
      observedAt: run.apiVerification.observedAt,
    },
    reclaimSession: run.reclaimSession
      ? {
          sessionRef: run.reclaimSession.sessionId,
          providerId: run.reclaimSession.providerId,
          providerVersion: run.reclaimSession.providerVersion,
          expiresAt: run.reclaimSession.expiresAt,
          state: run.reclaimSession.state,
        }
      : null,
    humanAuth: {
      capturePolicy: run.humanAuth.capturePolicy,
      capturePolicyHash: run.humanAuth.capturePolicyHash,
      startedAt: run.humanAuth.startedAt,
      expiresAt: run.humanAuth.expiresAt,
      completedAt: run.humanAuth.completedAt,
      completionRecorded: run.humanAuth.completionReceiptHash !== null,
    },
    zkEvidence: run.zkEvidence
      ? {
          providerId: run.zkEvidence.providerId,
          providerVersion: run.zkEvidence.providerVersion,
          verifiedAt: run.zkEvidence.verifiedAt,
          teeVerified: run.zkEvidence.teeVerified,
          custodyRecorded: run.zkEvidence.custodyReceipt !== null,
        }
      : null,
  });
}

export function projectArcaOnboardingBrowserMutationV1(input: Readonly<{
  run: unknown;
  replayed: boolean;
  nextActions: readonly string[];
}>): ArcaOnboardingBrowserMutationV1 {
  return arcaOnboardingBrowserMutationV1Schema.parse({
    version: 'arca-onboarding-browser-mutation-v1',
    run: projectArcaOnboardingBrowserRunV1(input.run),
    replayed: input.replayed,
    nextActions: input.nextActions,
  });
}

export function projectArcaOnboardingBrowserReadV1(input: Readonly<{
  run: unknown;
  nextActions: readonly string[];
}>): ArcaOnboardingBrowserReadV1 {
  return arcaOnboardingBrowserReadV1Schema.parse({
    version: 'arca-onboarding-browser-read-v1',
    run: projectArcaOnboardingBrowserRunV1(input.run),
    nextActions: input.nextActions,
  });
}

export function projectArcaOnboardingBrowserReclaimRequestV1(input: Readonly<{
  run: unknown;
  replayed: boolean;
  nextActions: readonly string[];
  output: Readonly<{
    session: Readonly<{ sessionId: string; expiresAt: string }>;
    requestUrl: string;
    statusUrl: string;
  }>;
}>): ArcaOnboardingBrowserReclaimRequestV1 {
  return arcaOnboardingBrowserReclaimRequestV1Schema.parse({
    version: 'arca-onboarding-browser-reclaim-request-v1',
    mutation: projectArcaOnboardingBrowserMutationV1(input),
    request: {
      sessionRef: input.output.session.sessionId,
      requestUrl: input.output.requestUrl,
      statusUrl: input.output.statusUrl,
      expiresAt: input.output.session.expiresAt,
    },
  });
}

export function projectArcaOnboardingBrowserHistoryV1(input: Readonly<{
  run: unknown;
  nextActions: readonly string[];
  events: readonly unknown[];
}>): ArcaOnboardingBrowserHistoryV1 {
  return arcaOnboardingBrowserHistoryV1Schema.parse({
    version: 'arca-onboarding-browser-history-v1',
    read: projectArcaOnboardingBrowserReadV1(input),
    events: input.events.map(eventInput => {
      const event = internalEventSchema.parse(eventInput);
      return {
        version: 'arca-onboarding-browser-event-v1',
        action: event.action,
        occurredAt: event.occurredAt,
        safeMetadata: event.safeMetadata,
      };
    }),
  });
}
