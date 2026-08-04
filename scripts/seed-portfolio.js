// Load the curated 9-project Canada portfolio (data/portfolio-9.json) into the
// Problem Radar `problems` table so the /problems dashboard shows them. These are
// hand-picked, scoped projects (source = run_id 'curated-portfolio'), distinct
// from the Codex discovery agent's auto-generated problems. Idempotent: upsert by
// slug; status is never regressed. Dollar figures are planning estimates.
//   node scripts/seed-portfolio.js [--dry-run]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { upsertProblem, listProblems } from '../src/problems.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry-run');
const { projects } = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'portfolio-9.json'), 'utf8'));

// The 7 discovery factors (labels + maxes) the dashboard renders as bars.
const FACTORS = [
  ['fin', 'Financial size / savings potential', 25],
  ['rec', 'Recurring and measurable', 15],
  ['under', 'Underserved by existing software', 15],
  ['data', 'Usable data available for an MVP', 15],
  ['buyer', 'Identifiable buyer who owns budget and pain', 10],
  ['mvp', 'We can build a convincing MVP fast', 10],
  ['repeat', 'Repeatable across many Canadian organisations', 5],
];

let n = 0;
for (const p of projects) {
  const breakdown = FACTORS.map(([k, factor, of]) => ({ factor, points: p.points[k] ?? 0, of, note: '' }));
  const score = breakdown.reduce((s, b) => s + b.points, 0);
  const notes = [
    'Curated 9-project Canada portfolio (not auto-discovered).',
    p.sell_priority ? `Sell priority #${p.sell_priority}${p.sell_priority <= 3 ? ' — sell first (next 30 days)' : ' — fourth campaign'}.` : null,
    'Price = intended sale price of a complete first version; dollar figures are planning estimates pending enrichment.',
  ].filter(Boolean).join(' ');

  if (DRY) { console.log(`${p.title} → ${score}/95, ${p.status}${p.sell_priority ? ', sell#' + p.sell_priority : ''}, $${p.our_cut_low / 1000}k-$${p.our_cut_high / 1000}k`); continue; }

  upsertProblem({
    title: p.title, sector: p.sector, region: p.region, one_liner: p.one_liner,
    who_has_it: p.who_has_it, workflow_today: p.workflow_today, why_expensive: p.why_expensive,
    why_unsolved: p.why_unsolved, proposed_solution: p.proposed_solution, demo_idea: p.demo_idea,
    measurable: p.measurable, recurrence: p.recurrence, data_availability: p.data_availability,
    our_cut_low: p.our_cut_low, our_cut_high: p.our_cut_high, pricing_basis: p.pricing_basis,
    buyer_roles: p.buyer_roles || [], target_companies: p.target_companies || [], sources: p.sources || [],
    score, score_breakdown: breakdown, confidence: p.confidence, status: p.status,
    product: p.product || null, notes, run_id: 'curated-portfolio',
  });
  n++;
}

if (!DRY) {
  const total = listProblems().length;
  console.log(`Loaded ${n} curated portfolio projects. Problem Radar backlog now ${total}.`);
} else {
  console.log(`[dry-run] ${projects.length} projects (no writes).`);
}
