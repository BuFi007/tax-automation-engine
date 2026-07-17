import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';

import type { TaxWidgetSnapshotReceiptV1 } from '@tax-engine/browser-contracts';

import { loadTaxSnapshot, type TaxSnapshotBrowserAuthority } from './api';
import { EvidenceCoverage } from './components/EvidenceCoverage';
import { ObligationJourney } from './components/ObligationJourney';
import { ProfileSelector } from './components/ProfileSelector';
import { TaxWidget } from './components/TaxWidget';
import { ArcaOnboardingJourney } from './components/ArcaOnboardingJourney';
import { LiveArcaOnboardingJourney } from './components/ArcaOnboardingJourney.live';
import { EmaraTaxJourney } from './components/EmaraTaxJourney';
import type { ArcaOnboardingBrowserAuthority } from './arca-api';

export function App({ taxAuthority = null, arcaAuthority = null, arcaEnvironment = 'homologation', arcaRequestedServices = ['wsfex', 'wsfe'] }: Readonly<{
  taxAuthority?: TaxSnapshotBrowserAuthority | null;
  arcaAuthority?: ArcaOnboardingBrowserAuthority | null;
  arcaEnvironment?: 'homologation' | 'production';
  arcaRequestedServices?: readonly ('wsfex' | 'wsfe')[];
}>) {
  const [receipt, setReceipt] = useState<TaxWidgetSnapshotReceiptV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!taxAuthority) throw new Error('TAX_SNAPSHOT_BROWSER_AUTHORITY_REQUIRED');
      setReceipt(await loadTaxSnapshot(taxAuthority));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load tax workspace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [taxAuthority]);

  const snapshot = receipt?.snapshot ?? null;

  return (
    <main>
      <header className="page-header">
        <div className="brand-mark"><ShieldCheck aria-hidden="true" /></div>
        <div className="page-title"><p className="eyebrow">BUFI · Human product</p><h1>Tax Automation Engine</h1><p>Deterministic evidence, manual workflows, and explicit approval gates.</p></div>
        <button className="icon-button" type="button" onClick={() => void load()} aria-label="Refresh workspace"><RefreshCw aria-hidden="true" /></button>
      </header>

      {loading && <div className="loading-panel" role="status">Building the evidence-backed tax snapshot…</div>}
      {error && <div className="error-panel" role="alert"><strong>Could not load the API.</strong><span>{error}</span><code>bun run dev:api</code></div>}

      {snapshot && !loading && (
        <>
          <section className="hero-grid">
            <div className="hero-copy"><span className="status-pill status-review_ready">Manual workflow</span><h2>One tax core.<br />Jurisdiction packs for every market.</h2><p>Argentina is the launch wedge. U.S. entities and Dubai Free Zone companies use the same evidence graph, obligation lifecycle, consent model, and browser-safe snapshot.</p></div>
            <TaxWidget snapshot={snapshot} onOpenWorkspace={() => document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' })} />
          </section>
          <div id="workspace" className="workspace-grid">
            <ProfileSelector profile={snapshot.profile} />
            <EvidenceCoverage snapshot={snapshot} />
            {snapshot.profile.jurisdiction === 'AR' && (arcaAuthority
              ? <LiveArcaOnboardingJourney snapshot={snapshot} authority={arcaAuthority} environment={arcaEnvironment} requestedServices={arcaRequestedServices} />
              : <ArcaOnboardingJourney />)}
            {snapshot.profile.jurisdiction === 'AE' && <EmaraTaxJourney snapshot={snapshot} />}
            <ObligationJourney snapshot={snapshot} />
          </div>
        </>
      )}
    </main>
  );
}
