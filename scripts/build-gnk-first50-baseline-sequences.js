// Build a complete, deterministic baseline for the first 50 × three GnK
// buying-group routes. The copy is four insight-led touches over ~3 weeks:
// a concrete problem question that names what GnK is exploring, a sharper
// operational insight, a short LinkedIn connection, then a single close-or-route.
// Internal research only sharpens the copy; uncertainty, qualification, and
// proof-boundary notes never reach the reader. Every stored draft passes the
// same validators as model-written copy and protected sent history is immutable.
import { db, replaceDraftSequence, updatePerson } from '../src/db.js';
import { rankGnkContacts, selectGnkBuyingGroup } from '../src/gnk-sales.js';
import {
  GNK_ROUTING_PLAN,
  GNK_FOUR_TOUCH_PLAN,
  GNK_SEQUENCE_JOBS,
  validateSequence,
  validateSpokenBrief,
} from '../src/outreach-quality.js';

process.env.ALLOW_LEGACY_SEQUENCE_WRITE = '1';
process.env.LEGACY_SEQUENCE_WRITE_CAMPAIGN = 'gnk';
const DRY_RUN = process.env.GNK_TEMPLATE_DRY_RUN === '1';

const companies = db.prepare(`
  SELECT c.id,c.name,c.campaign,pu.id pursuit_id,pu.hypothesis_key,pu.observed_fact,
         pu.problem,pu.workflow_owner,pu.consequence,pu.records,pu.offer,pu.kill_condition,pu.evidence
  FROM companies c JOIN pursuits pu ON pu.company_id=c.id
  WHERE c.archived_at IS NULL
    AND COALESCE(c.campaign,c.product,'') IN ('gnk','delay','football','row')
    AND EXISTS(SELECT 1 FROM people p WHERE p.company_id=c.id
      AND COALESCE(p.lifecycle_status,'active')!='archived' AND p.email LIKE '%@%')
  ORDER BY (c.lead_score IS NULL),c.lead_score DESC,c.name COLLATE NOCASE,c.id
  LIMIT 50
`).all();
if (companies.length !== 50) throw new Error(`Expected 50 GnK companies, found ${companies.length}.`);

const peopleStatement = db.prepare(`
  SELECT id,company_id,name,first_name,title,relevance_score,relevance_reason,sales_brief
  FROM people
  WHERE company_id=? AND COALESCE(lifecycle_status,'active')!='archived' AND email LIKE '%@%'
`);

function words(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

function clipWords(value, limit) {
  const tokens = words(value);
  const clipped = tokens.slice(0, limit);
  if (tokens.length > limit) {
    const trailingJoiners = /^(?:a|an|the|and|or|but|before|after|for|to|of|with|without|in|on|at|as|from)$/i;
    while (clipped.length && trailingJoiners.test(clipped.at(-1).replace(/[^\p{L}]/gu, ''))) clipped.pop();
  }
  return clipped.join(' ').replace(/[,. ]+$/, '');
}

// Sanitize a stored research field into buyer-safe prose. This strips internal
// framing ("Hypothesis to validate:"), forbidden punctuation, and any premature
// economics, so the reader sees plain, specific English and never an internal note.
function clean(value) {
  return String(value || '')
    .replace(/^\s*(?:Observed|Hypothesis to validate)\s*[:,]\s*/i, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/(?:CAD|USD|\$)\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?/gi, 'a reported amount')
    .replace(/\bannual\b/gi, 'reported')
    .replace(/\bROI\b/gi, 'return')
    // Replace terms the shared copy policy bans with plain, natural equivalents
    // so the stored research reads like English, not internal jargon.
    .replace(/\bdecision workflows?\b/gi, 'decision process')
    .replace(/\bworkflows?\b/gi, 'process')
    .replace(/\bdecision records?\b/gi, 'approval records')
    .replace(/\bacceptance checks?\b/gi, 'approval steps')
    .replace(/\binterfaces?\b/gi, 'systems')
    .replace(/\bscenarios?\b/gi, 'cases')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/!/g, '.')
    .replace(/:/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceCase(value) {
  const text = String(value || '');
  return text ? `${text[0].toLocaleUpperCase()}${text.slice(1)}` : text;
}

function email(firstName, touch, day, subject, content) {
  return {
    touch, day, channel: 'email', subject,
    body: `Hi ${firstName},\n\n${content}\n\nThanks,\nAndrew Gordienko\nGnK`,
  };
}

// Two hypotheses, each expressed as plain buyer-facing language. None of these
// strings carry qualification, proof-boundary, or hedging framing.
const REQUIREMENTS_KEY = 'requirements_approval_evidence_reconciliation';

function topicFor(company) {
  return company.hypothesis_key === REQUIREMENTS_KEY
    ? 'reconciling changed requirements with the approval evidence'
    : 'reconstructing the records behind an exception';
}

// The concrete commercial idea, stated plainly. The email should give the reader
// something to react to, not hide the idea behind discovery language.
function exploringClause(company) {
  return company.hypothesis_key === REQUIREMENTS_KEY
    ? 'a tool that keeps each requirement change beside the approval evidence behind the sign off'
    : 'a tool that assembles the records behind an exception into one reviewable case';
}

// "a"/"an" for a following phrase, so trigger phrases read grammatically.
function withArticle(phrase) {
  return `${/^[aeiou]/i.test(String(phrase).trim()) ? 'an' : 'a'} ${phrase}`;
}

// Drop the legal suffix so the company reads naturally inside a sentence.
function companyShort(name) {
  return clean(name)
    .replace(/,?\s+(?:inc|ltd|llc|llp|co|corp|corporation|company|limited|incorporated)\.?$/i, '')
    .trim() || clean(name);
}

function recordsPhrase(company) {
  return company.hypothesis_key === REQUIREMENTS_KEY
    ? 'requirement changes, drawings, and approval records'
    : 'the shipment, case, and approval records';
}

function triggerPhrase(company) {
  return company.hypothesis_key === REQUIREMENTS_KEY
    ? 'requirement or scope change'
    : 'exception or dispute';
}

// A short, role-shaped owner hint for the closing touch. Falls back to a plain
// operational phrase when the stored owner note is messy or names a person.
function ownerHint(company) {
  const raw = String(company.workflow_owner || '').split(/[;,\n]/)[0].trim();
  const role = raw.replace(/^\s*(?:a|an|the)\s+/i, '').trim();
  if (/^(?:director|manager|head|lead|controller|supervisor|specialist|leader|officer|vice president|vp|mine manager|project)/i.test(role)) {
    return role.charAt(0).toLowerCase() + role.slice(1);
  }
  return 'operations';
}

function sourceFor(company) {
  let evidence = [];
  try { evidence = JSON.parse(company.evidence || '[]'); } catch { evidence = []; }
  const source = evidence.find((item) => /^https?:\/\/\S+$/i.test(String(item?.url || item?.source_url || '')));
  if (!source) throw new Error(`No verified HTTP source is stored for ${company.name}.`);
  return {
    fact: clean(source.claim || source.fact || company.observed_fact),
    source_url: source.url || source.source_url,
  };
}

// Four insight-led touches. Every stored field is used only to make the copy
// more specific; nothing internal (uncertainty, qualification, proof boundary)
// reaches the reader. The commercial idea is stated plainly in touch 1.
function directTouches(company, person) {
  const firstName = person.first_name || String(person.name || '').split(/\s+/)[0];
  const companyName = companyShort(company.name);
  const problem = sentenceCase(clean(company.problem).replace(/[.?…\s]+$/, ''));
  const topic = topicFor(company);
  const subject = company.hypothesis_key === REQUIREMENTS_KEY
    ? 'Approval evidence question'
    : 'Exception evidence question';
  return [
    email(firstName, 1, 1, subject,
      `${problem}. Who decides which records and evidence are needed when that happens, and how long does pulling them together usually take?\n\nI run GnK, a small software and AI team in Toronto. We are exploring ${exploringClause(company)}, without taking over the decision itself.\n\nDoes that reflect a real, recurring task at ${companyName}, or is it already handled well today?`),
    email(firstName, 2, 4, subject,
      `A sharper version of what I am testing. In most operations ${recordsPhrase(company)} already exist, and the hard part is pulling the right ones together the moment ${withArticle(triggerPhrase(company))} lands, quickly enough that the decision is not delayed.\n\nIs that where the real effort sits at ${companyName}, or does it land somewhere else entirely?`),
    {
      touch: 3, day: 9, channel: 'linkedin', subject: null,
      body: `Hi ${firstName}, I am looking at how teams handle ${topic} and would be glad to connect.`,
    },
    email(firstName, 4, 18, 'Right person to ask',
      `I will close the loop on this. Are you the right person to ask about ${topic} at ${companyName}, or would someone in ${ownerHint(company)} be closer to it? A name or job title is all I need, and I will leave it there.`),
  ];
}

function routingTouches(company, person) {
  const firstName = person.first_name || String(person.name || '').split(/\s+/)[0];
  const fact = clipWords(clean(company.observed_fact), 24);
  return [
    email(firstName, 1, GNK_ROUTING_PLAN[0].day, 'Process ownership question',
      `${fact}. I am checking one ownership question before taking an idea further. When a ${triggerPhrase(company)} comes up, which role decides what records and evidence are needed to handle it? A name or job title is all I need, and I am not assuming it sits with your team.`),
    email(firstName, 2, GNK_ROUTING_PLAN[1].day, 'Process ownership question',
      `I will close this routing question. Is that the right team for this, or does another role own it? A job title is enough and I will stop here.`),
  ];
}

function spokenBrief(company, person) {
  const source = sourceFor(company);
  const topic = topicFor(company);
  const jobs = [...GNK_SEQUENCE_JOBS.entries()];
  const newInformation = [
    'One concrete problem question, plus the specific idea GnK is exploring.',
    'A sharper operational insight about where the time is actually lost.',
    'A short connection note that keeps the same question visible.',
    'A single ownership check that closes the thread cleanly.',
  ];
  const ctas = [
    'Say whether the task is real and recurring.',
    'Confirm or correct where the effort actually sits.',
    'Accept the connection request.',
    'Confirm the owner or give the right job title.',
  ];
  return {
    outreach_route: 'owner_or_evaluator',
    single_thread: topic,
    skeptical_question: `Does ${company.name} actually perform this recurring task, or do current systems or another party already handle it?`,
    proof_boundary: `${company.observed_fact} This is public context only; it does not by itself prove the internal task, ownership, frequency, consequence, or data access.`,
    next_step: 'Confirm the task exists and who owns it before quantifying value or designing a pilot.',
    research_used: [source],
    touch_plan: jobs.map(([touch, job], index) => ({
      touch,
      job,
      personalization_anchor: `${company.name} and ${person.title || 'the likely operating role'} in the ${topic} question`,
      new_information: newInformation[index],
      cta: ctas[index],
    })),
  };
}

// Rewrite every unsent draft at the 50 researched companies, not just the
// three-person buying group. Any active contact who already has a draft was
// going to be contacted with the old model copy; give them the clean four-touch
// version instead. Contacts with no existing draft are left untouched so we do
// not fabricate outreach for people the targeting deliberately excluded.
const hasDraft = db.prepare("SELECT 1 FROM sequences WHERE person_id=? AND status='draft' LIMIT 1");
const targets = [];
for (const company of companies) {
  const ranked = rankGnkContacts(peopleStatement.all(company.id));
  for (const person of ranked) {
    if (!hasDraft.get(person.id)) continue;
    targets.push({ company, person });
  }
}
if (!targets.length) throw new Error('No GnK draft contacts found to rewrite.');

const prepared = [];
const failures = [];
for (const { company, person } of targets) {
  const routing = person.gnk_route === 'router';
  const touches = routing ? routingTouches(company, person) : directTouches(company, person);
  const stored = db.prepare("SELECT touch,day,channel,subject,body,status FROM sequences WHERE person_id=? AND status<>'draft' ORDER BY touch").all(person.id);
  const protectedByTouch = new Map(stored.map((touch) => [Number(touch.touch), touch]));
  const protectedOne = protectedByTouch.get(1);
  const protectedTwo = protectedByTouch.get(2);
  if (protectedOne && !protectedTwo) touches.find((touch) => touch.touch === 2).subject = protectedOne.subject;
  if (protectedTwo && !protectedOne) touches.find((touch) => touch.touch === 1).subject = protectedTwo.subject;
  const combined = touches.map((touch) => protectedByTouch.get(Number(touch.touch)) || touch);
  const contact = {
    first_name: person.first_name || String(person.name || '').split(/\s+/)[0],
    outreach_route: routing ? 'routing' : 'owner_or_evaluator',
  };
  const brief = routing ? null : spokenBrief(company, person);
  const errors = [
    ...(brief ? validateSpokenBrief(brief, 'gnk') : []),
    ...validateSequence({ contact, campaign: 'gnk', touches: combined }),
  ];
  if (errors.length) failures.push({ id: person.id, name: person.name, company: company.name, errors });
  else prepared.push({ person, touches, brief, routing });
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  throw new Error(`${failures.length} baseline sequences failed validation; nothing was written.`);
}

if (!DRY_RUN) {
  for (const item of prepared) {
    replaceDraftSequence(item.person.id, 'gnk', item.touches);
    if (item.brief) updatePerson(item.person.id, { sales_brief: JSON.stringify(item.brief) });
  }
}

console.log(JSON.stringify({
  companies: companies.length,
  contacts: prepared.length,
  four_touch: prepared.filter((item) => !item.routing).length,
  bounded_routers: prepared.filter((item) => item.routing).length,
  written: DRY_RUN ? 0 : prepared.length,
}, null, 2));
