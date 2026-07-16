import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    fixtures: 'src/fixtures.ts',
    'scenario-fixtures': 'src/scenario-fixtures.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  treeshake: true,
  splitting: false,
  external: ['decimal.js', 'zod'],
});
