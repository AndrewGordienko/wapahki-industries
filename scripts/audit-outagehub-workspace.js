// Deterministic checks for the problem -> buyer -> first-touch workspace.
import { db } from '../src/db.js';

const problems = db.prepare(`
  SELECT p.*, COUNT(t.id) AS target_count
  FROM outagehub_problems p
  LEFT JOIN outagehub_targets t ON t.problem_id = p.id
  GROUP BY p.id
  ORDER BY p.id
`).all();
const targets = db.prepare('SELECT * FROM outagehub_targets ORDER BY id').all();
const failures = [];

for (const problem of problems) {
  if (!problem.target_count) failures.push(`problem ${problem.id} "${problem.title}" has no target buyer`);
  if (!problem.sources || problem.sources === '[]') failures.push(`problem ${problem.id} "${problem.title}" has no source`);
  let breakdown = [];
  try { breakdown = JSON.parse(problem.score_breakdown || '[]'); } catch { /* reported below */ }
  const sum = breakdown.reduce((n, item) => n + Number(item.points || 0), 0);
  if (sum !== Number(problem.score)) failures.push(`problem ${problem.id} score ${problem.score} != breakdown ${sum}`);
}

for (const target of targets) {
  const subject = String(target.email_subject || '').trim();
  const body = String(target.email_body || '').trim();
  const subjectWords = subject.split(/\s+/).filter(Boolean).length;
  const bodyWords = body.split(/\s+/).filter(Boolean).length;
  if (!target.company || !target.contact_title) failures.push(`target ${target.id} lacks company or buyer title`);
  if (subject !== subject.toLowerCase()) failures.push(`target ${target.id} subject is not lowercase`);
  if (subjectWords < 2 || subjectWords > 5) failures.push(`target ${target.id} subject has ${subjectWords} words`);
  if (/[:!?]/.test(subject)) failures.push(`target ${target.id} subject has salesy punctuation`);
  if (bodyWords < 90 || bodyWords > 180) failures.push(`target ${target.id} body has ${bodyWords} words`);
  if (!/20-minute conversation/.test(body)) failures.push(`target ${target.id} has no 20-minute conversation ask`);
  if (!/I’ll bring one real outage record/.test(body)) failures.push(`target ${target.id} has no concrete call payoff`);
  if (/every canadian|every utility|guarantee|instant detection|first to know|before .* knows/i.test(body)) {
    failures.push(`target ${target.id} crosses the OutageHub claim boundary`);
  }
}

console.log(`${problems.length} problems · ${targets.length} buyer drafts · ${failures.length} failures`);
for (const failure of failures) console.log(`  - ${failure}`);
if (failures.length) process.exitCode = 1;
