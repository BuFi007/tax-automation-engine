import { AlertTriangle, ArrowRight, CheckCircle2, Database, ShieldCheck } from 'lucide-react';

import type { TaxWidgetSnapshotV1 } from '@tax-engine/browser-contracts';

export function TaxWidget({ snapshot, onOpenWorkspace }: { snapshot: TaxWidgetSnapshotV1; onOpenWorkspace: () => void }) {
  const connected = snapshot.sourceHealth.sources.filter(source => source.state === 'connected').length;
  const totalSources = snapshot.sourceHealth.sources.length;
  const blockingGaps = snapshot.evidenceCoverage.gaps.filter(gap => gap.severity === 'blocking').length;
  const nextStep = snapshot.obligations.find(obligation => obligation.actionId !== null);

  return (
    <article className="widget-card" aria-labelledby="tax-widget-title">
      <header className="widget-header">
        <div>
          <p className="eyebrow">Evidence position</p>
          <h2 id="tax-widget-title">{snapshot.profile.jurisdiction} · {humanize(snapshot.profile.regimeId)}</h2>
        </div>
        <span className={`status-pill status-${snapshot.taxPosition.state}`}>
          {snapshot.taxPosition.state.replaceAll('_', ' ')}
        </span>
      </header>

      <div className="widget-metric">
        <span>Reconciled gross activity</span>
        <strong>{snapshot.activity.grossIncome ? formatMoney(snapshot.activity.grossIncome.decimal, snapshot.activity.grossIncome.currency) : 'Unavailable'}</strong>
        <small>Evidence-derived activity, not a filed tax liability.</small>
      </div>

      <div className="widget-grid">
        <div><Database aria-hidden="true" /><span>Sources</span><strong>{connected}/{totalSources}</strong></div>
        <div>{blockingGaps ? <AlertTriangle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}<span>Blocking gaps</span><strong>{blockingGaps}</strong></div>
        <div><CheckCircle2 aria-hidden="true" /><span>Mapped duties</span><strong>{snapshot.evidenceCoverage.mappedObligations}/{snapshot.evidenceCoverage.applicableObligations}</strong></div>
      </div>

      {(snapshot.profile.jurisdiction === 'AR' || nextStep) && (
        <div className="next-action">
          <div>
            <span>{snapshot.profile.jurisdiction === 'AR' ? 'Authority setup' : 'Next manual action'}</span>
            <strong>{snapshot.profile.jurisdiction === 'AR' ? 'Connect ARCA without sharing credentials' : nextStep?.title}</strong>
          </div>
          <ArrowRight aria-hidden="true" />
        </div>
      )}

      <button className="primary-button" type="button" onClick={onOpenWorkspace}>
        Open tax workspace <ArrowRight aria-hidden="true" />
      </button>
    </article>
  );
}

export function formatMoney(decimal: string, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(decimal));
}

export function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
