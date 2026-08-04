// Load fanned-out project ideas from data/ideas/*.json into the Problem Radar
// `problems` table. Each file is a JSON array of ideas produced by a sector
// research agent. Robust to trailing junk (strips to the outer [ ... ]). Dedupes
// by slug against existing problems and within this run. All loaded as status
// 'discovered' (candidates); the curated portfolio stays 'approved'.
//   node scripts/seed-ideas.js [--dry-run]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { upsertProblem, listProblems, existingSlugs, slugify } from '../src/problems.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, '..', 'data', 'ideas');
const DRY = process.argv.includes('--dry-run');

const FACTORS = [
  ['fin', 'Financial size / savings potential', 25],
  ['rec', 'Recurring and measurable', 15],
  ['under', 'Underserved by existing software', 15],
  ['data', 'Usable data available for an MVP', 15],
  ['buyer', 'Identifiable buyer who owns budget and pain', 10],
  ['mvp', 'We can build a convincing MVP fast', 10],
  ['repeat', 'Repeatable across many Canadian organisations', 5],
];

// Pull the outer JSON array out of whatever the agent wrote (tolerate prose/fences/stray tags).
function parseLoose(text) {
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a < 0 || b < 0 || b < a) throw new Error('no JSON array found');
  return JSON.parse(text.slice(a, b + 1));
}

if (!existsSync(DIR)) { console.error('no data/ideas dir'); process.exit(1); }
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
if (!files.length) { console.error('no idea files in data/ideas/'); process.exit(1); }

const known = new Set(existingSlugs().map((k) => k.slug));
const seen = new Set();
let added = 0, skipped = 0, filesOk = 0, filesBad = 0;
const perSector = {};

for (const f of files) {
  let ideas;
  try { ideas = parseLoose(readFileSync(join(DIR, f), 'utf8')); filesOk++; }
  catch (e) { console.error(`  ! skip ${f}: ${e.message}`); filesBad++; continue; }
  if (!Array.isArray(ideas)) { console.error(`  ! skip ${f}: not an array`); filesBad++; continue; }

  let n = 0;
  for (const idea of ideas) {
    if (!idea || !idea.title) { skipped++; continue; }
    const slug = slugify(idea.title);
    if (known.has(slug) || seen.has(slug)) { skipped++; continue; }
    seen.add(slug);
    n++; added++;
    if (DRY) continue;

    let score = idea.score ?? null;
    let breakdown = Array.isArray(idea.score_breakdown) ? idea.score_breakdown : [];
    if (idea.points) {
      breakdown = FACTORS.map(([k, factor, of]) => ({ factor, points: Number(idea.points[k]) || 0, of, note: '' }));
      score = breakdown.reduce((s, b) => s + b.points, 0);
    }
    upsertProblem({
      title: idea.title, sector: idea.sector || null, region: idea.region || 'Canada',
      one_liner: idea.one_liner || null, who_has_it: idea.who_has_it || null,
      workflow_today: idea.workflow_today || null, why_expensive: idea.why_expensive || null,
      why_unsolved: idea.why_unsolved || null, proposed_solution: idea.proposed_solution || null,
      demo_idea: idea.demo_idea || null, measurable: idea.measurable || null,
      recurrence: idea.recurrence || null, data_availability: idea.data_availability || null,
      our_cut_low: idea.our_cut_low ?? null, our_cut_high: idea.our_cut_high ?? null,
      pricing_basis: idea.pricing_basis || 'Complete v1 for one customer, sold in 30 days.',
      buyer_roles: idea.buyer_roles || [], target_companies: idea.target_companies || [],
      sources: idea.sources || [], score, score_breakdown: breakdown,
      confidence: idea.confidence || 'medium', status: 'discovered',
      run_id: 'idea-fanout', notes: 'Idea-pipeline fan-out. Dollar figures are planning estimates pending enrichment.',
    });
  }
  perSector[f] = n;
}

console.log(`\nfiles: ${filesOk} ok, ${filesBad} bad`);
for (const [f, n] of Object.entries(perSector)) console.log(`  ${f}: +${n}`);
console.log(`${DRY ? '[dry-run] ' : ''}+${added} ideas loaded, ${skipped} skipped (dupes/invalid).`);
if (!DRY) console.log(`Problem Radar backlog now ${listProblems().length}.`);
