import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';

import type { FounderResidency, JurisdictionCode, TaxWidgetSnapshotV1 } from '@tax-engine/core';

import { loadDemoSnapshot } from './api';
import { EvidenceCoverage } from './components/EvidenceCoverage';
import { ObligationJourney } from './components/ObligationJourney';
import { ProfileSelector } from './components/ProfileSelector';
import { TaxWidget } from './components/TaxWidget';
import { ArcaOnboardingJourney } from './components/ArcaOnboardingJourney';
import { LiveArcaOnboardingJourney } from './components/ArcaOnboardingJourney.live';
import type { ArcaOnboardingBrowserAuthority } from './api';

export function App({ arcaAuthority = null, arcaEnvironment = 'homologation', arcaRequestedServices = ['wsfex', 'wsfe'] }: Readonly<{
  arcaAuthority?: ArcaOnboardingBrowserAuthority | null;
  arcaEnvironment?: 'homologation' | 'production';
  arcaRequestedServices?: readonly ('wsfex' | 'wsfe')[];
}>) {
  const [jurisdiction, setJurisdiction] = useState<JurisdictionCode>('AR');
  const [regimeId, setRegimeId] = useState(DEFAULT_REGIMES.AR);
  const [founderResidency, setFounderResidency] = useState<FounderResidency>('foreign');
  const [snapshot, setSnapshot] = useState<TaxWidgetSnapshotV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (nextJurisdiction: JurisdictionCode, nextRegimeId: string, nextFounderResidency: FounderResidency) => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await loadDemoSnapshot(nextJurisdiction, nextRegimeId, nextFounderResidency));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load tax workspace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(jurisdiction, regimeId, founderResidency); }, [jurisdiction, regimeId, founderResidency]);

  const selectJurisdiction = (nextJurisdiction: JurisdictionCode) => {
    setJurisdiction(nextJurisdiction);
    setRegimeId(DEFAULT_REGIMES[nextJurisdiction]);
  };

  return (
    <main>
      <header className="page-header">
        <div className="brand-mark"><ShieldCheck aria-hidden="true" /></div>
        <div className="page-title"><p className="eyebrow">BUFI · Human product</p><h1>Tax Automation Engine</h1><p>Deterministic evidence, manual workflows, and explicit approval gates.</p></div>
        <button className="icon-button" type="button" onClick={() => void load(jurisdiction, regimeId, founderResidency)} aria-label="Refresh workspace"><RefreshCw aria-hidden="true" /></button>
      </header>

      {loading && <div className="loading-panel" role="status">Building the evidence-backed tax snapshot…</div>}
      {error && <div className="error-panel" role="alert"><strong>Could not load the API.</strong><span>{error}</span><code>bun run dev:api</code></div>}

      {snapshot && !loading && (
        <>
          <section className="hero-grid">
            <div className="hero-copy"><span className="status-pill status-review_ready">Manual workflow</span><h2>One tax core.<br />Jurisdiction packs for every market.</h2><p>Argentina is the launch wedge. The U.S. pack uses the same evidence graph, obligation lifecycle, consent model, and browser-safe snapshot.</p></div>
            <TaxWidget snapshot={snapshot} onOpenWorkspace={() => document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' })} />
          </section>
          <div id="workspace" className="workspace-grid">
            <ProfileSelector
              jurisdiction={jurisdiction}
              selectedRegime={snapshot.profile.regimeId}
              onJurisdictionChange={selectJurisdiction}
              onRegimeChange={setRegimeId}
              founderResidency={founderResidency}
              onFounderResidencyChange={setFounderResidency}
            />
            <EvidenceCoverage snapshot={snapshot} />
            {jurisdiction === 'AR' && (arcaAuthority
              ? <LiveArcaOnboardingJourney snapshot={snapshot} authority={arcaAuthority} environment={arcaEnvironment} requestedServices={arcaRequestedServices} />
              : <ArcaOnboardingJourney />)}
            <ObligationJourney snapshot={snapshot} />
          </div>
        </>
      )}
    </main>
  );
}

const DEFAULT_REGIMES: Record<JurisdictionCode, string> = {
  AR: 'monotributo_exportador',
  US: 'llc_single_member',
};
