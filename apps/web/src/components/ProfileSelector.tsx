import type { TaxWidgetSnapshotV1 } from '@tax-engine/browser-contracts';

export function ProfileSelector({ profile }: { profile: TaxWidgetSnapshotV1['profile'] }) {
  return (
    <section className="panel profile-panel" aria-labelledby="profile-heading">
      <div className="section-heading">
        <span className="step-number">1</span>
        <div>
          <h2 id="profile-heading">Confirm jurisdiction and profile</h2>
          <p>Country hints never become tax residency until you confirm them.</p>
        </div>
      </div>
      <div className="selector-grid" aria-label="Persisted tax profile">
        <div><span>Tax jurisdiction</span><strong>{{ AR: 'Argentina', US: 'United States', AE: 'United Arab Emirates' }[profile.jurisdiction]}</strong></div>
        <div><span>Confirmed entity</span><strong>{profile.entityType}</strong></div>
        <div><span>Confirmed regime</span><strong>{profile.regimeId.replaceAll('_', ' ')}</strong></div>
        <div><span>Confirmation</span><strong>{profile.confirmationState}</strong></div>
      </div>
      <p className="privacy-note">This is the persisted profile at {profile.profileVersion}. Changes use the authorized setup journey and optimistic concurrency; this read cannot mutate it.</p>
    </section>
  );
}
