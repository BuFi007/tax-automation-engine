import { AlertTriangle, ArrowRight, CheckCircle2, Database, ShieldCheck } from 'lucide-react';

import type { TaxWidgetSnapshotV1 } from '@tax-engine/core';

export function TaxWidget({ snapshot, onOpenWorkspace }: { snapshot: TaxWidgetSnapshotV1; onOpenWorkspace: () => void }) {
  const connected = snapshot.sourceCoverage.filter(source => source.connectionState === 'connected').length;
  const totalSources = snapshot.sourceCoverage.length;
  const blockingGaps = snapshot.evidenceCoverage.gaps.filter(gap => gap.severity === 'blocking').length;
  const nextStep = snapshot.nextSteps[0];

  return (
    <article className="widget-card" aria-labelledby="tax-widget-title">
      <header className="widget-header">
        <div>
          <p className="eyebrow">Evidence position</p>
          <h2 id="tax-widget-title">{snapshot.profile.jurisdiction} · {humanize(snapshot.profile.regimeId)}</h2>
        </div>
        <span className={`status-pill status-${snapshot.estimate.state}`}>
          {snapshot.estimate.state.replaceAll('_', ' ')}
        </span>
      </header>

      <div className="widget-metric">
        <span>Supported net activity</span>
        <strong>{snapshot.estimate.amount ? formatMoney(snapshot.estimate.amount.decimal, snapshot.estimate.amount.currency) : 'Unavailable'}</strong>
        <small>{snapshot.estimate.warning}</small>
      </div>

      <div className="widget-grid">
        <div><Database aria-hidden="true" /><span>Sources</span><strong>{connected}/{totalSources}</strong></div>
        <div>{blockingGaps ? <AlertTriangle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}<span>Blocking gaps</span><strong>{blockingGaps}</strong></div>
        <div><CheckCircle2 aria-hidden="true" /><span>Mapped duties</span><strong>{snapshot.evidenceCoverage.obligations.mapped}/{snapshot.evidenceCoverage.obligations.applicable}</strong></div>
      </div>

      {nextStep && (
        <div className="next-action">
          <div>
            <span>Next manual action</span>
            <strong>{nextStep.title}</strong>
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
