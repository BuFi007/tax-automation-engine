import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { readBoundedBody } from './bounded-body';
import {
  projectUaeEinvoicingOnboardingResult,
  projectUaeEinvoicingOnboardingRun,
  type UaeEinvoicingOnboardingService,
} from './uae-einvoicing-onboarding';
import {
  assertTaxTenantPrincipalScope,
  type TaxTenantPrincipalV3,
} from './tenant-principal';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const baseMutationSchema = {
  actorId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(8).max(200),
};

export async function handleUaeEinvoicingOnboardingRoute(
  request: Request,
  url: URL,
  service: UaeEinvoicingOnboardingService,
  options: Readonly<{
    enabled: boolean;
    userApprovalToken: string | null;
    evidenceIngestToken: string | null;
    tenantPrincipal?: TaxTenantPrincipalV3 | null;
  }>
): Promise<Response | null> {
  if (!/^\/v1\/uae-einvoicing-onboarding(?:\/|$)/u.test(url.pathname)) return null;
  if (!options.enabled) return json({ error: 'UAE_EINVOICING_ONBOARDING_DISABLED' }, 503);

  if (request.method === 'GET' && url.pathname.endsWith('/capabilities')) {
    return json({ data: service.capabilities() });
  }

  if (request.method === 'POST' && url.pathname.endsWith('/runs')) {
    const body = z
      .object({
        onboardingId: z.uuid(),
        workspaceId: z.string().min(1).max(200),
        taxpayerReferenceHash: sha256Schema,
        legalEntityReferenceHash: sha256Schema,
        environment: z.enum(['pilot', 'production']),
        revenueBand: z.enum([
          'aed_50m_or_more',
          'below_aed_50m',
          'government',
          'voluntary',
        ]),
        ...baseMutationSchema,
      })
      .strict()
      .parse(await boundedJson(request));
    requireUserAuthority(request, options, body.workspaceId, body.actorId);
    return json(
      {
        data: projectUaeEinvoicingOnboardingResult(
          service.createRun({ ...body, occurredAt: new Date().toISOString() })
        ),
      },
      201
    );
  }

  if (request.method === 'GET' && url.pathname.endsWith('/runs')) {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return json({ error: 'WORKSPACE_ID_REQUIRED' }, 400);
    requireWorkspaceAuthority(options, workspaceId);
    return json({
      data: service.listRuns(workspaceId).map(projectUaeEinvoicingOnboardingRun),
    });
  }

  const eventsMatch = url.pathname.match(
    /^\/v1\/uae-einvoicing-onboarding\/runs\/([^/]+)\/events$/u
  );
  if (request.method === 'GET' && eventsMatch) {
    const onboardingId = decodeURIComponent(eventsMatch[1]!);
    const run = service.getRun(onboardingId);
    requireWorkspaceAuthority(options, run.workspaceId);
    return json({
      data: {
        run: projectUaeEinvoicingOnboardingRun(run),
        events: service.listEvents(onboardingId).map(event => ({
          action: event.action,
          occurredAt: event.occurredAt,
        })),
      },
    });
  }

  const stepMatch = url.pathname.match(
    /^\/v1\/uae-einvoicing-onboarding\/runs\/([^/]+)\/steps\/([a-z_]+)$/u
  );
  if (request.method === 'POST' && stepMatch) {
    const onboardingId = decodeURIComponent(stepMatch[1]!);
    const step = stepMatch[2]!;
    const raw = await boundedJson(request);
    const occurredAt = new Date().toISOString();

    if (step === 'emaratax_asp_selection') {
      const body = z
        .object({
          ...baseMutationSchema,
          aspReferenceHash: sha256Schema,
          selectionReceiptHash: sha256Schema,
          selectedAt: z.iso.datetime({ offset: true }),
        })
        .strict()
        .parse(raw);
      const run = service.getRun(onboardingId);
      requireUserAuthority(request, options, run.workspaceId, body.actorId);
      return json({
        data: projectUaeEinvoicingOnboardingResult(
          service.applyUserCommand({
            onboardingId,
            actorId: body.actorId,
            occurredAt,
            command: {
              kind: 'record_emaratax_asp_selection',
              aspReferenceHash: body.aspReferenceHash,
              selectionReceiptHash: body.selectionReceiptHash,
              selectedAt: body.selectedAt,
              idempotencyKey: body.idempotencyKey,
            },
          })
        ),
      });
    }

    if (step === 'commercial_agreement') {
      const body = z
        .object({
          ...baseMutationSchema,
          agreementReferenceHash: sha256Schema,
          effectiveAt: z.iso.datetime({ offset: true }),
        })
        .strict()
        .parse(raw);
      const run = service.getRun(onboardingId);
      requireUserAuthority(request, options, run.workspaceId, body.actorId);
      return json({
        data: projectUaeEinvoicingOnboardingResult(
          service.applyUserCommand({
            onboardingId,
            actorId: body.actorId,
            occurredAt,
            command: {
              kind: 'record_commercial_agreement',
              agreementReferenceHash: body.agreementReferenceHash,
              effectiveAt: body.effectiveAt,
              idempotencyKey: body.idempotencyKey,
            },
          })
        ),
      });
    }

    requireTrustedToken(
      request,
      'x-tax-evidence-ingest-token',
      options.evidenceIngestToken,
      'EVIDENCE_INGEST'
    );
    const parsed = providerCommand(step, raw);
    return json({
      data: projectUaeEinvoicingOnboardingResult(
        service.applyProviderCommand({
          onboardingId,
          actorId: parsed.actorId,
          occurredAt,
          command: parsed.command,
        })
      ),
    });
  }

  const runMatch = url.pathname.match(
    /^\/v1\/uae-einvoicing-onboarding\/runs\/([^/]+)$/u
  );
  if (request.method === 'GET' && runMatch) {
    const run = service.getRun(decodeURIComponent(runMatch[1]!));
    requireWorkspaceAuthority(options, run.workspaceId);
    return json({ data: projectUaeEinvoicingOnboardingRun(run) });
  }

  return null;
}

function providerCommand(step: string, raw: unknown) {
  switch (step) {
    case 'asp_participant_registration': {
      const body = z
        .object({
          ...baseMutationSchema,
          participantReferenceHash: sha256Schema,
          registrationReceiptHash: sha256Schema,
        })
        .strict()
        .parse(raw);
      return {
        actorId: body.actorId,
        command: {
          kind: 'record_asp_participant_registration' as const,
          participantReferenceHash: body.participantReferenceHash,
          registrationReceiptHash: body.registrationReceiptHash,
          idempotencyKey: body.idempotencyKey,
        },
      };
    }
    case 'pint_ae_validation': {
      const body = z
        .object({
          ...baseMutationSchema,
          specificationVersion: z.string().regex(/^[A-Za-z0-9._-]{1,50}$/u),
          validationReceiptHash: sha256Schema,
        })
        .strict()
        .parse(raw);
      return {
        actorId: body.actorId,
        command: {
          kind: 'record_pint_ae_validation' as const,
          specificationVersion: body.specificationVersion,
          validationReceiptHash: body.validationReceiptHash,
          idempotencyKey: body.idempotencyKey,
        },
      };
    }
    case 'network_connectivity': {
      const body = z
        .object({ ...baseMutationSchema, exchangeReceiptHash: sha256Schema })
        .strict()
        .parse(raw);
      return {
        actorId: body.actorId,
        command: {
          kind: 'record_network_connectivity' as const,
          exchangeReceiptHash: body.exchangeReceiptHash,
          idempotencyKey: body.idempotencyKey,
        },
      };
    }
    case 'fta_reporting_validation': {
      const body = z
        .object({
          ...baseMutationSchema,
          reportingReceiptHash: sha256Schema,
          observedAt: z.iso.datetime({ offset: true }),
        })
        .strict()
        .parse(raw);
      return {
        actorId: body.actorId,
        command: {
          kind: 'record_fta_reporting_validation' as const,
          reportingReceiptHash: body.reportingReceiptHash,
          observedAt: body.observedAt,
          idempotencyKey: body.idempotencyKey,
        },
      };
    }
    default:
      throw new Error('UAE_EINVOICING_ONBOARDING_STEP_NOT_FOUND');
  }
}

function requireWorkspaceAuthority(
  options: Readonly<{ tenantPrincipal?: TaxTenantPrincipalV3 | null }>,
  workspaceId: string
): void {
  if (options.tenantPrincipal) {
    assertTaxTenantPrincipalScope(options.tenantPrincipal, workspaceId);
  }
}

function requireUserAuthority(
  request: Request,
  options: Readonly<{
    userApprovalToken: string | null;
    tenantPrincipal?: TaxTenantPrincipalV3 | null;
  }>,
  workspaceId: string,
  actorId: string
): void {
  if (options.tenantPrincipal) {
    assertTaxTenantPrincipalScope(options.tenantPrincipal, workspaceId, actorId);
    return;
  }
  requireTrustedToken(
    request,
    'x-tax-user-approval-token',
    options.userApprovalToken,
    'USER_APPROVAL'
  );
}

async function boundedJson(request: Request): Promise<unknown> {
  return JSON.parse(
    await readBoundedBody(
      request,
      64 * 1024,
      'UAE_EINVOICING_ONBOARDING_REQUEST_TOO_LARGE'
    )
  ) as unknown;
}

function requireTrustedToken(
  request: Request,
  header: string,
  expected: string | null,
  purpose: string
): void {
  if (!expected) throw new Error(`${purpose}_CONFIGURATION_REQUIRED`);
  const actual = request.headers.get(header);
  if (!actual || !constantTimeEqual(actual, expected)) {
    throw new Error(`${purpose}_UNAUTHORIZED`);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  );
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

