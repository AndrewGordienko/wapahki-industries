// Split the first 50 legacy GnK account narratives into the seven explicit
// hypothesis-led fields. This is deliberately conservative: public evidence
// stays separate from the operating hypothesis, and unconfirmed economics,
// data access, frequency and qualification remain false.
import { db } from '../src/db.js';
import { rankGnkContacts, selectGnkBuyingGroup } from '../src/gnk-sales.js';

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

const incompleteScorecard = JSON.stringify({
  frequent: false,
  expensive_when_poor: false,
  measurable: false,
  records_exist: false,
  identifiable_owner: false,
  testable_30_45_days: false,
  supports_40k_90k_engagement: false,
});
const incompleteQualification = JSON.stringify({
  recurring_workflow: false,
  measurable_consequence: false,
  named_owner: false,
  accessible_data: false,
  credible_champion: false,
  defined_pilot_outcome: false,
});

function between(text, left, right) {
  const start = text.indexOf(left);
  if (start < 0) return '';
  const contentStart = start + left.length;
  const end = right ? text.indexOf(right, contentStart) : -1;
  return text.slice(contentStart, end < 0 ? undefined : end).trim();
}

function ownerFromHelp(help) {
  const phrase = help.split(/\s+would\s+/i)[0].replace(/[.;:]\s*$/, '').trim();
  return phrase || 'Likely process owner to identify and confirm before discovery.';
}

function cohortFor(text) {
  if (/chargeback|deduction|shortage|retail compliance/i.test(text)) return 'exception_case_evidence_reconstruction';
  if (/procurement|vendor|bid|change order|project controls|technical requirement|compliance|regulat|licens|credential|clinical|medical|environment|safety|audit/i.test(text)) {
    return 'requirements_approval_evidence_reconciliation';
  }
  return 'exception_case_evidence_reconstruction';
}

function roleFor(route, title) {
  if (route === 'router') return 'router';
  if (route === 'technical_security_owner') return 'technical_security_owner';
  if (route === 'economic_buyer') return 'economic_buyer';
  if (/\b(?:analyst|coordinator|planner|scheduler|supervisor|specialist)\b/i.test(title || '')) return 'operator';
  return 'process_owner';
}

const pursuitForCompany = db.prepare('SELECT * FROM pursuits WHERE company_id=?');
const peopleForCompany = db.prepare(`
  SELECT id,name,first_name,title,relevance_score,relevance_reason,sales_brief
  FROM people
  WHERE company_id=? AND COALESCE(lifecycle_status,'active')!='archived' AND email LIKE '%@%'
`);
const updatePursuit = db.prepare(`UPDATE pursuits SET
  hypothesis_key=?, observed_fact=?, problem=?, workflow_owner=?, consequence=?, records=?, offer=?, kill_condition=?,
  workflow_scorecard=?, qualification=?, primary_person_id=?, narrative=?, next_goal=?,
  approval_status='needs_review', status='draft', phase='research', cost_model=NULL,
  autonomy_status='human_only', updated_at=datetime('now')
  WHERE id=?`);
const updatePursuitCohort = db.prepare("UPDATE pursuits SET hypothesis_key=?,updated_at=datetime('now') WHERE id=?");
const upsertContact = db.prepare(`
  INSERT INTO pursuit_contacts(pursuit_id,person_id,role,priority,state,reason,updated_at)
  VALUES(?,?,?,?,?,?,datetime('now'))
  ON CONFLICT(pursuit_id,person_id) DO UPDATE SET
    role=excluded.role,priority=excluded.priority,state=excluded.state,
    reason=excluded.reason,updated_at=datetime('now')
`);

let migrated = 0;
let preserved = 0;
let mappedContacts = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const company of companies) {
    const pursuit = pursuitForCompany.get(company.id);
    if (!pursuit) throw new Error(`No pursuit exists for ${company.name} (${company.id}).`);
    const ranked = rankGnkContacts(peopleForCompany.all(company.id));
    const direct = selectGnkBuyingGroup(ranked, 3);
    const selected = [...direct, ...ranked.filter((person) => person.gnk_route === 'router').slice(0, 3 - direct.length)];
    if (selected.length !== 3) throw new Error(`Expected three routes for ${company.name}.`);

    for (const [index, person] of selected.entries()) {
      upsertContact.run(
        pursuit.id,
        person.id,
        roleFor(person.gnk_route, person.title),
        index + 1,
        person.gnk_route === 'router' ? 'paused' : index === 0 ? 'selected' : 'candidate',
        person.gnk_route === 'router'
          ? 'Fallback router only: one initial note and one follow-up maximum.'
          : `Role-ranked GnK buying-group route (${person.gnk_route}).`,
      );
      mappedContacts += 1;
    }

    // The explicit 3PL Links and Young-Davidson corrections already contain
    // stronger, manually separated theses. Never degrade them.
    if (String(pursuit.observed_fact || '').trim() && String(pursuit.kill_condition || '').trim()) {
      updatePursuitCohort.run(cohortFor(pursuit.problem), pursuit.id);
      preserved += 1;
      continue;
    }

    const legacy = String(pursuit.problem || '');
    const observedFact = between(legacy, 'Observed:', 'Hypothesis to validate:');
    const hypothesis = between(legacy, 'Hypothesis to validate:', 'Help:');
    const help = between(legacy, 'Help:', 'Why reply:');
    if (!observedFact || !hypothesis || !help) {
      throw new Error(`Cannot safely split the legacy thesis for ${company.name} (${company.id}).`);
    }
    const owner = ownerFromHelp(help);
    const primary = selected.find((person) => person.gnk_route !== 'router') || selected[0];
    const consequence = 'Unknown until discovery. On the last real case, test handling time, decision delay, rework, errors, missed money or operational and regulatory risk; quantify only what the owner can evidence.';
    const records = `Not yet established. Ask ${owner} which source-system entries, case documents, correspondence and approval or escalation records were checked in the last real case; public research does not establish internal access.`;
    const pilot = `Only after qualification, replay 50–100 historical cases over 30–45 days, compare GnK's output with the actual decisions and outcomes, and measure time, money, errors or risk. The customer keeps every live decision.`;
    const killCondition = 'Stop if the work is not recurring, the consequence cannot be measured, no accountable owner or champion exists, records cannot be accessed, a 30–45 day historical replay is not credible, or measured value cannot support a $40k–$90k first engagement.';
    const narrative = `Observed fact: ${observedFact}\n\nHypothesis, not fact: ${hypothesis}\n\nThe first outreach must test the workflow and owner. Do not pitch software, quote economics or propose a paid pilot before discovery confirms the qualification conditions.`;
    const nextGoal = `Ask ${primary.name} how the last real case was handled and who owned the result. Stop or route if the hypothesized workflow is not theirs.`;

    updatePursuit.run(
      cohortFor(`${hypothesis} ${help}`), observedFact, hypothesis, owner, consequence,
      records, pilot, killCondition, incompleteScorecard, incompleteQualification,
      primary.id, narrative, nextGoal, pursuit.id,
    );
    migrated += 1;
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(JSON.stringify({ companies: companies.length, migrated, preserved, mapped_contacts: mappedContacts }, null, 2));
