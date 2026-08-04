// Compatibility entry point for the original three showcase contacts.
// The old file hard-coded drafts that now fail the evidence, English, subject,
// and CTA rules. Regenerate them through the same reviewed Codex pipeline used
// for every other contact.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [join(root, 'scripts', 'write-sequences.js')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    WRITER_IDS: '229,318,553',
    WRITER_REWRITE: '1',
    WRITER_BATCH: '1',
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
