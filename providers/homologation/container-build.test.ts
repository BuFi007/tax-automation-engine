import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const trustBoundaryDockerfiles = [
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

describe('ARCA trust-boundary container build contexts', () => {
  test.each(trustBoundaryDockerfiles)(
    '%s includes every Bun workspace manifest required by the frozen lockfile',
    (dockerfilePath) => {
      const dockerfile = readFileSync(resolve(repositoryRoot, dockerfilePath), 'utf8');

      for (const manifest of workspaceManifests()) {
        expect(dockerfile).toContain(`COPY ${manifest} ${manifest}`);
      }
    },
  );
});
