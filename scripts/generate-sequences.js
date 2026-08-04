// Compatibility entry point. The old generator called an OpenClaw/API-backed
// writer without a real review gate. All generation now routes through the
// Codex draft -> editorial review -> revision -> validation pipeline.
//
//   node scripts/generate-sequences.js wapahki --dry-run
//   node scripts/generate-sequences.js wapahki --limit 3
//   node scripts/generate-sequences.js wapahki --limit 3 --rewrite
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const campaign = args.find((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg));
const dryRun = args.includes('--dry-run');
const rewrite = args.includes('--rewrite');
const limitFlag = args.findIndex((arg) => arg === '--limit' || arg.startsWith('--limit='));
let limit = '';
if (limitFlag >= 0) {
  limit = args[limitFlag].includes('=')
    ? args[limitFlag].split('=')[1]
    : args[limitFlag + 1] || '';
}

if (!campaign) {
  console.error('usage: node scripts/generate-sequences.js <campaign> [--limit N] [--dry-run] [--rewrite]');
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  join(root, 'scripts', 'write-sequences.js'),
  campaign,
  ...(dryRun ? ['--dry-run'] : []),
], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(limit ? { WRITER_LIMIT: limit } : {}),
    ...(rewrite ? { WRITER_REWRITE: '1' } : {}),
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
