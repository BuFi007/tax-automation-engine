import {
  loadMasterKey,
  loadRepresentedCuitCommitmentKey,
  loadTaxpayerReferenceKey,
} from './crypto';
import { AfipSdkWsaaLoginClient } from './afipsdk-wsaa';
import { createBoundaryHandler } from './http';
import { ArcaBoundaryService } from './service';
import { ArcaBoundaryStore } from './store';

const port = Number(process.env.PORT ?? 4300);
const hostname = process.env.ARCA_BOUNDARY_HOST ?? '127.0.0.1';
const environment = parseArcaEnvironment(process.env.ARCA_ENVIRONMENT);
if (environment === 'production' && process.env.ARCA_BOUNDARY_PRODUCTION_APPROVED !== 'true') throw new Error('ARCA_BOUNDARY_PRODUCTION_APPROVAL_REQUIRED');
const databasePath = process.env.ARCA_BOUNDARY_DB_PATH ?? ':memory:';
if (databasePath === ':memory:')
  throw new Error('ARCA_BOUNDARY_DURABLE_STORE_REQUIRED');
const tokens = {
  payloadWriter: requiredToken('ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN'),
  payloadResolver: requiredToken('ARCA_BOUNDARY_PAYLOAD_RESOLVE_TOKEN'),
  wsaa: requiredToken('ARCA_BOUNDARY_WSAA_TOKEN'),
  status: requiredToken('ARCA_BOUNDARY_STATUS_TOKEN'),
  admin: requiredToken('ARCA_BOUNDARY_ADMIN_TOKEN'),
  padron: process.env.ARCA_BOUNDARY_PADRON_TOKEN
    ? requiredToken('ARCA_BOUNDARY_PADRON_TOKEN') : undefined,
  issuerRevoke: process.env.ARCA_BOUNDARY_ISSUER_REVOKE_TOKEN
    ? requiredToken('ARCA_BOUNDARY_ISSUER_REVOKE_TOKEN') : undefined,
};
const configuredTokens = Object.values(tokens).filter((token): token is string => !!token);
if (new Set(configuredTokens).size !== configuredTokens.length)
  throw new Error('ARCA_BOUNDARY_TOKENS_MUST_BE_DISTINCT');
const masterKey = loadMasterKey();
const representedCuitCommitmentKey = loadRepresentedCuitCommitmentKey();
const taxpayerReferenceKey = loadTaxpayerReferenceKey();
const retentionPolicy = loadRetentionPolicy(environment);
const authProvider = process.env.ARCA_WSAA_PROVIDER ?? 'direct';
if (authProvider !== 'direct' && authProvider !== 'afipsdk')
  throw new Error('ARCA_WSAA_PROVIDER_INVALID');
if (authProvider === 'afipsdk' && process.env.ARCA_AFIPSDK_KEY_TRANSFER_APPROVED !== 'true')
  throw new Error('AFIPSDK_KEY_TRANSFER_APPROVAL_REQUIRED');
const wsaa = authProvider === 'afipsdk'
  ? new AfipSdkWsaaLoginClient(requiredToken('AFIPSDK_ACCESS_TOKEN'))
  : undefined;
const service = new ArcaBoundaryService(
  new ArcaBoundaryStore(masterKey, databasePath, representedCuitCommitmentKey),
  wsaa,
  retentionPolicy,
  taxpayerReferenceKey,
  process.env.ARCA_FISCAL_BETA_ENABLED === 'true'
    && process.env.TAX_DEPLOYMENT_ENVIRONMENT === 'development'
    && environment === 'homologation'
    ? new Set((process.env.ARCA_FISCAL_BETA_WORKSPACE_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean)) : null
);
masterKey.fill(0);
representedCuitCommitmentKey.fill(0);
taxpayerReferenceKey.fill(0);
const handler = createBoundaryHandler(service, tokens, environment);

export const server = Bun.serve({
  hostname,
  port,
  fetch: handler,
});

function requiredToken(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(`${name}_REQUIRED`);
  return value;
}

function parseArcaEnvironment(raw: string | undefined): 'homologation' | 'production' {
  if (raw === 'production') return 'production';
  if (raw === 'homologacion' || raw === 'homologation') return 'homologation';
  throw new Error('ARCA_ENVIRONMENT_INVALID');
}

function loadRetentionPolicy(environment: 'homologation' | 'production') {
  const retentionPolicyId = process.env.ARCA_BOUNDARY_PAYLOAD_RETENTION_POLICY_ID
    ?? (environment === 'homologation' ? 'arca-authority-terminal-recovery-v1' : '');
  const rawDays = process.env.ARCA_BOUNDARY_PAYLOAD_TERMINAL_RETENTION_DAYS
    ?? (environment === 'homologation' ? '30' : '');
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(retentionPolicyId))
    throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_REQUIRED');
  if (!/^\d+$/.test(rawDays))
    throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_REQUIRED');
  const days = Number(rawDays);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3_650)
    throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_INVALID');
  return {
    retentionPolicyId,
    terminalRetentionMs: days * 24 * 60 * 60_000,
  };
}

if (import.meta.main) console.info(`ARCA authority boundary listening on ${hostname}:${server.port}; environment=${environment}; secrets remain encrypted and outside agent context`);
