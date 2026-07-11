import { readFileSync } from 'node:fs';

import { rotateBoundaryMasterKey } from './rotation';

const databasePath = requiredEnvironment('ARCA_BOUNDARY_DB_PATH');
const oldMasterKey = readKeyFile(requiredEnvironment('ARCA_BOUNDARY_MASTER_KEY_FILE'));
const newMasterKey = readKeyFile(requiredEnvironment('ARCA_BOUNDARY_NEW_MASTER_KEY_FILE'));
const dryRun = process.argv.includes('--dry-run');
try {
  const result = rotateBoundaryMasterKey({ databasePath, oldMasterKey, newMasterKey, occurredAt: new Date().toISOString(), dryRun });
  console.info(JSON.stringify({ version: 'arca-boundary-key-rotation-v1', ...result }));
} finally {
  oldMasterKey.fill(0);
  newMasterKey.fill(0);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function readKeyFile(path: string): Buffer {
  const key = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error('ARCA_BOUNDARY_MASTER_KEY_INVALID');
  return key;
}
