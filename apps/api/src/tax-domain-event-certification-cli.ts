import { randomUUID } from 'node:crypto';

import {
  certifyTaxDomainEventCorridor,
  taxDomainEventCertificationConfigFromEnvironment,
} from './tax-domain-event-certification';

const certificationId = parseCertificationId(process.argv.slice(2));

try {
  const report = await certifyTaxDomainEventCorridor(
    taxDomainEventCertificationConfigFromEnvironment(),
    certificationId,
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      version: 'tax-domain-event-corridor-certification-error-v1',
      errorCode: safeErrorCode(error),
    }),
  );
  process.exitCode = 1;
}

function parseCertificationId(args: string[]): string {
  if (args.length === 0) return randomUUID();
  if (args.length === 2 && args[0] === '--certification-id') return args[1]!;
  throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_ARGUMENTS_INVALID');
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : '';
  return /^TAX_DOMAIN_EVENT_[A-Z0-9_]{1,100}$/.test(candidate)
    ? candidate
    : 'TAX_DOMAIN_EVENT_CERTIFICATION_FAILED';
}
