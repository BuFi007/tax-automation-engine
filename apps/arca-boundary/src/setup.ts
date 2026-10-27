import { generateKeyPairSync, randomUUID, X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';

import { hashCanonical } from '@tax-engine/core';
import type { SqlDatabase } from '@tax-engine/sql-store';
import { openSqlDatabase } from '@tax-engine/sql-store/bun';
import { isValidCuit } from '@tax-engine/wsfex-signer/contracts';
import * as forge from 'node-forge';
import { z } from 'zod';

import { commitRepresentedCuit, openJson, referenceRepresentedCuit, sealJson } from './crypto';
import type { IssuerProvisionReceipt } from './contracts';
import type { ArcaBoundaryStore } from './store';
import { validateIssuerCredential } from './wsaa';

/**
 * Setup sessions for automated ARCA connection.
 *
 * The tax engine opens a session for one onboarding run and taxpayer reference.
 * The browser executor, which sees the ARCA page, reports the CUIT it observes
 * here and nowhere else. The boundary checks it against the taxpayer reference,
 * seals it, generates the key pair and CSR, imports the certificate ARCA issued
 * and finally provisions the issuer used by WSAA.
 *
 * Callers receive references, commitments, fingerprints and the CSR. The private
 * key and the raw CUITs never leave this module.
 */

const SETUP_REFERENCE = /^setup:\/\/[0-9a-f-]{36}$/;
const ENROLLMENT_REFERENCE = /^enrollment:\/\/[0-9a-f-]{36}$/;
const SESSION_TTL_MS = 48 * 60 * 60_000;
const ALIAS = /^[a-z0-9][a-z0-9-]{2,30}$/;
const cuit = z.string().regex(/^\d{11}$/).refine(isValidCuit, { message: 'CUIT_CHECK_DIGIT_INVALID' });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const setupSessionCreateSchema = z.object({
  version: z.literal('arca-setup-session-create-v1'),
  executionId: z.uuid(),
  onboardingId: z.uuid(),
  workspaceId: z.string().min(1).max(200),
  environment: z.enum(['homologation', 'production']),
  taxpayerReferenceHash: sha256,
  issuerProfileRef: z.string().regex(/^arca-setup\/[0-9a-f-]{36}$/),
  mode: z.enum(['provider_delegation', 'customer_certificate']),
}).strict();

export const setupTaxpayerMatchSchema = z.object({
  version: z.literal('arca-setup-taxpayer-match-v1'),
  setupRef: z.string().regex(SETUP_REFERENCE),
  executionId: z.uuid(),
  loginCuit: cuit,
  candidates: z.array(cuit).min(1).max(20),
}).strict();

export const setupEnrollmentCreateSchema = z.object({
  version: z.literal('arca-setup-enrollment-create-v1'),
  setupRef: z.string().regex(SETUP_REFERENCE),
  alias: z.string().regex(ALIAS),
}).strict();

export const setupCsrReadSchema = z.object({
  version: z.literal('arca-setup-csr-read-v1'),
  setupRef: z.string().regex(SETUP_REFERENCE),
  executionId: z.uuid(),
  enrollmentRef: z.string().regex(ENROLLMENT_REFERENCE),
}).strict();

export const setupCertificateImportSchema = z.object({
  version: z.literal('arca-setup-certificate-import-v1'),
  setupRef: z.string().regex(SETUP_REFERENCE),
  executionId: z.uuid(),
  enrollmentRef: z.string().regex(ENROLLMENT_REFERENCE),
  certificatePem: z.string().min(100).max(32_000),
}).strict();

export const setupProvisionSchema = z.object({
  version: z.literal('arca-setup-provision-v1'),
  setupRef: z.string().regex(SETUP_REFERENCE),
  /** Executor receipts proving the ARCA relationships this provisioning relies on. */
  relationshipEvidenceHash: sha256,
  providerAcceptanceEvidenceHash: sha256.nullable(),
}).strict();

export const setupStatusSchema = z.object({
  setupRef: z.string().regex(SETUP_REFERENCE),
}).strict();

type SetupState = 'created' | 'attested' | 'enrolled' | 'certificate_imported' | 'provisioned';

type SealedSetup = Readonly<{
  representedCuit: string | null;
  privateKeyPem: string | null;
  csrPem: string | null;
  certificatePem: string | null;
}>;

type SetupRow = {
  setup_ref: string;
  execution_id: string;
  onboarding_id: string;
  workspace_id_hash: string;
  workspace_id: string;
  environment: 'homologation' | 'production';
  taxpayer_reference_hash: string;
  issuer_profile_ref: string;
  mode: 'provider_delegation' | 'customer_certificate';
  state: SetupState;
  represented_cuit_commitment: string | null;
  login_identity_hash: string | null;
  enrollment_ref: string | null;
  alias: string | null;
  csr_hash: string | null;
  certificate_fingerprint: string | null;
  certificate_valid_until: string | null;
  sealed: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export type SetupStatus = Readonly<{
  version: 'arca-setup-session-status-v1';
  setupRef: string;
  executionId: string;
  state: SetupState;
  mode: 'provider_delegation' | 'customer_certificate';
  representedCuitCommitment: string | null;
  loginIdentityHash: string | null;
  enrollmentRef: string | null;
  csrHash: string | null;
  certificateFingerprint: string | null;
  certificateValidUntil: string | null;
  expiresAt: string;
}>;

export type SetupProviderTemplate = Readonly<{ workspaceId: string; issuerProfileRef: string }>;

export class ArcaSetupBoundary {
  readonly #db: SqlDatabase;
  readonly #sealKey: Buffer;
  readonly #commitmentKey: Buffer;
  readonly #taxpayerReferenceKey: Buffer;

  constructor(private readonly options: Readonly<{
    databasePath: string | SqlDatabase;
    sealKey: Buffer;
    commitmentKey: Buffer;
    taxpayerReferenceKey: Buffer;
    issuers: ArcaBoundaryStore;
    environment: 'homologation' | 'production';
    providerTemplate: SetupProviderTemplate | null;
    /** PEM CA certificates ARCA issues under. Required in production. */
    trustedIssuers: readonly string[];
  }>) {
    for (const key of [options.sealKey, options.commitmentKey, options.taxpayerReferenceKey])
      if (key.length !== 32) throw new Error('ARCA_SETUP_KEY_INVALID');
    if (options.environment === 'production' && options.trustedIssuers.length === 0)
      throw new Error('ARCA_SETUP_TRUSTED_ISSUERS_REQUIRED');
    this.#sealKey = Buffer.from(options.sealKey);
    this.#commitmentKey = Buffer.from(options.commitmentKey);
    this.#taxpayerReferenceKey = Buffer.from(options.taxpayerReferenceKey);
    this.#db = openSqlDatabase(options.databasePath);
    this.#db.configure({ wal: true, secureDelete: true });
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS arca_setup_sessions (
        setup_ref TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL UNIQUE,
        onboarding_id TEXT NOT NULL,
        workspace_id_hash TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        environment TEXT NOT NULL,
        taxpayer_reference_hash TEXT NOT NULL,
        issuer_profile_ref TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL,
        state TEXT NOT NULL,
        represented_cuit_commitment TEXT,
        login_identity_hash TEXT,
        enrollment_ref TEXT UNIQUE,
        alias TEXT,
        csr_hash TEXT,
        certificate_fingerprint TEXT,
        certificate_valid_until TEXT,
        sealed TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arca_setup_events (
        event_id TEXT PRIMARY KEY,
        setup_ref_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
    `);
  }

  /** Idempotent per execution: a retry returns the existing session. */
  createSession(raw: unknown, occurredAt: string): SetupStatus {
    const input = setupSessionCreateSchema.parse(raw);
    if (input.environment !== this.options.environment) throw new Error('ARCA_SETUP_ENVIRONMENT_MISMATCH');
    if (input.mode === 'provider_delegation' && !this.options.providerTemplate)
      throw new Error('ARCA_SETUP_PROVIDER_TEMPLATE_NOT_CONFIGURED');
    const existing = this.#db.query<SetupRow, [string]>('SELECT * FROM arca_setup_sessions WHERE execution_id = ?').get(input.executionId);
    if (existing) {
      if (
        existing.onboarding_id !== input.onboardingId
        || existing.workspace_id !== input.workspaceId
        || existing.taxpayer_reference_hash !== input.taxpayerReferenceHash
        || existing.issuer_profile_ref !== input.issuerProfileRef
        || existing.mode !== input.mode
      ) throw new Error('ARCA_SETUP_SESSION_IDEMPOTENCY_CONFLICT');
      return status(existing);
    }
    const setupRef = `setup://${randomUUID()}`;
    const sealed = this.seal(setupRef, { representedCuit: null, privateKeyPem: null, csrPem: null, certificatePem: null });
    this.#db.query(`
      INSERT INTO arca_setup_sessions (
        setup_ref, execution_id, onboarding_id, workspace_id_hash, workspace_id, environment,
        taxpayer_reference_hash, issuer_profile_ref, mode, state, sealed, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)
    `).run(
      setupRef, input.executionId, input.onboardingId, hashCanonical(input.workspaceId), input.workspaceId,
      input.environment, input.taxpayerReferenceHash, input.issuerProfileRef, input.mode, sealed,
      occurredAt, occurredAt, new Date(Date.parse(occurredAt) + SESSION_TTL_MS).toISOString(),
    );
    this.event(setupRef, 'arca_setup_session_created', hashCanonical({ mode: input.mode }), occurredAt);
    return status(this.row(setupRef, occurredAt));
  }

  /**
   * The executor read these CUITs from the authenticated ARCA page. Only the
   * candidate matching the run's taxpayer reference is kept; the rest are dropped.
   */
  matchTaxpayer(raw: unknown, occurredAt: string): Readonly<{
    version: 'arca-setup-taxpayer-match-result-v1';
    matched: boolean;
    matchIndex: number | null;
    representedCuitCommitment: string | null;
    loginIdentityHash: string;
  }> {
    const input = setupTaxpayerMatchSchema.parse(raw);
    const row = this.row(input.setupRef, occurredAt);
    if (row.execution_id !== input.executionId) throw new Error('ARCA_SETUP_EXECUTION_MISMATCH');
    const loginIdentityHash = hashCanonical({ purpose: 'arca-setup-login-identity-v1', commitment: commitRepresentedCuit(this.#commitmentKey, input.loginCuit) });
    const matchIndex = input.candidates.findIndex(candidate =>
      referenceRepresentedCuit(this.#taxpayerReferenceKey, candidate) === row.taxpayer_reference_hash);
    if (matchIndex < 0) {
      this.event(input.setupRef, 'arca_setup_taxpayer_not_matched', hashCanonical({ count: input.candidates.length }), occurredAt);
      return { version: 'arca-setup-taxpayer-match-result-v1', matched: false, matchIndex: null, representedCuitCommitment: null, loginIdentityHash };
    }
    const representedCuit = input.candidates[matchIndex]!;
    const commitment = commitRepresentedCuit(this.#commitmentKey, representedCuit);
    const sealed = this.open(row);
    if (sealed.representedCuit && sealed.representedCuit !== representedCuit) throw new Error('ARCA_SETUP_TAXPAYER_CHANGED');
    this.#db.query(`
      UPDATE arca_setup_sessions SET sealed = ?, represented_cuit_commitment = ?, login_identity_hash = ?,
        state = CASE WHEN state = 'created' THEN 'attested' ELSE state END, updated_at = ?
      WHERE setup_ref = ?
    `).run(this.seal(row.setup_ref, { ...sealed, representedCuit }), commitment, loginIdentityHash, occurredAt, row.setup_ref);
    this.event(input.setupRef, 'arca_setup_taxpayer_matched', commitment, occurredAt);
    return { version: 'arca-setup-taxpayer-match-result-v1', matched: true, matchIndex, representedCuitCommitment: commitment, loginIdentityHash };
  }

  /** Generate the key pair and CSR. Idempotent: the same session keeps one enrollment. */
  createEnrollment(raw: unknown, occurredAt: string): Readonly<{
    version: 'arca-setup-enrollment-v1';
    enrollmentRef: string;
    csrHash: string;
    alias: string;
  }> {
    const input = setupEnrollmentCreateSchema.parse(raw);
    const row = this.row(input.setupRef, occurredAt);
    if (row.mode !== 'customer_certificate') throw new Error('ARCA_SETUP_ENROLLMENT_NOT_APPLICABLE');
    if (row.enrollment_ref) {
      if (row.alias !== input.alias) throw new Error('ARCA_SETUP_ENROLLMENT_ALIAS_CONFLICT');
      return { version: 'arca-setup-enrollment-v1', enrollmentRef: row.enrollment_ref, csrHash: row.csr_hash!, alias: row.alias };
    }
    const sealed = this.open(row);
    if (!sealed.representedCuit) throw new Error('ARCA_SETUP_TAXPAYER_NOT_ATTESTED');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const csrPem = createCsr(privateKeyPem, input.alias, sealed.representedCuit);
    const enrollmentRef = `enrollment://${randomUUID()}`;
    const csrHash = hashCanonical(csrPem);
    this.#db.query(`
      UPDATE arca_setup_sessions SET sealed = ?, enrollment_ref = ?, alias = ?, csr_hash = ?, state = 'enrolled', updated_at = ?
      WHERE setup_ref = ?
    `).run(this.seal(row.setup_ref, { ...sealed, privateKeyPem, csrPem }), enrollmentRef, input.alias, csrHash, occurredAt, row.setup_ref);
    this.event(input.setupRef, 'arca_setup_enrollment_created', csrHash, occurredAt);
    return { version: 'arca-setup-enrollment-v1', enrollmentRef, csrHash, alias: input.alias };
  }

  /** The executor needs the CSR bytes to upload. The CSR is public; the key is not returned. */
  readCsr(raw: unknown, occurredAt: string): Readonly<{ version: 'arca-setup-csr-v1'; csrPem: string; csrHash: string; alias: string }> {
    const input = setupCsrReadSchema.parse(raw);
    const row = this.row(input.setupRef, occurredAt);
    if (row.execution_id !== input.executionId || row.enrollment_ref !== input.enrollmentRef)
      throw new Error('ARCA_SETUP_ENROLLMENT_NOT_FOUND');
    const sealed = this.open(row);
    if (!sealed.csrPem) throw new Error('ARCA_SETUP_ENROLLMENT_NOT_FOUND');
    return { version: 'arca-setup-csr-v1', csrPem: sealed.csrPem, csrHash: row.csr_hash!, alias: row.alias! };
  }

  /**
   * Import the certificate ARCA issued. It must belong to the generated key,
   * name the attested CUIT, be currently valid, and chain to a trusted ARCA CA.
   * Re-importing the same certificate is a no-op; a different one is refused.
   */
  importCertificate(raw: unknown, occurredAt: string): Readonly<{
    version: 'arca-setup-certificate-import-receipt-v1';
    certificateFingerprint: string;
    validFrom: string;
    validUntil: string;
    chainVerified: boolean;
  }> {
    const input = setupCertificateImportSchema.parse(raw);
    const row = this.row(input.setupRef, occurredAt);
    if (row.execution_id !== input.executionId || row.enrollment_ref !== input.enrollmentRef)
      throw new Error('ARCA_SETUP_ENROLLMENT_NOT_FOUND');
    const sealed = this.open(row);
    if (!sealed.privateKeyPem || !sealed.representedCuit) throw new Error('ARCA_SETUP_ENROLLMENT_NOT_FOUND');
    const certificatePem = normalizePem(input.certificatePem);
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(certificatePem);
    } catch {
      throw new Error('ARCA_SETUP_CERTIFICATE_INVALID');
    }
    const fingerprint = certificate.fingerprint256.replaceAll(':', '').toLowerCase();
    if (row.certificate_fingerprint) {
      if (row.certificate_fingerprint !== fingerprint) throw new Error('ARCA_SETUP_CERTIFICATE_ALREADY_IMPORTED');
      return {
        version: 'arca-setup-certificate-import-receipt-v1',
        certificateFingerprint: fingerprint,
        validFrom: new Date(certificate.validFrom).toISOString(),
        validUntil: new Date(certificate.validTo).toISOString(),
        chainVerified: this.verifyChain(certificate),
      };
    }
    if (!certificateMatchesPrivateKey(certificate, sealed.privateKeyPem))
      throw new Error('ARCA_SETUP_CERTIFICATE_KEY_MISMATCH');
    const subjectCuit = /serialNumber=CUIT (\d{11})/.exec(certificate.subject)?.[1];
    if (subjectCuit !== sealed.representedCuit) throw new Error('ARCA_SETUP_CERTIFICATE_SUBJECT_MISMATCH');
    const now = Date.parse(occurredAt);
    if (Date.parse(certificate.validFrom) > now + 5 * 60_000 || Date.parse(certificate.validTo) <= now + 60_000)
      throw new Error('ARCA_SETUP_CERTIFICATE_NOT_CURRENT');
    const chainVerified = this.verifyChain(certificate);
    if (!chainVerified && this.options.environment === 'production')
      throw new Error('ARCA_SETUP_CERTIFICATE_ISSUER_UNTRUSTED');
    this.#db.query(`
      UPDATE arca_setup_sessions SET sealed = ?, certificate_fingerprint = ?, certificate_valid_until = ?,
        state = 'certificate_imported', updated_at = ?
      WHERE setup_ref = ?
    `).run(
      this.seal(row.setup_ref, { ...sealed, certificatePem }), fingerprint,
      new Date(certificate.validTo).toISOString(), occurredAt, row.setup_ref,
    );
    this.event(input.setupRef, 'arca_setup_certificate_imported', fingerprint, occurredAt);
    return {
      version: 'arca-setup-certificate-import-receipt-v1',
      certificateFingerprint: fingerprint,
      validFrom: new Date(certificate.validFrom).toISOString(),
      validUntil: new Date(certificate.validTo).toISOString(),
      chainVerified,
    };
  }

  /**
   * Provision the issuer WSAA uses. Customer certificate: the imported
   * certificate and its generated key. Provider delegation: BUFI's stored
   * template certificate bound to the attested represented CUIT, only with
   * evidence that the customer delegated and BUFI accepted.
   */
  provision(raw: unknown, occurredAt: string): IssuerProvisionReceipt {
    const input = setupProvisionSchema.parse(raw);
    const row = this.row(input.setupRef, occurredAt);
    const sealed = this.open(row);
    if (!sealed.representedCuit) throw new Error('ARCA_SETUP_TAXPAYER_NOT_ATTESTED');
    let holderCuit: string;
    let certificatePem: string;
    let privateKeyPem: string;
    if (row.mode === 'customer_certificate') {
      if (!sealed.certificatePem || !sealed.privateKeyPem) throw new Error('ARCA_SETUP_CERTIFICATE_NOT_IMPORTED');
      holderCuit = sealed.representedCuit;
      certificatePem = sealed.certificatePem;
      privateKeyPem = sealed.privateKeyPem;
    } else {
      if (!input.providerAcceptanceEvidenceHash) throw new Error('ARCA_SETUP_PROVIDER_ACCEPTANCE_REQUIRED');
      const template = this.options.providerTemplate;
      if (!template) throw new Error('ARCA_SETUP_PROVIDER_TEMPLATE_NOT_CONFIGURED');
      const credential = this.options.issuers.getIssuer(template.workspaceId, template.issuerProfileRef, row.environment);
      if (!credential.active || !credential.delegationConfirmed || credential.certificateHolderCuit !== credential.representedCuit)
        throw new Error('ARCA_SETUP_PROVIDER_TEMPLATE_NOT_OWNED');
      if (credential.certificateHolderCuit === sealed.representedCuit) throw new Error('ARCA_SETUP_PROVIDER_IS_TAXPAYER');
      holderCuit = credential.certificateHolderCuit;
      certificatePem = credential.certificatePem;
      privateKeyPem = credential.privateKeyPem;
    }
    const validated = validateIssuerCredential({
      workspaceId: row.workspace_id,
      issuerProfileRef: row.issuer_profile_ref,
      environment: row.environment,
      certificateHolderCuit: holderCuit,
      representedCuit: sealed.representedCuit,
      certificatePem,
      privateKeyPem,
      // Attested by recorded executor evidence of the ARCA relationships, not by a flag.
      delegationConfirmed: true,
    }, new Date(occurredAt));
    const receipt = this.options.issuers.provisionIssuer({ ...validated, replaceCertificateFingerprint: null, occurredAt });
    this.#db.query("UPDATE arca_setup_sessions SET state = 'provisioned', updated_at = ? WHERE setup_ref = ?").run(occurredAt, row.setup_ref);
    this.event(input.setupRef, 'arca_setup_provisioned', hashCanonical({
      relationshipEvidenceHash: input.relationshipEvidenceHash,
      providerAcceptanceEvidenceHash: input.providerAcceptanceEvidenceHash,
      certificateFingerprint: receipt.certificateFingerprint,
    }), occurredAt);
    return receipt;
  }

  status(raw: unknown, occurredAt: string): SetupStatus {
    const input = setupStatusSchema.parse(raw);
    return status(this.row(input.setupRef, occurredAt, true));
  }

  close(): void {
    this.#sealKey.fill(0);
    this.#commitmentKey.fill(0);
    this.#taxpayerReferenceKey.fill(0);
    this.#db.close();
  }

  private verifyChain(certificate: X509Certificate): boolean {
    return this.options.trustedIssuers.some(pem => {
      try {
        const issuer = new X509Certificate(pem);
        return certificate.checkIssued(issuer) && certificate.verify(issuer.publicKey);
      } catch {
        return false;
      }
    });
  }

  private row(setupRef: string, occurredAt: string, allowExpired = false): SetupRow {
    const row = this.#db.query<SetupRow, [string]>('SELECT * FROM arca_setup_sessions WHERE setup_ref = ?').get(setupRef);
    if (!row) throw new Error('ARCA_SETUP_SESSION_NOT_FOUND');
    if (!allowExpired && Date.parse(row.expires_at) <= Date.parse(occurredAt) && row.state !== 'provisioned')
      throw new Error('ARCA_SETUP_SESSION_EXPIRED');
    return row;
  }

  private seal(setupRef: string, value: SealedSetup): string {
    return sealJson(this.#sealKey, `arca-setup-session-v1\0${setupRef}`, value);
  }

  private open(row: SetupRow): SealedSetup {
    return openJson(this.#sealKey, `arca-setup-session-v1\0${row.setup_ref}`, row.sealed) as SealedSetup;
  }

  private event(setupRef: string, action: string, artifactHash: string, occurredAt: string): void {
    this.#db.query('INSERT INTO arca_setup_events (event_id, setup_ref_hash, action, artifact_hash, occurred_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), hashCanonical(setupRef), action, artifactHash, occurredAt);
  }
}

function status(row: SetupRow): SetupStatus {
  return {
    version: 'arca-setup-session-status-v1',
    setupRef: row.setup_ref,
    executionId: row.execution_id,
    state: row.state,
    mode: row.mode,
    representedCuitCommitment: row.represented_cuit_commitment,
    loginIdentityHash: row.login_identity_hash,
    enrollmentRef: row.enrollment_ref,
    csrHash: row.csr_hash,
    certificateFingerprint: row.certificate_fingerprint,
    certificateValidUntil: row.certificate_valid_until,
    expiresAt: row.expires_at,
  };
}

/** ARCA requires `serialNumber=CUIT <11 digits>` in the subject (WSAA.ObtenerCertificado). */
export function createCsr(privateKeyPem: string, alias: string, representedCuit: string): string {
  if (!ALIAS.test(alias)) throw new Error('ARCA_SETUP_ALIAS_INVALID');
  if (!/^\d{11}$/.test(representedCuit)) throw new Error('ARCA_SETUP_CUIT_INVALID');
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  csr.setSubject([
    { shortName: 'C', value: 'AR' },
    { shortName: 'O', value: 'BUFI' },
    { shortName: 'CN', value: alias },
    { name: 'serialNumber', value: `CUIT ${representedCuit}` },
  ]);
  csr.sign(privateKey, forge.md.sha256.create());
  if (!csr.verify()) throw new Error('ARCA_SETUP_CSR_INVALID');
  return forge.pki.certificationRequestToPem(csr);
}

/**
 * `X509Certificate.checkPrivateKey` returns false for a matching key in workerd,
 * so compare the SPKI DER of the certificate key and of the private key's public half.
 */
export function certificateMatchesPrivateKey(certificate: X509Certificate, privateKeyPem: string): boolean {
  // Node and workerd accept a private KeyObject here; @types/node does not declare it.
  const fromKey = createPublicKey(createPrivateKey(privateKeyPem) as never).export({ type: 'spki', format: 'der' });
  const fromCertificate = certificate.publicKey.export({ type: 'spki', format: 'der' });
  return fromKey.equals(fromCertificate);
}

function normalizePem(value: string): string {
  const trimmed = value.trim().replace(/\r\n/g, '\n');
  if (trimmed.startsWith('-----BEGIN CERTIFICATE-----')) return `${trimmed}\n`;
  // ARCA's download is sometimes base64 DER without armor.
  const compact = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) throw new Error('ARCA_SETUP_CERTIFICATE_INVALID');
  return `-----BEGIN CERTIFICATE-----\n${compact.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}
