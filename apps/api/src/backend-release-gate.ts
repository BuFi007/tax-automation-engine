import {
  TAX_APPROVAL_ACTION_IDS_V1,
  TAX_READ_CAPABILITY_IDS_V1,
} from '@tax-engine/browser-contracts';
import { TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256 } from '@tax-engine/browser-contracts/fixtures';
import { TAX_BROWSER_SCENARIO_FIXTURES_V1_SHA256 } from '@tax-engine/browser-contracts/scenarios';
import { z } from 'zod';

import { validateHomologationEvidence, validateLiveWsfexSmoke } from './homologation';

const suiteSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  command: z.array(z.string().min(1)).min(2),
  proves: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1),
}).strict();

const faultIdSchema = z.enum([
  'duplicate_events',
  'reordered_events',
  'worker_kill_restart',
  'provider_429',
  'provider_timeout',
  'stale_rule_fx_model_catalogue',
  'partial_capabilities',
  'wrong_enrichment_identity',
  'graph_collision',
  'ambiguous_authority_result',
  'signer_denial',
  'accountant_rejection',
  'consent_revocation',
  'cross_tenant_access',
  'corrupted_artifact',
  'database_outage',
  'queue_replay',
  'kill_switch',
]);

export const backendReleaseManifestV1Schema = z.object({
  version: z.literal('tax-backend-release-manifest-v1'),
  issue: z.literal('BU-252'),
  contract: z.object({
    browserPackageVersion: z.string().min(1),
    goldenFixtureSha256: z.string().regex(/^[a-f0-9]{64}$/),
    scenarioFixtureSha256: z.string().regex(/^[a-f0-9]{64}$/),
    capabilityReads: z.literal(22),
    approvalAwareActions: z.literal(4),
  }).strict(),
  journeys: z.array(z.enum([
    'argentina_service_exporter',
    'us_domestic_llc',
    'us_foreign_owned_llc',
    'us_c_corporation',
    'accountant_two_client_isolation',
  ])).length(5),
  faultMatrix: z.array(faultIdSchema).length(18),
  faultEvidence: z.array(z.object({
    id: faultIdSchema,
    testFile: z.string().regex(/^(?:apps|packages)\/[a-z0-9_./-]+\.test\.tsx?$/),
    testTitle: z.string().min(10),
  }).strict()).length(18),
  softwareSuites: z.array(suiteSchema).min(5),
  externalAuthority: z.object({
    environment: z.literal('homologacion'),
    liveSmokePath: z.string().min(1),
    homologationEvidencePath: z.string().min(1),
    requiredState: z.literal('ready_for_invoice_homologation'),
    productionEnabledMustRemain: z.literal(false),
  }).strict(),
  productionInvariants: z.object({
    fixtureFallbackForbidden: z.literal(true),
    rawCredentialInputForbidden: z.literal(true),
    productionAuthorityRequiresExplicitApproval: z.literal(true),
    preparationReviewSubmissionAcceptancePaymentDistinct: z.literal(true),
  }).strict(),
}).strict().superRefine((manifest, context) => {
  for (const [path, values] of [
    ['journeys', manifest.journeys],
    ['faultMatrix', manifest.faultMatrix],
    ['faultEvidence', manifest.faultEvidence.map(evidence => evidence.id)],
    ['softwareSuites', manifest.softwareSuites.map(suite => suite.id)],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', path: [path], message: `${path} must not contain duplicates` });
    }
  }
  const evidenceIds = manifest.faultEvidence.map(evidence => evidence.id);
  if (manifest.faultMatrix.some(id => !evidenceIds.includes(id))) {
    context.addIssue({ code: 'custom', path: ['faultEvidence'], message: 'Every fault requires named test evidence' });
  }
});

export type BackendReleaseManifestV1 = z.infer<typeof backendReleaseManifestV1Schema>;
export type BackendReleaseSuiteResultV1 = Readonly<{
  id: string;
  state: 'passed' | 'failed';
  exitCode: number;
  durationMs: number;
}>;

export type BackendReleaseFaultResultV1 = Readonly<{
  id: string;
  state: 'passed' | 'failed';
  exitCode: number;
  durationMs: number;
}>;

export type BackendReleaseReportV1 = Readonly<{
  version: 'tax-backend-release-report-v1';
  issue: 'BU-252';
  revision: string;
  generatedAt: string;
  state: 'ready_for_human_product_gate' | 'software_failed' | 'external_authority_blocked';
  softwareState: 'passed' | 'failed';
  authorityState: 'ready_for_invoice_homologation' | 'blocked';
  failedGateIds: readonly string[];
  faultEvidence: readonly BackendReleaseFaultResultV1[];
  suites: readonly BackendReleaseSuiteResultV1[];
  fixtureDigests: Readonly<{ golden: string; scenarios: string }>;
  productionEnabled: false;
  limitations: readonly string[];
}>;

export function parseBackendReleaseManifestV1(input: unknown): BackendReleaseManifestV1 {
  const manifest = backendReleaseManifestV1Schema.parse(input);
  if (manifest.contract.goldenFixtureSha256 !== TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256) {
    throw new Error('BACKEND_RELEASE_GOLDEN_FIXTURE_DIGEST_MISMATCH');
  }
  if (manifest.contract.scenarioFixtureSha256 !== TAX_BROWSER_SCENARIO_FIXTURES_V1_SHA256) {
    throw new Error('BACKEND_RELEASE_SCENARIO_FIXTURE_DIGEST_MISMATCH');
  }
  if (manifest.contract.capabilityReads !== TAX_READ_CAPABILITY_IDS_V1.length) {
    throw new Error('BACKEND_RELEASE_READ_CAPABILITY_COUNT_MISMATCH');
  }
  if (manifest.contract.approvalAwareActions !== TAX_APPROVAL_ACTION_IDS_V1.length) {
    throw new Error('BACKEND_RELEASE_ACTION_CAPABILITY_COUNT_MISMATCH');
  }
  return manifest;
}

export async function assertBackendReleaseFaultEvidenceV1(
  manifest: BackendReleaseManifestV1,
  root: string,
): Promise<void> {
  for (const evidence of manifest.faultEvidence) {
    const file = Bun.file(`${root}/${evidence.testFile}`);
    if (!await file.exists()) throw new Error(`BACKEND_RELEASE_FAULT_TEST_MISSING:${evidence.id}`);
  }
}

export async function executeBackendReleaseFaultEvidenceV1(
  manifest: BackendReleaseManifestV1,
  root: string,
): Promise<BackendReleaseFaultResultV1[]> {
  const results: BackendReleaseFaultResultV1[] = [];
  for (const evidence of manifest.faultEvidence) {
    const startedAt = performance.now();
    const child = Bun.spawn(['bun', 'test', evidence.testFile, '-t', evidence.testTitle], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...Bun.env, NODE_ENV: 'test' },
    });
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    const exitCode = await child.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    const assertionPassed = `${stdout}\n${stderr}`
      .split('\n')
      .some(line => line.includes('(pass)') && line.includes(evidence.testTitle));
    const state = exitCode === 0 && assertionPassed ? 'passed' as const : 'failed' as const;
    if (state === 'failed' && stderr.trim()) console.error(stderr.trim());
    results.push({
      id: evidence.id,
      state,
      exitCode,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
  return results;
}

export type BackendReleaseJsonFileV1 = Readonly<{
  exists(): Promise<boolean>;
  json(): Promise<unknown>;
}>;

export async function readBackendReleaseJsonFileV1(
  file: BackendReleaseJsonFileV1 | null,
): Promise<unknown | null> {
  if (!file || !await file.exists()) return null;
  try {
    return await file.json();
  } catch {
    return {};
  }
}

export function buildBackendReleaseReportV1(input: Readonly<{
  manifest: BackendReleaseManifestV1;
  revision: string;
  generatedAt: string;
  faultEvidence: readonly BackendReleaseFaultResultV1[];
  suites: readonly BackendReleaseSuiteResultV1[];
  liveSmoke: unknown;
  homologationEvidence: unknown | null;
}>): BackendReleaseReportV1 {
  if (!/^[a-f0-9]{7,64}$/.test(input.revision)) throw new Error('BACKEND_RELEASE_REVISION_INVALID');
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error('BACKEND_RELEASE_GENERATED_AT_INVALID');
  const expectedSuites = input.manifest.softwareSuites.map(suite => suite.id);
  if (input.suites.length !== expectedSuites.length
    || input.suites.some((suite, index) => suite.id !== expectedSuites[index])) {
    throw new Error('BACKEND_RELEASE_SUITE_SET_MISMATCH');
  }
  const expectedFaults = input.manifest.faultEvidence.map(evidence => evidence.id);
  if (input.faultEvidence.length !== expectedFaults.length
    || input.faultEvidence.some((result, index) => result.id !== expectedFaults[index])) {
    throw new Error('BACKEND_RELEASE_FAULT_RESULT_SET_MISMATCH');
  }
  const softwareState = input.suites.every(suite => suite.state === 'passed' && suite.exitCode === 0)
    && input.faultEvidence.every(result => result.state === 'passed' && result.exitCode === 0)
    ? 'passed' as const
    : 'failed' as const;
  let authority: ReturnType<typeof validateLiveWsfexSmoke>;
  try {
    authority = validateLiveWsfexSmoke(input.liveSmoke);
  } catch {
    authority = {
      version: 'arca-wsfex-live-smoke-validation-v1',
      state: 'blocked',
      failedGateIds: ['live_smoke_invalid'],
      safeSummary: {
        authorityEnvironment: 'homologacion',
        activeFeeWsPointCount: 0,
        productionEnabled: false,
        limitation: 'The homologation smoke evidence is missing or invalid.',
      },
    };
  }
  const homologationFailedGateIds: string[] = [];
  if (input.homologationEvidence === null) {
    homologationFailedGateIds.push('homologation_evidence_missing');
  } else {
    try {
      const homologation = validateHomologationEvidence(input.homologationEvidence);
      if (homologation.state !== 'structurally_complete_for_human_production_review') {
        homologationFailedGateIds.push(...homologation.failedGateIds.map(id => `homologation:${id}`));
      }
    } catch {
      homologationFailedGateIds.push('homologation_evidence_invalid');
    }
  }
  const authorityState = authority.state === 'ready_for_invoice_homologation'
    && homologationFailedGateIds.length === 0
    ? 'ready_for_invoice_homologation' as const
    : 'blocked' as const;
  const state = softwareState === 'failed'
    ? 'software_failed' as const
    : authorityState === 'blocked'
      ? 'external_authority_blocked' as const
      : 'ready_for_human_product_gate' as const;
  const limitations = authorityState === 'blocked'
    ? ['ARCA homologation is not certified until an active FEEWS point is discovered and the complete reviewed invoice/recovery matrix is supplied.']
    : ['This backend gate does not enable production; production remains subject to explicit owner and authority approval.'];
  const softwareFailedGateIds = [
    ...input.suites
      .filter(suite => suite.state !== 'passed' || suite.exitCode !== 0)
      .map(suite => `software:${suite.id}`),
    ...input.faultEvidence
      .filter(result => result.state !== 'passed' || result.exitCode !== 0)
      .map(result => `fault:${result.id}`),
  ];
  return {
    version: 'tax-backend-release-report-v1',
    issue: 'BU-252',
    revision: input.revision,
    generatedAt: input.generatedAt,
    state,
    softwareState,
    authorityState,
    failedGateIds: [
      ...softwareFailedGateIds,
      ...authority.failedGateIds,
      ...homologationFailedGateIds,
    ],
    faultEvidence: input.faultEvidence,
    suites: input.suites,
    fixtureDigests: {
      golden: input.manifest.contract.goldenFixtureSha256,
      scenarios: input.manifest.contract.scenarioFixtureSha256,
    },
    productionEnabled: false,
    limitations,
  };
}
