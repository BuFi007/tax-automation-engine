import { useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';

const STEPS = [
  {
    id: 'login_handoff',
    title: 'Secure login handoff',
    description: 'You enter CUIT and Clave Fiscal directly on ARCA. Motora pauses and never receives credentials or cookies.',
    owner: 'You',
  },
  {
    id: 'service_adherence',
    title: 'Enable portal services',
    description: 'Add Point-of-Sale Administration and Relationship Manager only if missing. Every account change needs your confirmation.',
    owner: 'You + Motora',
  },
  {
    id: 'point_of_sale_discovery',
    title: 'Discover points of sale',
    description: 'Look for an active export point of sale first. An existing compatible point skips creation.',
    owner: 'Motora',
  },
  {
    id: 'point_of_sale_creation',
    title: 'Create export point of sale',
    description: 'Create the compatible FEEWS point only when discovery found none, after an explicit confirmation.',
    owner: 'You + Motora',
  },
  {
    id: 'ws_delegation',
    title: 'Delegate web services',
    description: 'Delegate WSFEX and WSFE to Motora’s reviewed certificate. Your Clave Fiscal is never part of API calls.',
    owner: 'You',
  },
  {
    id: 'api_verification',
    title: 'Verify ARCA APIs',
    description: 'WSFEX and WSFE independently confirm delegation and the active point of sale for this taxpayer.',
    owner: 'Motora',
  },
  {
    id: 'zk_evidence',
    title: 'Seal ZK evidence',
    description: 'Reclaim WITNESS proves the minimum onboarding facts. Raw portal responses stay in encrypted proof custody.',
    owner: 'Reclaim + Motora',
  },
  {
    id: 'ready',
    title: 'Ready',
    description: 'Electronic invoicing becomes available only after both authoritative API receipts and verified ZK evidence agree.',
    owner: 'Deterministic gate',
  },
] as const;

export function ArcaOnboardingJourney() {
  const [scope, setScope] = useState<'wsfex' | 'wsfex_wsfe'>('wsfex_wsfe');
  const [handoffStarted, setHandoffStarted] = useState(false);

  const openHandoff = () => {
    setHandoffStarted(true);
    window.open('https://auth.afip.gob.ar/contribuyente_/login.xhtml', '_blank', 'noopener,noreferrer');
  };

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
        {STEPS.map((step, index) => {
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
          <strong>{handoffStarted ? 'Secure handoff opened' : 'Begin with a user-controlled ARCA session'}</strong>
          <p>{handoffStarted ? 'Finish signing in on ARCA, then return to Motora. No password or session token crosses this boundary.' : 'Motora guides each screen and pauses before any service, point-of-sale, or delegation change.'}</p>
        </div>
        <button className="primary-button onboarding-button" type="button" onClick={openHandoff}>
          {handoffStarted ? 'Open ARCA again' : 'Continue with ARCA'} <ExternalLink aria-hidden="true" />
        </button>
      </div>

      <div className="execution-gate onboarding-gate">
        <LockKeyhole aria-hidden="true" />
        <div><strong>ZK is evidence, not authority</strong><p>Reclaim cannot create a point of sale or delegation. `ready` requires ARCA API verification bound to the same taxpayer and point of sale.</p></div>
      </div>
    </section>
  );
}

export { STEPS as ARCA_ONBOARDING_UI_STEPS };

export function arcaScopeDescriptions(scope: 'wsfex' | 'wsfex_wsfe') {
  return scope === 'wsfex'
    ? {
        apiVerification: 'WSFEX independently confirms delegation and the active export point of sale for this taxpayer.',
        ready: 'Electronic export invoicing becomes available only after the authoritative WSFEX receipt and verified ZK evidence agree.',
      }
    : {
        apiVerification: 'WSFEX and WSFE independently confirm delegation and the active point of sale for this taxpayer.',
        ready: 'Electronic invoicing becomes available only after both authoritative API receipts and verified ZK evidence agree.',
      };
}
