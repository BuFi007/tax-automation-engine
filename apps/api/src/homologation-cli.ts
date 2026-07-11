import { buildHomologationPreflight, probeWsfexHomologationSigner, validateHomologationEvidence } from './homologation';

const [command, evidencePath] = process.argv.slice(2);

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
} else if (command === 'probe-signer') {
  const baseUrl = process.env.ARCA_SIGNER_URL ?? '';
  const token = process.env.ARCA_SIGNER_TOKEN ?? '';
  const report = await probeWsfexHomologationSigner({ baseUrl, token });
  console.log(JSON.stringify(report, null, 2));
} else {
  throw new Error('USAGE: bun run homologation:preflight | homologation:probe-signer | homologation:validate -- <redacted-evidence.json>');
}
