import { resolve } from 'node:path';

import {
  assertBackendReleaseFaultEvidenceV1,
  buildBackendReleaseReportV1,
  parseBackendReleaseManifestV1,
  type BackendReleaseSuiteResultV1,
} from './backend-release-gate';

const root = resolve(import.meta.dir, '../../..');
const manifestPath = resolve(root, 'certification/backend-v1.manifest.json');
const manifest = parseBackendReleaseManifestV1(await Bun.file(manifestPath).json());
await assertBackendReleaseFaultEvidenceV1(manifest, root);
const status = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=normal'], {
  cwd: root,
  stdout: 'pipe',
  stderr: 'inherit',
});
if (status.exitCode !== 0) throw new Error('BACKEND_RELEASE_GIT_STATUS_UNAVAILABLE');
if (status.stdout.toString().trim()) throw new Error('BACKEND_RELEASE_DIRTY_WORKTREE');
const suites: BackendReleaseSuiteResultV1[] = [];

for (const suite of manifest.softwareSuites) {
  const startedAt = performance.now();
  const process = Bun.spawn(suite.command, {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...Bun.env, NODE_ENV: 'test' },
  });
  const exitCode = await process.exited;
  suites.push({
    id: suite.id,
    state: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    durationMs: Math.round(performance.now() - startedAt),
  });
  if (exitCode !== 0) break;
}

for (const suite of manifest.softwareSuites.slice(suites.length)) {
  suites.push({ id: suite.id, state: 'failed', exitCode: 125, durationMs: 0 });
}

const git = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: root, stdout: 'pipe', stderr: 'inherit' });
const revision = (await new Response(git.stdout).text()).trim();
if (await git.exited !== 0) throw new Error('BACKEND_RELEASE_GIT_REVISION_UNAVAILABLE');
const liveSmoke = await Bun.file(resolve(root, manifest.externalAuthority.liveSmokePath)).json();
const report = buildBackendReleaseReportV1({
  manifest,
  revision,
  generatedAt: new Date().toISOString(),
  suites,
  liveSmoke,
});

console.log(JSON.stringify(report, null, 2));

if (report.softwareState === 'failed') process.exit(1);
if (Bun.argv.includes('--software-only')) process.exit(0);
if (report.state !== 'ready_for_human_product_gate') process.exit(2);
