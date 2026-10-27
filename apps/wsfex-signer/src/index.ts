import { createWsfexSigner } from './app';

const port = Number(process.env.PORT ?? 4200);
const hostname = process.env.WSFEX_SIGNER_HOST ?? '127.0.0.1';
const signer = createWsfexSigner({
  env: process.env,
  database: process.env.WSFEX_SIGNER_DB_PATH ?? ':memory:',
});

export const server = Bun.serve({
  hostname,
  port,
  fetch: request => signer.fetch(request),
});

if (import.meta.main) {
  console.info(`WSFEX signer listening on ${hostname}:${server.port}; environment=${signer.environment}; credentials remain in vault/WSAA boundaries`);
}
