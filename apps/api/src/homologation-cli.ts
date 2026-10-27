import { buildHomologationPreflight, probeReclaimProofVault, probeWsfeHomologationSigner, probeWsfexHomologationSigner, validateHomologationEvidence, validateLiveWsfexSmoke } from './homologation';
import { HttpWsfexGateway } from './wsfex';

const [command, evidencePath] = process.argv.slice(2);
// Through the Tax API's operator proxy, the signer URLs are `$TAX/v1/operator/{wsfex,wsfe}-signer`.
const operatorProxyToken = process.env.TAX_OPERATOR_PROXY_TOKEN;
const operatorHeaders = operatorProxyToken ? { headers: { 'x-bufi-operator-token': operatorProxyToken } } : {};

if (command === 'preflight') {
  const report = buildHomologationPreflight();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === 'ready_for_authorized_homologation' ? 0 : 2;
} else if (command === 'validate-report') {
  if (!evidencePath) throw new Error('HOMOLOGATION_EVIDENCE_PATH_REQUIRED');
  const file = Bun.file(evidencePath);
  if (!await file.exists()) throw new Error('HOMOLOGATION_EVIDENCE_FILE_NOT_FOUND');
  const report = validateHomologationEvidence(await file.json());
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === 'structurally_complete_for_human_production_review' ? 0 : 3;
} else if (command === 'validate-live-smoke') {
  if (!evidencePath) throw new Error('LIVE_SMOKE_EVIDENCE_PATH_REQUIRED');
  const file = Bun.file(evidencePath);
  if (!await file.exists()) throw new Error('LIVE_SMOKE_EVIDENCE_FILE_NOT_FOUND');
  const report = validateLiveWsfexSmoke(await file.json());
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === 'ready_for_invoice_homologation' ? 0 : 2;
} else if (command === 'probe-signer') {
  const baseUrl = process.env.ARCA_SIGNER_URL ?? '';
  const token = process.env.ARCA_SIGNER_TOKEN ?? '';
  const report = await probeWsfexHomologationSigner({ baseUrl, token, ...operatorHeaders });
  console.log(JSON.stringify(report, null, 2));
} else if (command === 'probe-points-of-sale') {
  if (process.env.ARCA_ENVIRONMENT === 'production') {
    throw new Error('HOMOLOGATION_POINT_OF_SALE_PROBE_FORBIDS_PRODUCTION');
  }
  const gateway = HttpWsfexGateway.fromEnvironment();
  if (!gateway) throw new Error('ARCA_SIGNER_CONFIGURATION_REQUIRED');
  const workspaceId = process.env.ARCA_HOMOLOGATION_WORKSPACE_ID ?? '';
  const issuerProfileRef = process.env.ARCA_HOMOLOGATION_ISSUER_PROFILE_REF ?? '';
  if (!workspaceId || !issuerProfileRef) {
    throw new Error('ARCA_HOMOLOGATION_POINT_OF_SALE_CONTEXT_REQUIRED');
  }
  const receipt = await gateway.discoverPointsOfSale({ workspaceId, issuerProfileRef });
  const report = {
    version: 'arca-wsfex-point-of-sale-probe-v1',
    state: receipt.activePoints.length > 0 ? 'ready' : 'blocked',
    authorityEnvironment: receipt.environment,
    activePoints: receipt.activePoints,
    authorityResponseHash: receipt.authorityResponseHash,
    evidenceHash: receipt.evidenceHash,
    observedAt: receipt.observedAt,
    productionEnabled: false,
  } as const;
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === 'ready' ? 0 : 2;
} else if (command === 'probe-wsfe-signer') {
  const baseUrl = process.env.ARCA_WSFE_SIGNER_URL ?? '';
  const token = process.env.ARCA_WSFE_SIGNER_TOKEN ?? '';
  const report = await probeWsfeHomologationSigner({ baseUrl, token, ...operatorHeaders });
  console.log(JSON.stringify(report, null, 2));
} else if (command === 'probe-proof-vault') {
  const report = await probeReclaimProofVault({ baseUrl: process.env.RECLAIM_PROOF_VAULT_URL ?? '', token: process.env.RECLAIM_PROOF_VAULT_TOKEN ?? '' });
  console.log(JSON.stringify(report, null, 2));
} else {
  throw new Error('USAGE: bun run homologation:preflight | homologation:probe-signer | homologation:probe-points-of-sale | homologation:probe-wsfe-signer | homologation:probe-proof-vault | homologation:validate -- <redacted-evidence.json> | homologation:validate-live-smoke -- <smoke.json>');
}
