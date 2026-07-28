import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const arcaRuntimeDockerfiles = [
  'apps/api/Dockerfile',
  'apps/reclaim-proof-vault/Dockerfile',
  'apps/arca-boundary/Dockerfile',
  'apps/wsfex-signer/Dockerfile',
  'apps/wsfe-signer/Dockerfile',
] as const;

function workspaceManifests(): string[] {
  return ['apps', 'packages'].flatMap((workspaceRoot) =>
    readdirSync(resolve(repositoryRoot, workspaceRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${workspaceRoot}/${entry.name}/package.json`)
      .filter((manifest) => Bun.file(resolve(repositoryRoot, manifest)).size > 0),
  );
}

describe('ARCA runtime container build contexts', () => {
  test.each(arcaRuntimeDockerfiles)(
    '%s includes every Bun workspace manifest required by the frozen lockfile',
    (dockerfilePath) => {
      const dockerfile = readFileSync(resolve(repositoryRoot, dockerfilePath), 'utf8');

      for (const manifest of workspaceManifests()) {
        expect(dockerfile).toContain(`COPY ${manifest} ${manifest}`);
      }
    },
  );

  test('Tax Engine API image is production-mode, non-root, and durable by default', () => {
    const dockerfile = readFileSync(
      resolve(repositoryRoot, 'apps/api/Dockerfile'),
      'utf8',
    );

    expect(dockerfile).toContain('RUN bun run --filter @tax-engine/browser-contracts build');
    expect(dockerfile).toContain('ENV NODE_ENV=production');
    expect(dockerfile).toContain('ENV TAX_ENGINE_DB_PATH=/data/tax-engine.sqlite');
    expect(dockerfile).toContain('USER bun');
    expect(dockerfile).not.toContain('TAX_ENGINE_DB_PATH=:memory:');
  });
});
