// Launch the long-running first-50 stream in its own process group so it keeps
// progressing when the terminal call that starts it returns. Progress is
// written to a stable log and the resumable wrapper skips completed contacts.
import { closeSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logPath = join(root, 'data', 'gnk-first50-first3-hypothesis-led.log');
const output = openSync(logPath, 'a');
const child = spawn(process.execPath, [join(root, 'scripts', 'run-gnk-first-50-unified.js')], {
  cwd: root,
  detached: true,
  env: { ...process.env },
  stdio: ['ignore', output, output],
});
child.unref();
closeSync(output);
console.log(JSON.stringify({ pid: child.pid, log: logPath }));
