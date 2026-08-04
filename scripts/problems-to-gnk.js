// Mirror the Problem Radar ideas (problems table) onto the GnK board
// (gnk_projects table) so http://localhost:8787/gnk shows all of them,
// organized by domain (sector) and ranked by interest+feasibility. Idempotent:
// dedupes by title, so it won't duplicate on re-run or clobber manual entries.
//   node scripts/problems-to-gnk.js [--dry-run]
import { listProblems } from '../src/problems.js';
import { listGnkProjects, createGnkProject } from '../src/db.js';

const DRY = process.argv.includes('--dry-run');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// score is out of ~95; map to 1..5 stars.
const toStars = (score) => clamp(Math.round((score || 0) / 19), 1, 5);
// feasibility from the "build a convincing MVP fast" + "usable data" factors if present.
function feasibility(p) {
  const bd = p.score_breakdown || [];
  const pick = (needle) => bd.find((b) => (b.factor || '').toLowerCase().includes(needle));
  const mvp = pick('mvp') || pick('build');
  const data = pick('data');
  if (mvp && data) return clamp(Math.round(((mvp.points / (mvp.of || 10)) + (data.points / (data.of || 15))) / 2 * 5), 1, 5);
  return clamp(Math.round((p.score || 0) / 22), 1, 5);
}

const existing = new Set(listGnkProjects().map((f) => (f.title || '').toLowerCase()));
const problems = listProblems();
let added = 0, skipped = 0;
for (const p of problems) {
  if (existing.has((p.title || '').toLowerCase())) { skipped++; continue; }
  const src = Array.isArray(p.sources) && p.sources[0] ? p.sources[0].url : null;
  if (DRY) { added++; continue; }
  createGnkProject({
    title: p.title,
    problem: p.one_liner || p.why_expensive,
    who_affected: p.who_has_it,
    why_it_matters: p.why_expensive,
    what_we_build: p.proposed_solution,
    domain: p.sector || 'other',
    interest: toStars(p.score),
    feasibility: feasibility(p),
    status: p.status === 'approved' ? 'scoping' : 'idea',
    links: src,
  });
  added++;
}

console.log(`${DRY ? '[dry-run] ' : ''}GnK board: +${added} projects mirrored from Problem Radar, ${skipped} already present.`);
if (!DRY) console.log(`GnK board now has ${listGnkProjects().length} projects.`);
