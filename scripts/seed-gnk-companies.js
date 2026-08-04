// Seed the GnK funnel with the REAL named companies researched per idea in
// data/ideas-companies/*.json (each: [{idea_title, companies:[{name,region,domain,why}]}]).
// Looks up each idea in the problems table for buyer_roles + context. Idempotent:
// dedupes by company name against the whole DB. Robust to trailing junk.
//   node scripts/seed-gnk-companies.js [--dry-run]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getCompanyByName, insertCompany } from '../src/db.js';
import { listProblems } from '../src/problems.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, '..', 'data', 'ideas-companies');
const DRY = process.argv.includes('--dry-run');
const money = (n) => (n == null ? '?' : `$${Math.round(n / 1000)}k`);

function parseLoose(text) {
  const a = text.indexOf('['); const b = text.lastIndexOf(']');
  if (a < 0 || b < 0 || b < a) throw new Error('no JSON array');
  return JSON.parse(text.slice(a, b + 1));
}

if (!existsSync(DIR)) { console.error('no data/ideas-companies dir'); process.exit(1); }
const ideaByTitle = new Map(listProblems().map((p) => [p.title, p]));
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const seen = new Set();
let added = 0, skipped = 0, noIdea = 0, filesBad = 0;

for (const f of files) {
  let groups;
  try { groups = parseLoose(readFileSync(join(DIR, f), 'utf8')); } catch (e) { console.error(`  ! ${f}: ${e.message}`); filesBad++; continue; }
  for (const g of groups) {
    const idea = ideaByTitle.get(g.idea_title);
    if (!idea) { noIdea++; continue; }
    for (const co of g.companies || []) {
      if (!co || !co.name) continue;
      const key = co.name.trim().toLowerCase();
      if (seen.has(key)) continue; seen.add(key);
      if (getCompanyByName(co.name)) { skipped++; continue; }
      if (DRY) { added++; continue; }
      const notes = [
        `Idea: ${idea.title}`,
        `Problem: ${idea.one_liner || ''}`,
        `Workflow today: ${idea.workflow_today || ''}`,
        `Why this company: ${co.why || ''}`,
        `What we'd build: ${idea.proposed_solution || ''}`,
        `Demo: ${idea.demo_idea || ''}`,
        `Fee: ${money(idea.our_cut_low)}-${money(idea.our_cut_high)}`,
      ].join('\n');
      insertCompany({
        name: co.name, city: co.region || null, location: 'Canada',
        domain: co.domain || null, website: co.domain ? `https://${co.domain}` : null,
        industry: idea.sector || null, source: 'gnk-idea-research', campaign: 'gnk',
        target_titles: idea.buyer_roles || [], notes,
      });
      added++;
    }
  }
}
console.log(`${DRY ? '[dry-run] ' : ''}GnK funnel: +${added} real companies from research, ${skipped} already in DB, ${noIdea} unmatched ideas, ${filesBad} bad files.`);
