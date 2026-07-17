export function executionGateCopy(jurisdiction: 'AR' | 'US' | 'AE'): string {
  if (jurisdiction === 'AR') {
    return 'No filing, payment, or authority submission can run from this workspace. ARCA onboarding remains a separate user-controlled handoff.';
  }
  if (jurisdiction === 'AE') {
    return 'No filing, payment, or FTA submission can run from this workspace. EmaraTax login, UAE PASS, submission, and authority decisions remain user-controlled or accountant-gated.';
  }
  return 'No filing, payment, or IRS submission can run from this workspace. U.S. filing remains separately provider- or accountant-gated.';
}
