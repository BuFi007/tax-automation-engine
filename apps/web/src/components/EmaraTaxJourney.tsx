import { CheckCircle2, Circle, ExternalLink, KeyRound, ShieldCheck } from 'lucide-react';
import type { TaxWidgetSnapshotV1 } from '@tax-engine/browser-contracts';

const EMARATAX_URL = 'https://eservices.tax.gov.ae/';

export function EmaraTaxJourney({ snapshot }: { snapshot: TaxWidgetSnapshotV1 }) {
  const readiness = snapshot.jurisdictionProfileReadiness?.kind === 'ae_free_zone_entity'
    ? snapshot.jurisdictionProfileReadiness
    : null;
  const accounting = snapshot.sourceHealth.sources.filter(source => source.kind === 'accounting');
  const booksReady = accounting.some(source => source.state === 'connected');
  const profileReady = readiness !== null && readiness.state !== 'incomplete';
  const corporateTaxCertificateReady = readiness?.corporateTaxRegistration === 'certificate_available';
  const corporateTaxSubmitted = readiness?.corporateTaxRegistration === 'submitted';
  const vatAssessed = readiness !== null && !['needs_review', 'unconfirmed'].includes(readiness.vatThresholdState);
  const steps = [
    {
      id: 'accounting_evidence', title: 'Sync the books', owner: 'BUFI + you', complete: booksReady,
      description: accounting.length > 0
        ? `Use the existing ${accounting.map(source => source.providerDescriptor.displayName).join(', ')} connection as tax evidence; no duplicate tax-only OAuth.`
        : 'Connect QuickBooks, Xero, Conta Azul, or a supported ledger and reconcile the period before tax preparation.',
    },
    {
      id: 'free_zone_profile', title: 'Confirm the Dubai Free Zone profile', owner: 'You + accountant', complete: profileReady,
      description: 'Confirm formation emirate, legal form, license authority, tax period, ownership, and operating footprint.',
    },
    {
      id: 'corporate_tax_registration', title: 'Prepare Corporate Tax registration', owner: 'You + accountant', complete: corporateTaxCertificateReady,
      description: corporateTaxCertificateReady
        ? 'A certificate candidate is available. BUFI still requires verified FTA evidence before the obligation can become accepted or satisfied.'
        : corporateTaxSubmitted
        ? 'The application is submitted and remains in FTA review. This is not an acceptance or certificate.'
        : 'Build the incorporation, license, owner, and signatory packet. The final submission stays in your EmaraTax session.',
    },
    {
      id: 'vat_assessment', title: 'Assess VAT registration', owner: 'Tax engine + accountant', complete: vatAssessed,
      description: 'Classify the mandatory, voluntary, non-resident, or below-threshold route from accepted ledger evidence.',
    },
    {
      id: 'free_zone_review', title: 'Review qualifying Free Zone status', owner: 'Accountant', complete: false,
      description: 'Free Zone incorporation is not blanket 0%. Substance, qualifying income, excluded activities, de minimis, audited statements, and permanent establishments require specialist review.',
    },
    {
      id: 'emaratax_handoff', title: 'Submit and verify in EmaraTax', owner: 'You', complete: false,
      description: 'Sign in at the live FTA portal. BUFI does not store your password, UAE PASS session, cookies, or portal credentials.',
    },
  ] as const;

  return (
    <section className="panel arca-onboarding" aria-labelledby="emaratax-heading">
      <div className="section-heading">
        <span className="step-number">3</span>
        <div>
          <p className="eyebrow">Dubai Free Zone · Authority setup</p>
          <h2 id="emaratax-heading">Prepare taxes, then hand off to EmaraTax</h2>
          <p>BUFI assembles the evidence and guided packet. You or your accountant controls authentication, submission, and every FTA declaration.</p>
        </div>
      </div>

      <div className="credential-boundary">
        <KeyRound aria-hidden="true" />
        <div><strong>Credential boundary</strong><span>EmaraTax and UAE PASS credentials never enter the BUFI workspace.</span></div>
      </div>

      <ol className="onboarding-steps">
        {steps.map((step, index) => (
          <li key={step.id} data-step={step.id}>
            <div className="onboarding-step-icon">{step.complete ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}</div>
            <div className="onboarding-step-copy">
              <div><span>{String(index + 1).padStart(2, '0')}</span><h3>{step.title}</h3></div>
              <p>{step.description}</p>
            </div>
            <span className="onboarding-owner">{step.owner}</span>
          </li>
        ))}
      </ol>

      <div className="point-of-sale-next-step">
        <ShieldCheck aria-hidden="true" />
        <div><strong>Authority truth stays external</strong><p>“Submitted / in review” becomes accepted only after a verified FTA decision or certificate is attached to the same case.</p></div>
      </div>
      <a className="secondary-button" href={EMARATAX_URL} target="_blank" rel="noreferrer">Open official EmaraTax <ExternalLink aria-hidden="true" /></a>
    </section>
  );
}
