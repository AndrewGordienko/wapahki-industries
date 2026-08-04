// Populate the dedicated OHUB Grants CRM spreadsheet with an ordered five-route
// contact map and a reviewed seven-touch cadence for every stored OHUB funding
// opportunity. This never sends anything. Routes without a published address,
// and roles that exist only after assignment, remain visibly unverified.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  getCompanyByName,
  insertCompany,
  replaceDraftSequence,
  updateCompany,
  updatePerson,
  upsertPerson,
} from '../src/db.js';
import {
  SEQUENCE_JOBS,
  validateSequence,
  validateSpokenBrief,
} from '../src/outreach-quality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'data', 'outagehub-grant-outreach.json'), 'utf8'));
const CAMPAIGN = 'outagehub-grants';
const DRY_RUN = process.argv.includes('--dry-run');

process.env.ALLOW_LEGACY_SEQUENCE_WRITE = '1';
process.env.LEGACY_SEQUENCE_WRITE_CAMPAIGN = CAMPAIGN;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sentence(value) {
  const text = clean(value).replace(/[.?!]+$/, '');
  return text ? `${text[0].toLocaleUpperCase()}${text.slice(1)}` : text;
}

function email(subject, content) {
  return {
    channel: 'email',
    subject,
    body: `Hi there,\n\n${content}\n\nThanks,\nAndrew Gordienko\nOutageHub`,
  };
}

function sequenceFor(program, contact) {
  const opening = program.subject;
  const projectThread = 'Outage data project outline';
  const closing = 'Closing the funding route';
  const routeQuestion = clean(contact.role_question);
  const useRule = clean(contact.use_when);
  const shortProgram = clean(program.subject).toLocaleLowerCase();
  const routeControlQuestion = contact.priority === 1
    ? 'Before I send any documents, what non-confidential identifier should appear in the first enquiry'
    : 'Before this route is used, which earlier step or referral should be recorded so the enquiry is not duplicated';
  return [
    {
      touch: 1,
      day: 1,
      ...email(opening,
        `I am Andrew Gordienko, founder of OutageHub in Toronto. I am preparing the correct route for ${program.program_name}. OutageHub is an early-stage software and data product that collects public electricity utility outage updates and is developing map, API, SMS and email delivery paths for operational users.\n\nYour published or assigned role matters because ${useRule.replace(/^Use /, 'it should be used ').replace(/^Start /, 'it is the place to start ')} I am writing to confirm ${routeQuestion}. We have not assumed incorporation, payroll, revenue, matching funds, customer outcomes, or production coverage. Could you confirm the correct official route and the evidence we should prepare before taking the next step?`),
    },
    {
      touch: 2,
      day: 4,
      ...email(opening,
        `The specific project we would describe is ${clean(program.project)}. We would keep completed work separate from proposed work and state each corporate fact only after it is documented.\n\nThe unresolved items are ${clean(program.gaps)}. For your part of the process, which document or eligibility test determines whether those items should be resolved before an application, inside the application, or only after an officer is assigned?`),
    },
    {
      touch: 3,
      day: 6,
      channel: 'linkedin',
      subject: null,
      body: `Hello, I am mapping the official ${shortProgram} for an early-stage Toronto outage-data project. I would value a connection only if your role handles applicant guidance.`,
    },
    {
      touch: 4,
      day: 9,
      ...email(projectThread,
        `I have reduced the proposed work to one evidence outline covering the applicant, completed technical work, remaining uncertainty, planned tests, project dates, team, budget, intellectual property, other assistance, and the exact outcome the program would evaluate.\n\nThe project would not claim complete coverage or proven customer results. Which part of that outline should be settled first for ${program.program_name}, and which part should wait for formal application instructions?`),
    },
    {
      touch: 5,
      day: 11,
      channel: 'linkedin',
      subject: null,
      body: `One narrow point on ${shortProgram}. ${routeControlQuestion}? If another role owns that routing detail, a title or official inbox is enough.`,
    },
    {
      touch: 6,
      day: 15,
      ...email(projectThread,
        `I now have a draft evidence checklist and a bounded project description, but I will not treat the program as available until the applicant facts and current rules are verified. Would a 20-minute conversation with the correct program officer be the right next step? I would use it only to confirm the route, required evidence, timing, and any clear stop condition before preparing a submission.`),
    },
    {
      touch: 7,
      day: 18,
      ...email(closing,
        `I will close this funding route for now. Should OutageHub wait until ${clean(program.next_condition)}, use the published entry route now, or speak with a different official role? A job title or published inbox is enough, and I will not contact parallel roles after a clear answer.`),
    },
  ];
}

function briefFor(program, contact) {
  const jobs = [...SEQUENCE_JOBS.entries()];
  const information = [
    `The route-specific question for ${contact.name} is stated without assuming eligibility.`,
    `The unresolved evidence set covers ${program.gaps}`,
    'The connection request is limited to applicant guidance and does not seek influence.',
    `The proposed work is bounded as ${program.project}`,
    `The role boundary is ${contact.role_question}`,
    'A short conversation is requested only after a written evidence outline exists.',
    `The route closes unless ${program.next_condition}`,
  ];
  const ctas = [
    'Confirm the official route and evidence required before the next step.',
    'Identify when each unresolved item must be resolved.',
    'Connect only when the role legitimately handles applicant guidance.',
    'Name the first evidence section that should be completed.',
    'Answer the one role-specific eligibility or process question.',
    'Accept a 20-minute evidence and route check.',
    'Confirm whether to wait, use the published route, or contact another official role.',
  ];
  return {
    outreach_route: 'funding_program_route',
    single_thread: program.objective,
    skeptical_question: `Is ${program.program_name} currently usable by OutageHub, or is the proper action to prepare, wait, or stop?`,
    proof_boundary: `${program.state} The public source does not prove OutageHub eligibility, an award, a pilot, or an assigned contact.`,
    next_step: `Use route priority ${contact.priority} only after every earlier applicable route has been completed or has referred the enquiry onward.`,
    research_used: [{ fact: program.source_fact, source_url: program.source_url }],
    touch_plan: jobs.map(([touch, job], index) => ({
      touch,
      job,
      personalization_anchor: `${contact.title} at ${contact.organization} and its documented place in the ${program.program_name} route`,
      new_information: information[index],
      cta: ctas[index],
    })),
  };
}

function preparedPrograms() {
  if (config.campaign !== CAMPAIGN) throw new Error(`Expected campaign ${CAMPAIGN}.`);
  if (!Array.isArray(config.programs) || config.programs.length !== 8) {
    throw new Error(`Expected 8 OHUB programs, found ${config.programs?.length || 0}.`);
  }
  const prepared = [];
  const failures = [];
  for (const program of config.programs) {
    if (!Array.isArray(program.contacts) || program.contacts.length !== 5) {
      failures.push(`${program.program_name} must have exactly 5 ordered routes.`);
      continue;
    }
    for (const [index, rawContact] of program.contacts.entries()) {
      const contact = { ...rawContact, priority: index + 1 };
      const touches = sequenceFor(program, contact);
      const brief = briefFor(program, contact);
      const errors = [
        ...validateSequence({ contact: { first_name: 'there' }, campaign: CAMPAIGN, touches }),
        ...validateSpokenBrief(brief, CAMPAIGN),
      ];
      if (errors.length) failures.push(`${program.program_name} / ${contact.name}\n  ${errors.join('\n  ')}`);
      prepared.push({ program, contact, touches, brief });
    }
  }
  if (failures.length) throw new Error(`Grant CRM validation failed before writing\n\n${failures.join('\n\n')}`);
  return prepared;
}

function accountName(program) {
  return `OHUB Grant Route | ${program.program_name}`;
}

function tierFor(score) {
  if (Number(score) >= 65) return 'easy';
  if (Number(score) >= 50) return 'medium';
  return 'hard';
}

function main() {
  const prepared = preparedPrograms();
  if (DRY_RUN) {
    console.log(JSON.stringify({ programs: config.programs.length, contacts: prepared.length, touches: prepared.length * 7, written: 0 }, null, 2));
    return;
  }

  const grantByName = new Map(db.prepare(`
    SELECT * FROM grants WHERE applicant='outagehub'
  `).all().map((grant) => [grant.program_name, grant]));
  const knownProgramNames = new Set(config.programs.map((program) => program.program_name));
  const missing = [...knownProgramNames].filter((name) => !grantByName.has(name));
  if (missing.length) throw new Error(`Stored OHUB grants are missing config matches\n${missing.join('\n')}`);

  let companies = 0;
  let contacts = 0;
  let sequences = 0;
  let protectedContacts = 0;
  for (const program of config.programs) {
    const grant = grantByName.get(program.program_name);
    const name = accountName(program);
    let company = getCompanyByName(name);
    const companyFields = {
      website: grant.official_url,
      city: grant.jurisdiction === 'Toronto' ? 'Toronto' : null,
      location: grant.jurisdiction || 'Canada',
      industry: `Funding route | ${program.category}`,
      target_titles: program.contacts.map((contact) => contact.title),
      campaign: CAMPAIGN,
      tier: tierFor(grant.score),
      hypothesis: `${program.state} Outreach objective is to ${program.objective}. This is an application-support account, not a customer-sales account.`,
      stage: 'Researched',
      lead_score: grant.score,
      signals: [{
        type: 'official_program_source',
        summary: program.source_fact,
        url: program.source_url,
        verified_at: config.verified_at,
      }],
      notes: [
        'CRM purpose: funding application support and official routing.',
        `Program category: ${program.category}.`,
        `Current state: ${program.state}`,
        'Contact rule: start with Priority 1. Move to another route only after a referral, a documented non-response, or the stage named in that contact row. Never contact all five in parallel.',
        `Eligibility gaps: ${program.gaps}.`,
        `Official source: ${program.source_url}`,
        `Grant record: ${grant.slug}`,
      ].join('\n'),
    };
    if (!company) {
      company = insertCompany({
        name,
        campaign: CAMPAIGN,
        source: 'outagehub-grant-crm',
        ...companyFields,
      });
    }
    company = updateCompany(company.id, companyFields);
    companies += 1;

    const configuredNames = new Set(program.contacts.map((contact) => contact.name.toLocaleLowerCase()));
    db.prepare(`
      UPDATE people
      SET lifecycle_status='archived', archived_at=COALESCE(archived_at, datetime('now')),
          suppression_reason='Route removed from the verified OHUB grant contact map.'
      WHERE company_id=? AND notes LIKE 'OHUB_GRANT_ROUTE%'
        AND lower(COALESCE(name, '')) NOT IN (${program.contacts.map(() => '?').join(',')})
    `).run(company.id, ...configuredNames);

    for (const item of prepared.filter((entry) => entry.program.program_name === program.program_name)) {
      const { contact, touches, brief } = item;
      const emailAddress = clean(contact.email) || null;
      let person = upsertPerson({
        company_id: company.id,
        name: contact.name,
        first_name: 'there',
        title: contact.title,
        email: emailAddress,
        email_status: emailAddress ? 'verified' : 'unavailable',
        relevance_score: 11 - contact.priority,
        relevance_reason: `${contact.use_when} ${sentence(contact.role_question)}.`,
        status: 'new',
        notes: 'OHUB_GRANT_ROUTE',
      });
      const assignedOnly = /Do not|only after|after assignment|after selection|after a filed|after an application exists/i.test(contact.use_when);
      person = updatePerson(person.id, {
        title: contact.title,
        email: emailAddress,
        email_status: emailAddress ? 'verified' : 'unavailable',
        relevance_score: 11 - contact.priority,
        relevance_reason: `${contact.use_when} ${sentence(contact.role_question)}.`,
        role_type: contact.priority === 1 ? 'champion' : 'referral',
        persona: 'funding_program_route',
        sales_brief: JSON.stringify(brief),
        lifecycle_status: assignedOnly || !emailAddress ? 'needs_verification' : 'active',
        last_verified_at: config.verified_at,
        suppression_reason: assignedOnly ? contact.use_when : null,
        notes: [
          'OHUB_GRANT_ROUTE',
          `Route priority: ${contact.priority} of 5`,
          `Use rule: ${contact.use_when}`,
          contact.phone ? `Published phone: ${contact.phone}` : '',
          contact.email ? `Published email: ${contact.email}` : 'No direct public email is stored.',
          `Official route: ${contact.url}`,
          'Cadence rule: use this seven-touch sequence only for this route and stop immediately on reply or referral. Do not run sequences for parallel roles.',
        ].filter(Boolean).join('\n'),
      });
      contacts += 1;

      const protectedCount = db.prepare(
        "SELECT COUNT(*) n FROM sequences WHERE person_id=? AND status<>'draft'",
      ).get(person.id).n;
      if (protectedCount) {
        protectedContacts += 1;
        continue;
      }
      replaceDraftSequence(person.id, CAMPAIGN, touches);
      sequences += 1;
    }
  }

  console.log(JSON.stringify({
    programs: companies,
    contacts,
    seven_touch_sequences: sequences,
    touches_written: sequences * 7,
    protected_contacts_preserved: protectedContacts,
    campaign: CAMPAIGN,
  }, null, 2));
}

main();
