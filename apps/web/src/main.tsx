import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import type { TaxSnapshotBrowserAuthority } from './api';
import type { ArcaOnboardingBrowserAuthority } from './arca-api';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing');

declare global {
  interface Window {
    __TAX_BOOTSTRAP__?: Readonly<{
      snapshotAuthority: TaxSnapshotBrowserAuthority;
      arcaAuthority?: ArcaOnboardingBrowserAuthority;
      arcaEnvironment?: 'homologation' | 'production';
    }>;
  }
}

const bootstrap = window.__TAX_BOOTSTRAP__;

createRoot(root).render(
  <StrictMode>
    <App
      taxAuthority={bootstrap?.snapshotAuthority ?? null}
      arcaAuthority={bootstrap?.arcaAuthority ?? null}
      arcaEnvironment={bootstrap?.arcaEnvironment ?? 'homologation'}
    />
  </StrictMode>
);
