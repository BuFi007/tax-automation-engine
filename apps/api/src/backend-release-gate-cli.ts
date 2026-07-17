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
const startRevision = readGitRevision();
assertCleanWorktree();
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

const endRevision = readGitRevision();
assertCleanWorktree();
if (endRevision !== startRevision) throw new Error('BACKEND_RELEASE_REVISION_CHANGED_DURING_RUN');
const liveSmoke = await Bun.file(resolve(root, manifest.externalAuthority.liveSmokePath)).json();
const homologationFile = Bun.file(resolve(root, manifest.externalAuthority.homologationEvidencePath));
const homologationEvidence = await homologationFile.exists() ? await homologationFile.json() : null;
const report = buildBackendReleaseReportV1({
  manifest,
  revision: startRevision,
  generatedAt: new Date().toISOString(),
  suites,
  liveSmoke,
  homologationEvidence,
});

console.log(JSON.stringify(report, null, 2));

if (report.softwareState === 'failed') process.exit(1);
if (Bun.argv.includes('--software-only')) process.exit(0);
if (report.state !== 'ready_for_human_product_gate') process.exit(2);

function assertCleanWorktree(): void {
  const status = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  if (status.exitCode !== 0) throw new Error('BACKEND_RELEASE_GIT_STATUS_UNAVAILABLE');
  if (status.stdout.toString().trim()) throw new Error('BACKEND_RELEASE_DIRTY_WORKTREE');
}

function readGitRevision(): string {
  const git = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  if (git.exitCode !== 0) throw new Error('BACKEND_RELEASE_GIT_REVISION_UNAVAILABLE');
  const revision = git.stdout.toString().trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('BACKEND_RELEASE_GIT_REVISION_INVALID');
  return revision;
}
