// Deliberately run the all-contact T2 backfill through the quarantined legacy
// sequence store. The pursuit workflow is account/primary-contact based and
// cannot represent this one-time per-contact migration. The global setting is
// restored on success, failure, or an interrupt.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const setting = db.prepare(
  "SELECT value FROM system_settings WHERE key = 'legacy_writers_enabled'",
).get();
const priorValue = setting?.value || 'false';
let restored = false;
let child = null;

function setLegacyWriterSetting(value) {
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('legacy_writers_enabled', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(value);
}

function restore() {
  if (restored) return;
  restored = true;
  setLegacyWriterSetting(priorValue);
  console.log(`Restored legacy_writers_enabled=${priorValue}.`);
}

process.once('exit', restore);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (!child || child.killed) return;
    child.kill(signal);
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 4_000);
  });
}

try {
  setLegacyWriterSetting('true');
  console.log('Temporarily enabled the quarantined legacy store for this T2 migration.');
  child = spawn(process.execPath, [join(root, 'scripts', 'write-touch2.js'), ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, ALLOW_LEGACY_SEQUENCE_WRITE: '1' },
    stdio: 'inherit',
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0) {
    process.exitCode = result.code || (result.signal ? 1 : 0);
  }
} finally {
  restore();
}
