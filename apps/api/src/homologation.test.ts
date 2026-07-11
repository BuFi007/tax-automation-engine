import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import { buildHomologationPreflight, probeWsfexHomologationSigner, validateHomologationEvidence } from './homologation';

describe('ARCA homologation acceptance harness', () => {
  test('reports missing authority and provider assets without disclosing configured values', () => {
    const preflight = buildHomologationPreflight({
      ARCA_SIGNER_TOKEN: 'must-not-leak',
      RECLAIM_APP_SECRET: 'also-must-not-leak',
      ARCA_ENVIRONMENT: 'homologacion',
    });
    expect(preflight.state).toBe('blocked');
    expect(preflight.productionActivationAllowed).toBe(false);
    expect(JSON.stringify(preflight)).not.toContain('must-not-leak');
    expect(preflight.gates.find(gate => gate.id === 'explicit_homologation_authority')?.state).toBe('missing');
  });

  test('becomes ready only with reviewed HTTPS homologation boundaries and explicit authority', () => {
    const preflight = buildHomologationPreflight(readyEnvironment());
    expect(preflight.state).toBe('ready_for_authorized_homologation');
    expect(preflight.gates.every(gate => gate.state === 'ready')).toBe(true);
    expect(buildHomologationPreflight({ ...readyEnvironment(), ARCA_ENVIRONMENT: 'production', TAX_ENGINE_PRODUCTION_APPROVED: 'true' }).state).toBe('blocked');
  });

  test('accepts only redacted evidence with complete Reclaim, WSFEX, journey, and human-review coverage', () => {
    const accepted = validateHomologationEvidence(validEvidence());
    expect(accepted).toEqual(expect.objectContaining({ state: 'structurally_complete_for_human_production_review', failedGateIds: [] }));
    expect(accepted.safeSummary.productionEnabled).toBe(false);
    expect(accepted.safeSummary.limitation).toContain('independent reviewers');

    const evidence = validEvidence();
    const rejected = validateHomologationEvidence({
      ...evidence,
      reclaim: [evidence.reclaim[0], evidence.reclaim[0], evidence.reclaim[2]],
      wsfex: evidence.wsfex.map(item => item.documentType === 21 ? { ...item, mismatchedEchoRejected: false } : item),
      reviews: { ...evidence.reviews, securityAccepted: false },
    });
    expect(rejected.state).toBe('rejected');
    expect(rejected.failedGateIds).toEqual(expect.arrayContaining(['reclaim_coverage', 'wsfex_recovery_or_echo_gate', 'human_review_gate']));
  });

  test('probes only a homologation signer that reports delegated certificate and WSAA readiness', async () => {
    const report = await probeWsfexHomologationSigner(
      { baseUrl: 'https://signer.example.test', token: 'signer-token' },
      async (_url, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer signer-token');
        return Response.json({
          version: 'motora-wsfex-signer-health-v1',
          environment: 'homologation',
          signerVersion: '1.0.0',
          wsfexVersion: '3.1.1',
          certificateDelegationConfigured: true,
          wsaaReady: true,
        });
      }
    );
    expect(report).toEqual(expect.objectContaining({ state: 'ready', signerVersion: '1.0.0', safeHealthReceiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(probeWsfexHomologationSigner({ baseUrl: 'http://signer.example.test', token: 'token' })).rejects.toThrow('ARCA_SIGNER_HTTPS_REQUIRED');
    expect(probeWsfexHomologationSigner(
      { baseUrl: 'https://signer.example.test', token: 'token' },
      async () => Response.json({
        version: 'motora-wsfex-signer-health-v1', environment: 'production', signerVersion: '1', wsfexVersion: '3.1.1',
        certificateDelegationConfigured: true, wsaaReady: true,
      })
    )).rejects.toThrow();
  });
});

function readyEnvironment(): Record<string, string> {
  return {
    ARCA_ENVIRONMENT: 'homologacion',
    ARCA_HOMOLOGATION_AUTHORIZED: 'true',
    ARCA_HOMOLOGATION_TEST_IDENTITY_APPROVED: 'true',
    TAX_ENGINE_USER_APPROVAL_TOKEN: 'user-token',
    TAX_ENGINE_ACCOUNTANT_APPROVAL_TOKEN: 'accountant-token',
    TAX_ENGINE_EVIDENCE_INGEST_TOKEN: 'ingest-token',
    RECLAIM_APP_ID: 'app-id',
    RECLAIM_APP_SECRET: 'app-secret',
    RECLAIM_CALLBACK_BASE_URL: 'https://tax-api.example.test',
    RECLAIM_ARCA_TAXPAYER_PROVIDER_REVIEWED: 'true',
    RECLAIM_ARCA_TAXPAYER_PROVIDER_ID: 'provider-readiness',
    RECLAIM_ARCA_CAE_PROVIDER_REVIEWED: 'true',
    RECLAIM_ARCA_CAE_PROVIDER_ID: 'provider-cae',
    RECLAIM_PROOF_VAULT_URL: 'https://proof-vault.example.test',
    RECLAIM_PROOF_VAULT_TOKEN: 'vault-token',
    RECLAIM_PROOF_RETENTION_POLICY_ID: 'tax-evidence-v1',
    ARCA_SIGNER_URL: 'https://wsfex-signer.example.test',
    ARCA_SIGNER_TOKEN: 'signer-token',
    ARCA_WSFEX_DELEGATION_CONFIRMED: 'true',
    TAX_ENGINE_PRODUCTION_APPROVED: 'false',
  };
}

function validEvidence() {
  const hash = (value: string) => hashCanonical(value);
  return {
    version: 'arca-homologation-evidence-v1' as const,
    executedAt: '2026-07-11T12:00:00.000Z',
    authorityEnvironment: 'homologacion' as const,
    effectiveRuleVersionIds: ['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1'],
    reclaim: [
      { purpose: 'arca_taxpayer_readiness' as const, providerIdHash: hash('provider-readiness'), providerVersion: '1.0.0', proofHash: hash('readiness-proof'), custodyReceiptHash: hash('readiness-custody'), teeRequired: false, teeVerified: false, negativeBindingCasesRejected: true },
      { purpose: 'arca_cae_constatement' as const, providerIdHash: hash('provider-cae'), providerVersion: '1.0.0', proofHash: hash('invoice-proof'), custodyReceiptHash: hash('invoice-custody'), teeRequired: true, teeVerified: true, negativeBindingCasesRejected: true },
      { purpose: 'arca_adjustment_constatement' as const, providerIdHash: hash('provider-cae'), providerVersion: '1.0.0', proofHash: hash('adjustment-proof'), custodyReceiptHash: hash('adjustment-custody'), teeRequired: true, teeVerified: true, negativeBindingCasesRejected: true },
    ],
    wsfex: ([19, 20, 21] as const).map(documentType => ({
      documentType,
      acceptedReceiptHash: hash(`accepted-${documentType}`),
      ambiguousOutcomeObserved: true,
      exactRecoveryReceiptHash: hash(`recovered-${documentType}`),
      mismatchedEchoRejected: true,
    })),
    journeys: [
      { path: 'reclaim_copilot' as const, eventSequenceHash: hash('path-b-events'), accountingAttestationPacketHash: hash('path-b-packet'), separateSettlementFxTaxStatesObserved: true },
      { path: 'wsfex_delegated' as const, eventSequenceHash: hash('path-a-events'), accountingAttestationPacketHash: hash('path-a-packet'), separateSettlementFxTaxStatesObserved: true },
    ],
    reviews: { accountantAccepted: true, securityAccepted: true, ownerAcceptedForProductionReview: true, redactedEvidenceReferenceHash: hash('review-evidence') },
    secretsDetected: false as const,
    productionEnabled: false as const,
  };
}
