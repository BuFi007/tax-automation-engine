import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import {
  assertBackendReleaseFaultEvidenceV1,
  buildBackendReleaseReportV1,
  parseBackendReleaseManifestV1,
} from './backend-release-gate';

const manifestUrl = new URL('../../../certification/backend-v1.manifest.json', import.meta.url);
const liveSmokeUrl = new URL('../../../providers/homologation/evidence/2026-07-14-wsfex-live-smoke.json', import.meta.url);
const root = fileURLToPath(new URL('../../..', import.meta.url));

describe('BU-252 backend release gate', () => {
  test('pins the complete journey, fault, capability and fixture manifest', async () => {
    const manifest = parseBackendReleaseManifestV1(await Bun.file(manifestUrl).json());
    expect(manifest.journeys).toHaveLength(5);
    expect(manifest.faultMatrix).toHaveLength(18);
    expect(manifest.faultMatrix).toContain('provider_429');
    expect(manifest.faultMatrix).toContain('worker_kill_restart');
    await expect(assertBackendReleaseFaultEvidenceV1(manifest, root)).resolves.toBeUndefined();
    expect(manifest.softwareSuites.map(suite => suite.id)).toEqual([
      'full_repository_check',
      'browser_contract_replay',
      'durability_isolation_and_provenance',
      'authority_and_outbox_faults',
      'jurisdiction_erp_crypto_and_factoring',
    ]);
  });

  test('rejects a fault matrix that points at an absent assertion', async () => {
    const raw = await Bun.file(manifestUrl).json() as any;
    raw.faultEvidence[0].testTitle = 'this assertion does not exist anywhere';
    const manifest = parseBackendReleaseManifestV1(raw);
    await expect(assertBackendReleaseFaultEvidenceV1(
      manifest,
      root,
    )).rejects.toThrow('BACKEND_RELEASE_FAULT_ASSERTION_MISSING:duplicate_events');
  });

  test('fails the software gate when any required suite is omitted or fails', async () => {
    const manifest = parseBackendReleaseManifestV1(await Bun.file(manifestUrl).json());
    const smoke = await Bun.file(liveSmokeUrl).json();
    const suites = manifest.softwareSuites.map((suite, index) => ({
      id: suite.id,
      state: index === 2 ? 'failed' as const : 'passed' as const,
      exitCode: index === 2 ? 1 : 0,
      durationMs: 1,
    }));
    expect(buildBackendReleaseReportV1({
      manifest,
      revision: 'a'.repeat(40),
      generatedAt: '2026-07-16T12:00:00.000Z',
      suites,
      liveSmoke: smoke,
    })).toMatchObject({ state: 'software_failed', softwareState: 'failed', productionEnabled: false });
    expect(() => buildBackendReleaseReportV1({
      manifest,
      revision: 'a'.repeat(40),
      generatedAt: '2026-07-16T12:00:00.000Z',
      suites: suites.slice(1),
      liveSmoke: smoke,
    })).toThrow('BACKEND_RELEASE_SUITE_SET_MISMATCH');
  });

  test('keeps the full release blocked on the authoritative zero-PDV smoke', async () => {
    const manifest = parseBackendReleaseManifestV1(await Bun.file(manifestUrl).json());
    const smoke = await Bun.file(liveSmokeUrl).json();
    const report = buildBackendReleaseReportV1({
      manifest,
      revision: 'b'.repeat(40),
      generatedAt: '2026-07-16T12:00:00.000Z',
      suites: manifest.softwareSuites.map(suite => ({
        id: suite.id, state: 'passed', exitCode: 0, durationMs: 1,
      })),
      liveSmoke: smoke,
    });
    expect(report).toMatchObject({
      state: 'external_authority_blocked',
      softwareState: 'passed',
      authorityState: 'blocked',
      productionEnabled: false,
    });
    expect(report.failedGateIds).toContain('feews_point_of_sale_missing');
  });

  test('becomes eligible for the human-product gate only with passing software and active homologation PDV evidence', async () => {
    const manifest = parseBackendReleaseManifestV1(await Bun.file(manifestUrl).json());
    const smoke = await Bun.file(liveSmokeUrl).json() as any;
    smoke.feeWsPointOfSale = {
      ...smoke.feeWsPointOfSale,
      activePoints: [{ number: 4 }],
      responseErrorCode: '0',
      gateState: 'ready',
    };
    const report = buildBackendReleaseReportV1({
      manifest,
      revision: 'c'.repeat(40),
      generatedAt: '2026-07-16T12:00:00.000Z',
      suites: manifest.softwareSuites.map(suite => ({
        id: suite.id, state: 'passed', exitCode: 0, durationMs: 1,
      })),
      liveSmoke: smoke,
    });
    expect(report).toMatchObject({
      state: 'ready_for_human_product_gate',
      authorityState: 'ready_for_invoice_homologation',
      productionEnabled: false,
    });
  });
});
