import { ArrowUpRight, Check, Clock3, LockKeyhole, UserRoundCheck } from 'lucide-react';

import type { TaxWidgetSnapshotV1 } from '@tax-engine/core';

import { humanize } from './TaxWidget';

export function ObligationJourney({ snapshot }: { snapshot: TaxWidgetSnapshotV1 }) {
  return (
    <section className="panel" aria-labelledby="journey-heading">
      <div className="section-heading">
        <span className="step-number">3</span>
        <div>
          <h2 id="journey-heading">Manual tax journey</h2>
          <p>Preparation, review, submission, acceptance, and satisfaction remain separate.</p>
        </div>
      </div>

      <div className="journey-list">
        {snapshot.obligations.map(obligation => (
          <article className="obligation-card" key={obligation.id}>
            <div className="obligation-topline">
              <span className="obligation-category">{humanize(obligation.category)}</span>
              <span className={`source-state ${obligation.applicability === 'applicable' ? 'source-connected' : 'source-degraded'}`}>
                {obligation.applicability.replaceAll('_', ' ')}
              </span>
            </div>
            <h3>{obligation.title}</h3>
            <p>{obligation.description}</p>
            <div className="state-track" aria-label={`${obligation.title} lifecycle`}>
              <Lifecycle label="Prepare" state={obligation.preparationState} icon={Clock3} />
              <Lifecycle label="Review" state={obligation.preparationState === 'accountant_approved' ? 'approved' : 'pending'} icon={UserRoundCheck} />
              <Lifecycle label="Submit" state={obligation.submissionState} icon={LockKeyhole} />
              <Lifecycle label="Satisfy" state={obligation.satisfactionState} icon={Check} />
            </div>
            <button type="button" className="secondary-button" disabled={!obligation.actionId}>
              Review manual action <ArrowUpRight aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>

      <div className="execution-gate">
        <LockKeyhole aria-hidden="true" />
        <div><strong>Execution gate active</strong><p>No filing, payment, ARCA session, or IRS submission can run from this workspace.</p></div>
      </div>
    </section>
  );
}

function Lifecycle({ label, state, icon: Icon }: { label: string; state: string; icon: typeof Clock3 }) {
  const complete = ['accountant_approved', 'accepted', 'satisfied', 'approved'].includes(state);
  return <div className={complete ? 'lifecycle-complete' : ''}><Icon aria-hidden="true" /><span>{label}</span><small>{state.replaceAll('_', ' ')}</small></div>;
}
