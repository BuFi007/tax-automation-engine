import type { SqlDatabase } from '@tax-engine/sql-store';

import {
  deriveDomainKey,
  loadMasterKey,
  loadRepresentedCuitCommitmentKey,
  loadTaxpayerReferenceKey,
} from './crypto';
import { AfipSdkWsaaLoginClient } from './afipsdk-wsaa';
import { createBoundaryHandler } from './http';
import { ArcaBoundaryService } from './service';
import { ArcaBoundaryStore } from './store';
import { ArcaSetupBoundary } from './setup';

type Environment = Readonly<Record<string, string | undefined>>;

export type BoundaryOptions = Readonly<{
  env: Environment;
  /** A file path (Bun: each store opens its own connection, as today) or an injected database. */
  database: string | SqlDatabase;
  /** PEM bundle of ARCA's computer-certificate CAs. Required only in production. */
  trustedIssuersPem?: string;
}>;

export type Boundary = Readonly<{
  fetch(request: Request): Response | Promise<Response>;
  environment: 'homologation' | 'production';
}>;

export function createBoundary({ env, database, trustedIssuersPem }: BoundaryOptions): Boundary {
  const requiredToken = (name: string): string => {
    const value = env[name];
    if (!value || value.length < 32) throw new Error(`${name}_REQUIRED`);
    return value;
  };
  const environment = parseArcaEnvironment(env.ARCA_ENVIRONMENT);
  if (environment === 'production' && env.ARCA_BOUNDARY_PRODUCTION_APPROVED !== 'true') throw new Error('ARCA_BOUNDARY_PRODUCTION_APPROVAL_REQUIRED');
  if (typeof database === 'string' ? database === ':memory:' : !database.durable)
    throw new Error('ARCA_BOUNDARY_DURABLE_STORE_REQUIRED');
  const tokens = {
    payloadWriter: requiredToken('ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN'),
    payloadResolver: requiredToken('ARCA_BOUNDARY_PAYLOAD_RESOLVE_TOKEN'),
    wsaa: requiredToken('ARCA_BOUNDARY_WSAA_TOKEN'),
    status: requiredToken('ARCA_BOUNDARY_STATUS_TOKEN'),
    admin: requiredToken('ARCA_BOUNDARY_ADMIN_TOKEN'),
    padron: env.ARCA_BOUNDARY_PADRON_TOKEN
      ? requiredToken('ARCA_BOUNDARY_PADRON_TOKEN') : undefined,
    issuerRevoke: env.ARCA_BOUNDARY_ISSUER_REVOKE_TOKEN
      ? requiredToken('ARCA_BOUNDARY_ISSUER_REVOKE_TOKEN') : undefined,
    setup: env.ARCA_BOUNDARY_SETUP_TOKEN
      ? requiredToken('ARCA_BOUNDARY_SETUP_TOKEN') : undefined,
    setupExecutor: env.ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN
      ? requiredToken('ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN') : undefined,
  };
  if (Boolean(tokens.setup) !== Boolean(tokens.setupExecutor))
    throw new Error('ARCA_BOUNDARY_SETUP_TOKENS_REQUIRED_TOGETHER');
  const configuredTokens = Object.values(tokens).filter((token): token is string => !!token);
  if (new Set(configuredTokens).size !== configuredTokens.length)
    throw new Error('ARCA_BOUNDARY_TOKENS_MUST_BE_DISTINCT');
  // Base64 values only; the Bun entry resolves the `*_FILE` forms before calling here.
  const keyEnvironment = {
    ...env,
    ARCA_BOUNDARY_MASTER_KEY_FILE: undefined,
    ARCA_BOUNDARY_CUIT_COMMITMENT_KEY_FILE: undefined,
    ARCA_BOUNDARY_TAXPAYER_REFERENCE_KEY_FILE: undefined,
  };
  const masterKey = loadMasterKey(keyEnvironment);
  const representedCuitCommitmentKey = loadRepresentedCuitCommitmentKey(keyEnvironment);
  const taxpayerReferenceKey = loadTaxpayerReferenceKey(keyEnvironment);
  const retentionPolicy = loadRetentionPolicy(env, environment);
  const authProvider = env.ARCA_WSAA_PROVIDER ?? 'direct';
  if (authProvider !== 'direct' && authProvider !== 'afipsdk')
    throw new Error('ARCA_WSAA_PROVIDER_INVALID');
  if (authProvider === 'afipsdk' && env.ARCA_AFIPSDK_KEY_TRANSFER_APPROVED !== 'true')
    throw new Error('AFIPSDK_KEY_TRANSFER_APPROVAL_REQUIRED');
  const wsaa = authProvider === 'afipsdk'
    ? new AfipSdkWsaaLoginClient(requiredToken('AFIPSDK_ACCESS_TOKEN'))
    : undefined;
  const issuerStore = new ArcaBoundaryStore(masterKey, database, representedCuitCommitmentKey);
  const setup = tokens.setup
    ? new ArcaSetupBoundary({
        databasePath: database,
        sealKey: deriveDomainKey(masterKey, 'setup-sessions'),
        commitmentKey: representedCuitCommitmentKey,
        taxpayerReferenceKey,
        issuers: issuerStore,
        environment,
        providerTemplate: env.ARCA_SETUP_PROVIDER_TEMPLATE_WORKSPACE_ID && env.ARCA_SETUP_PROVIDER_TEMPLATE_PROFILE_REF
          ? {
              workspaceId: env.ARCA_SETUP_PROVIDER_TEMPLATE_WORKSPACE_ID,
              issuerProfileRef: env.ARCA_SETUP_PROVIDER_TEMPLATE_PROFILE_REF,
            }
          : null,
        trustedIssuers: parseTrustedIssuers(trustedIssuersPem),
      })
    : null;
  const service = new ArcaBoundaryService(
    issuerStore,
    wsaa,
    retentionPolicy,
    taxpayerReferenceKey,
    env.ARCA_FISCAL_BETA_ENABLED === 'true'
      && env.TAX_DEPLOYMENT_ENVIRONMENT === 'development'
      && environment === 'homologation'
      ? new Set((env.ARCA_FISCAL_BETA_WORKSPACE_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean)) : null
  );
  masterKey.fill(0);
  representedCuitCommitmentKey.fill(0);
  taxpayerReferenceKey.fill(0);
  return {
    fetch: createBoundaryHandler(service, tokens, environment, undefined, setup),
    environment,
  };
}

function parseArcaEnvironment(raw: string | undefined): 'homologation' | 'production' {
  if (raw === 'production') return 'production';
  if (raw === 'homologacion' || raw === 'homologation') return 'homologation';
  throw new Error('ARCA_ENVIRONMENT_INVALID');
}

function loadRetentionPolicy(env: Environment, environment: 'homologation' | 'production') {
  const retentionPolicyId = env.ARCA_BOUNDARY_PAYLOAD_RETENTION_POLICY_ID
    ?? (environment === 'homologation' ? 'arca-authority-terminal-recovery-v1' : '');
  const rawDays = env.ARCA_BOUNDARY_PAYLOAD_TERMINAL_RETENTION_DAYS
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

/** PEM bundle of ARCA's computer-certificate CAs (the official "cadena de certificación"). */
function parseTrustedIssuers(bundle: string | undefined): readonly string[] {
  if (!bundle) return [];
  return bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}
