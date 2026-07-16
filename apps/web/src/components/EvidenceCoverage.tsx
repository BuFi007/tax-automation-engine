import { AlertCircle, CheckCircle2, CircleDashed, PlugZap } from 'lucide-react';

import type { TaxWidgetSnapshotV1 } from '@tax-engine/browser-contracts';

import { formatMoney, humanize } from './TaxWidget';

export function EvidenceCoverage({ snapshot }: { snapshot: TaxWidgetSnapshotV1 }) {
  const { evidenceCoverage } = snapshot;
  return (
    <section className="panel" aria-labelledby="coverage-heading">
      <div className="section-heading">
        <span className="step-number">2</span>
        <div>
          <h2 id="coverage-heading">Evidence coverage</h2>
          <p>One reconciled view across workspace, banks, accounting, Inbox, graph, and analytics.</p>
        </div>
      </div>

      <div className="coverage-metrics">
        <CoverageMetric label="Revenue reconciled" current={evidenceCoverage.reconciledRevenue} total={evidenceCoverage.invoicedRevenue} />
        <CoverageMetric label="Expenses supported" current={evidenceCoverage.supportedExpenses} total={evidenceCoverage.recordedExpenses} />
        <div className="coverage-card"><span>Obligations mapped</span><strong>{evidenceCoverage.mappedObligations}/{evidenceCoverage.applicableObligations}</strong></div>
      </div>

      <div className="source-list" aria-label="Evidence sources">
        {snapshot.sourceHealth.sources.map(source => (
          <div className="source-row" key={source.sourceRef}>
            <div className="source-icon"><PlugZap aria-hidden="true" /></div>
            <div className="source-copy"><strong>{source.providerDescriptor.displayName}</strong><span>{source.acceptedEvidenceCount} accepted · {source.needsReviewCount} review</span></div>
            <span className={`source-state source-${source.state}`}>{source.state}</span>
          </div>
        ))}
      </div>

      {evidenceCoverage.gaps.length > 0 && (
        <div className="gap-list">
          <h3>Missing links</h3>
          {evidenceCoverage.gaps.map(gap => (
            <div className="gap-row" key={gap.gapRef}>
              {gap.severity === 'blocking' ? <AlertCircle aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
              <div><strong>{humanize(gap.kind)}</strong><span>{gap.severity} · manual review required</span></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CoverageMetric({ label, current, total }: {
  label: string;
  current: { decimal: string; currency: string } | null;
  total: { decimal: string; currency: string } | null;
}) {
  return (
    <div className="coverage-card">
      <span>{label}</span>
      <strong>{current ? formatMoney(current.decimal, current.currency) : 'Unavailable'}</strong>
      <small>{total ? `of ${formatMoney(total.decimal, total.currency)}` : 'No source total'}</small>
      {current && total && current.decimal === total.decimal ? <CheckCircle2 aria-label="Fully covered" /> : null}
    </div>
  );
}
