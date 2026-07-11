import { loadMasterKey } from './crypto';
import { createBoundaryHandler } from './http';
import { ArcaBoundaryService } from './service';
import { ArcaBoundaryStore } from './store';

const port = Number(process.env.PORT ?? 4300);
const environment = process.env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
if (environment === 'production' && process.env.ARCA_BOUNDARY_PRODUCTION_APPROVED !== 'true') throw new Error('ARCA_BOUNDARY_PRODUCTION_APPROVAL_REQUIRED');
const tokens = {
  payloadWriter: requiredToken('ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN'),
  payloadResolver: requiredToken('ARCA_BOUNDARY_PAYLOAD_RESOLVE_TOKEN'),
  wsaa: requiredToken('ARCA_BOUNDARY_WSAA_TOKEN'),
  admin: requiredToken('ARCA_BOUNDARY_ADMIN_TOKEN'),
};
if (new Set(Object.values(tokens)).size !== 4) throw new Error('ARCA_BOUNDARY_TOKENS_MUST_BE_DISTINCT');
const masterKey = loadMasterKey();
const service = new ArcaBoundaryService(new ArcaBoundaryStore(masterKey));
masterKey.fill(0);
const handler = createBoundaryHandler(service, tokens, environment);

export const server = Bun.serve({
  port,
  fetch: handler,
});

function requiredToken(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(`${name}_REQUIRED`);
  return value;
}

if (import.meta.main) console.info(`ARCA authority boundary listening on port ${server.port}; environment=${environment}; secrets remain encrypted and outside agent context`);
