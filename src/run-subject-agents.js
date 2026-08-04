import { spawn } from 'node:child_process';
import { join } from 'node:path';

// Run the campaign-aware subject workflow for every independent email thread
// a writer just changed. T2 is locked to the approved T1 subject. Keeping this
// as the final writer stage prevents a later draft job from overwriting the
// reviewed subject plan with first-pass fields.
export async function personalizeWrittenSubjects({ root, campaign, personIds }) {
  const ids = [...new Set((personIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length || process.env.SKIP_SUBJECT_AGENTS === '1') return;

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      join(root, 'scripts', 'personalize-subjects.js'),
      '--campaign', campaign,
      '--ids', ids.join(','),
      '--batch', process.env.SUBJECT_BATCH || '8',
      '--concurrency', process.env.SUBJECT_CONCURRENCY || '2',
    ], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`subject agents exited ${code ?? signal}`));
    });
  });
}
