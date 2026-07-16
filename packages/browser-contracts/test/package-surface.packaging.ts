import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, test } from 'bun:test';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
) as {
  version: string;
  main: string;
  types: string;
  files: string[];
  exports: Record<string, unknown>;
};

describe('published browser-contract package', () => {
  test('exposes only the frozen root and fixtures entrypoints from dist', () => {
    expect(packageJson.version).toBe('0.2.0');
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.files).toEqual(['dist', 'README.md', 'COMPATIBILITY.md']);
    expect(packageJson.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
      './fixtures': {
        types: './dist/fixtures.d.ts',
        import: './dist/fixtures.js',
      },
    });
  });

  test('ships no source, tests, configuration, or source maps', () => {
    const files = packedFiles();
    expect(files).toEqual([
      'COMPATIBILITY.md',
      'README.md',
      'dist/fixtures.d.ts',
      'dist/fixtures.js',
      'dist/index.d.ts',
      'dist/index.js',
      'package.json',
    ]);
    expect(
      files.some(
        file =>
          file.startsWith('src/') ||
          file.startsWith('test/') ||
          file.includes('.test.') ||
          file.endsWith('.map') ||
          file.includes('tsconfig') ||
          file.includes('tsup.config'),
      ),
    ).toBe(false);
  });

  test('loads in Node and preserves the built golden-fixture digest', async () => {
    const rootUrl = pathToFileURL(resolve(packageRoot, 'dist/index.js')).href;
    const fixturesUrl = pathToFileURL(resolve(packageRoot, 'dist/fixtures.js')).href;
    const rootModule = (await import(rootUrl)) as Record<string, unknown>;
    const fixturesModule = (await import(fixturesUrl)) as Record<string, unknown>;
    const goldenDigest = fixturesModule.TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256;

    expect(rootModule.taxWidgetSnapshotReceiptV1Schema).toBeDefined();
    expect(rootModule.TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256).toBeUndefined();
    expect(goldenDigest).toBe(
      '6e1856b87f25a6f6d346955ea372ae8e55c02ab0b902c9cb32901372380f299c',
    );
    if (typeof goldenDigest !== 'string') throw new Error('Built fixture digest is not a string');

    const serialized = JSON.stringify(fixturesModule.TAX_BROWSER_GOLDEN_FIXTURES_V1);
    expect(createHash('sha256').update(serialized).digest('hex')).toBe(goldenDigest);

    const node = Bun.spawnSync({
      cmd: [
        'node',
        '--input-type=module',
        '--eval',
        `const root = await import(${JSON.stringify(rootUrl)}); const fixtures = await import(${JSON.stringify(fixturesUrl)}); if (!root.taxWidgetSnapshotReceiptV1Schema || fixtures.TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256 !== '6e1856b87f25a6f6d346955ea372ae8e55c02ab0b902c9cb32901372380f299c') process.exit(1);`,
      ],
      cwd: packageRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(node.exitCode, node.stderr.toString()).toBe(0);
  });
});

function packedFiles(): string[] {
  const packed = Bun.spawnSync({
    cmd: ['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'],
    cwd: packageRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(packed.exitCode, packed.stderr.toString()).toBe(0);
  const reports = JSON.parse(packed.stdout.toString()) as Array<{
    files: Array<{ path: string }>;
  }>;
  return reports[0]!.files.map(file => file.path).sort();
}
