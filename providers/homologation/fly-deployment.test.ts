import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const configs = [
  ['tax-api.toml', 'apps/api/Dockerfile', 'tax_engine_data'],
  ['arca-boundary.toml', 'apps/arca-boundary/Dockerfile', 'arca_boundary_data'],
  ['reclaim-proof-vault.toml', 'apps/reclaim-proof-vault/Dockerfile', 'reclaim_proof_vault_data'],
  ['wsfex-signer.toml', 'apps/wsfex-signer/Dockerfile', 'wsfex_signer_data'],
  ['wsfe-signer.toml', 'apps/wsfe-signer/Dockerfile', 'wsfe_signer_data'],
] as const;

describe('Fly ARCA homologation topology', () => {
  test.each(configs)('%s is single-writer, always-on, TLS-only, and pinned to gru', (
    filename,
    dockerfile,
    volume,
  ) => {
    const config = readFileSync(resolve(repositoryRoot, 'deploy/fly', filename), 'utf8');

    expect(config).toContain('primary_region = "gru"');
    expect(config).toContain(`dockerfile = "${dockerfile}"`);
    expect(config).toContain('force_https = true');
    expect(config).toContain('auto_stop_machines = "off"');
    expect(config).toContain('min_machines_running = 1');
    expect(config).toContain(`source = "${volume}"`);
    expect(config).not.toMatch(/^app\s*=/m);
    expect(config).not.toMatch(/(token|secret|private_key|certificate|cuit|point_of_sale)\s*=/i);
  });

  test('keeps authority and production effects disabled in the Tax API', () => {
    const config = readFileSync(
      resolve(repositoryRoot, 'deploy/fly/tax-api.toml'),
      'utf8',
    );

    expect(config).toContain('ARCA_ENVIRONMENT = "homologacion"');
    expect(config).toContain('TAX_ENGINE_ARCA_AUTHORITY_CORRIDOR_ENABLED = "false"');
    expect(config).toContain('TAX_ENGINE_ARCA_REMOTE_EFFECTS_ENABLED = "false"');
    expect(config).toContain('TAX_ENGINE_PRODUCTION_APPROVED = "false"');
    expect(config).toContain('TAX_ENGINE_LEGACY_EVIDENCE_APPEND_ENABLED = "false"');
  });

  test('mounts boundary and proof-vault encryption keys from Fly secrets', () => {
    const boundary = readFileSync(
      resolve(repositoryRoot, 'deploy/fly/arca-boundary.toml'),
      'utf8',
    );
    const proofVault = readFileSync(
      resolve(repositoryRoot, 'deploy/fly/reclaim-proof-vault.toml'),
      'utf8',
    );

    expect(boundary).toContain('guest_path = "/run/secrets/arca_boundary_master_key"');
    expect(boundary).toContain('guest_path = "/run/secrets/arca_boundary_cuit_commitment_key"');
    expect(boundary).toContain('ARCA_BOUNDARY_MASTER_KEY_FILE = "/run/secrets/arca_boundary_master_key"');
    expect(boundary).toContain('ARCA_BOUNDARY_CUIT_COMMITMENT_KEY_FILE = "/run/secrets/arca_boundary_cuit_commitment_key"');
    expect(proofVault).toContain('guest_path = "/run/secrets/reclaim_proof_vault_master_key"');
    expect(proofVault).toContain('RECLAIM_PROOF_VAULT_MASTER_KEY_FILE = "/run/secrets/reclaim_proof_vault_master_key"');
  });

  test('documents Fly file-secret decoding without double-encoding bearer credentials', () => {
    const readme = readFileSync(
      resolve(repositoryRoot, 'deploy/fly/README.md'),
      'utf8',
    );

    expect(readme).toContain('require two representation layers');
    expect(readme).toContain("After Fly's one decode");
    expect(readme).toContain('Do not double-encode ordinary bearer/HMAC variables');
  });
});
