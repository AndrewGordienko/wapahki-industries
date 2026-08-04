// Seed the GnK outreach campaign with the real, named target companies from
// the strongest Problem Radar ideas. Each company carries its idea's full context
// in notes (so Apollo uses the idea's buyer roles and the email writer can
// personalize). Idempotent (dedupe by company name). Seeding is free; Apollo
// enrichment (scripts/build-all.js gnk / pipeline) is the paid step.
//   node scripts/seed-gnk-crm.js [--min-score 80] [--dry-run]
import { listProblems } from '../src/problems.js';
import { getCompanyByName, insertCompany } from '../src/db.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const MIN = (() => { const i = args.indexOf('--min-score'); return i >= 0 ? Number(args[i + 1]) : 80; })();

// Keep only real, named organisations (skip generic/typed examples).
const GENERIC = /^(a |an |any |mid|small|large|typical|regional|various|multiple|major |several |example|e\.?g\.?|local |independent )/i;
const realName = (n) => n && n.trim().length > 3 && /[A-Z]/.test(n) && !GENERIC.test(n.trim()) && !/\be\.?g\.?\b/i.test(n);

const money = (n) => (n == null ? '?' : `$${Math.round(n / 1000)}k`);
const problems = listProblems().filter((p) => (p.score || 0) >= MIN || p.status === 'approved');

let companies = 0, ideas = 0, skippedGeneric = 0;
const seen = new Set(getCompanyByName ? [] : []);
for (const p of problems) {
  const targets = (p.target_companies || []).filter((t) => t && t.name);
  if (!targets.length) continue;
  let used = 0;
  for (const t of targets) {
    if (!realName(t.name)) { skippedGeneric++; continue; }
    const key = t.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    used++;
    const notes = [
      `Idea: ${p.title}`,
      `Problem: ${p.one_liner || ''}`,
      `Workflow today: ${p.workflow_today || ''}`,
      `Why this company: ${t.why || ''}`,
      `What we'd build: ${p.proposed_solution || ''}`,
      `Demo: ${p.demo_idea || ''}`,
      `Fee: ${money(p.our_cut_low)}-${money(p.our_cut_high)}`,
    ].join('\n');
    if (DRY) { companies++; continue; }
    if (getCompanyByName(t.name)) continue; // already in DB (any campaign) — don't duplicate
    insertCompany({
      name: t.name, city: t.region || null, location: 'Canada',
      industry: p.sector || null, source: 'gnk-idea', campaign: 'gnk',
      target_titles: p.buyer_roles || [], notes,
    });
    companies++;
  }
  if (used) ideas++;
}

console.log(`${DRY ? '[dry-run] ' : ''}GnK funnel: +${companies} companies from ${ideas} ideas (score>=${MIN} or approved), ${skippedGeneric} generic names skipped.`);
