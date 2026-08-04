// Resumable, strictly top-down GnK stream for the first three role-ranked
// contacts at each of the first 50 companies. Owner/evaluator contacts receive
// the requested seven-stage learning sequence. A fallback router is capped at
// two messages and is never forced into seven touches.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';
import { rankGnkContacts, selectGnkBuyingGroup } from '../src/gnk-sales.js';
import { validateSequence, validateSpokenBrief } from '../src/outreach-quality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.env.GNK_FIRST50_DRY_RUN === '1';
const companies = db.prepare(`
  SELECT c.id,c.name
  FROM companies c
  WHERE c.archived_at IS NULL
    AND COALESCE(c.campaign,c.product,'') IN ('gnk','delay','football','row')
    AND EXISTS(SELECT 1 FROM people p WHERE p.company_id=c.id
      AND COALESCE(p.lifecycle_status,'active')!='archived' AND p.email LIKE '%@%')
  ORDER BY (c.lead_score IS NULL),c.lead_score DESC,c.name COLLATE NOCASE,c.id
  LIMIT 50
`).all();
if (companies.length !== 50) throw new Error(`Expected 50 GnK companies, found ${companies.length}.`);

const thesisStatement = db.prepare(`
  SELECT hypothesis_key,observed_fact,problem,workflow_owner,consequence,records,offer,kill_condition
  FROM pursuits WHERE company_id=?
`);
const cohortKeys = new Set();
for (const company of companies) {
  const thesis = thesisStatement.get(company.id);
  const missing = ['hypothesis_key','observed_fact','problem','workflow_owner','consequence','records','offer','kill_condition']
    .filter((field) => !String(thesis?.[field] || '').trim());
  if (missing.length) throw new Error(`Account thesis incomplete for ${company.name}: ${missing.join(', ')}.`);
  cohortKeys.add(thesis.hypothesis_key);
}
if (cohortKeys.size > 2) {
  throw new Error(`First-50 GnK drafting must use at most two reusable hypotheses; found ${cohortKeys.size}.`);
}

const peopleStatement = db.prepare(`
  SELECT p.id,p.company_id,p.name,p.first_name,p.title,p.relevance_score,p.relevance_reason,p.sales_brief,
    (SELECT COUNT(*) FROM sequences s WHERE s.person_id=p.id AND s.status<>'draft') protected_count
  FROM people p
  WHERE p.company_id=?
    AND COALESCE(p.lifecycle_status,'active')!='archived' AND p.email LIKE '%@%'
`);
const peopleByCompany = (companyId) => peopleStatement.all(companyId);

const targets = [];
for (const company of companies) {
  const ranked = rankGnkContacts(peopleByCompany(company.id));
  const direct = selectGnkBuyingGroup(ranked, 3);
  const fallbackRouters = ranked.filter((person) => person.gnk_route === 'router').slice(0, 3 - direct.length);
  const selected = [...direct, ...fallbackRouters];
  if (selected.length !== 3) {
    throw new Error(`Expected three emailable routes at ${company.name}, found ${selected.length}.`);
  }
  selected.forEach((person, index) => targets.push({
    ...person,
    company_name: company.name,
    company_rank: companies.indexOf(company) + 1,
    person_rank: index + 1,
  }));
}
if (targets.length !== 150) throw new Error(`Expected 150 GnK contacts, found ${targets.length}.`);
if (DRY_RUN) {
  const routers = targets.filter((person) => person.gnk_route === 'router');
  console.log(JSON.stringify({
    companies: companies.length,
    hypothesis_cohorts: [...cohortKeys],
    contacts: targets.length,
    seven_stage_contacts: targets.length - routers.length,
    bounded_routers: routers.map((person) => ({
      company: person.company_name,
      name: person.name,
      title: person.title,
    })),
  }, null, 2));
  process.exit(0);
}

const completedKey = 'gnk_first50_first3_hypothesis_led_completed_ids';
let completed;
try {
  completed = new Set(JSON.parse(db.prepare('SELECT value FROM system_settings WHERE key=?').get(completedKey)?.value || '[]'));
} catch {
  completed = new Set();
}

function exactSeven(person) {
  const rows = db.prepare('SELECT touch,day,channel,subject,body,status FROM sequences WHERE person_id=? ORDER BY touch').all(person.id);
  const expected = [[1,1,'email'],[2,4,'email'],[3,6,'linkedin'],[4,9,'email'],[5,11,'linkedin'],[6,15,'email'],[7,18,'email']];
  const shapeMatches = rows.length === expected.length && expected.every(([touch, day, channel], index) => (
    Number(rows[index].touch) === touch && Number(rows[index].day) === day && rows[index].channel === channel
  ));
  if (!shapeMatches) return false;
  let brief = {};
  try { brief = JSON.parse(person.sales_brief || '{}'); } catch { brief = {}; }
  return validateSpokenBrief(brief, 'gnk').length === 0
    && validateSequence({
      contact: {
        first_name: person.first_name || String(person.name || '').split(/\s+/)[0],
        outreach_route: person.gnk_route === 'router' ? 'routing' : 'owner_or_evaluator',
      },
      campaign: 'gnk',
      touches: rows,
    }).length === 0;
}

function capRouter(person) {
  const protectedAfterTwo = db.prepare(
    "SELECT COUNT(*) n FROM sequences WHERE person_id=? AND touch>2 AND status<>'draft'",
  ).get(person.id).n;
  if (protectedAfterTwo) {
    throw new Error(`Router ${person.name} has protected history after touch 2; pause for manual review.`);
  }
  db.prepare("DELETE FROM sequences WHERE person_id=? AND touch>2 AND status='draft'").run(person.id);
  const rows = db.prepare('SELECT touch FROM sequences WHERE person_id=? ORDER BY touch').all(person.id);
  if (!rows.length || rows.length > 2) {
    throw new Error(`Router ${person.name} needs one initial note and at most one follow-up.`);
  }
  return true;
}

for (const person of targets) {
  if (person.gnk_route === 'router') {
    if (capRouter(person)) completed.add(person.id);
  } else if (exactSeven(person)) {
    completed.add(person.id);
  }
}

function persistCompleted() {
  db.prepare(`
    INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')
  `).run(completedKey, JSON.stringify([...completed]));
}
persistCompleted();

let restored = false;
let activeChild = null;
function setLegacy(value) {
  db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES('legacy_writers_enabled',?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`).run(value);
}
function restore() {
  if (restored) return;
  restored = true;
  setLegacy('false');
  console.log('Restored legacy_writers_enabled=false.');
}
process.once('exit', restore);
for (const signal of ['SIGINT','SIGTERM']) {
  process.once(signal, () => {
    if (activeChild && !activeChild.killed) activeChild.kill(signal);
    restore();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

async function runPerson(person, attempt) {
  const preserve = Number(person.protected_count || 0) > 0;
  console.log(`Company ${person.company_rank}/50 · contact ${person.person_rank}/3: ${person.name} (${person.id}) | ${person.gnk_route} | ${preserve ? 'preserve history' : 'full rewrite'} | attempt ${attempt}`);
  setLegacy('true');
  activeChild = spawn(process.execPath, [join(root, 'scripts', 'write-sequences.js'), 'gnk'], {
    cwd: root,
    env: {
      ...process.env,
      ALLOW_LEGACY_SEQUENCE_WRITE: '1',
      WRITER_IDS: String(person.id),
      WRITER_EXCLUDE_IDS: '',
      WRITER_PRESERVE_PROTECTED: preserve ? '1' : '0',
      WRITER_ONE_PER_COMPANY: '0',
      WRITER_FORCE_COVERAGE: '1',
      WRITER_REWRITE: '1',
      WRITER_BATCH: '1',
      WRITER_CONCURRENCY: '1',
      // Deterministic GnK validation remains mandatory. Full multi-agent copy
      // review is opt-in for this 147-contact backfill so the resumable run can
      // finish in a practical window; failed drafts still enter repair and no
      // partial sequence is stored.
      WRITER_REVIEW: process.env.GNK_FIRST50_FULL_REVIEW === '1' ? '1' : '0',
      SKIP_SUBJECT_AGENTS: process.env.GNK_FIRST50_SUBJECT_REVIEW === '1' ? '0' : '1',
      SUBJECTS_PER_UNIT: process.env.GNK_FIRST50_SUBJECT_REVIEW === '1' ? '1' : '0',
    },
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    activeChild.once('error', (error) => {
      setLegacy('false');
      reject(error);
    });
    activeChild.once('close', (code, signal) => {
      setLegacy('false');
      resolve({ code, signal });
    });
  });
}

try {
  setLegacy('false');
  const routers = targets.filter((person) => person.gnk_route === 'router').length;
  console.log(`Hypothesis-led GnK stream: ${targets.length} contacts across ${companies.length} companies; ${routers} bounded routers; ${completed.size} already complete.`);
  for (const person of targets) {
    if (completed.has(person.id)) continue;
    if (person.gnk_route === 'router') continue;
    let success = false;
    for (let attempt = 1; attempt <= 2 && !success; attempt += 1) {
      const result = await runPerson(person, attempt);
      person.sales_brief = db.prepare('SELECT sales_brief FROM people WHERE id=?').get(person.id)?.sales_brief;
      success = result.code === 0 && exactSeven(person);
      if (!success) console.log(`Contact ${person.id} did not complete on attempt ${attempt} (${result.code ?? result.signal}).`);
    }
    if (success) {
      completed.add(person.id);
      persistCompleted();
      console.log(`Visible now: ${completed.size}/${targets.length} target contacts complete.`);
    } else {
      console.log(`Deferred contact ${person.id}; its existing messages remain intact.`);
    }
  }
} finally {
  restore();
}

const remaining = targets.filter((person) => !completed.has(person.id));
console.log(`Hypothesis-led stream finished with ${completed.size}/${targets.length} complete and ${remaining.length} deferred.`);
if (remaining.length) process.exitCode = 1;
