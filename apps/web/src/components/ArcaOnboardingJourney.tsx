import { useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';

import { ARCA_ONBOARDING_UI_STEPS, arcaScopeDescriptions } from './ArcaOnboardingJourney.model';

export function ArcaOnboardingJourney() {
  const [scope, setScope] = useState<'wsfex' | 'wsfex_wsfe'>('wsfex_wsfe');
  const [handoffStarted, setHandoffStarted] = useState(false);

  const scopeDescriptions = arcaScopeDescriptions(scope);

  return (
    <section className="panel arca-onboarding" aria-labelledby="arca-onboarding-heading">
      <div className="section-heading">
        <span className="step-number">3</span>
        <div>
          <p className="eyebrow">Argentina · Authority setup</p>
          <h2 id="arca-onboarding-heading">Connect ARCA without sharing your Clave Fiscal</h2>
          <p>One guided setup per taxpayer. After delegation, Motora signs API calls with its own certificate on behalf of that CUIT.</p>
        </div>
      </div>

      <div className="onboarding-config">
        <label>
          Invoice scope
          <select value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
            <option value="wsfex_wsfe">Export + local · WSFEX and WSFE</option>
            <option value="wsfex">Export only · WSFEX</option>
          </select>
        </label>
        <div className="credential-boundary">
          <KeyRound aria-hidden="true" />
          <div><strong>Credential boundary</strong><span>Clave Fiscal stays between you and ARCA.</span></div>
        </div>
      </div>

      <ol className="onboarding-steps">
        {ARCA_ONBOARDING_UI_STEPS.map((step, index) => {
          const active = index === 0;
          const scopeNote = scope === 'wsfex' && step.id === 'ws_delegation';
          return (
            <li key={step.id} className={active ? 'onboarding-step-active' : ''} data-step={step.id}>
              <div className="onboarding-step-icon">
                {step.id === 'ready' ? <ShieldCheck aria-hidden="true" /> : active ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
              </div>
              <div className="onboarding-step-copy">
                <div><span>{String(index + 1).padStart(2, '0')}</span><h3>{step.title}</h3></div>
                <p>{step.id === 'api_verification' ? scopeDescriptions.apiVerification : step.id === 'ready' ? scopeDescriptions.ready : step.description}</p>
                {scopeNote && <small>WSFE is omitted for export-only scope; WSFEX delegation remains required.</small>}
              </div>
              <span className="onboarding-owner">{step.owner}</span>
            </li>
          );
        })}
      </ol>

      <div className="onboarding-handoff">
        <div>
          <strong>{handoffStarted ? 'ARCA handoff requested' : 'Begin with a user-controlled ARCA session'}</strong>
          <p>{handoffStarted ? 'Continue in the ARCA tab, then return to Motora. If it did not appear, use Open ARCA again. No password or session token crosses this boundary.' : 'Motora guides each screen and pauses before any service, point-of-sale, or delegation change.'}</p>
        </div>
        <a
          className="primary-button onboarding-button"
          href="https://auth.afip.gob.ar/contribuyente_/login.xhtml"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setHandoffStarted(true)}
        >
          {handoffStarted ? 'Open ARCA again' : 'Continue with ARCA'} <ExternalLink aria-hidden="true" />
        </a>
      </div>

      <div className="execution-gate onboarding-gate">
        <LockKeyhole aria-hidden="true" />
        <div><strong>ZK is evidence, not authority</strong><p>Reclaim cannot create a point of sale or delegation. `ready` requires ARCA API verification bound to the same taxpayer and point of sale.</p></div>
      </div>
    </section>
  );
}
