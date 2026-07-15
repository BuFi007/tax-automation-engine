import { useState } from 'react';
import { ArrowUpRight, Check, Clock3, LockKeyhole, UserRoundCheck, X } from 'lucide-react';

import type { TaxObligation, TaxWidgetSnapshotV1 } from '@tax-engine/core';

import { humanize } from './TaxWidget';
import { executionGateCopy } from './ObligationJourney.model';

export function ObligationJourney({ snapshot }: { snapshot: TaxWidgetSnapshotV1 }) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  return (
    <section className="panel" aria-labelledby="journey-heading">
      <div className="section-heading">
        <span className="step-number">{snapshot.profile.jurisdiction === 'AR' ? '4' : '3'}</span>
        <div>
          <h2 id="journey-heading">Manual tax journey</h2>
          <p>Preparation, review, submission, acceptance, and satisfaction remain separate.</p>
        </div>
      </div>

      <div className="journey-list">
        {snapshot.obligations.map(obligation => {
          const reviewing = reviewingId === obligation.id;
          const reviewPanelId = `manual-review-${obligation.id.replaceAll(':', '-')}`;
          return <article className="obligation-card" key={obligation.id}>
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
            <button
              type="button"
              className="secondary-button"
              disabled={!obligation.actionId}
              aria-expanded={reviewing}
              aria-controls={reviewPanelId}
              onClick={() => setReviewingId(reviewing ? null : obligation.id)}
            >
              {reviewing ? 'Close review' : 'Review manual action'} {reviewing ? <X aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
            </button>
            {reviewing && <ManualActionReview obligation={obligation} panelId={reviewPanelId} />}
          </article>;
        })}
      </div>

      <div className="execution-gate">
        <LockKeyhole aria-hidden="true" />
        <div><strong>Execution gate active</strong><p>{executionGateCopy(snapshot.profile.jurisdiction)}</p></div>
      </div>
    </section>
  );
}

export function ManualActionReview({ obligation, panelId }: { obligation: TaxObligation; panelId: string }) {
  return (
    <section className="manual-action-review" id={panelId} aria-label={`${obligation.title} manual review`} aria-live="polite">
      <div>
        <span>Preparation only</span>
        <strong>This action cannot file, pay, or open an authority session.</strong>
      </div>
      <dl>
        <div><dt>Current gate</dt><dd>{humanize(obligation.preparationState)}</dd></div>
        <div><dt>Submission</dt><dd>{humanize(obligation.submissionState)}</dd></div>
        <div><dt>Evidence needed</dt><dd>{obligation.evidenceRequirementIds.length} requirements</dd></div>
        <div><dt>Rule versions</dt><dd>{obligation.ruleVersionIds.length} pinned</dd></div>
      </dl>
      <p>Next: inspect the mapped evidence, resolve blocking gaps, then request accountant review. Submission remains separately approval-gated.</p>
    </section>
  );
}

function Lifecycle({ label, state, icon: Icon }: { label: string; state: string; icon: typeof Clock3 }) {
  const complete = ['accountant_approved', 'accepted', 'satisfied', 'approved'].includes(state);
  return <div className={complete ? 'lifecycle-complete' : ''}><Icon aria-hidden="true" /><span>{label}</span><small>{state.replaceAll('_', ' ')}</small></div>;
}
