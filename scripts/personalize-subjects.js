// Three-agent subject-line workflow for every independent email thread in the
// stored campaign plan. The strategist proposes six grounded options per
// thread, a skeptic red-teams them, and an independent editor chooses or
// rewrites one after checking the recipient, message, and job of the touch.
//
// Inherited same-thread subjects stay out of the creative pass. The pass
// discovers each stored campaign plan, including Wapahki's T1/T4/T7 threads,
// OutageHub's T1/T2/T4 threads, and T1-only specialist writers.
//
// Default: repair draft sequences with weak subjects.
//   npm run outreach:subjects
//   npm run outreach:subjects -- --all
//   npm run outreach:subjects -- --campaign wapahki --ids 331,332 --dry-run
import { db } from '../src/db.js';
import { runCodex } from '../src/codex.js';
import {
  areDistinctSubjectThreads,
  isGenericSubject,
  normalizeSubject,
  sourcePhraseIsGrounded,
  subjectKey,
  validatePersonalizedSubject,
} from '../src/subject-lines.js';

const BASES = Object.freeze([
  'role_decision', 'operational_trigger', 'costly_consequence', 'concrete_output',
]);
const MAX_THREAD_TARGETS = 6;

const args = process.argv.slice(2);
const valueAfter = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const campaignFamily = (value) => {
  const key = String(value || '').trim().toLocaleLowerCase('en-GB');
  if (['gnk', 'delay', 'football', 'row'].includes(key)) return 'gnk';
  if (['outagehub', 'outage'].includes(key)) return 'outagehub';
  return key;
};
const campaigns = new Set(
  (valueAfter('--campaign', 'wapahki,gnk,outagehub') || '')
    .split(',')
    .map(campaignFamily)
    .filter(Boolean),
);
const ids = new Set(
  (valueAfter('--ids', '') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger),
);
const all = args.includes('--all');
const dryRun = args.includes('--dry-run');
const limit = Number(valueAfter('--limit', '0')) || 0;
const offset = Number(valueAfter('--offset', '0')) || 0;
const batchSize = Math.min(4, Math.max(1, Number(valueAfter('--batch', '4')) || 4));
const concurrency = Math.max(1, Number(valueAfter('--concurrency', '2')) || 2);
const model = process.env.SUBJECT_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-sol';
const reasoning = process.env.SUBJECT_REASONING || 'xhigh';
const timeoutMs = Math.max(300000, Number(process.env.SUBJECT_TIMEOUT_MS || 600000));

const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'basis', 'source_phrase'],
  properties: {
    subject: { type: 'string' },
    basis: { type: 'string', enum: BASES },
    source_phrase: { type: 'string' },
  },
};

const proposalsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contact_id', 'threads'],
        properties: {
          contact_id: { type: 'integer' },
          threads: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_THREAD_TARGETS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['touch', 'candidates'],
              properties: {
                touch: { type: 'integer' },
                candidates: { type: 'array', minItems: 6, maxItems: 6, items: candidateSchema },
              },
            },
          },
        },
      },
    },
  },
};

const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contact_id', 'threads'],
        properties: {
          contact_id: { type: 'integer' },
          threads: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_THREAD_TARGETS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['touch', 'subject', 'basis', 'source_phrase', 'reason'],
              properties: {
                touch: { type: 'integer' },
                subject: { type: 'string' },
                basis: { type: 'string', enum: BASES },
                source_phrase: { type: 'string' },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

const critiqueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['critiques'],
  properties: {
    critiques: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contact_id', 'threads'],
        properties: {
          contact_id: { type: 'integer' },
          threads: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_THREAD_TARGETS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['touch', 'strongest_subject', 'weakest_pattern', 'rewrite_direction', 'reason'],
              properties: {
                touch: { type: 'integer' },
                strongest_subject: { type: 'string' },
                weakest_pattern: { type: 'string' },
                rewrite_direction: { type: 'string' },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

const flatRows = db.prepare(`
  SELECT s.id AS sequence_id, s.person_id, s.touch, s.subject, s.body, s.status,
         p.name, p.first_name, p.title, p.role_type, p.relevance_reason,
         c.id AS company_id, c.name AS company, s.campaign,
         c.campaign AS source_campaign, c.industry,
         c.city, c.notes, c.hypothesis
  FROM sequences s
  JOIN people p ON p.id = s.person_id
  JOIN companies c ON c.id = p.company_id
  WHERE s.channel = 'email'
  ORDER BY c.campaign, c.id, p.id, s.touch
`).all().filter((row) => campaigns.has(campaignFamily(row.campaign)));

const byContact = new Map();
for (const item of flatRows) {
  if (!byContact.has(item.person_id)) byContact.set(item.person_id, { ...item, emails: [] });
  byContact.get(item.person_id).emails.push({
    sequence_id: item.sequence_id,
    touch: Number(item.touch),
    subject: item.subject,
    body: item.body,
    status: item.status,
  });
}
const rows = [...byContact.values()];

function emailAt(row, touch) {
  return row.emails.find((email) => email.touch === Number(touch));
}

function isInheritedThread(row, email) {
  const family = campaignFamily(row.campaign);
  if (family === 'outagehub') {
    return email.touch === 3 && Boolean(emailAt(row, 2));
  }
  if (email.touch === 2 && Boolean(emailAt(row, 1))) return true;
  return campaignFamily(row.campaign) === 'wapahki'
    && email.touch === 5
    && Boolean(emailAt(row, 4));
}

function targetsFor(row) {
  return row.emails.filter((email) => email.status === 'draft' && !isInheritedThread(row, email));
}

function jobFor(row, touch) {
  if (row.campaign === 'wapahki') {
    if (touch === 1) return 'Name the concrete operational question in the email without assuming a task, pain, ownership, or project.';
    if (touch === 4) return 'Name the clearly labelled emerging hypothesis in this email without presenting it as a confirmed process.';
    if (touch === 7) return 'Close this exact market-learning question calmly without sales-stage or ownership language.';
  }
  if (campaignFamily(row.campaign) === 'outagehub') {
    if (touch === 1) return 'Name the operational trigger or current incident decision this role can illuminate.';
    if (touch === 2) return 'Name the historical replay or supported sample incident record sent in this email.';
    if (touch === 4) return 'Close or route ownership of outage intelligence or the incident-system integration calmly.';
  }
  if (touch === 1) return 'Open the specific work problem or decision without presenting the hypothesis as proven.';
  if (touch === 4) return 'Open a genuinely new thread around this email’s different evidence, consequence, or angle.';
  if (touch === 6) return 'Name the concrete artifact, bounded example, or pilot-scoping decision offered in this email.';
  if (touch === 7) return 'Close or route this exact work topic calmly, without guilt or reply bait.';
  return 'Accurately name the distinct decision, evidence, or useful output in this email.';
}

const t1Counts = new Map();
const subjectOwners = new Map();
const newlyReservedSubjectKeys = new Set();
for (const row of rows) {
  const key = subjectKey(emailAt(row, 1)?.subject);
  if (key) {
    if (!t1Counts.has(key)) t1Counts.set(key, new Set());
    t1Counts.get(key).add(row.person_id);
  }
  for (const email of row.emails.filter((item) => !isInheritedThread(row, item))) {
    const subject = subjectKey(email.subject);
    if (!subject) continue;
    if (!subjectOwners.has(subject)) subjectOwners.set(subject, new Set());
    subjectOwners.get(subject).add(`${row.person_id}:${email.touch}`);
  }
}

function recipientText(row) {
  return [
    row.title,
    row.role_type,
    row.relevance_reason,
    row.industry,
    row.hypothesis,
    row.notes,
  ].filter(Boolean).join('\n');
}

function sourceText(row, email) {
  return [recipientText(row), email.body].filter(Boolean).join('\n');
}

function validationContext(row, email) {
  const roleAndAccountText = recipientText(row);
  // Wapahki subjects should be allowed to name the exact account-grounded
  // product, package, or candidate task in the email. Requiring those words to
  // appear in a person's title incorrectly rejects subjects such as
  // "Granola-cup case packing" for a Continuous Improvement Manager.
  const recipientSpecificText = row.campaign === 'wapahki'
    ? [roleAndAccountText, email.body].filter(Boolean).join('\n')
    : roleAndAccountText;
  return {
    contactName: row.name,
    company: row.company,
    sourceText: sourceText(row, email),
    messageText: email.body,
    recipientText: recipientSpecificText,
    requireRecipientGrounding: true,
  };
}

let selected = rows.filter((row) => {
  const targets = targetsFor(row);
  if (!targets.length) return false;
  if (ids.size) return ids.has(row.person_id);
  if (all) return true;
  const t1 = emailAt(row, 1);
  const repeated = targets.some((email) => (
    (subjectOwners.get(subjectKey(email.subject))?.size || 0) > 1
  ));
  const weak = targets.some((email) => (
    isGenericSubject(email.subject)
    || validatePersonalizedSubject(email.subject, validationContext(row, email)).length > 0
  ));
  const t2 = emailAt(row, 2);
  const brokenThread = t1 && t2 && t2.status === 'draft' && t2.subject !== t1.subject;
  return repeated || weak || brokenThread;
});
selected = selected.slice(offset, limit ? offset + limit : undefined);

const batches = [];
for (let index = 0; index < selected.length; index += batchSize) {
  batches.push(selected.slice(index, index + batchSize));
}

function context(row) {
  const t1 = emailAt(row, 1);
  const duplicateCount = t1 ? t1Counts.get(subjectKey(t1.subject))?.size || 0 : 0;
  return {
    contact_id: row.person_id,
    recipient: row.name,
    title: row.title,
    role_type: row.role_type || null,
    company: row.company,
    campaign: row.campaign,
    source_campaign: row.source_campaign,
    industry: row.industry || null,
    t1_subject_to_replace_because_it_is_reused: duplicateCount > 1 ? t1.subject : null,
    subject_targets: targetsFor(row).map((email) => ({
      touch: email.touch,
      job: jobFor(row, email.touch),
      current_subject: email.subject,
      must_change_because_reused: (subjectOwners.get(subjectKey(email.subject))?.size || 0) > 1,
      email: email.body,
    })),
    full_email_sequence_for_context: row.emails.map((email) => ({
      touch: email.touch,
      subject: email.subject,
      email: email.body,
      same_thread_as_t1: isInheritedThread(row, email),
    })),
    account_context: String(row.notes || '').slice(0, 5000),
    account_hypothesis: row.hypothesis || null,
  };
}

function sharedRules() {
  return [
    'Use 2-5 words and natural sentence capitalization: capitalize the first word plus genuine proper nouns and acronyms. Never force lowercase, Capitalize Every Word, or shout in capitals.',
    'Use no colon, question mark, exclamation point, emoji, fake Re/Fwd prefix, or other salesy punctuation.',
    'Sound like a concrete work topic the recipient would recognize in an inbox. Prefer the most specific truthful noun from that touch.',
    'Personalization means role and account relevance, not inserting the person or company name.',
    'Do not use generic bait such as Quick question, Following up, Checking in, Your thoughts, Opportunity, Partnership, or Idea for.',
    'Do not lead with seller-first words such as AI, Automation, Solution, Platform, Optimize, Transform, Unlock, or Streamline.',
    'Do not assert an unverified problem, loss, urgency, relationship, or internal knowledge. No clickbait or ambulance chasing.',
    'Each subject must accurately preview that touch’s actual email, not merely the wider account research.',
    'Each subject must be grounded both in the email and in this recipient’s role or supplied account evidence.',
    'source_phrase must be a verbatim 2-12 word phrase from that target email, title, role context, or account evidence.',
  ];
}

function strategyPrompt(batch, failures = []) {
  return [
    'You are the subject-line strategist for Andrew Gordienko’s cold-outreach sequences.',
    'For every subject target supplied for each contact, propose exactly six distinct subjects.',
    'For each target, candidate 1 must use role_decision, candidate 2 operational_trigger, candidate 3 costly_consequence, and candidate 4 concrete_output. Candidates 5 and 6 must be the two strongest genuinely different alternatives after rereading the exact email.',
    ...sharedRules(),
    'Same-thread inherited subjects are deliberately absent from subject_targets. For OutageHub, T3 retains T2. For other current campaigns, T2 retains T1; Wapahki also has T5 retain T4.',
    'Follow each target’s job. The topics must develop with the campaign plan; do not write cosmetic synonym swaps across touches.',
    ...(failures.length ? ['', '=== PREVIOUS STRATEGIST VALIDATION FAILURES ===', JSON.stringify(failures, null, 2)] : []),
    '',
    '=== CONTACTS ===',
    JSON.stringify(batch.map(context), null, 2),
    '',
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function criticPrompt(batch, proposals, failures = []) {
  return [
    'You are the skeptical independent subject-line critic. Do not approve a candidate because it is merely short.',
    'For every contact and subject target, red-team every strategist option that survived deterministic review against truthfulness, recipient-role specificity, exact email alignment, natural inbox language, and distinctiveness.',
    'Name the strongest candidate, the weakest recurring pattern, and a concrete rewrite direction. The final editor may reject your winner.',
    'Penalize vague noun piles, clever teaser language, unsupported loss claims, name insertion, and subjects that could fit another contact unchanged.',
    ...sharedRules(),
    ...(failures.length ? ['', '=== PREVIOUS CRITIC VALIDATION FAILURES ===', JSON.stringify(failures, null, 2)] : []),
    '',
    '=== CONTACTS ===',
    JSON.stringify(batch.map(context), null, 2),
    '',
    '=== STRATEGIST PROPOSALS ===',
    JSON.stringify(proposals, null, 2),
    '',
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function editorPrompt(batch, proposals, critiques, failures = []) {
  const batchTargets = new Set(batch.flatMap((row) => (
    targetsFor(row).map((email) => `${row.person_id}:${email.touch}`)
  )));
  const reservedSubjects = [...subjectOwners.entries()]
    .filter(([, owners]) => [...owners].some((owner) => !batchTargets.has(owner)))
    .map(([subject]) => subject)
    .filter(Boolean)
    .sort();
  return [
    'You are the independent subject-line editor. The strategist’s options are suggestions, not approved copy.',
    'For every supplied contact and subject target, choose the strongest candidate or write a better subject.',
    ...sharedRules(),
    'Audit the subjects as one sequence. Every target must perform its stated job and accurately fit its own email.',
    'All independently generated subjects for a contact must be distinct. A later new thread must not be a cosmetic singular/plural or synonym rewrite of T1.',
    'No final subject may match an item in RESERVED SUBJECTS, compared case-insensitively.',
    'If must_change_because_reused is true for a target, that target’s subject MUST change.',
    'Reject name insertion, generic curiosity, vague pain labels, seller language, unsupported urgency, cleverness, guilt, and any topic its email does not deliver.',
    'The reason must explain the fit to that touch’s job, not merely say that the subject is concise.',
    ...(failures.length ? ['', '=== PREVIOUS EDITOR VALIDATION FAILURES ===', JSON.stringify(failures, null, 2)] : []),
    '',
    '=== CONTACTS ===',
    JSON.stringify(batch.map(context), null, 2),
    '',
    '=== STRATEGIST PROPOSALS ===',
    JSON.stringify(proposals, null, 2),
    '',
    '=== INDEPENDENT CRITIQUE ===',
    JSON.stringify(critiques, null, 2),
    '',
    '=== RESERVED SUBJECTS ===',
    JSON.stringify(reservedSubjects),
    '',
    'Return only the structured JSON requested by the schema.',
  ].join('\n');
}

function exactTouchMap(row, threads) {
  const expected = targetsFor(row).map((email) => email.touch).sort((a, b) => a - b);
  const map = new Map();
  for (const thread of Array.isArray(threads) ? threads : []) {
    const touch = Number(thread.touch);
    if (map.has(touch)) return { map, error: `duplicate touch ${touch}` };
    map.set(touch, thread);
  }
  const actual = [...map.keys()].sort((a, b) => a - b);
  if (expected.join(',') !== actual.join(',')) {
    return { map, error: `thread set must be exactly ${expected.join(',')} (received ${actual.join(',')})` };
  }
  return { map, error: null };
}

function validateCandidate(row, touch, candidate) {
  const email = emailAt(row, touch);
  if (!email) return [`touch ${touch} is not an email in this campaign plan`];
  const errors = validatePersonalizedSubject(candidate?.subject, validationContext(row, email));
  if (!sourcePhraseIsGrounded(candidate?.source_phrase, sourceText(row, email))) {
    errors.push('source_phrase is not a verbatim phrase from this email or its recipient context');
  }
  return errors;
}

function contactSetError(batch, items, label) {
  const expected = batch.map((row) => row.person_id).sort((a, b) => a - b);
  const actual = (items || []).map((item) => Number(item.contact_id)).sort((a, b) => a - b);
  const unique = new Set(actual);
  if (unique.size !== actual.length) return `${label} returned a duplicate contact`;
  if (expected.join(',') !== actual.join(',')) {
    return `${label} contact set must be exactly ${expected.join(',')} (received ${actual.join(',')})`;
  }
  return null;
}

function validateProposals(batch, proposals) {
  const contactError = contactSetError(batch, proposals, 'strategist');
  if (contactError) return [{ errors: [contactError] }];
  const byId = new Map((proposals || []).map((proposal) => [Number(proposal.contact_id), proposal]));
  const failures = [];
  for (const row of batch) {
    const proposal = byId.get(row.person_id);
    if (!proposal) {
      failures.push({ contact_id: row.person_id, errors: ['strategist omitted contact'] });
      continue;
    }
    const { map, error } = exactTouchMap(row, proposal.threads);
    if (error) {
      failures.push({ contact_id: row.person_id, errors: [error] });
      continue;
    }
    for (const touch of [...map.keys()]) {
      const candidates = map.get(touch)?.candidates || [];
      const errors = [];
      if (candidates.length !== 6) errors.push('strategist must return exactly six candidates');
      const bases = new Set(candidates.map((candidate) => candidate.basis));
      if (BASES.some((basis) => !bases.has(basis))) errors.push('six-candidate exploration must cover all four required bases');
      if (new Set(candidates.map((candidate) => subjectKey(candidate.subject))).size !== candidates.length) {
        errors.push('candidate subjects are not distinct');
      }
      const viable = candidates.filter((candidate) => validateCandidate(row, touch, candidate).length === 0);
      const viableBases = new Set(viable.map((candidate) => candidate.basis));
      if (viable.length < 3) {
        const rejected = candidates.map((candidate, candidateIndex) => ({
          candidate: candidateIndex + 1,
          errors: validateCandidate(row, touch, candidate),
        })).filter((candidate) => candidate.errors.length);
        errors.push(`fewer than three final-quality candidates survived deterministic review: ${JSON.stringify(rejected)}`);
      }
      if (viableBases.size < 2) errors.push('surviving candidates do not provide enough strategic variety');
      if (errors.length) failures.push({ contact_id: row.person_id, touch, errors });
    }
  }
  return failures;
}

// The six strategist options are an exploration pool. Weak options must never
// reach the critic or editor, but one rejected brainstorm should not discard a
// thread that still has several independently valid alternatives.
function viableProposals(batch, proposals) {
  const rowsById = new Map(batch.map((row) => [Number(row.person_id), row]));
  return (proposals || []).map((proposal) => {
    const row = rowsById.get(Number(proposal.contact_id));
    return {
      ...proposal,
      threads: (proposal.threads || []).map((thread) => ({
        ...thread,
        candidates: (thread.candidates || []).filter((candidate) => (
          row && validateCandidate(row, Number(thread.touch), candidate).length === 0
        )),
      })),
    };
  });
}

function validateCritiques(batch, critiques, proposals) {
  const contactError = contactSetError(batch, critiques, 'critic');
  if (contactError) return [{ errors: [contactError] }];
  const byId = new Map((critiques || []).map((critique) => [Number(critique.contact_id), critique]));
  const proposalById = new Map((proposals || []).map((proposal) => [Number(proposal.contact_id), proposal]));
  const failures = [];
  for (const row of batch) {
    const critique = byId.get(row.person_id);
    if (!critique) {
      failures.push({ contact_id: row.person_id, errors: ['critic omitted contact'] });
      continue;
    }
    const { map, error } = exactTouchMap(row, critique.threads);
    if (error) {
      failures.push({ contact_id: row.person_id, errors: [error] });
      continue;
    }
    for (const [touch, thread] of map) {
      const missing = ['strongest_subject', 'weakest_pattern', 'rewrite_direction', 'reason']
        .filter((field) => !String(thread?.[field] || '').trim());
      if (missing.length) failures.push({
        contact_id: row.person_id,
        touch,
        errors: [`critic omitted ${missing.join(', ')}`],
      });
      const { map: proposalMap } = exactTouchMap(row, proposalById.get(row.person_id)?.threads);
      const candidateKeys = new Set((proposalMap.get(touch)?.candidates || []).map((candidate) => (
        subjectKey(candidate.subject)
      )));
      if (thread?.strongest_subject && !candidateKeys.has(subjectKey(thread.strongest_subject))) {
        failures.push({
          contact_id: row.person_id,
          touch,
          errors: ['critic strongest_subject is not one of the strategist candidates'],
        });
      }
    }
  }
  return failures;
}

function validateResults(batch, results) {
  const contactError = contactSetError(batch, results, 'editor');
  if (contactError) return [{ errors: [contactError] }];
  const byId = new Map((results || []).map((result) => [Number(result.contact_id), result]));
  const batchTargets = new Set(batch.flatMap((row) => (
    targetsFor(row).map((email) => `${row.person_id}:${email.touch}`)
  )));
  const finalT1Counts = new Map();
  const finalSubjectCounts = new Map();
  for (const row of batch) {
    const result = byId.get(row.person_id);
    const { map } = exactTouchMap(row, result?.threads);
    const key = subjectKey(map.get(1)?.subject);
    if (key) finalT1Counts.set(key, (finalT1Counts.get(key) || 0) + 1);
    for (const thread of map.values()) {
      const threadKey = subjectKey(thread.subject);
      if (threadKey) finalSubjectCounts.set(threadKey, (finalSubjectCounts.get(threadKey) || 0) + 1);
    }
  }
  const failures = [];
  for (const row of batch) {
    const result = byId.get(row.person_id);
    if (!result) {
      failures.push({ contact_id: row.person_id, errors: ['editor omitted contact'] });
      continue;
    }
    const { map, error } = exactTouchMap(row, result.threads);
    if (error) {
      failures.push({ contact_id: row.person_id, errors: [error] });
      continue;
    }
    const planErrors = [];
    for (const [touch, thread] of map) {
      const key = subjectKey(thread.subject);
      for (const threadError of validateCandidate(row, touch, thread)) {
        planErrors.push(`T${touch}: ${threadError}`);
      }
      if (!String(thread.reason || '').trim()) planErrors.push(`T${touch}: editor reason is missing`);
      if ((finalSubjectCounts.get(key) || 0) > 1) planErrors.push(`T${touch}: subject is reused inside this batch`);
      if (newlyReservedSubjectKeys.has(key)) planErrors.push(`T${touch}: subject was assigned by an earlier batch`);
      const target = `${row.person_id}:${touch}`;
      const outsideOwners = [...(subjectOwners.get(key) || [])]
        .filter((owner) => owner !== target && !batchTargets.has(owner));
      if (outsideOwners.length) planErrors.push(`T${touch}: subject is already used by another email`);
      const oldKey = subjectKey(emailAt(row, touch)?.subject);
      if ((subjectOwners.get(oldKey)?.size || 0) > 1 && key === oldKey) {
        planErrors.push(`T${touch}: editor preserved a reused subject that must change`);
      }
    }
    const keys = [...map.values()].map((thread) => subjectKey(thread.subject));
    if (new Set(keys).size !== keys.length) planErrors.push('independent email-thread subjects must all be distinct');
    if (map.has(1) && map.has(4) && !areDistinctSubjectThreads(map.get(1).subject, map.get(4).subject)) {
      planErrors.push('T4 must open a materially distinct subject thread from T1');
    }
    const independentTouches = [...map.keys()].sort((left, right) => left - right);
    for (let left = 0; left < independentTouches.length; left += 1) {
      for (let right = left + 1; right < independentTouches.length; right += 1) {
        const firstTouch = independentTouches[left];
        const secondTouch = independentTouches[right];
        if (firstTouch === 1 && secondTouch === 4) continue;
        if (!areDistinctSubjectThreads(map.get(firstTouch).subject, map.get(secondTouch).subject)) {
          planErrors.push(`T${firstTouch} and T${secondTouch} must use materially distinct subject threads`);
        }
      }
    }
    if (map.has(1)) {
      const t1Key = subjectKey(map.get(1).subject);
      if ((finalT1Counts.get(t1Key) || 0) > 1) planErrors.push('editor reused the same T1 subject inside this batch');
      const oldT1Key = subjectKey(emailAt(row, 1)?.subject);
      if ((t1Counts.get(oldT1Key)?.size || 0) > 1 && t1Key === oldT1Key) {
        planErrors.push('editor preserved a cross-contact duplicate T1 subject');
      }
    }
    if (planErrors.length) failures.push({ contact_id: row.person_id, errors: planErrors });
  }
  return failures;
}

if (dryRun) {
  console.log(`subject agents dry run: ${selected.length} contacts across ${batches.length} batches`);
  console.log(JSON.stringify(selected.slice(0, 20).map(context), null, 2));
  process.exit(0);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS subject_line_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    touch INTEGER,
    old_subject TEXT,
    new_subject TEXT NOT NULL,
    basis TEXT,
    source_phrase TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
const reviewColumns = new Set(db.prepare('PRAGMA table_info(subject_line_reviews)').all().map((column) => column.name));
if (!reviewColumns.has('touch')) db.exec('ALTER TABLE subject_line_reviews ADD COLUMN touch INTEGER');

function assertDraftSnapshot(email, personId) {
  const current = db.prepare(`
    SELECT person_id, touch, subject, body, status
    FROM sequences WHERE id = ?
  `).get(email.sequence_id);
  if (!current
    || Number(current.person_id) !== Number(personId)
    || Number(current.touch) !== Number(email.touch)
    || current.status !== 'draft'
    || String(current.subject || '') !== String(email.subject || '')
    || String(current.body || '') !== String(email.body || '')) {
    throw new Error(`sequence changed during subject review for person ${personId}, touch ${email.touch}`);
  }
}

let cursor = 0;
let completed = 0;
let wroteContacts = 0;
let wroteSubjects = 0;
let failed = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= batches.length) return;
    const batch = batches[index];
    let reservedByThisBatch = [];
    try {
      let proposals = await runCodex({
        prompt: strategyPrompt(batch), schema: proposalsSchema, model, reasoning,
        webSearch: false, timeoutMs, cwd: process.cwd(),
      });
      let proposalFailures = validateProposals(batch, proposals.proposals || []);
      if (proposalFailures.length) {
        proposals = await runCodex({
          prompt: strategyPrompt(batch, proposalFailures), schema: proposalsSchema, model, reasoning,
          webSearch: false, timeoutMs, cwd: process.cwd(),
        });
        proposalFailures = validateProposals(batch, proposals.proposals || []);
      }
      if (proposalFailures.length) {
        throw new Error(`subject strategist quality gate failed: ${JSON.stringify(proposalFailures)}`);
      }
      proposals = { ...proposals, proposals: viableProposals(batch, proposals.proposals || []) };

      let critique = await runCodex({
        prompt: criticPrompt(batch, proposals.proposals || []), schema: critiqueSchema, model, reasoning,
        webSearch: false, timeoutMs, cwd: process.cwd(),
      });
      let critiqueFailures = validateCritiques(batch, critique.critiques || [], proposals.proposals || []);
      if (critiqueFailures.length) {
        critique = await runCodex({
          prompt: criticPrompt(batch, proposals.proposals || [], critiqueFailures),
          schema: critiqueSchema, model, reasoning,
          webSearch: false, timeoutMs, cwd: process.cwd(),
        });
        critiqueFailures = validateCritiques(batch, critique.critiques || [], proposals.proposals || []);
      }
      if (critiqueFailures.length) {
        throw new Error(`subject critic quality gate failed: ${JSON.stringify(critiqueFailures)}`);
      }

      let review = await runCodex({
        prompt: editorPrompt(batch, proposals.proposals || [], critique.critiques || []),
        schema: reviewSchema, model, reasoning,
        webSearch: false, timeoutMs, cwd: process.cwd(),
      });
      let failures = validateResults(batch, review.results || []);
      if (failures.length) {
        review = await runCodex({
          prompt: editorPrompt(batch, proposals.proposals || [], critique.critiques || [], failures),
          schema: reviewSchema, model, reasoning,
          webSearch: false, timeoutMs, cwd: process.cwd(),
        });
        failures = validateResults(batch, review.results || []);
      }
      if (failures.length) throw new Error(`subject editor quality gate failed: ${JSON.stringify(failures)}`);

      const byId = new Map(review.results.map((result) => [Number(result.contact_id), result]));
      const proposedKeys = [...new Set(review.results.flatMap((result) => (
        (result.threads || []).map((thread) => subjectKey(thread.subject)).filter(Boolean)
      )))];
      const reservationConflicts = proposedKeys.filter((key) => newlyReservedSubjectKeys.has(key));
      if (reservationConflicts.length) {
        throw new Error(`subject reservation conflict with another batch: ${reservationConflicts.join(', ')}`);
      }
      proposedKeys.forEach((key) => newlyReservedSubjectKeys.add(key));
      reservedByThisBatch = proposedKeys;
      let batchSubjects = 0;
      let batchContacts = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of batch) {
          const { map } = exactTouchMap(row, byId.get(row.person_id).threads);
          for (const [touch, result] of map) {
            const email = emailAt(row, touch);
            assertDraftSnapshot(email, row.person_id);
            const subject = normalizeSubject(result.subject);
            const updated = db.prepare("UPDATE sequences SET subject = ? WHERE id = ? AND status = 'draft'")
              .run(subject, email.sequence_id);
            if (updated.changes !== 1) {
              throw new Error(`subject update lost its draft row for person ${row.person_id}, touch ${touch}`);
            }
            db.prepare(`
              INSERT INTO subject_line_reviews
                (sequence_id, person_id, touch, old_subject, new_subject, basis, source_phrase, reason)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              email.sequence_id, row.person_id, touch, email.subject, subject,
              result.basis, result.source_phrase, result.reason,
            );
            batchSubjects++;
          }
          if (campaignFamily(row.campaign) !== 'outagehub' && map.has(1)) {
            const t2 = emailAt(row, 2);
            if (t2?.status === 'draft') {
              assertDraftSnapshot(t2, row.person_id);
              const inherited = db.prepare("UPDATE sequences SET subject = ? WHERE id = ? AND status = 'draft'")
                .run(normalizeSubject(map.get(1).subject), t2.sequence_id);
              if (inherited.changes !== 1) {
                throw new Error(`T2 subject inheritance lost its draft row for person ${row.person_id}`);
              }
            }
          }
          if (campaignFamily(row.campaign) === 'outagehub' && map.has(2)) {
            const t3 = emailAt(row, 3);
            if (t3?.status === 'draft') {
              assertDraftSnapshot(t3, row.person_id);
              const inherited = db.prepare("UPDATE sequences SET subject = ? WHERE id = ? AND status = 'draft'")
                .run(normalizeSubject(map.get(2).subject), t3.sequence_id);
              if (inherited.changes !== 1) {
                throw new Error(`T3 subject inheritance lost its draft row for person ${row.person_id}`);
              }
            }
          }
          if (campaignFamily(row.campaign) === 'wapahki' && map.has(4)) {
            const t5 = emailAt(row, 5);
            if (t5?.status === 'draft') {
              assertDraftSnapshot(t5, row.person_id);
              const inherited = db.prepare("UPDATE sequences SET subject = ? WHERE id = ? AND status = 'draft'")
                .run(normalizeSubject(map.get(4).subject), t5.sequence_id);
              if (inherited.changes !== 1) {
                throw new Error(`T5 subject inheritance lost its draft row for person ${row.person_id}`);
              }
            }
          }
          // A contact becomes visible at the front of the CRM only after every
          // independent draft subject selected for that contact has passed the
          // strategist, skeptic, editor, and deterministic checks in this batch.
          db.prepare(`
            UPDATE sequences SET created_at=datetime('now')
            WHERE person_id=? AND status='draft'
          `).run(row.person_id);
          batchContacts++;
        }
        db.exec('COMMIT');
        wroteSubjects += batchSubjects;
        wroteContacts += batchContacts;
        reservedByThisBatch = [];
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      reservedByThisBatch.forEach((key) => newlyReservedSubjectKeys.delete(key));
      failed++;
      console.log(`  failed batch ${index + 1}: ${String(error.message).split('\n')[0]}`);
    }
    completed++;
    console.log(`  ${completed}/${batches.length} batches | contacts ${wroteContacts} | subjects ${wroteSubjects} | failed ${failed}`);
  }
}

console.log(`subject agents: ${selected.length} contacts | ${batches.length} batches | ${model}/${reasoning} | concurrency=${concurrency}`);
await Promise.all(Array.from({ length: Math.min(concurrency, batches.length || 1) }, () => worker()));
console.log(`Done. Reviewed ${wroteSubjects} subjects across ${wroteContacts} contacts; ${failed} batches failed.`);
if (failed) process.exitCode = 1;
