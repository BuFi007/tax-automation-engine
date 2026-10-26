import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';

import { hashCanonical } from '@tax-engine/core';
import * as forge from 'node-forge';

import { referenceRepresentedCuit } from './crypto';
import { ArcaSetupBoundary } from './setup';
import { ArcaBoundaryStore } from './store';
import { CUIT, certificateBundle } from './test-fixtures';
import { validateIssuerCredential } from './wsaa';

const NOW = '2026-10-26T12:00:00.000Z';
const OTHER_CUIT = '27300000008';
const PROVIDER_CUIT = '30711111118';
const EXECUTION_ID = '33333333-3333-4333-8333-333333333333';

function testCa() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00.000Z');
  certificate.validity.notAfter = new Date('2030-01-01T00:00:00.000Z');
  const subject = [{ shortName: 'CN', value: 'Computadores Test' }, { shortName: 'O', value: 'AFIP' }, { shortName: 'C', value: 'AR' }];
  certificate.setSubject(subject);
  certificate.setIssuer(subject);
  certificate.setExtensions([{ name: 'basicConstraints', cA: true }]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return { keys, certificate, pem: forge.pki.certificateToPem(certificate) };
}

const CA = testCa();

/** What ARCA does with the uploaded CSR: issue a certificate for the same key and subject. */
function issue(csrPem: string, overrides: Partial<{ serial: string; subject: forge.pki.CertificateField[]; publicKey: forge.pki.PublicKey }> = {}) {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = overrides.publicKey ?? csr.publicKey!;
  certificate.serialNumber = overrides.serial ?? '0a';
  certificate.validity.notBefore = new Date('2026-10-26T00:00:00.000Z');
  certificate.validity.notAfter = new Date('2028-10-26T00:00:00.000Z');
  certificate.setSubject(overrides.subject ?? csr.subject.attributes);
  certificate.setIssuer(CA.certificate.subject.attributes);
  certificate.sign(CA.keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(certificate);
}

function boundary(options: Partial<ConstructorParameters<typeof ArcaSetupBoundary>[0]> = {}) {
  const masterKey = randomBytes(32);
  const commitmentKey = randomBytes(32);
  const taxpayerReferenceKey = randomBytes(32);
  const issuers = new ArcaBoundaryStore(masterKey, ':memory:', commitmentKey);
  const setup = new ArcaSetupBoundary({
    databasePath: ':memory:',
    sealKey: randomBytes(32),
    commitmentKey,
    taxpayerReferenceKey,
    issuers,
    environment: 'homologation',
    providerTemplate: null,
    trustedIssuers: [CA.pem],
    ...options,
  });
  return { setup, issuers, taxpayerReferenceKey, commitmentKey };
}

function open(fixture: ReturnType<typeof boundary>, mode: 'customer_certificate' | 'provider_delegation' = 'customer_certificate') {
  return fixture.setup.createSession({
    version: 'arca-setup-session-create-v1',
    executionId: EXECUTION_ID,
    onboardingId: '11111111-1111-4111-8111-111111111111',
    workspaceId: 'workspace-1',
    environment: 'homologation',
    taxpayerReferenceHash: referenceRepresentedCuit(fixture.taxpayerReferenceKey, CUIT),
    issuerProfileRef: `arca-setup/${EXECUTION_ID}`,
    mode,
  }, NOW);
}

function match(fixture: ReturnType<typeof boundary>, setupRef: string, candidates = [OTHER_CUIT, CUIT]) {
  return fixture.setup.matchTaxpayer({
    version: 'arca-setup-taxpayer-match-v1', setupRef, executionId: EXECUTION_ID, loginCuit: OTHER_CUIT, candidates,
  }, NOW);
}

function enroll(fixture: ReturnType<typeof boundary>, setupRef: string) {
  const enrollment = fixture.setup.createEnrollment({ version: 'arca-setup-enrollment-create-v1', setupRef, alias: 'bufi-arca-homo' }, NOW);
  const csr = fixture.setup.readCsr({ version: 'arca-setup-csr-read-v1', setupRef, executionId: EXECUTION_ID, enrollmentRef: enrollment.enrollmentRef }, NOW);
  return { enrollment, csr };
}

describe('ARCA setup boundary', () => {
  test('matches only the run taxpayer and never stores the other candidates', () => {
    const fixture = boundary();
    const session = open(fixture);
    expect(session.state).toBe('created');
    const unmatched = match(fixture, session.setupRef, [OTHER_CUIT]);
    expect(unmatched).toMatchObject({ matched: false, matchIndex: null, representedCuitCommitment: null });
    const matched = match(fixture, session.setupRef);
    expect(matched).toMatchObject({ matched: true, matchIndex: 1 });
    expect(matched.loginIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(fixture.setup.status({ setupRef: session.setupRef }, NOW))).not.toContain(CUIT);
    expect(() => fixture.setup.matchTaxpayer({
      version: 'arca-setup-taxpayer-match-v1', setupRef: session.setupRef,
      executionId: '44444444-4444-4444-8444-444444444444', loginCuit: CUIT, candidates: [CUIT],
    }, NOW)).toThrow('ARCA_SETUP_EXECUTION_MISMATCH');
  });

  test('a session is idempotent per execution and refuses a conflicting retry', () => {
    const fixture = boundary();
    const first = open(fixture);
    expect(open(fixture).setupRef).toBe(first.setupRef);
    expect(() => fixture.setup.createSession({
      version: 'arca-setup-session-create-v1', executionId: EXECUTION_ID,
      onboardingId: '11111111-1111-4111-8111-111111111111', workspaceId: 'workspace-2', environment: 'homologation',
      taxpayerReferenceHash: referenceRepresentedCuit(fixture.taxpayerReferenceKey, CUIT),
      issuerProfileRef: `arca-setup/${EXECUTION_ID}`, mode: 'customer_certificate',
    }, NOW)).toThrow('ARCA_SETUP_SESSION_IDEMPOTENCY_CONFLICT');
  });

  test('generates the key inside the boundary and gives out only the CSR', () => {
    const fixture = boundary();
    const session = open(fixture);
    expect(() => fixture.setup.createEnrollment({ version: 'arca-setup-enrollment-create-v1', setupRef: session.setupRef, alias: 'bufi-arca-homo' }, NOW))
      .toThrow('ARCA_SETUP_TAXPAYER_NOT_ATTESTED');
    match(fixture, session.setupRef);
    const { enrollment, csr } = enroll(fixture, session.setupRef);
    expect(csr.csrPem).toContain('BEGIN CERTIFICATE REQUEST');
    expect(JSON.stringify({ enrollment, csr })).not.toContain('PRIVATE KEY');
    const parsed = forge.pki.certificationRequestFromPem(csr.csrPem);
    expect(parsed.verify()).toBe(true);
    expect(parsed.subject.getField({ name: 'serialNumber' })?.value).toBe(`CUIT ${CUIT}`);
    expect(parsed.subject.getField('CN')?.value).toBe('bufi-arca-homo');
    expect(enrollment.csrHash).toBe(hashCanonical(csr.csrPem));
    // Retrying the enrollment keeps the same key.
    expect(fixture.setup.createEnrollment({ version: 'arca-setup-enrollment-create-v1', setupRef: session.setupRef, alias: 'bufi-arca-homo' }, NOW).enrollmentRef)
      .toBe(enrollment.enrollmentRef);
  });

  test('imports only a current certificate for the generated key and the attested CUIT', () => {
    const fixture = boundary();
    const session = open(fixture);
    match(fixture, session.setupRef);
    const { enrollment, csr } = enroll(fixture, session.setupRef);
    const importInput = (certificatePem: string) => ({
      version: 'arca-setup-certificate-import-v1' as const, setupRef: session.setupRef, executionId: EXECUTION_ID,
      enrollmentRef: enrollment.enrollmentRef, certificatePem,
    });
    const foreignKey = forge.pki.rsa.generateKeyPair(2048).publicKey;
    expect(() => fixture.setup.importCertificate(importInput(issue(csr.csrPem, { publicKey: foreignKey })), NOW))
      .toThrow('ARCA_SETUP_CERTIFICATE_KEY_MISMATCH');
    expect(() => fixture.setup.importCertificate(importInput(issue(csr.csrPem, {
      subject: [{ shortName: 'CN', value: 'bufi-arca-homo' }, { name: 'serialNumber', value: `CUIT ${OTHER_CUIT}` }],
    })), NOW)).toThrow('ARCA_SETUP_CERTIFICATE_SUBJECT_MISMATCH');
    const issued = issue(csr.csrPem);
    const receipt = fixture.setup.importCertificate(importInput(issued), NOW);
    expect(receipt.chainVerified).toBe(true);
    expect(fixture.setup.importCertificate(importInput(issued), NOW)).toEqual(receipt);
    expect(() => fixture.setup.importCertificate(importInput(issue(csr.csrPem, { serial: '0b' })), NOW))
      .toThrow('ARCA_SETUP_CERTIFICATE_ALREADY_IMPORTED');
    // Base64 DER without armor, as some ARCA downloads deliver it, is accepted too.
    const der = issued.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    expect(fixture.setup.importCertificate(importInput(der), NOW).certificateFingerprint).toBe(receipt.certificateFingerprint);
  });

  test('customer-certificate provisioning binds the issuer to the same commitment', () => {
    const fixture = boundary();
    const session = open(fixture);
    const matched = match(fixture, session.setupRef);
    const { enrollment, csr } = enroll(fixture, session.setupRef);
    fixture.setup.importCertificate({
      version: 'arca-setup-certificate-import-v1', setupRef: session.setupRef, executionId: EXECUTION_ID,
      enrollmentRef: enrollment.enrollmentRef, certificatePem: issue(csr.csrPem),
    }, NOW);
    const receipt = fixture.setup.provision({
      version: 'arca-setup-provision-v1', setupRef: session.setupRef,
      relationshipEvidenceHash: hashCanonical('relations'), providerAcceptanceEvidenceHash: null,
    }, NOW);
    expect(receipt.representedCuitCommitment).toBe(matched.representedCuitCommitment!);
    expect(receipt.delegationConfirmed).toBe(true);
    const issuer = fixture.issuers.getIssuer('workspace-1', `arca-setup/${EXECUTION_ID}`, 'homologation');
    expect(issuer.certificateHolderCuit).toBe(CUIT);
    expect(issuer.representedCuit).toBe(CUIT);
    expect(fixture.setup.status({ setupRef: session.setupRef }, NOW).state).toBe('provisioned');
  });

  test('provider delegation reuses BUFI certificate only with acceptance evidence', () => {
    const fixture = boundary({ providerTemplate: { workspaceId: 'bufi-provider', issuerProfileRef: 'issuer://bufi/provider' } });
    const providerCredential = certificateBundle(PROVIDER_CUIT, new Date(NOW));
    const validated = validateIssuerCredential({
      workspaceId: 'bufi-provider', issuerProfileRef: 'issuer://bufi/provider', environment: 'homologation',
      certificateHolderCuit: PROVIDER_CUIT, representedCuit: PROVIDER_CUIT,
      certificatePem: providerCredential.certificatePem, privateKeyPem: providerCredential.privateKeyPem,
      delegationConfirmed: true,
    }, new Date(NOW));
    fixture.issuers.provisionIssuer({ ...validated, replaceCertificateFingerprint: null, occurredAt: NOW });
    const session = open(fixture, 'provider_delegation');
    match(fixture, session.setupRef);
    expect(() => fixture.setup.createEnrollment({ version: 'arca-setup-enrollment-create-v1', setupRef: session.setupRef, alias: 'bufi-arca-homo' }, NOW))
      .toThrow('ARCA_SETUP_ENROLLMENT_NOT_APPLICABLE');
    expect(() => fixture.setup.provision({
      version: 'arca-setup-provision-v1', setupRef: session.setupRef,
      relationshipEvidenceHash: hashCanonical('delegated'), providerAcceptanceEvidenceHash: null,
    }, NOW)).toThrow('ARCA_SETUP_PROVIDER_ACCEPTANCE_REQUIRED');
    fixture.setup.provision({
      version: 'arca-setup-provision-v1', setupRef: session.setupRef,
      relationshipEvidenceHash: hashCanonical('delegated'), providerAcceptanceEvidenceHash: hashCanonical('accepted'),
    }, NOW);
    const issuer = fixture.issuers.getIssuer('workspace-1', `arca-setup/${EXECUTION_ID}`, 'homologation');
    expect(issuer.certificateHolderCuit).toBe(PROVIDER_CUIT);
    expect(issuer.representedCuit).toBe(CUIT);
  });

  test('provider delegation is refused when no provider certificate is configured', () => {
    expect(() => open(boundary(), 'provider_delegation')).toThrow('ARCA_SETUP_PROVIDER_TEMPLATE_NOT_CONFIGURED');
  });

  test('production refuses to start without trusted ARCA issuers', () => {
    expect(() => boundary({ environment: 'production', trustedIssuers: [] })).toThrow('ARCA_SETUP_TRUSTED_ISSUERS_REQUIRED');
  });
});
