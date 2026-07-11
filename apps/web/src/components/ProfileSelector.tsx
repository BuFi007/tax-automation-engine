import type { JurisdictionCode } from '@tax-engine/core';

const OPTIONS: Record<JurisdictionCode, readonly { value: string; label: string }[]> = {
  AR: [
    { value: 'monotributo_exportador', label: 'Monotributo · service exporter' },
    { value: 'responsable_inscripto', label: 'Responsable Inscripto' },
    { value: 'sociedad_mipyme', label: 'Sociedad / MiPyME' },
  ],
  US: [
    { value: 'llc_single_member', label: 'Single-member LLC' },
    { value: 'llc_multi_member', label: 'Multi-member LLC' },
    { value: 's_corp', label: 'S-Corporation' },
    { value: 'c_corp', label: 'C-Corporation' },
  ],
};

export function ProfileSelector({ jurisdiction, selectedRegime, onJurisdictionChange }: {
  jurisdiction: JurisdictionCode;
  selectedRegime: string;
  onJurisdictionChange: (jurisdiction: JurisdictionCode) => void;
}) {
  return (
    <section className="panel profile-panel" aria-labelledby="profile-heading">
      <div className="section-heading">
        <span className="step-number">1</span>
        <div>
          <h2 id="profile-heading">Confirm jurisdiction and profile</h2>
          <p>Country hints never become tax residency until you confirm them.</p>
        </div>
      </div>
      <div className="selector-grid">
        <label>
          Tax jurisdiction
          <select value={jurisdiction} onChange={event => onJurisdictionChange(event.target.value as JurisdictionCode)}>
            <option value="AR">Argentina</option>
            <option value="US">United States</option>
          </select>
        </label>
        <label>
          Confirmed regime
          <select value={selectedRegime} disabled>
            {OPTIONS[jurisdiction].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <p className="privacy-note">The demo profile is confirmed locally. Production changes use optimistic versioning and an audit event.</p>
    </section>
  );
}
