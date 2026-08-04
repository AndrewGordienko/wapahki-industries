// Full-sequence Codex writer with a fail-closed editorial and validation pipeline.
//
// Default path uses the user's authenticated ChatGPT/Codex CLI session. It never
// reads OPENAI_API_KEY and never calls the usage-billed OpenAI API.
//
//   node scripts/write-sequences.js wapahki --dry-run
//   WRITER_LIMIT=3 node scripts/write-sequences.js wapahki
//   WRITER_IDS=229,232 WRITER_REWRITE=1 node scripts/write-sequences.js wapahki
//   WRITER_REWRITE=1 node scripts/write-sequences.js
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runCodex,
  sequenceBatchSchemaForCampaign,
  critiqueBatchSchema,
  languageBatchSchema,
} from '../src/codex.js';
import { db, replaceDraftSequence, replaceSequence, updatePerson } from '../src/db.js';
import {
  sequenceLengthForCampaign,
  sequencePlanForCampaign,
  sequencePlanForContact,
  wapahkiTrackForContact,
  validateSequence,
  validateSpokenBrief,
} from '../src/outreach-quality.js';
import { personalizeWrittenSubjects } from '../src/run-subject-agents.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const requestedCampaigns = args.filter((arg) => !arg.startsWith('--'));
const CAMPAIGNS = requestedCampaigns.length ? requestedCampaigns : ['wapahki', 'gnk', 'outagehub'];
const DRY_RUN = args.includes('--dry-run');
const BATCH = Number(process.env.WRITER_BATCH || 3);
const CONCURRENCY = Number(process.env.WRITER_CONCURRENCY || 1);
const LIMIT = Number(process.env.WRITER_LIMIT || 0);
const IDS = (process.env.WRITER_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
const EXCLUDE_IDS = new Set(
  (process.env.WRITER_EXCLUDE_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean),
);
const REWRITE = process.env.WRITER_REWRITE === '1';
const ONE_PER_COMPANY = process.env.WRITER_ONE_PER_COMPANY === '1';
const FORCE_COVERAGE = process.env.WRITER_FORCE_COVERAGE === '1';
const PRESERVE_PROTECTED = process.env.WRITER_PRESERVE_PROTECTED === '1';
const COMPANY_LIMIT = Number(process.env.WRITER_COMPANY_LIMIT || 0);
const REVIEW = process.env.WRITER_REVIEW !== '0';
const DRAFT_MODEL = process.env.DRAFT_MODEL || 'gpt-5.6-sol';
const DRAFT_REASONING = process.env.DRAFT_REASONING || 'xhigh';
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'gpt-5.6-sol';
const REVIEW_REASONING = process.env.REVIEW_REASONING || 'high';
const LANGUAGE_MODEL = process.env.LANGUAGE_MODEL || 'gpt-5.6-sol';
const LANGUAGE_REASONING = process.env.LANGUAGE_REASONING || 'high';
const REVISE_MODEL = process.env.REVISE_MODEL || REVIEW_MODEL;
const REVISE_REASONING = process.env.REVISE_REASONING || REVIEW_REASONING;
const SKIP_SUBJECT_AGENTS = process.env.SKIP_SUBJECT_AGENTS === '1';
const SUBJECTS_PER_UNIT = process.env.SUBJECTS_PER_UNIT === '1';

const shared = readFileSync(join(root, 'playbooks', '_shared.md'), 'utf8');
const accountResearchPath = join(root, 'data', 'outreach-research.json');
const accountResearch = JSON.parse(readFileSync(accountResearchPath, 'utf8'));
const redditMatch = shared.match(/<!-- REDDIT-WISDOM:START -->([\s\S]*?)<!-- REDDIT-WISDOM:END -->/);
if (!redditMatch) {
  throw new Error('The active REDDIT-WISDOM block is missing from playbooks/_shared.md. Run `npm run reddit:learn` before writing sequences.');
}
const researchMatch = shared.match(/<!-- SALES-RESEARCH:START -->([\s\S]*?)<!-- SALES-RESEARCH:END -->/);
if (!researchMatch) {
  throw new Error('The active SALES-RESEARCH block is missing from playbooks/_shared.md. Run `npm run research:learn` before writing sequences.');
}
const redditGuidance = redditMatch[1].trim();
const researchGuidance = researchMatch[1].trim();
const sharedCore = shared
  .replace(/<!-- REDDIT-WISDOM:START -->[\s\S]*?<!-- REDDIT-WISDOM:END -->/, '')
  .replace(/<!-- SALES-RESEARCH:START -->[\s\S]*?<!-- SALES-RESEARCH:END -->/, '')
  .trim();
const CAMPAIGN_ALIASES = {
  wapahki: ['wapahki'],
  gnk: ['gnk', 'delay', 'football', 'row'],
  outagehub: ['outagehub', 'outage'],
};
function safeJson(value) {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function safeArray(value) {
  const parsed = safeJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function gnkOutreachRoute(row) {
  if (row.campaign !== 'gnk') return 'campaign_default';
  const explicitRole = String(row.pursuit_contact_role || row.role_type || '').toLowerCase();
  const relevance = String(row.angle || '').toLowerCase();
  const title = String(row.title || '').toLowerCase();
  const routingSignal = /\b(?:rout(?:e|ing)|referr?al|forward|fallback|does not own|do not own)\b/.test(relevance)
    || /\b(?:routing|referral|research)\b/.test(explicitRole)
    || (/\b(?:business development|sales|marketing|support specialist)\b/.test(title)
      && Number(row.relevance_score || 0) <= 4);
  return routingSignal ? 'routing' : 'owner_or_evaluator';
}

function knownColleagues(companyId, contactId) {
  return db.prepare(`
    SELECT id, name, title
    FROM people
    WHERE company_id = ?
      AND id <> ?
      AND COALESCE(lifecycle_status, 'active') != 'archived'
    ORDER BY relevance_score DESC, id
    LIMIT 8
  `).all(companyId, contactId);
}

function immutableTouches(personId) {
  return db.prepare(`
    SELECT touch,day,channel,subject,body,status,created_at
    FROM sequences
    WHERE person_id=? AND status<>'draft'
    ORDER BY touch
  `).all(personId);
}

function contactContext(row) {
  const notes = safeJson(row.company_notes);
  const verifiedEvidence = [];
  const sourceUrls = [];

  if (notes.market_signal?.hook && notes.market_signal?.source_url) {
    verifiedEvidence.push({
      summary: notes.market_signal.hook,
      source_url: notes.market_signal.source_url,
      source_date: notes.market_signal.date || null,
      warning: 'This is a researcher summary, not a direct quote. Paraphrase conservatively and do not strengthen it.',
    });
    sourceUrls.push(notes.market_signal.source_url);
  }
  if (notes.evidence_source) sourceUrls.push(notes.evidence_source);
  if (notes.defensible_problem && notes.evidence_source) {
    verifiedEvidence.push({
      summary: notes.defensible_problem,
      source_url: notes.evidence_source,
      source_date: null,
      warning: 'This is a researcher summary tied to the cited source, not a direct quote. Paraphrase conservatively and do not add a current internal problem.',
    });
  }

  const rawNotes = String(row.company_notes || '').trim();
  if (rawNotes && !rawNotes.startsWith('{')) {
    const urls = rawNotes.match(/https?:\/\/[^\s)]+/g) || [];
    sourceUrls.push(...urls);
    const evidenceMatch = rawNotes.match(/Evidence:\s*([\s\S]*?)(?:\nPrice:|\nBudget:|\nIdeal:|$)/i);
    if (evidenceMatch && urls.length) {
      verifiedEvidence.push({
        summary: evidenceMatch[1].replace(/\s+/g, ' ').trim(),
        source_url: urls[0],
        source_date: null,
        warning: 'This is a legacy researcher summary tied to the cited source. Verify the wording against the source and never present the projected cost, urgency, or business impact as fact.',
      });
    }
  }

  const curatedEvidence = accountResearch[`${row.campaign}:${row.company}`] || [];
  for (const item of curatedEvidence) {
    verifiedEvidence.push(item);
    if (item.source_url) sourceUrls.push(item.source_url);
  }

  for (const item of safeArray(row.pursuit_evidence)) {
    const fact = item.claim || item.statement || item.fact;
    const sourceUrl = item.url || item.source_url;
    if (!fact || !sourceUrl) continue;
    verifiedEvidence.push({
      summary: fact,
      source_url: sourceUrl,
      source_date: item.observed_at || item.source_date || null,
      warning: 'This is account-level public evidence. Verify the source wording and do not turn it into a claim about an internal process.',
    });
    sourceUrls.push(sourceUrl);
  }

  return {
    contact_id: row.id,
    company_id: row.company_id,
    first_name: row.first_name || String(row.name || '').split(/\s+/)[0],
    full_name: row.name,
    title: row.title,
    outreach_route: gnkOutreachRoute(row),
    known_colleagues: knownColleagues(row.company_id, row.id),
    immutable_sent_or_approved_touches: immutableTouches(row.id),
    company: row.company,
    company_industry: row.industry || null,
    company_location: row.city || null,
    verified_evidence: verifiedEvidence,
    source_urls: [...new Set(sourceUrls)],
    public_company_context: {
      what_they_do: notes.what_they_do || null,
      theme: notes.theme || null,
    },
    unverified_research_hypotheses: {
      old_relevance_reason: row.angle || null,
      account_hypothesis: row.company_hypothesis || null,
      defensible_problem: notes.defensible_problem || null,
      proposed_project: notes.ai_project || null,
      role_hypotheses: notes.role_hypotheses || null,
      decision_model: notes.decision_model || null,
      why_meaningful: notes.why_meaningful || null,
    },
    account_thesis_keep_fields_separate: {
      cohort_hypothesis_key: row.hypothesis_key || null,
      observed_public_fact: row.observed_fact || null,
      problem_hypothesis_not_fact: row.pursuit_problem || row.company_hypothesis || null,
      likely_owner_to_confirm: row.workflow_owner || null,
      consequence_to_measure: row.pursuit_consequence || null,
      records_or_systems_to_confirm: row.records || null,
      historical_pilot_test_after_discovery: row.pursuit_offer || null,
      kill_condition: row.kill_condition || null,
      worth_pursuing_scorecard: safeJson(row.workflow_scorecard),
      discovery_qualification: safeJson(row.qualification),
    },
    commercial_context_not_for_email: {
      budget_signal: notes.budget_signal || null,
      close_tier: notes.close_tier || row.tier || null,
      deal_problem_to_validate: row.pursuit_problem || null,
      deal_consequence_to_validate: row.pursuit_consequence || null,
      desired_commitment: row.desired_commitment || null,
      value_to_partner: row.value_to_partner || null,
      next_deal_goal: row.next_goal || null,
      motion: row.pursuit_type || null,
      contact_role: row.pursuit_contact_role || row.role_type || null,
      cost_model: row.pursuit_cost_model || null,
      cost_confidence: row.pursuit_cost_confidence || null,
      known_decision_process: row.decision_process || null,
    },
    previous_private_brief_not_evidence: safeJson(row.sales_brief),
  };
}

function rowsFor(campaign) {
  const sourceCampaigns = CAMPAIGN_ALIASES[campaign] || [campaign];
  const requiredPlan = sequencePlanForCampaign(campaign);
  const requiredTouches = requiredPlan.length;
  const planShapeSql = requiredPlan.map(() => `
    SUM(CASE WHEN company_sequence.touch = ?
              AND company_sequence.day = ?
              AND company_sequence.channel = ? THEN 1 ELSE 0 END) = 1
  `).join(' AND ');
  const planShapeParams = requiredPlan.flatMap(({ touch, day, channel }) => [touch, day, channel]);
  let rows = db.prepare(`
    SELECT p.id, p.company_id, p.name, p.first_name, p.title, p.role_type, p.relevance_score,
           p.sales_brief, p.relevance_reason AS angle,
           c.name AS company, c.campaign AS source_campaign, ? AS campaign,
           c.industry, c.city, c.tier, c.notes AS company_notes, c.hypothesis AS company_hypothesis,
           pu.pursuit_type, pu.problem AS pursuit_problem, pu.evidence AS pursuit_evidence,
           pu.hypothesis_key, pu.observed_fact, pu.workflow_owner, pu.records,
           pu.kill_condition, pu.workflow_scorecard, pu.qualification, pu.offer AS pursuit_offer,
           pu.consequence AS pursuit_consequence, pu.cost_model AS pursuit_cost_model,
           pu.cost_confidence AS pursuit_cost_confidence, pu.desired_commitment,
           pu.value_to_partner, pu.decision_process, pu.next_goal,
           pc.role AS pursuit_contact_role,
           (SELECT COUNT(*) FROM sequences s WHERE s.person_id = p.id) AS sequence_count,
           (SELECT COUNT(*) FROM sequences s WHERE s.person_id = p.id AND s.status <> 'draft') AS protected_count,
           EXISTS (
             SELECT 1
             FROM people company_person
             JOIN sequences company_sequence ON company_sequence.person_id = company_person.id
             WHERE company_person.company_id = c.id
             GROUP BY company_person.id
             HAVING COUNT(company_sequence.id) = ?
                AND ${planShapeSql}
           ) AS company_has_complete_sequence
    FROM people p
    JOIN companies c ON c.id = p.company_id
    LEFT JOIN pursuits pu ON pu.company_id = c.id
    LEFT JOIN pursuit_contacts pc ON pc.pursuit_id = pu.id AND pc.person_id = p.id
    WHERE c.campaign IN (${sourceCampaigns.map(() => '?').join(',')})
      AND c.archived_at IS NULL
      AND COALESCE(p.lifecycle_status, 'active') != 'archived'
      AND p.email LIKE '%@%'
    ORDER BY (c.lead_score IS NULL), c.lead_score DESC,
             c.name COLLATE NOCASE, c.id, p.id
  `).all(campaign, requiredTouches, ...planShapeParams, ...sourceCampaigns);
  if (IDS.length) rows = rows.filter((row) => IDS.includes(row.id));
  if (EXCLUDE_IDS.size) rows = rows.filter((row) => !EXCLUDE_IDS.has(row.id));
  rows = rows.filter((row) => (
    process.env.WRITER_UNLOCK_FOUNDER_SEQUENCE === '1'
    || safeJson(row.sales_brief)?.founder_locked !== true
  ));
  rows = rows.filter((row) => PRESERVE_PROTECTED
    ? Number(row.protected_count || 0) > 0
    : Number(row.protected_count || 0) === 0);
  if (!REWRITE) {
    if (ONE_PER_COMPANY) {
      rows = rows.filter((row) => !Number(row.company_has_complete_sequence || 0));
    } else {
      rows = rows.filter((row) => row.sequence_count < requiredTouches);
    }
  }
  if (ONE_PER_COMPANY && COMPANY_LIMIT) {
    const companyIds = [...new Set(rows.map((row) => row.company_id))].slice(0, COMPANY_LIMIT);
    const allowed = new Set(companyIds);
    rows = rows.filter((row) => allowed.has(row.company_id));
  }
  if (LIMIT) rows = rows.slice(0, LIMIT);
  return rows;
}

const playbooks = Object.fromEntries(
  CAMPAIGNS.map((campaign) => [campaign, readFileSync(join(root, 'playbooks', `${campaign}.md`), 'utf8')]),
);
const units = [];
for (const campaign of CAMPAIGNS) {
  const rows = rowsFor(campaign);
  if (ONE_PER_COMPANY) {
    const byCompany = new Map();
    for (const row of rows) {
      if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
      byCompany.get(row.company_id).push(row);
    }
    for (const companyRows of byCompany.values()) units.push({ campaign, rows: companyRows });
  } else {
    // Wapahki drafts one contact per unit so each unit is a single track
    // (operational, economic, or routing), which fixes the sequence length and
    // schema. Batching mixed-track contacts would apply one track to all of them.
    const batchSize = campaign === 'wapahki' ? 1 : BATCH;
    for (let i = 0; i < rows.length; i += batchSize) units.push({ campaign, rows: rows.slice(i, i + batchSize) });
  }
}

function draftPrompt(unit) {
  const isWapahki = unit.campaign === 'wapahki';
  const isOutageHub = unit.campaign === 'outagehub';
  // Every Wapahki contact runs the same seven-stage sequence. The contact's
  // track (operational, economic, routing) only changes the framing, not length.
  const wapahkiTrack = isWapahki ? wapahkiTrackForContact(unit.rows[0]) : null;
  const isWapahkiRouting = wapahkiTrack === 'routing';
  const isWapahkiEconomic = wapahkiTrack === 'economic';
  const requiredPlan = sequencePlanForCampaign(unit.campaign);
  const touchCount = requiredPlan.length;
  const touchJobs = isWapahki
    ? 'last_example_question, concrete_motion_test, connect, sharper_example, route_owner, offer_task_sketch, close_loop'
    : isOutageHub
      ? 'establish_ownership, examine_handoff, connect, retrospective_replay, consequence_question, sharpen_angle, classification_close'
      : 'problem_question, sharper_hypothesis, connect, close_or_route';
  return [
    'You are Andrew Gordienko’s cold-outreach writer.',
    `Write a complete ${touchCount}-touch sequence for each supplied contact.`,
    'Use this authority order when instructions conflict. Verified source evidence controls factual claims. Campaign rules and founder-approved examples control the offer, posture, and voice. Shared house rules control sequence shape and quality. Managed external research is advisory and applies only when compatible. Private briefs, deal context, hypotheses, and old relevance notes guide preparation but are never evidence.',
    'Write one coherent human conversation, not a collage of rules. The rules are constraints; do not echo their labels or phrasing into buyer-facing copy. Match the quality and naturalness of approved examples without copying their sentences.',
    ...(PRESERVE_PROTECTED
      ? [
          `Some contacts have immutable sent or approved history in immutable_sent_or_approved_touches. Return a complete ${touchCount}-touch sequence, but copy every immutable touch exactly into the corresponding touch so the private plan and future copy respond to what was actually sent. Never rewrite, improve, contradict, or erase sent history.`,
          'Write only the remaining stages as new copy. They must continue the one problem hypothesis established by the immutable messages while correcting any overreach. Do not repeat a meeting ask, economics, or a pilot pitch already made. GnK routing contacts are handled by a separate two-message route and must not appear in its full-sequence writer.',
        ]
      : []),
    ...(ONE_PER_COMPANY
      ? [
          'The supplied contacts all work at one business. Choose AT MOST ONE contact for a sequence. Return a disposition for everyone else and explain why the chosen person is the strongest role. If nobody has a credible route, choose nobody.',
          'Decision consistency is mandatory. If a disposition reason says a person is the strongest contact, has the strongest route, can credibly assess the question, or is a valid research contact, that disposition MUST be write and the sequence MUST be included. Do not describe a credible winner and then mark everyone do_not_contact.',
        ]
      : []),
    ...(FORCE_COVERAGE
      ? [
          'This is an operator-requested coverage batch. Write one complete sequence for EVERY supplied contact without inventing purchasing authority or ownership. For OutageHub, an adjacent contact receives a transparent role-specific routing sequence. GnK contacts that are merely routers still fail closed for its separate routing workflow.',
          'Ground the question in what this role can credibly observe, perform, control, approve, or secure. A title is a route hypothesis, not proof that the person owns the work.',
          'A GnK contact marked outreach_route routing must not receive this four-touch sequence. Return do_not_contact for this batch so the separate two-message routing workflow can handle them.',
          'When known_colleagues names a more plausible operator or owner, use the final touch to ask about that route once. Do not turn every earlier touch into a routing request.',
          'Choose one product thread per company and keep it for every contact. Pre-shipment retailer-compliance exception handling and post-chargeback dispute recovery are different products. Never combine them in one sequence or let old relevance notes switch the product chosen by the current account pursuit.',
          'Do not invent a retailer rule such as maximum carton weight. Do not use product sizes, weights, or colours as proof of routing, labelling, or shipping non-compliance. Do not assume the company says release or hold; describe retailer-compliance exceptions in neutral language.',
          'Research before writing. Use at least one verified source or an official company page and record the exact fact and URL in spoken_brief.research_used. If public evidence does not establish role ownership, say so in the private proof boundary and write a transparent routing or discovery sequence rather than inventing authority.',
        ]
      : [
          'First decide whether the role has an honest route to the offer. Return one disposition for EVERY supplied contact. If the route or evidence is weak, set do_not_contact and omit that contact from sequences. Never force a draft.',
    'Apply the campaign posture when judging that route. Wapahki and OutageHub explicitly allow bounded user-research calls with operators, maintenance staff, field-service staff, or operations leaders named in their campaign rules. Those people do not need purchasing authority and must not be rejected merely because they cannot sponsor a paid pilot. GNK still requires a plausible commercial route.',
    ...(isWapahki ? [
      'The Wapahki contact map deliberately uses three distinct role perspectives per account. A contact marked role_type referral or research may receive a bounded sequence about what they uniquely see: customer-program variation, package specifications, quality controls, floor observations, finished-load handoffs, or the route to operations or engineering. Do not reject them merely for lacking buying authority. Never claim that a person owns, decides, is responsible for, or is accountable for a process based on title alone.',
    ] : []),
          'Research before writing. For every contact you keep, use at least one supplied verified source or browse to an official company page or equally direct public source. Record the exact factual statement and URL in spoken_brief.research_used. A search-result snippet, a title alone, and a generic company description are not enough. If you cannot find a current role-relevant fact, return do_not_contact.',
        ]),
    'For every contact you do write, complete spoken_brief before the touches. single_thread must name exactly one situation the first email is about. The evidence, question, offer_connection, and call_payoff must all stay on that thread. Do not combine adjacent product goals merely to explain the whole product.',
    'The brief must explain the offer with a concrete actor, action, and object, name why this person would reply, state one question in words Andrew would actually say aloud, explain how the offer connects to that exact question, and name what Andrew will show and what the recipient can change on the call. It must also rehearse one hard role-specific question about fit, proof, implementation, risk, or ownership; state exactly what the supplied evidence supports and does not support; and choose the one concrete next step if the recipient confirms relevance. Draft the messages from that brief.',
    `Plan all ${touchCount} touches in spoken_brief.touch_plan before drafting. Use exactly these jobs in order: ${touchJobs}. For every touch, name the real personalization anchor, the genuinely new information it contributes, and its one CTA. Repeating the company name, title, greeting, or the fact that Andrew emailed is not personalization. A role-owned decision, sourced company event, concrete consequence, useful calculation, or tailored artifact is.`,
    isWapahki
      ? (isWapahkiRouting
        ? 'Seven stages, but run them as a LIGHT routing thread — this person is outside the operational and economic remit, so never ask them to develop the robotics thesis or sit through floor discovery. Stage 1 (email): name that Wapahki is early-stage and building a cell that picks up and places (or transfers) one product the same way every cycle, say you are researching how the physical pack-out is actually done, acknowledge it is probably outside their role, and ask who owns that physical process. Later stages add one concrete example, confirm or narrow the owner (a name or job title is all you need), and close. Ask for a name, not a meeting. Every stage must add something new — a concrete example, a clarified owner, a different ask — never a paraphrase of a prior touch.'
        : isWapahkiEconomic
          ? 'This is a finance or business contact — a ROUTE INTO OPERATIONS and the person who judges investment, not a thesis partner. Never ask them to theorize about the floor. Stage 1 (email): name that Wapahki is early-stage and building a cell that repeats one case-handling, transfer, or palletizing motion, then ask who determines whether the same task appears across enough customer programs to justify the investment — production, engineering, or finance. Stage 2 (email): give one concrete example (sealed cases from several programs reaching the same point and being transferred or palletized in roughly the same way) and ask who would know whether a handoff like that occurs often enough, with little enough variation, to investigate — a name or job title is all you need. Later stages confirm the route and close calmly. Never invent figures. Every stage must add a concrete example, new evidence, or a different ask — never a paraphrase.'
          : 'This is a seven-stage operational discovery that MOVES and asks the recipient to RECALL real work, never to theorize. Stage 1 (email): name that Wapahki is early-stage and building a cell that repeats one case-handling, transfer, or palletizing motion, then ask about a recent real example — across two recent production runs, was there a finished-case transfer or palletizing step that stayed essentially the same even though the product and quality checks changed? Ask for a short call or one recent example by email. Stage 2 (email): make it concrete — name one specific handoff (sealed cases from several runs leaving the same conveyor point, transferred or palletized the same way) and ask whether it repeats or whether case size, weight, rate, or sanitation make it different each time. Stage 3 (LinkedIn): connect in one line about that exact question. Stage 4 (email): a DIFFERENT concrete example or a narrower cut of the same handoff — never restate stage 2. Stage 5 (email): route — ask whether they are closest or whether a named colleague or function is. Stage 6 (LinkedIn): offer to sketch the one task (what arrives, what movement repeats, what changes between runs, which exceptions still need a person). Stage 7 (email): close. Arrive at the real question: does one specific physical handoff repeat often enough, with little enough variation, to investigate? THE HARD RULE: a later touch may exist only if it adds a more concrete example, new evidence, a useful artifact, or a different ask; if it merely paraphrases the prior hypothesis it is wrong. Banned abstract phrases: "stays recognizable", "the checks change", "emerging hypothesis", "learning question", "current synthesis", "unfamiliar operating idea", "where repeatable handling ends".')
      : isOutageHub
        ? 'The sequence is four substantive emails around one trigger and one operational decision. Touch 1 explains why this role has unique insight, asks how the decision is handled today, describes OutageHub in one sentence, and sells a 20-minute discovery call or routes an adjacent contact. Touch 2 sends an inline historical replay or clearly labelled supported sample record without asking permission. Touch 3 connects the decision to one measurable consequence without inventing a number. Touch 4 closes or routes outage intelligence or the incident-system integration. Do not pitch a pilot after silence.'
        : 'The GnK sequence is four insight-led touches over roughly three weeks (days 1, 4, 9, 18). Touch 1 asks one concrete when-event problem question and names, in one plain sentence, the specific tool GnK is exploring, so the reader gets a concrete idea to react to; no meeting ask. Touch 2 shares a sharper operational insight about where the time is actually lost and invites one correction; it gives a view, it does not re-interrogate. Touch 3 is a short LinkedIn connection note on the same question. Touch 4 asks for the correct owner once, a name or job title, then stops. THE FUNDAMENTAL RULE: internal research only makes the copy more specific; internal uncertainty, qualification language, and proof boundaries must NEVER appear in buyer-facing copy. Never write "the source does not prove", "not yet established", "only after qualification", "operating task/owner", or hedges like "I am not assuming this sits with you" — that context lives in the private brief. Silence is not validation. Do not quantify the case or mention a paid pilot anywhere in the cold sequence. Touch 4 must name the exact workflow it closes.',
    'Use commercial_context_not_for_email to keep the sequence aimed at the actual deal motion, desired commitment, and next step. It is Andrew’s private strategy, not a public company fact, so never claim the recipient agreed with it or quote it as evidence.',
    'The private brief should be richer than the copy. Do not dump the skeptical-question rehearsal, every proof caveat, or the internal next-step logic into touch 1.',
    'Apply the answerability test to the main question: the recipient must be able to answer it in one ordinary sentence without learning Andrew’s product vocabulary or decoding an abstract phrase.',
    '',
    '=== SHARED RULES ===',
    sharedCore,
    '',
    '=== ACTIVE REDDIT PRACTITIONER GUIDANCE ===',
    'This managed block was distilled from the Reddit research in the handbook. Apply it as practitioner guidance. Evidence and campaign rules win if a tactic conflicts.',
    redditGuidance,
    '',
    '=== ACTIVE YOUTUBE, COURSE, AND BOOK GUIDANCE ===',
    'This managed block was distilled from the cited cross-source research guide. Apply it directly. The house rules named inside it remain fixed.',
    researchGuidance,
    '',
    '=== CAMPAIGN RULES ===',
    playbooks[unit.campaign],
    '',
    '=== REQUIRED TOUCH PLAN ===',
    JSON.stringify(requiredPlan),
    ...(isWapahki
      ? [
          `This seven-stage Wapahki plan over roughly four weeks is authoritative. Track for this contact: ${wapahkiTrack}. The stages MOVE and never paraphrase — a later touch may exist only if it adds a more concrete example, new evidence, a useful artifact, or a different ask.`,
          'Subject rule: touches 1, 2, 4, 5, and 7 are emails with a non-null 2-to-5-word subject in natural sentence capitalization. Touch 2 stays in the touch-1 thread and repeats touch 1 exactly. Touch 4 opens a distinct thread; touch 5 stays in that thread and repeats touch 4 exactly. Touch 7 has a distinct calm closing subject. Touches 3 and 6 are LinkedIn with null subjects.',
          'Every first email names, in one plain sentence, that Wapahki is an early-stage robotics company building a flexible robotic cell that repeats one case-handling, transfer, or palletizing motion (picks up and places, transfers, or palletizes one item the same way every cycle). Ask the recipient to RECALL real work, never to speculate about automation. Do not open with "as [title], you would know", do not recite an early-stage disclaimer, do not add "an email reply would also help", and never assert a specific named task already exists.',
          ...(isWapahkiRouting
            ? [
              'ROUTING FRAMING: this person is outside the operational and economic remit — keep it light and never ask them to develop the thesis or run floor discovery. Touch 1: say you are researching how the physical pack-out is actually done, acknowledge it is probably outside their role, and ask who owns that physical process — packaging, production, or operations. Ask for a name or job title, NOT a meeting. Touch 2 (same thread): add one concrete example of the handoff you mean so the routing ask is specific. Touch 3: LinkedIn note asking to connect and who owns physical pack-out. Touch 4 (new thread): confirm a likely name if you have one, otherwise narrow the function — add something new. Touch 5: a short plain nudge for the right name or title. Touch 6: one-line LinkedIn follow-up. Touch 7: close warmly, door open for a name later. Never ask this person for a call and never pitch equipment.',
            ]
            : isWapahkiEconomic
              ? [
                'ECONOMIC FRAMING: this finance or business contact is a ROUTE INTO OPERATIONS and judges investment — never ask them to describe floor work. Touch 1: ask who determines whether the same task appears across enough customer programs to justify the investment — production, engineering, or finance. Touch 2 (same thread): give one concrete example (sealed cases from several customer programs reaching the same point and being transferred or palletized the same way) and ask who would know whether a handoff like that occurs often enough, with little enough variation, to investigate — a name or job title is all you need. Touch 3: LinkedIn note about finding who evaluates whether a repeating task justifies automation. Touch 4 (new thread): one new concrete angle on the investment question (utilization of one cell across several programs, or the labour tied to one repeated movement). Touch 5: confirm the route — which function would evaluate it, and could they point you there. Touch 6: one short LinkedIn question to confirm the owner. Touch 7: close calmly, door open for a name. Never invent figures and never mention a pilot or deployment.',
              ]
              : [
                'OPERATIONAL FRAMING: write like a builder talking to an operator. Touch 1: ask about a recent real example — across two recent production runs, was there a finished-case transfer or palletizing step that stayed essentially the same even though the product and quality checks changed? Ask for a short call or one recent example by email. Touch 2 (same thread): make it concrete — name one specific handoff (sealed cases from several runs leaving the same conveyor point, transferred or palletized the same way) and ask whether it repeats or whether case size, weight, rate, or sanitation make it different each time. Touch 3: LinkedIn note about that exact finished-case handoff question. Touch 4 (new thread): a DIFFERENT concrete example or a narrower cut (a different conveyor point, a different pack family, the exceptions that still need a person) — must add what touch 2 did not; do not label anything a "hypothesis". Touch 5 (same thread as 4): route — ask whether this person is closest or whether a named colleague or function (production, engineering, continuous improvement) knows it better. Touch 6: LinkedIn — offer to sketch the one task (what arrives, what movement repeats, what changes between runs, which exceptions still need a person) and ask if that is worth doing; one question, no meeting. Touch 7: close calmly on that specific handoff. Arrive at the real question: does one specific physical handoff repeat often enough, with little enough variation, to investigate?',
              ]),
          'Banned abstract phrases in every touch: "stays recognizable", "the checks change", "emerging hypothesis", "learning question", "current synthesis", "unfamiliar operating idea", "where repeatable handling ends". Banned selling and presuming: technical screen, fit screen, qualify, disqualify, reject a weak opportunity, deployment, deploy, pilot, paid pilot, an unbuilt one-page sketch as a promise, and claiming the recipient owns or is accountable for the work.',
        ]
      : isOutageHub
        ? [
          'This seven-stage OutageHub plan is authoritative for OutageHub. The whole sequence tests ONE thing before it sells anything: does this company actually own the decision — determining the likely cause and the dispatch/triage priority for power-related alarms during a regional outage — or has an upstream carrier, NOC, or vendor already made those decisions and handed the company an already-classified, pre-prioritized work order? Never assume the company owns the workflow. Earn that fact. The ONLY meeting ask in the whole sequence is stage 4.',
          'Subject rule: stages 1, 2, 4, 6, 7 are EMAILS with a non-null 2-to-5-word subject in natural sentence capitalization. Stage 2 stays in the stage-1 thread and repeats the stage-1 subject exactly. Stage 4 opens a NEW thread with a distinct retrospective subject; stage 6 stays in stage 4’s thread; stage 7 uses its own distinct closing subject. Stages 3 and 5 are LinkedIn and MUST use a null subject.',
          'Use real operator vocabulary, not invented process nouns. Say "prioritize a trouble ticket", "decide where to dispatch a technician", "check whether alarms share a utility outage", "classify the incident". NEVER invent phrases like "emergency-dispatch review", "which alarm group is reviewed next", or "outage context record".',
          'Stage 1 (email, day 1) — establish ownership, NO call. Open with ONE verified public fact about what THIS team actually does (maintains site power and generators, runs the NOC, handles catastrophe claims, and so on). Then ask the real ownership question in plain operator terms: when a regional outage produces power-related alarms or trouble tickets across sites, does their team decide which sites get field attention first / still determine the likely cause and priority, or does the carrier or upstream group send it already classified? Introduce yourself once with "I run OutageHub", then say in one plain clause, tuned to this buyer, that it matches public Canadian utility outage reports to site locations. Frame the honest test: you are trying to learn whether that context could support their decision or whether the decision stays entirely with the carrier. End with a light question — which is closer to how it works? Do NOT ask for a call here. Do NOT paste a canned slogan, do not stack disclaimers, and never label a non-operator "multi-site operator".',
          'Stage 2 (email, day 5, SAME thread) — examine the handoff concretely; it is NOT a replay and never asks the reader to imagine an event. Ask: when the company receives a power-related work order, does it already include the relevant utility outage and restoration information, or does someone in operations check that separately? Say plainly and conditionally what OutageHub could attach (utility source, observation time, location match) to the existing incident, and that if that information already arrives reliably it likely would not add much. If an SLA would force dispatch regardless of cause, name that too. End with one question such as: who would see that handoff most clearly? No meeting ask, no numbers.',
          'Stage 3 (LinkedIn, day 9) — a connection request note written before acceptance, under 200 characters. One plain line about the ownership question you are exploring. It must NOT ask for a call, paste an email, include a link or signature, or assume they read the emails.',
          'Stage 4 (email, day 13, NEW thread) — the retrospective evaluation carrying the ONLY 20-minute call ask. Conditioned on ownership: if the company owns any part of the prioritization, the safest evaluation is retrospective — they select one past regional outage and its site alarms; OutageHub reconstructs the utility information available at the time and matches it to those locations; their team judges whether the added context would have shortened the review or changed any dispatch priority; no live decision depends on the result. End with a single plain question: would a 20-minute call be worthwhile to determine whether that replay is practical? No numbers, no ROI.',
          'Stage 5 (LinkedIn, day 18) — one short consequence question, written as if connected. Ask exactly one easy question about the consequence they would actually feel — e.g. whether the slow part is gathering the outside context or deciding priority once they have it. No meeting ask, no numbers, no pasted email.',
          'Stage 6 (email, day 24, stage-4 thread) — sharpen ONE new angle, never a restatement. Add one concrete observation drawn from this company’s real context (for example that the utility’s public restoration estimate can matter more than the outage flag, because it changes whether they hold or roll a truck) and ask whether that matches their experience. No meeting ask, no numbers.',
          'Stage 7 (email, day 30, new closing thread) — the carrier / company / shared classification close. Ask which description is closest: the carrier prioritizes the sites and sends the work orders; the company prioritizes the field response; or the decision is shared. Say that if it is the first you are likely speaking with the wrong organization, and if it is the second or third, a job title for the person closest to that decision would help. Do NOT ask about an "integration owner" or "incident-system integration", and do not repeat the product, a replay, or a meeting ask.',
          'The costly-problem, economic-case, cost-basis, potential-upside, commercial-entry, and account evidence remain private. Buyer-facing copy must not mention a pilot, CAD $40k–$75k, a first-year deployment, an annual contract, illustrative account economics, or ANY invented number, dollar range, hour count, or percentage. Discovery earns any later commercial proposal.',
          'Never claim real-time, live, complete, national, or nationwide coverage, and never imply every Canadian utility is covered. Describe the source only as public Canadian utility outage reports matched to site locations, phrased naturally rather than as a fixed slogan. Do not claim an advantage over Gisual, PowerOutage.com, direct utility data, or the buyer’s current stack unless supplied product evidence proves it.',
        ]
        : [
          'Subject rule: touches 1, 2, and 4 are emails and MUST have a non-null 2-to-5-word subject with natural sentence capitalization: capitalize the first word and genuine proper nouns or acronyms, not every word. Touch 2 is the same thread and MUST repeat touch 1 subject exactly. Touch 4 opens a new thread and MUST use a different subject. Touch 3 is LinkedIn and MUST use a null subject.',
          'Touch 1 is the day-1 problem question, written entirely from the recipient’s perspective. Do NOT copy the private hypothesis or its memo phrasing, and never open with "The question is whether". Re-express it as one concrete, company-specific question about the recipient’s real workflow: when a specific triggering event happens, ask what happens between the resulting record or report and the decision it should drive (for example repair, restrict, monitor, escalate, dispute, release, or approve). Name in one plain sentence a possible direction GnK is exploring, but do NOT force a predetermined product; the exact tool is a discovery outcome, not a fixed template. Do not assert the recipient owns the process, do not ask for a meeting, do not quantify a cost, do not ask how long something takes before the task itself is established, and do not mention a pilot.',
          'Touch 2 is the day-4 email in the same thread and MUST add new information, never a restatement of touch 1. Offer one sharper, specific observation about where the difficulty in that exact workflow tends to sit, drawn from this company’s real context, never a generic phrase reused across industries, and ask whether that matches how they actually work or whether it lands elsewhere. No meeting ask.',
          'Touch 3 is a LinkedIn CONNECTION REQUEST NOTE, written before acceptance. Keep it under 200 characters. It must not ask for a call, paste the email, include a link or signature, or imply that the recipient read touch 1 or touch 2.',
          'Touch 4 is the day-18 close-or-route email in a new thread. Name the exact workflow in the recipient’s own language, ask once whether this person or a named colleague owns it (a name or job title is enough), and stop. Do not repeat a meeting ask, economics, or pilot language.',
        ]),
    '',
    '=== CONTACT CONTEXT ===',
    JSON.stringify(unit.rows.map(contactContext), null, 2),
    '',
    'Important data rule: unverified_research_hypotheses are brainstorming inputs, not facts. They may become a question or proposed example only. Supplied verified_evidence and facts you personally verify against the URLs in research_used are the only source-backed company evidence. Paraphrase conservatively.',
    'Write native, concrete English. A full discovery touch 1 normally runs 80 to 150 body words excluding greeting and signature; a Wapahki routing email runs about 55 to 100. GnK routing contacts are not eligible for this writer. Any call request must be for 20 minutes, never 10 or 15.',
    isWapahki
      ? (isWapahkiRouting
        ? 'End the single routing email by asking who owns the physical process and requesting a name or job title. Do NOT ask for a call and do not promise an artifact.'
        : isWapahkiEconomic
          ? 'End touch 1 with a plain question ending in "20-minute call?" or "20-minute conversation?", then offer a pointer to whoever owns operations as an easy alternative. Do not add "an email reply would also help" and do not promise an artifact.'
          : 'End touch 1 with a single plain question ending in "20-minute call?" or "20-minute conversation?". Do not add a second low-friction line such as "an email reply would also help," and do not promise an artifact.')
      : isOutageHub
        ? 'OutageHub stage 1 asks NO meeting; it ends with a light "which is closer to how it works?" ownership question. The ONLY call ask is stage 4, phrased as a single plain question ending in "20-minute call?" or "20-minute conversation?" about whether the retrospective replay is practical.'
        : 'GnK touch 1 must not ask for a call. The four-touch cold sequence contains no meeting ask at all; a 20-minute discovery is earned only after a reply.',
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function critiquePrompt(unit, draftResult) {
  const isWapahki = unit.campaign === 'wapahki';
  const isOutageHub = unit.campaign === 'outagehub';
  return [
    'You are the editorial board for Andrew Gordienko’s cold outreach. Do not rewrite yet.',
    'Review each full sequence through four independent lenses.',
    ...(PRESERVE_PROTECTED ? [
      'History-preservation editor: compare the draft with immutable_sent_or_approved_touches. Require those touches to remain exact historical copies. Judge only what future touches should do next; do not recommend editing an email that was already sent.',
    ] : []),
    'Research editor: open and verify every URL in spoken_brief.research_used. Reject a search snippet, stale or indirect source, unsupported paraphrase, or a source that has no role-relevant bearing on the message.',
    'Evidence editor: identify every statement that the supplied evidence does not support or that strengthens a researcher summary.',
    FORCE_COVERAGE
      ? 'Recipient editor: require an honest operator, process-owner, economic-buyer, or technical/security route for every GnK contact. A contact marked outreach_route routing must be rejected from the four-touch batch and handled by the separate two-message routing path. Never invent authority to satisfy coverage.'
      : 'Recipient editor: decide whether this exact title has a credible route to the question and whether every angle belongs in that role’s remit. Follow the campaign posture: an explicitly permitted Wapahki or OutageHub research contact does not need authority to buy or sponsor a pilot; GNK does.',
    'Clarity editor: find awkward, non-native, abstract, vague, or canned English. Read the copy as spoken English.',
    'Coherence editor: trace the operational thread from the evidence through the question, offer, and CTA. Reject an email that starts strongly but switches to a different product problem or makes an unclear pronoun do the logical work.',
    'Decision editor: identify the exact decision this recipient makes, why the decision repeats, and the concrete recommendation, comparison, brief, range, or record the proposed tool places in front of them. Reject a draft that describes data inputs more clearly than the decision or output.',
    'Boundary editor: require the draft to make clear whether the build is an internal company tool or a customer-facing product capability. Reject unsupported assumptions about access to customer records, usage telemetry, scientific evidence, plant data, or other systems.',
    'Role-value editor: test the idea against the title. Commercial leaders need a credible connection to adoption, proof of value, renewals, expansion, or product feedback. Technical and scientific leaders need a precise technical decision, not an undefined "weak" result.',
    'Economics editor: for GnK and OutageHub, reject every cost estimate, annualized burden, ROI claim, pilot or deployment price, or paid-pilot pitch in the no-reply sequence. Economics and commercial scope come only after discovery. For other campaigns, apply their own explicit cost rules.',
    'Answerability editor: read the main question by itself. Reject it if the recipient must decode Andrew’s terminology, resolve multiple events, or invent the situation before answering in one ordinary sentence.',
    'Reply editor: decide whether touch 1 contains enough context and one useful workflow question. GnK touch 1 must not ask for a meeting; the four-touch cold sequence contains no meeting ask at all.',
    'Skeptical-buyer editor: ask the hardest credible question this role would raise about fit, proof, implementation, risk, or ownership. Reject a sequence that can answer only by inventing a case study, capability, result, access to data, or customer commitment.',
    'Next-step editor: confirm that the private brief names one concrete action after a positive reply and that each buyer-facing touch has one stage-appropriate request rather than several competing paths.',
    'Tone editor: reject commands that make the recipient qualify or dismiss the pitch, including "tell me if that is not a problem," and reject curt exits such as "no need to continue." Qualification is the writer’s job.',
    isWapahki
      ? 'Sequence-strategy editor: enforce Wapahki’s seven-touch early-discovery progression. Touch 1 says why the role provides unique insight, states that Wapahki is early stage and not selling equipment yet, asks one concrete operational question, and offers a 20-minute call or email answer. Touch 2 clarifies one process distinction. Touch 3 only connects. Touch 4 shares an emerging hypothesis and asks whether it matches. Touch 5 checks the right person or function without assuming ownership. Touch 6 tests one synthesis in a single LinkedIn question without a meeting ask. Touch 7 closes calmly. Reject product or process assumptions, claims of accountability or ownership, qualifying and deployment language, technical or fit screens, disqualification criteria, sketches that do not exist, repeated questions, broad market-research homework, and requests for floor access.'
      : isOutageHub
        ? 'Sequence-strategy editor: enforce OutageHub’s ownership-first progression. The sequence must TEST whether the company owns the cause-and-dispatch-priority decision before selling anything; reject copy that assumes the company receives and classifies the alarms when a carrier or upstream group may hand it an already-triaged work order. Reject unsupported coverage, latency, early-detection, N+1 diesel, colocation, before-ticket, or buyer-surprise claims, invented operator nouns ("emergency-dispatch review", "which alarm group is reviewed next"), any invented number or dollar range, and premature "integration owner" asks. Touch 1 opens with one verified fact about what the team does, asks whether they still determine cause and dispatch/triage priority or the carrier sends it already classified, describes the mechanism plainly (matches public Canadian utility outage reports to site locations, no canned slogan, no mismatched "multi-site operators" label), frames the honest remove-a-check-or-just-duplicate test, and asks for a 20-minute call. Touch 2 sharpens the ownership fork (already-set ticket vs. still-checks-utility, and SLA-forced dispatch changes nothing) and asks which is closer — no replay, no imagined event. Touch 3 proposes a retrospective test on the company’s own closed incidents and asks whether they hold the historical tickets or the carrier does. Touch 4 asks who owns the alarm-to-dispatch handoff (this person, another operations group, or the carrier) for a name or job title. Reject any pilot or price, permission-to-send asks, stacked caveats, and technical questionnaires.'
        : 'Sequence-strategy editor: enforce GnK’s four-touch insight-led order. Touch 1 asks one when-event problem question with no meeting ask and names, in one plain sentence, the specific tool GnK is exploring. Touch 2 shares a sharper operational insight about where the time is lost and invites one correction, with no meeting ask. Touch 3 only connects. Touch 4 closes or routes once, asking for a name or job title. Reject any internal uncertainty, qualification, or proof-boundary language in buyer-facing copy, any cost model or paid-pilot pitch before discovery, repeated questions, invented ownership, or a router placed in four touches.',
    'Sequence-plan editor: compare every buyer-facing touch with spoken_brief.touch_plan. Reject surface personalization based only on the name, title, employer, greeting, or prior outreach. Reject any follow-up that does not add the distinct information promised in the plan, and reject a generic close that could be sent unchanged to another person.',
    FORCE_COVERAGE
      ? 'Use revise for fixable copy. For GnK use do_not_contact when the supplied title is only a router or has no honest access to the workflow; coverage never overrides role fit. Pass only when no material change is needed.'
      : 'Set verdict to do_not_contact when role fit or evidence is too weak. Set revise for any fixable issue. Pass only when no material change is needed.',
    '',
    '=== SHARED RULES ===',
    sharedCore,
    '',
    '=== ACTIVE REDDIT PRACTITIONER GUIDANCE ===',
    redditGuidance,
    '',
    '=== ACTIVE YOUTUBE, COURSE, AND BOOK GUIDANCE ===',
    researchGuidance,
    '',
    '=== CAMPAIGN RULES ===',
    playbooks[unit.campaign],
    '',
    '=== CONTACT CONTEXT ===',
    JSON.stringify(unit.rows.map(contactContext), null, 2),
    '',
    '=== DRAFT SEQUENCES ===',
    JSON.stringify(draftResult.sequences, null, 2),
    '',
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function languagePrompt(unit, draftResult) {
  return [
    'You are an independent native-English read-aloud editor. You are not a sales strategist and you are not here to preserve polished wording.',
    'Read every line aloud as if Andrew were saying it to the recipient on the phone.',
    'A line fails if all its words are English but a native speaker has to stop and translate the noun phrases, infer the actor, or guess why one sentence follows another.',
    'Read the main question on its own. It must describe one event clearly enough that the recipient could answer in one ordinary sentence without knowing Andrew’s product.',
    'Read the product sentence on its own. It must say what the tool puts in front of which person and what decision that output changes. A catalogue of data sources is not a product explanation.',
    'Reject undefined failure labels such as "weak experiment", "weak prior attempt", and "likely repeat". Name the target, material, condition, contradictory result, failed check, or other concrete reason the prior work matters.',
    'For each contact, first state the whole email idea in one plain actor-action-object sentence. Then quote every unnatural line, explain exactly why it makes the reader stumble, and replace it with words a person would actually say.',
    'Then trace the idea across paragraphs. The evidence, question, explanation, and CTA must remain about one operational situation. If the opener is about a stopped robot, the next paragraph cannot switch to changing products or rewriting programs.',
    'Read the CTA especially closely. A sentence like "Could we spend 20 minutes on that process if I prepare a sketch, so you can tell me what to change?" fails because it carries the request, condition, artifact, and payoff in one breath. Split it into the call question and a plain payoff sentence.',
    'Undefined labels fail automatically, including flexible equipment, re-teach formats, robot cell, scenario agent, scenario sandbox, decision inputs, outage context, brief look, or anything similar. Explain the physical or software action instead.',
    'Boardroom language also fails. Replace phrases such as assess whether, merits, strategically useful, outside current priorities, if applicable, or deserves attention.',
    'Aggressive or recipient-burdening language fails too. Andrew must not tell the reader to disprove his premise, route his email, or announce that there is "no need to continue."',
    'A call payoff fails if it appears to ask the recipient to disclose or put on screen internal alarms, incident logs, customer records, facility readings, or other sensitive operating data. Andrew brings the artifact; the recipient may react at a process level.',
    'Model transitions fail when they merely glue paragraphs together, including "that made me want to ask," "that work made me curious," and "seeing that range." State the fact, then ask.',
    'Do not make Andrew ask the reader to "correct my view," "correct the checks," or "correct what the person decides." Name the artifact and ask whether it matches the real work or what Andrew overlooked.',
    'Reject "you can correct..." in a CTA. It assigns the reader editing work. Use a natural comparison or ask what Andrew missed.',
    'Reject adjacent paragraphs that repeat the same long phrase. The second paragraph must advance the idea rather than restate the first question.',
    'Set pass only when every touch is idiomatic, concrete, and flows on one read. Technically grammatical is not enough.',
    '',
    '=== SHARED PLAIN-ENGLISH RULES ===',
    sharedCore,
    '',
    '=== ACTIVE REDDIT PRACTITIONER GUIDANCE ===',
    redditGuidance,
    '',
    '=== ACTIVE YOUTUBE, COURSE, AND BOOK GUIDANCE ===',
    researchGuidance,
    '',
    '=== CAMPAIGN MEANING ===',
    playbooks[unit.campaign],
    '',
    '=== DRAFT SPOKEN BRIEFS AND SEQUENCES ===',
    JSON.stringify(draftResult.sequences, null, 2),
    '',
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function revisePrompt(unit, draftResult, critiqueResult, languageResult) {
  const isWapahki = unit.campaign === 'wapahki';
  const isOutageHub = unit.campaign === 'outagehub';
  const touchCount = sequenceLengthForCampaign(unit.campaign);
  const allowed = new Set(
    critiqueResult.reviews
      .filter((review) => FORCE_COVERAGE || review.verdict !== 'do_not_contact')
      .map((review) => Number(review.contact_id)),
  );
  return [
    'You are the final editor for Andrew Gordienko’s cold outreach.',
    `Revise every included sequence so it resolves every required change and follows the rules. Read all ${touchCount} touches together and remove repeated questions, CTAs, sentence shapes, and apologies.`,
    isWapahki
      ? 'Wapahki email touches 1, 2, 4, 5, and 7 MUST have non-null 2-to-5-word subjects with natural sentence capitalization. Touch 2 MUST repeat touch 1. Touch 4 opens a distinct emerging-hypothesis thread and touch 5 MUST repeat touch 4. Touch 7 uses a third distinct closing subject. LinkedIn touches 3 and 6 MUST have null subjects.'
      : isOutageHub
        ? 'All four OutageHub touches are emails with non-null 2-to-5-word subjects in natural sentence capitalization. Touch 2 opens a distinct replay thread, touch 3 MUST repeat touch 2 exactly, and touch 4 uses a distinct ownership subject.'
        : 'Touches 1, 2, and 4 MUST have non-null 2-to-5-word subjects with natural sentence capitalization. Touch 2 MUST repeat the touch 1 subject exactly, and touch 4 opens a distinct closing thread. LinkedIn touch 3 MUST have a null subject.',
    isWapahki
      ? 'Preserve the seven distinct Wapahki discovery jobs: role-specific question, concrete process clarification, connection request, emerging hypothesis, right-person or function check, one synthesis question, then calm close. Touch 1 must explain what the role uniquely sees, say Wapahki is early stage and not selling equipment yet, and offer an email answer as an alternative to a 20-minute call. Touch 3 is a pre-acceptance connection request under 200 characters. Touch 6 is one LinkedIn question without a meeting ask. Remove process assumptions, ownership claims, technical or fit screens, qualification language, deployment or pilot language, unbuilt sketches, and premature rate/pickup/placement specifications.'
      : isOutageHub
        ? 'Preserve the four distinct OutageHub jobs: test whether the company owns the cause-and-dispatch-priority decision, sharpen the ownership fork, propose a retrospective test on the company’s own closed incidents, then route the alarm-to-dispatch handoff owner. Keep one trigger and decision from start to finish. In touch 1 describe the mechanism plainly and tuned to the buyer (matches public Canadian utility outage reports to site locations, not a fixed slogan), never assume the company owns the workflow, and remove coverage or latency claims, invented operator nouns, invented numbers, premature integration-owner asks, imagined replays, stacked caveats, and every pilot or price.'
        : 'Preserve GnK’s four distinct insight-led jobs: a concrete problem question that names the specific tool GnK is exploring with no meeting ask, a sharper operational hypothesis that invites one correction with no meeting ask, a connection request, then a single close-or-route asking for a name or job title. Remove every internal hedge, qualification note, proof-boundary line, cost estimate, ROI claim, paid-pilot pitch, platform pitch, repeated question, and invented owner.',
    FORCE_COVERAGE
      ? 'This coverage batch requires a final sequence for every preselected owner/evaluator contact. Do not convert a router into four touches; omit it as do_not_contact for the separate two-message routing path. Keep exactly one problem hypothesis and never invent ownership, budget, internal problems, records, terminology, or authority.'
      : 'Omit contacts whose editorial verdict is do_not_contact. Do not add new contacts.',
    ...(PRESERVE_PROTECTED ? [
      'Preserve every immutable sent or approved touch exactly. Revise only the remaining future touches and the private plan. The sequence must acknowledge the established product thread through its continuation, never by pretending the historical copy was different.',
    ] : []),
    '',
    '=== SHARED RULES ===',
    sharedCore,
    '',
    '=== ACTIVE REDDIT PRACTITIONER GUIDANCE ===',
    redditGuidance,
    '',
    '=== ACTIVE YOUTUBE, COURSE, AND BOOK GUIDANCE ===',
    researchGuidance,
    '',
    '=== CAMPAIGN RULES ===',
    playbooks[unit.campaign],
    '',
    '=== CONTACT CONTEXT FOR ALLOWED CONTACTS ===',
    JSON.stringify(unit.rows.filter((row) => allowed.has(row.id)).map(contactContext), null, 2),
    '',
    '=== DRAFT SEQUENCES ===',
    JSON.stringify(draftResult.sequences.filter((sequence) => allowed.has(Number(sequence.contact_id))), null, 2),
    '',
    '=== EDITORIAL REVIEWS ===',
    JSON.stringify(critiqueResult.reviews, null, 2),
    '',
    '=== INDEPENDENT NATIVE-ENGLISH REVIEWS ===',
    JSON.stringify(languageResult.reviews, null, 2),
    '',
    `Return one disposition for every allowed contact and include the complete spoken_brief in every revised sequence. Preserve verified research_used URLs and revise the ${touchCount}-row touch_plan so it exactly matches the final copy. The spoken brief and the email must use concrete actor-action-object language and stay on one operational thread. Preserve or improve the skeptical_question, proof_boundary, and next_step fields; they are required private preparation, not extra paragraphs to paste into the email.`,
    'Any call request must say 20 minutes. Do not use rejection-seeking filler such as "a no is helpful," "tell me to get lost," or "no pressure."',
    isWapahki
      ? 'For touch 1, put the 20-minute call question and the email-reply alternative in two separate sentences. Do not promise an artifact.'
      : isOutageHub
        ? 'For a direct owner in touch 1, put the 20-minute call question and the concrete payoff in two separate sentences. For an adjacent role, use only the routing ask.'
        : 'GnK touch 1 must not ask for a call. The four-touch cold sequence contains no 20-minute discovery invitation; discovery is earned only by a reply.',
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function repairPrompt(unit, finalResult, repairItems) {
  const isWapahki = unit.campaign === 'wapahki';
  const isOutageHub = unit.campaign === 'outagehub';
  const touchCount = sequenceLengthForCampaign(unit.campaign);
  const repairIds = new Set(repairItems.map((item) => item.contact_id));
  return [
    'You are the deterministic repair editor for Andrew Gordienko’s outreach.',
    'Repair only the included sequences. Resolve every listed validation error while preserving accurate evidence, the chosen recipient, and the single operational thread.',
    ...(PRESERVE_PROTECTED ? [
      'Never change an immutable sent or approved touch from the contact context. Repair only future draft touches.',
    ] : []),
    'Do not remove useful context merely to pass. Every repaired touch must still sound like natural spoken English.',
    isWapahki
      ? 'Touch 1 must end with a 20-minute call or conversation question, then a separate sentence offering an email reply as a genuinely helpful alternative. Do not promise an artifact.'
      : isOutageHub
        ? 'For a direct owner, touch 1 call CTAs use two sentences: a plain question ending in "20-minute call?" or "20-minute conversation?", then a concrete payoff. For an adjacent role, ask only for the likely owner.'
        : 'GnK touch 1 must contain no meeting ask. The four-touch cold sequence contains no 20-minute discovery invitation.',
    isWapahki
      ? 'Preserve all seven Wapahki early-discovery jobs while repairing. Touch 1 explains what the role uniquely sees, states early-stage and not-selling-yet status, asks one operational question, and offers a 20-minute call or email answer. Touch 2 clarifies one concrete process distinction. Touch 3 only connects. Touch 4 tests a clearly labelled emerging hypothesis. Touch 5 checks the right person or function without assuming ownership. Touch 6 asks one synthesis question without a meeting. Touch 7 closes. Do not restore technical or fit screens, qualification or deployment language, process assumptions, ownership claims, sketches, or rate/pickup/placement specifications.'
      : isOutageHub
        ? 'Preserve OutageHub’s four ownership-first jobs while repairing. Touch 1 opens with one verified fact about the team, asks whether they still determine cause and dispatch/triage priority or the carrier sends it already classified, describes the mechanism in plain buyer-tuned words (matches public Canadian utility outage reports to site locations, never a canned slogan or a mismatched "multi-site operators" label), frames the remove-a-check-or-just-duplicate test, and asks for a 20-minute call. Touch 2 sharpens the ownership fork (already-set ticket vs. still-checks-utility, SLA-forced dispatch changes nothing) and asks which is closer, with no replay and no imagined event. Touch 3 proposes a retrospective test on the company’s own closed incidents and asks whether they hold the historical tickets or the carrier does. Touch 4 asks who owns the alarm-to-dispatch handoff for a name or title. Do not restore coverage, latency, early-detection or infrastructure claims, technical questionnaires, invented operator nouns, invented numbers, imagined replays, premature integration-owner asks, stacked caveats, a pilot, a price, or a second use case.'
        : 'Preserve GnK’s order while repairing: touch 1 problem question that names the specific tool GnK is exploring, touch 2 sharper hypothesis that invites one correction, touch 3 connection request, touch 4 close or route asking for a name or job title. Both emails must contain no meeting ask. Reject routers from this four-touch batch. Remove every internal hedge, qualification note, proof-boundary line, cost estimate, and pilot pitch because silence is not validation.',
    '',
    '=== SHARED RULES ===',
    sharedCore,
    '',
    '=== ACTIVE REDDIT PRACTITIONER GUIDANCE ===',
    redditGuidance,
    '',
    '=== ACTIVE YOUTUBE, COURSE, AND BOOK GUIDANCE ===',
    researchGuidance,
    '',
    '=== CAMPAIGN RULES ===',
    playbooks[unit.campaign],
    '',
    '=== CONTACT CONTEXT ===',
    JSON.stringify(unit.rows.filter((row) => repairIds.has(row.id)).map(contactContext), null, 2),
    '',
    '=== SEQUENCES AND EXACT VALIDATION ERRORS ===',
    JSON.stringify(repairItems, null, 2),
    '',
    `Return a write disposition and one complete repaired ${touchCount}-touch sequence for every included contact. Include the full spoken_brief, including skeptical_question, proof_boundary, next_step, verified research_used, and a ${touchCount}-row touch_plan that matches the repaired copy. Do not add contacts.`,
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function resultMap(result) {
  return new Map((result?.sequences || []).map((sequence) => [Number(sequence.contact_id), sequence]));
}

function touchesForValidation(row, generatedTouches) {
  if (!PRESERVE_PROTECTED) return generatedTouches;
  const byTouch = new Map((generatedTouches || []).map((touch) => [Number(touch.touch), touch]));
  for (const touch of immutableTouches(row.id)) byTouch.set(Number(touch.touch), touch);
  const canonicalByTouch = new Map(sequencePlanForCampaign(row.campaign).map((item) => [Number(item.touch), item]));
  return [...byTouch.values()]
    .map((touch) => {
      if (String(touch.status || 'draft') === 'draft') return touch;
      const canonical = canonicalByTouch.get(Number(touch.touch));
      // Historical sends are immutable. Normalize only their in-memory cadence
      // coordinates so validation can judge the new continuation without
      // rewriting an old day-4 send into day 5 in SQLite.
      return canonical ? { ...touch, day: canonical.day, channel: canonical.channel } : touch;
    })
    .sort((left, right) => Number(left.touch) - Number(right.touch));
}

async function processUnit(unit) {
  const unitTrack = unit.campaign === 'wapahki'
    ? wapahkiTrackForContact(unit.rows[0])
    : null;
  const sequenceSchema = sequenceBatchSchemaForCampaign(unit.campaign, { track: unitTrack });
  const draftResult = await runCodex({
    prompt: draftPrompt(unit),
    schema: sequenceSchema,
    model: DRAFT_MODEL,
    reasoning: DRAFT_REASONING,
    webSearch: true,
    cwd: root,
  });
  const draftDispositionsById = new Map(
    (draftResult.dispositions || []).map((item) => [Number(item.contact_id), item]),
  );
  const missingDispositions = unit.rows
    .map((row) => row.id)
    .filter((id) => !draftDispositionsById.has(id));
  if (missingDispositions.length) {
    throw new Error(`draft omitted dispositions for contact ids ${missingDispositions.join(', ')}`);
  }
  const draftedIds = new Set((draftResult.sequences || []).map((sequence) => Number(sequence.contact_id)));
  const draftWrites = [...draftDispositionsById.values()].filter((item) => item.verdict === 'write');
  if (ONE_PER_COMPANY && (draftWrites.length > 1 || draftedIds.size > 1)) {
    throw new Error(`company mode requires at most one sequence, got ${draftedIds.size} sequences and ${draftWrites.length} write dispositions`);
  }
  if (ONE_PER_COMPANY && draftWrites.length === 0) {
    const contradictions = [...draftDispositionsById.values()].filter((item) => (
      /\b(?:strongest|credible|valid|best|clearer|more direct)\b/i.test(item.reason)
      && !/\b(?:not|no|less|weak|lack|without|does not|isn't|is not|insufficient|too removed|too indirect|cannot)\b/i.test(item.reason)
    ));
    if (contradictions.length) {
      throw new Error(`contradictory company selection marked every contact do_not_contact: ${contradictions.map((item) => `${item.contact_id} ${item.reason}`).join(' | ')}`);
    }
  }
  const missingWrittenSequences = [...draftDispositionsById.values()]
    .filter((item) => item.verdict === 'write' && !draftedIds.has(Number(item.contact_id)))
    .map((item) => item.contact_id);
  if (missingWrittenSequences.length) {
    throw new Error(`draft marked write but omitted sequences for contact ids ${missingWrittenSequences.join(', ')}`);
  }
  if (FORCE_COVERAGE) {
    const missingCoverage = unit.rows
      .map((row) => row.id)
      .filter((id) => draftDispositionsById.get(id)?.verdict !== 'write' || !draftedIds.has(id));
    if (missingCoverage.length) {
      throw new Error(`coverage batch requires a draft sequence for contact ids ${missingCoverage.join(', ')}`);
    }
  }

  let finalResult = draftResult;
  let critiqueResult = null;
  let languageResult = null;
  let postFinalLanguageResult = null;

  if (REVIEW && (draftResult.sequences || []).length) {
    critiqueResult = await runCodex({
      prompt: critiquePrompt(unit, draftResult),
      schema: critiqueBatchSchema,
      model: REVIEW_MODEL,
      reasoning: REVIEW_REASONING,
      webSearch: true,
      cwd: root,
    });

    const expectedIds = new Set((draftResult.sequences || []).map((s) => Number(s.contact_id)));
    const reviewedIds = new Set((critiqueResult.reviews || []).map((r) => Number(r.contact_id)));
    const missingReviews = [...expectedIds].filter((id) => !reviewedIds.has(id));
    if (missingReviews.length) throw new Error(`review omitted contact ids ${missingReviews.join(', ')}`);

    languageResult = await runCodex({
      prompt: languagePrompt(unit, draftResult),
      schema: languageBatchSchema,
      model: LANGUAGE_MODEL,
      reasoning: LANGUAGE_REASONING,
      cwd: root,
    });
    const languageIds = new Set((languageResult.reviews || []).map((r) => Number(r.contact_id)));
    const missingLanguageReviews = [...expectedIds].filter((id) => !languageIds.has(id));
    if (missingLanguageReviews.length) {
      throw new Error(`native-English review omitted contact ids ${missingLanguageReviews.join(', ')}`);
    }

    finalResult = await runCodex({
      prompt: revisePrompt(unit, draftResult, critiqueResult, languageResult),
      schema: sequenceSchema,
      model: REVISE_MODEL,
      reasoning: REVISE_REASONING,
      cwd: root,
    });
    if (FORCE_COVERAGE) {
      const finalIds = new Set((finalResult.sequences || []).map((sequence) => Number(sequence.contact_id)));
      const missingFinalCoverage = unit.rows.map((row) => row.id).filter((id) => !finalIds.has(id));
      if (missingFinalCoverage.length) {
        throw new Error(`final editor omitted coverage contact ids ${missingFinalCoverage.join(', ')}`);
      }
    }
    if (ONE_PER_COMPANY && (finalResult.sequences || []).length > 1) {
      throw new Error(`final editor returned ${(finalResult.sequences || []).length} sequences for one business`);
    }

    if ((finalResult.sequences || []).length) {
      postFinalLanguageResult = await runCodex({
        prompt: [
          'This is the final-copy language audit. The copy has already been revised once, so do not assume it improved.',
          'Identify any awkward wording introduced by the final editor. Apply the same strict read-aloud standard below.',
          '',
          languagePrompt(unit, finalResult),
        ].join('\n'),
        schema: languageBatchSchema,
        model: LANGUAGE_MODEL,
        reasoning: LANGUAGE_REASONING,
        cwd: root,
      });
      const expectedFinalIds = new Set((finalResult.sequences || []).map((s) => Number(s.contact_id)));
      const postLanguageIds = new Set((postFinalLanguageResult.reviews || []).map((r) => Number(r.contact_id)));
      const missingPostLanguage = [...expectedFinalIds].filter((id) => !postLanguageIds.has(id));
      if (missingPostLanguage.length) {
        throw new Error(`post-final native-English review omitted contact ids ${missingPostLanguage.join(', ')}`);
      }
    }
  }

  let finalById = resultMap(finalResult);
  const draftDispositions = draftDispositionsById;
  const reviewsById = new Map((critiqueResult?.reviews || []).map((review) => [Number(review.contact_id), review]));
  const postLanguageById = new Map(
    (postFinalLanguageResult?.reviews || []).map((review) => [Number(review.contact_id), review]),
  );
  const outcome = { campaign: unit.campaign, wrote: 0, writtenIds: [], removed: 0, rejected: [], skipped: [] };

  const repairItems = [];
  for (const row of unit.rows) {
    const draftDisposition = draftDispositions.get(row.id);
    const review = reviewsById.get(row.id);
    if ((!FORCE_COVERAGE && draftDisposition?.verdict === 'do_not_contact')
      || (!FORCE_COVERAGE && review?.verdict === 'do_not_contact')) continue;
    const sequence = finalById.get(row.id);
    if (!sequence) continue;
    const errors = [
      ...validateSpokenBrief(sequence.spoken_brief, unit.campaign, contactContext(row)),
      ...validateSequence({
        contact: contactContext(row),
        campaign: unit.campaign,
        touches: touchesForValidation(row, sequence.touches),
      }),
    ];
    const postLanguageReview = postLanguageById.get(row.id);
    if (postLanguageReview?.verdict === 'revise') {
      errors.push(`post-final native-English review requires revision: ${postLanguageReview.flow_notes}`);
    }
    if (errors.length) {
      repairItems.push({
        contact_id: row.id,
        errors,
        native_english_review: postLanguageReview || null,
        sequence,
      });
    }
  }

  if (repairItems.length) {
    const repaired = await runCodex({
      prompt: repairPrompt(unit, finalResult, repairItems),
      schema: sequenceSchema,
      model: REVISE_MODEL,
      reasoning: REVISE_REASONING,
      cwd: root,
    });
    const repairedById = resultMap(repaired);
    const missingRepairs = repairItems
      .map((item) => item.contact_id)
      .filter((id) => !repairedById.has(id));
    if (missingRepairs.length) throw new Error(`repair omitted contact ids ${missingRepairs.join(', ')}`);
    finalById = new Map([...finalById, ...repairedById]);

    const secondRepairItems = [];
    for (const item of repairItems) {
      const row = unit.rows.find((candidate) => candidate.id === item.contact_id);
      const sequence = finalById.get(item.contact_id);
      if (!row || !sequence) continue;
      const errors = [
        ...validateSpokenBrief(sequence.spoken_brief, unit.campaign, contactContext(row)),
        ...validateSequence({
          contact: contactContext(row),
          campaign: unit.campaign,
          touches: touchesForValidation(row, sequence.touches),
        }),
      ];
      if (errors.length) {
        secondRepairItems.push({
          contact_id: item.contact_id,
          errors,
          native_english_review: item.native_english_review,
          sequence,
        });
      }
    }
    if (secondRepairItems.length) {
      const repairedAgain = await runCodex({
        prompt: repairPrompt(unit, { sequences: [...finalById.values()] }, secondRepairItems),
        schema: sequenceSchema,
        model: REVISE_MODEL,
        reasoning: REVISE_REASONING,
        cwd: root,
      });
      const repairedAgainById = resultMap(repairedAgain);
      const missingSecondRepairs = secondRepairItems
        .map((item) => item.contact_id)
        .filter((id) => !repairedAgainById.has(id));
      if (missingSecondRepairs.length) {
        throw new Error(`second repair omitted contact ids ${missingSecondRepairs.join(', ')}`);
      }
      finalById = new Map([...finalById, ...repairedAgainById]);
    }
  }

  // The model occasionally preserves a colon through both editorial repairs.
  // Normalize only that mechanical house-rule failure here; the full semantic
  // validator still runs immediately below. The touch-1 CTA is intentionally
  // left to the writer so each track keeps its own ending (call, call-or-route,
  // or a routing name request) rather than a single forced sentence.
  if (unit.campaign === 'wapahki') {
    for (const sequence of finalById.values()) {
      for (const touch of sequence.touches || []) {
        touch.body = String(touch.body || '').replace(/:/g, ',');
      }
    }
  }

  for (const row of unit.rows) {
    const draftDisposition = draftDispositions.get(row.id);
    const review = reviewsById.get(row.id);
    if ((!FORCE_COVERAGE && draftDisposition?.verdict === 'do_not_contact')
      || (!FORCE_COVERAGE && review?.verdict === 'do_not_contact')) {
      // Do not delete existing messages on a do_not_contact verdict during a
      // rewrite; a single model call should never cause message loss.
      outcome.skipped.push({
        id: row.id,
        reason: review?.verdict === 'do_not_contact'
          ? (review.role_fit || review.evidence || 'editorial do_not_contact')
          : (draftDisposition?.reason || 'draft do_not_contact'),
      });
      continue;
    }
    const sequence = finalById.get(row.id);
    if (!sequence) {
      outcome.skipped.push({ id: row.id, reason: 'writer omitted contact or role fit was too weak' });
      continue;
    }
    const contact = contactContext(row);
    const errors = [
      ...validateSpokenBrief(sequence.spoken_brief, unit.campaign, contactContext(row)),
      ...validateSequence({
        contact,
        campaign: unit.campaign,
        touches: touchesForValidation(row, sequence.touches),
      }),
    ];
    if (errors.length) {
      // A rejected rewrite must never destroy existing messages. Leave whatever
      // is stored (often a valid 2-touch draft) untouched and record only the miss.
      if (process.env.WRITER_DEBUG_REJECT) {
        console.log(`\n----- REJECTED DRAFT person ${row.id} -----\n${errors.join('\n')}\n`);
        for (const t of sequence.touches || []) {
          console.log(`[T${t.touch}] ${t.subject || '(no subject)'}\n${t.body}\n`);
        }
        console.log('----- END REJECTED DRAFT -----\n');
      }
      outcome.rejected.push({ id: row.id, errors });
      continue;
    }
    if (PRESERVE_PROTECTED) replaceDraftSequence(row.id, unit.campaign, sequence.touches);
    else replaceSequence(row.id, unit.campaign, sequence.touches);
    updatePerson(row.id, { sales_brief: JSON.stringify(sequence.spoken_brief) });
    outcome.wrote++;
    outcome.writtenIds.push(row.id);
  }

  return outcome;
}

console.log([
  `Codex writer: draft=${DRAFT_MODEL}/${DRAFT_REASONING}`,
  `review=${REVIEW ? `${REVIEW_MODEL}/${REVIEW_REASONING}` : 'explicitly disabled'}`,
  `language=${REVIEW ? `${LANGUAGE_MODEL}/${LANGUAGE_REASONING}` : 'off'}`,
  `revise=${REVIEW ? `${REVISE_MODEL}/${REVISE_REASONING}` : 'off'}`,
  `rewrite=${REWRITE}`,
  `one-per-company=${ONE_PER_COMPANY}`,
  `units=${units.length}`,
  `concurrency=${CONCURRENCY}`,
].join(' | '));

if (DRY_RUN) {
  if (!units.length) {
    console.log('No eligible contacts.');
  } else {
    console.log(draftPrompt(units[0]));
  }
  process.exit(0);
}

let cursor = 0;
let completed = 0;
let wrote = 0;
let removed = 0;
let failed = 0;
let rejected = 0;
let skipped = 0;
const writtenIdsByCampaign = new Map();

async function worker() {
  while (cursor < units.length) {
    const unit = units[cursor++];
    try {
      const outcome = await processUnit(unit);
      if (SUBJECTS_PER_UNIT && !SKIP_SUBJECT_AGENTS && outcome.writtenIds.length) {
        const placeholders = outcome.writtenIds.map(() => '?').join(',');
        // Keep provisional writer subjects out of the "newest first" review
        // lane. The sequence receives a current timestamp only after the
        // strategist, skeptic, and editor have all passed.
        db.prepare(`
          UPDATE sequences SET created_at = '1970-01-01 00:00:00'
          WHERE person_id IN (${placeholders}) AND status = 'draft'
        `).run(...outcome.writtenIds);
        console.log(`  subject agents reviewing person ${outcome.writtenIds.join(',')}`);
        await personalizeWrittenSubjects({
          root,
          campaign: outcome.campaign,
          personIds: outcome.writtenIds,
        });
        // Promotion is the commit point visible to the CRM: a sequence reaches
        // the front only after every independent subject thread passes review.
        db.prepare(`
          UPDATE sequences SET created_at = datetime('now')
          WHERE person_id IN (${placeholders}) AND status = 'draft'
        `).run(...outcome.writtenIds);
      }
      wrote += outcome.wrote;
      if (!writtenIdsByCampaign.has(outcome.campaign)) writtenIdsByCampaign.set(outcome.campaign, []);
      writtenIdsByCampaign.get(outcome.campaign).push(...outcome.writtenIds);
      removed += outcome.removed;
      rejected += outcome.rejected.length;
      skipped += outcome.skipped.length;
      for (const item of outcome.rejected) {
        console.log(`  rejected person ${item.id}: ${item.errors.join('; ')}`);
      }
      for (const item of outcome.skipped) {
        console.log(`  skipped person ${item.id}: ${item.reason}`);
      }
    } catch (error) {
      failed++;
      console.log(`  failed ${unit.campaign} [${unit.rows.map((row) => row.id).join(',')}]: ${error.message}`);
    }
    completed++;
    console.log(`  ${completed}/${units.length} units | wrote ${wrote} | removed ${removed} bad drafts | rejected ${rejected} | skipped ${skipped} | failed ${failed}`);
  }
}

await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));

console.log(`Done. Stored ${wrote} reviewed sequences. Removed ${removed} do-not-contact drafts. Rejected ${rejected}; skipped ${skipped}; failed units ${failed}.`);
if (!SKIP_SUBJECT_AGENTS && !SUBJECTS_PER_UNIT) {
  for (const [campaign, personIds] of writtenIdsByCampaign) {
    if (!personIds.length) continue;
    console.log(`Running subject strategist + editor for ${personIds.length} new ${campaign} sequences.`);
    try {
      await personalizeWrittenSubjects({ root, campaign, personIds });
    } catch (error) {
      failed++;
      console.log(`Subject agents failed closed for ${campaign}: ${error.message}`);
    }
  }
} else if (wrote && SUBJECTS_PER_UNIT && !SKIP_SUBJECT_AGENTS) {
  console.log('Subject agents completed per unit before each sequence was promoted.');
} else if (wrote) {
  console.log('Subject agents skipped because the in-app full sequence already passed final review.');
}
if (rejected || failed) process.exitCode = 1;
