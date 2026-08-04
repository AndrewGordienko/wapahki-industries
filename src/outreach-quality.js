import {
  looksLikeIllustrativeCostAnalysis,
  validateIllustrativeCostAnalysis,
} from './cost-analysis.js';
import { areDistinctSubjectThreads, normalizeSubject } from './subject-lines.js';
import { wapahkiTrack } from './wapahki-contact-selection.js';

export const SEVEN_TOUCH_PLAN = Object.freeze([
  Object.freeze({ touch: 1, day: 1, channel: 'email' }),
  Object.freeze({ touch: 2, day: 4, channel: 'email' }),
  Object.freeze({ touch: 3, day: 6, channel: 'linkedin' }),
  Object.freeze({ touch: 4, day: 9, channel: 'email' }),
  Object.freeze({ touch: 5, day: 11, channel: 'linkedin' }),
  Object.freeze({ touch: 6, day: 15, channel: 'email' }),
  Object.freeze({ touch: 7, day: 18, channel: 'email' }),
]);

export const GNK_ROUTING_PLAN = Object.freeze([
  Object.freeze({ touch: 1, day: 1, channel: 'email' }),
  Object.freeze({ touch: 2, day: 4, channel: 'email' }),
]);

// GnK cold outreach is four insight-led touches over roughly three weeks:
// a concrete problem question, a sharper operational insight, a short LinkedIn
// connection, then a single close-or-route. It does not run buyers through a
// seven-step qualification funnel and never asks for a meeting from cold.
export const GNK_FOUR_TOUCH_PLAN = Object.freeze([
  Object.freeze({ touch: 1, day: 1, channel: 'email' }),
  Object.freeze({ touch: 2, day: 4, channel: 'email' }),
  Object.freeze({ touch: 3, day: 9, channel: 'linkedin' }),
  Object.freeze({ touch: 4, day: 18, channel: 'email' }),
]);

// Every Wapahki contact runs the same seven-stage sequence. The stages MOVE and
// never paraphrase: recall a real example, test one concrete motion, connect,
// narrow to one handoff, route to the right person, offer a task sketch, close.
// Role only changes the framing (operational floor vs finance/investment vs
// pure routing), never the length.
export const WAPAHKI_SEVEN_TOUCH_PLAN = Object.freeze([
  Object.freeze({ touch: 1, day: 1, channel: 'email' }),
  Object.freeze({ touch: 2, day: 5, channel: 'email' }),
  Object.freeze({ touch: 3, day: 9, channel: 'linkedin' }),
  Object.freeze({ touch: 4, day: 15, channel: 'email' }),
  Object.freeze({ touch: 5, day: 20, channel: 'email' }),
  Object.freeze({ touch: 6, day: 26, channel: 'linkedin' }),
  Object.freeze({ touch: 7, day: 32, channel: 'email' }),
]);

// OutageHub runs a seven-stage ownership-first sequence over roughly a month.
// It tests whether the company even owns the cause-and-dispatch decision before
// selling anything: establish ownership, examine the handoff, connect, propose a
// retrospective replay carrying the only call ask, probe the consequence, sharpen
// one angle, then close with a carrier/company/shared classification. No pilot
// after silence; the only meeting ask is in stage 4.
export const OUTAGEHUB_SEVEN_TOUCH_PLAN = Object.freeze([
  Object.freeze({ touch: 1, day: 1, channel: 'email' }),
  Object.freeze({ touch: 2, day: 5, channel: 'email' }),
  Object.freeze({ touch: 3, day: 9, channel: 'linkedin' }),
  Object.freeze({ touch: 4, day: 13, channel: 'email' }),
  Object.freeze({ touch: 5, day: 18, channel: 'linkedin' }),
  Object.freeze({ touch: 6, day: 24, channel: 'email' }),
  Object.freeze({ touch: 7, day: 30, channel: 'email' }),
]);

export const SEQUENCE_JOBS = new Map([
  [1, 'problem_question'],
  [2, 'recent_case_question'],
  [3, 'connect'],
  [4, 'useful_artifact'],
  [5, 'business_consequence'],
  [6, 'discovery_invitation'],
  [7, 'close_or_route'],
]);

export const GNK_SEQUENCE_JOBS = new Map([
  [1, 'handoff_question'],
  [2, 'recent_case'],
  [3, 'connect'],
  [4, 'sharper_hypothesis'],
  [5, 'existing_system_check'],
  [6, 'discovery_invitation'],
  [7, 'close_or_route'],
]);

export const GNK_ROUTING_JOBS = new Map([
  [1, 'route_owner'],
  [2, 'close_route'],
]);

// The seven stages advance concretely and never paraphrase: recall a real
// example, test one physical motion, connect, narrow to one handoff, route to
// the right person, offer a simple task sketch, then close.
export const WAPAHKI_SEQUENCE_JOBS = new Map([
  [1, 'last_example_question'],
  [2, 'concrete_motion_test'],
  [3, 'connect'],
  [4, 'sharper_example'],
  [5, 'route_owner'],
  [6, 'offer_task_sketch'],
  [7, 'close_loop'],
]);

// A contact object carries either an explicit track or a title we can classify.
export function wapahkiTrackForContact(contact) {
  const explicit = String(contact?.track || contact?.wapahki_track || '').toLowerCase();
  if (explicit === 'operational' || explicit === 'economic' || explicit === 'routing') {
    return explicit;
  }
  return wapahkiTrack(contact?.title);
}

export const OUTAGEHUB_SEQUENCE_JOBS = new Map([
  [1, 'establish_ownership'],
  [2, 'examine_handoff'],
  [3, 'connect'],
  [4, 'retrospective_replay'],
  [5, 'consequence_question'],
  [6, 'sharpen_angle'],
  [7, 'classification_close'],
]);

export function campaignFamilyFor(campaign) {
  const key = String(campaign || '').toLowerCase();
  if (['gnk', 'delay', 'football', 'row'].includes(key)) return 'gnk';
  if (['outagehub', 'outage'].includes(key)) return 'outagehub';
  return key;
}

export function sequencePlanForCampaign(campaign) {
  const family = campaignFamilyFor(campaign);
  if (family === 'wapahki') return WAPAHKI_SEVEN_TOUCH_PLAN;
  if (family === 'outagehub') return OUTAGEHUB_SEVEN_TOUCH_PLAN;
  if (family === 'gnk') return SEVEN_TOUCH_PLAN;
  return SEVEN_TOUCH_PLAN;
}

export function sequencePlanForContact(campaign, contact) {
  // Every GnK and Wapahki contact runs the full seven-stage sequence
  // regardless of role or track; the role only changes framing, never length.
  return sequencePlanForCampaign(campaign);
}

export function sequenceJobsForContact(campaign, contact) {
  return sequenceJobsForCampaign(campaign);
}

export function sequenceJobsForCampaign(campaign) {
  const family = campaignFamilyFor(campaign);
  if (family === 'wapahki') return WAPAHKI_SEQUENCE_JOBS;
  if (family === 'outagehub') return OUTAGEHUB_SEQUENCE_JOBS;
  if (family === 'gnk') return GNK_SEQUENCE_JOBS;
  return SEQUENCE_JOBS;
}

export function sequenceLengthForCampaign(campaign) {
  return sequencePlanForCampaign(campaign).length;
}

export function hasCompleteSequence(campaign, touches) {
  const plan = sequencePlanForCampaign(campaign);
  const ids = new Set((touches || []).map((touch) => Number(touch.touch)));
  return Array.isArray(touches)
    && touches.length === plan.length
    && plan.every(({ touch }) => ids.has(touch));
}

const BANNED = [
  ['just following up', /\bjust follow(?:ing)? up\b/i],
  ['just checking in', /\bjust checking in\b/i],
  ['quick one', /\bquick one\b/i],
  ['quick question', /\bquick question\b/i],
  ['I found you because', /\bI found you because\b/i],
  ['my guess is', /\bmy guess is\b/i],
  ['a no is helpful', /\ba (?:quick )?no (?:is|would be) helpful\b/i],
  ['no pressure', /\bno pressure\b/i],
  ['tell me to get lost', /\btell me to get lost\b/i],
  ['set me straight', /\bset me straight\b/i],
  ['take this off your plate', /\btake this off your plate\b/i],
  ['outside your remit', /\boutside your remit\b/i],
  ['brief look', /\bbrief look\b/i],
  ['worth a look', /\bworth (?:a|another|a quick) look\b/i],
  ['flexible equipment', /\bflexible equipment\b/i],
  ['re-teach formats', /\bre-?teach (?:the )?formats?\b/i],
  ['scenario agent', /\bscenario agent\b/i],
  ['scenario sandbox', /\bscenario sandbox\b/i],
  ['scenario', /\bscenarios?\b/i],
  ['fan narrative agent', /\bfan[- ]narrative agent\b/i],
  ['workflow', /\bworkflows?\b/i],
  ['interface', /\binterfaces?\b/i],
  ['outage context', /\boutage context\b/i],
  ['decision record', /\bdecision records?\b/i],
  ['acceptance check', /\bacceptance checks?\b/i],
  ['unless you already', /\bunless (?:you|[\p{L}\p{N} .&'-]+) already (?:have|has|use|uses|do|does)\b/iu],
  ['caught my attention because', /\bcaught my attention because\b/i],
  ['strategically useful', /\bstrategically useful\b/i],
  ['assess whether', /\bassess whether\b/i],
  ['idea merits', /\b(?:the )?idea merits\b/i],
  ['deserves internal attention', /\bdeserves internal attention\b/i],
  ['outside current priorities', /\boutside current priorities\b/i],
  ['if applicable', /\bif applicable\b/i],
  ['at this stage', /\bat this stage\b/i],
  ['only pay if it ships', /\b(?:only |don't |do not |wouldn't )?pay\b[^.!?\n]{0,45}\b(?:if|unless)\b[^.!?\n]{0,30}\bship/i],
  ['deceptive outage subject', /^subject:\s*(?:your outage|your july outage|always last to know)\b/im],
  ['two robot topics in one sentence', /\bset (?:it|the robot) up\b[^.!?\n]{0,100}\band (?:restart|reset|recover)\b/i],
  ['unclear operator pronoun', /\bwhen (?:it|that) tells? (?:the )?operator\b/i],
  ['recipient qualification command', /\btell me if (?:that|this|it)(?:'s| is) not (?:a )?problem\b/i],
  ['map to your work', /\bmap(?:s|ped|ping)? to your work\b/i],
  ['dismissive close', /\bno need to continue\b/i],
  ['messy reconciliation problem', /\bmessy reconciliation problem\b/i],
  ['vague service impact', /\bwhere service impact may be coming from\b/i],
  ['real-time Canadian coverage', /\breal[- ]?time Canadian coverage\b/i],
  ['permission to send example', /\bwould you like me to send\b/i],
  ['invented thirteen-hour calculation', /\b(?:13|thirteen) hours?\b/i],
  ['two factory events', /\broutine stop or pack change\b/i],
  ['packages vary', /\bpackages vary\b/i],
  ['select a pack', /\bselect (?:a|the) pack\b/i],
  ['operator steps', /\boperator steps\b/i],
  ['calling someone over', /\bcall(?:ing)? someone over\b/i],
  ['raised a practical question', /\braised a practical question\b/i],
  ['abstract operator permission', /\bwhat should an operator be able to do at the line\b/i],
  ['common stops', /\bcommon stops\b/i],
  ['machine rebuilt or reprogrammed', /\bmachine (?:rebuilt|reprogrammed)|\brebuilt or reprogrammed\b/i],
  ['trust condition', /\bwhat would need to be true before you(?: would|['’]d)? trust\b/i],
  ['challenge first', /\bwhat (?:would )?[\p{L}\p{N} -]+ challenge first\b/iu],
  ['overloaded call ask', /\bcould we spend (?:20|twenty) minutes\b[^.?!]{0,160}\bif\b[^.?!]{0,160}\bso\b/i],
  ['model transition', /\b(?:that (?:made me (?:want to ask|curious)|work made me curious)|seeing that range)\b/i],
  ['correct my view', /\bcorrect my view\b/i],
  ['correct the checks', /\bcorrect the checks\b/i],
  ['correct what someone decides', /\bcorrect what (?:the person|someone|they) decides\b/i],
  ['unworkable on a real floor', /\bunworkable on a real floor\b/i],
  ['recipient correction homework', /\byou can correct\b/i],
  ['belongs beside', /\bbelongs? beside\b/i],
  ['asks for sensitive comparison', /\bcompare\b[^.!?\n]{0,140}\b(?:internal|facility|network|customer)\b[^.!?\n]{0,70}\b(?:data|readings?|logs?|alarms?|records?)\b/i],
  ['long ignorance hedge', /\bwhile I (?:do not|don['’]t) know whether\b[^.?!]{25,180}\b(?:I would|I['’]d) value your view\b/i],
  ['undefined weak experiment', /\bweak (?:prior )?(?:experiment|attempt)\b/i],
  ['unreliable repeat identification', /\bidentif(?:y|ies|ied|ying) likely repeats?\b/i],
  // Outbound doctrine (docs/outbound-doctrine/): a hypothetical product question
  // smuggles the solution in before the problem is confirmed; "on behalf of"
  // never sounds like Andrew talking; FOMO makes an indecisive buyer do nothing.
  ['hypothetical would-you-use question', /\bwould you (?:use|be interested in using|want to use)\b/i],
  ['reaching out on behalf of', /\breaching out on behalf of\b/i],
  ['FOMO falling behind', /\b(?:falling behind|fall behind|competitors are already)\b/i],
];

function words(text) {
  return (text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []).length;
}

function emailContent(body) {
  return body
    .replace(/^Hi [^,\n]+,\s*/i, '')
    .replace(/\s*Thanks,\s*\n[^\n]+\s*\n[^\n]+\s*$/i, '')
    .trim();
}

function normalizedSentences(body) {
  return emailContent(body)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').trim())
    .filter((s) => words(s) >= 6);
}

function repeatedWordRun(body, size = 8) {
  const tokens = emailContent(body)
    .toLowerCase()
    .match(/[\p{L}\p{N}']+/gu) || [];
  const seen = new Map();
  for (let i = 0; i <= tokens.length - size; i++) {
    const phrase = tokens.slice(i, i + size).join(' ');
    const previous = seen.get(phrase);
    if (previous != null && i - previous >= size) return phrase;
    if (previous == null) seen.set(phrase, i);
  }
  return null;
}

const QUESTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'broadly', 'could', 'do', 'does', 'for',
  'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'there', 'this',
  'to', 'we', 'what', 'which', 'would', 'you', 'your',
]);

function normalizedQuestion(question) {
  const aliases = new Map([
    ['changes', 'change'], ['changing', 'change'], ['changed', 'change'],
    ['jobs', 'task'], ['job', 'task'], ['tasks', 'task'], ['moves', 'task'], ['move', 'task'],
    ['consistent', 'stable'], ['consistency', 'stable'], ['predictable', 'stable'],
    ['reusable', 'stable'], ['repeated', 'stable'], ['repeats', 'stable'], ['same', 'stable'],
  ]);
  return (String(question || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .map((token) => aliases.get(token) || token)
    .filter((token) => !QUESTION_STOP_WORDS.has(token));
}

function similarQuestions(left, right) {
  const leftTokens = new Set(normalizedQuestion(left));
  const rightTokens = new Set(normalizedQuestion(right));
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.8;
}

function repeatedQuestionError(touches, includeConsistencyHeuristic = true) {
  const questions = [];
  for (const touch of touches) {
    const found = String(touch.body || '').match(/[^.!?\n][^!?\n]*\?/g) || [];
    for (const question of found) questions.push({ touch: Number(touch.touch), question: question.trim() });
  }
  for (let left = 0; left < questions.length; left += 1) {
    for (let right = left + 1; right < questions.length; right += 1) {
      if (similarQuestions(questions[left].question, questions[right].question)) {
        return `touches ${questions[left].touch} and ${questions[right].touch} ask substantially the same question`;
      }
    }
  }
  const consistencyQuestions = includeConsistencyHeuristic ? questions.filter(({ question }) => (
    /\b(?:job|task|move|work|operation)\b/i.test(question)
    && /\b(?:change(?:s|d|ing)? least|(?:most )?consistent|stable|stays? (?:the )?same|predictable|repeat(?:s|able)?|reusable)\b/i.test(question)
  )) : [];
  return consistencyQuestions.length > 1
    ? 'sequence repeatedly asks which job changes least or stays most consistent'
    : null;
}

export function validateSpokenBrief(brief, campaign, contact) {
  const errors = [];
  // A Wapahki routing contact has a one-row plan; everyone else keeps the full
  // campaign plan. When no contact is supplied this falls back to the campaign
  // default, so existing callers are unaffected.
  const plan = sequencePlanForContact(campaign, contact);
  const jobs = sequenceJobsForContact(campaign, contact);
  const expectedCount = plan.length;
  const sources = Array.isArray(brief?.research_used) ? brief.research_used : [];
  if (!sources.length) errors.push('spoken brief has no verified research source');
  for (const source of sources) {
    if (!String(source?.fact || '').trim()) errors.push('spoken brief research source has no fact');
    if (!/^https?:\/\/\S+$/i.test(String(source?.source_url || '').trim())) {
      errors.push('spoken brief research source must have an exact HTTP(S) URL');
    }
  }

  const touchPlan = Array.isArray(brief?.touch_plan) ? brief.touch_plan : [];
  if (touchPlan.length !== expectedCount) {
    errors.push(`spoken brief touch plan must have ${expectedCount} rows, got ${touchPlan.length}`);
  }
  const seen = new Set();
  const information = new Set();
  for (const item of touchPlan) {
    const touch = Number(item?.touch);
    if (seen.has(touch)) errors.push(`spoken brief repeats touch ${touch}`);
    seen.add(touch);
    if (jobs.get(touch) !== item?.job) {
      errors.push(`spoken brief touch ${touch} must use job ${jobs.get(touch) || 'unknown'}`);
    }
    for (const field of ['personalization_anchor', 'new_information', 'cta']) {
      if (!String(item?.[field] || '').trim()) errors.push(`spoken brief touch ${touch} is missing ${field}`);
    }
    const anchor = String(item?.personalization_anchor || '').trim();
    if (/^(?:recipient|person|company|company name|job title|recipient title|first name|greeting|previous (?:email|message|touch))\.?$/i.test(anchor)) {
      errors.push(`spoken brief touch ${touch} uses surface personalization`);
    }
    if (touch > 1 && touch < expectedCount) {
      const normalized = String(item?.new_information || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (normalized && information.has(normalized)) errors.push(`spoken brief touch ${touch} repeats earlier information`);
      if (normalized) information.add(normalized);
    }
  }
  for (let touch = 1; touch <= expectedCount; touch++) {
    if (!seen.has(touch)) errors.push(`spoken brief touch plan is missing touch ${touch}`);
  }
  return [...new Set(errors)];
}

export function validateSequence({ contact, campaign, touches }) {
  const errors = [];
  const ids = new Set();
  const campaignFamily = campaignFamilyFor(campaign);
  const isRoutingContact = false;
  const wapahkiTrackName = campaignFamily === 'wapahki'
    ? wapahkiTrackForContact(contact)
    : null;
  const plan = sequencePlanForContact(campaign, contact);
  const touchPlan = new Map(plan.map(({ touch, day, channel }) => (
    [touch, { day, channel }]
  )));
  const protectedOpening = Array.isArray(touches)
    ? touches.find((touch) => Number(touch.touch) === 1 && String(touch.status || 'draft') !== 'draft')
    : null;

  if (!Array.isArray(touches) || touches.length !== plan.length) {
    return [`expected ${plan.length} touches, got ${Array.isArray(touches) ? touches.length : 'non-array'}`];
  }

  for (const t of touches) {
    const expected = touchPlan.get(Number(t.touch));
    if (!expected) {
      errors.push(`invalid touch ${t.touch}`);
      continue;
    }
    if (ids.has(t.touch)) errors.push(`duplicate touch ${t.touch}`);
    ids.add(t.touch);
    if (Number(t.day) !== expected.day) errors.push(`touch ${t.touch} must be day ${expected.day}`);
    if (t.channel !== expected.channel) errors.push(`touch ${t.touch} must use ${expected.channel}`);

    const body = String(t.body || '').trim();
    if (!body) errors.push(`touch ${t.touch} has no body`);
    // Sent and approved messages are immutable historical facts. Validate their
    // position in the cadence, then judge only the future copy we can still fix.
    if (String(t.status || 'draft') !== 'draft') continue;
    if (/[—–]/.test(body)) errors.push(`touch ${t.touch} contains an em/en dash`);
    if (/!/.test(body)) errors.push(`touch ${t.touch} contains an exclamation point`);
    if (/:/.test(body) && !(campaignFamily === 'outagehub' && Number(t.touch) === 2)) {
      errors.push(`touch ${t.touch} contains a colon`);
    }
    if (/https?:\/\//i.test(body)) errors.push(`touch ${t.touch} contains a URL`);
    if (/\b(?:10|15|ten|fifteen)[ -]?minute/i.test(body)) {
      errors.push(`touch ${t.touch} asks for less than 20 minutes`);
    }
    for (const [label, re] of BANNED) {
      const target = t.channel === 'email'
        ? `subject: ${String(t.subject || '')}\n${body}`
        : body;
      if (re.test(target)) errors.push(`touch ${t.touch} uses banned phrase: ${label}`);
    }

    if (t.channel === 'email') {
      const subject = String(t.subject || '').trim();
      const inheritsProtectedThread = Number(t.touch) === 2
        && protectedOpening
        && subject === String(protectedOpening.subject || '').trim();
      const contentWords = words(emailContent(body));
      if (!subject) errors.push(`touch ${t.touch} has no subject`);
      if (!inheritsProtectedThread && subject && subject !== normalizeSubject(subject)) {
        errors.push(`touch ${t.touch} subject must use natural sentence capitalization`);
      }
      if (!inheritsProtectedThread && (words(subject) < 2 || words(subject) > 5)) errors.push(`touch ${t.touch} subject must be 2-5 words`);
      if (!inheritsProtectedThread && /[:!?]/.test(subject)) errors.push(`touch ${t.touch} subject contains salesy punctuation`);
      if (!body.startsWith(`Hi ${contact.first_name},`)) errors.push(`touch ${t.touch} greeting is wrong`);
      const signatureLine = campaignFamily === 'wapahki'
        ? 'Founder, Wapahki Industries'
        : campaignFamily === 'gnk' ? 'GnK' : 'OutageHub';
      const escapedSignature = signatureLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`Thanks,\\s*\\nAndrew Gordienko\\s*\\n${escapedSignature}\\s*$`).test(body)) {
        errors.push(`touch ${t.touch} signature is wrong`);
      }
      // A routing sequence is deliberately terse. It earns a name or title; it
      // does not make a non-owner sit through buyer-level problem discovery.
      const routingRange = Number(t.touch) === 1 ? [55, 100]
        : Number(t.touch) === 2 ? [18, 65]
          : Number(t.touch) === plan.length ? [15, 55]
            : [20, 80];
      // The final touch is a short closing email by design; other follow-ups sit higher.
      const [min, max] = isRoutingContact ? routingRange
        : t.touch === 1 ? (campaignFamily === 'gnk' ? [75, 160] : campaignFamily === 'wapahki' ? [80, 150] : [90, 145])
          : t.touch === 2 ? (campaignFamily === 'wapahki' ? [25, 120] : [35, 120])
            : Number(t.touch) === plan.length ? [25, 90]
              // Wapahki touch 5 is a low-friction routing check. Padding it to
              // 40 words makes it sound more like a sales follow-up than a
              // respectful request for the right perspective.
              : campaignFamily === 'wapahki' && Number(t.touch) === 5 ? [30, 105]
                : campaignFamily === 'wapahki' && Number(t.touch) === 4 ? [30, 90]
                  : campaignFamily === 'outagehub' && Number(t.touch) === 4 ? [40, 145]
                    : [40, 105];
      if (contentWords < min || contentWords > max) {
        errors.push(`touch ${t.touch} content is ${contentWords} words, expected ${min}-${max}`);
      }
      if (Number(t.touch) === 1) {
        const repeated = repeatedWordRun(body);
        if (repeated) errors.push(`touch 1 repeats a long phrase: "${repeated}"`);
        if (campaignFamily === 'gnk'
          && /\b(?:uses|combines|connects|reviews|brings together)\b[^.!?\n]*(?:,\s*[^,.!?\n]+){3,}/i.test(body)) {
          errors.push('touch 1 catalogs inputs instead of explaining the output and decision');
        }
      }
      if (looksLikeIllustrativeCostAnalysis(body)) {
        const costErrors = validateIllustrativeCostAnalysis(body, {
          requireCalibration: Number(t.touch) === 2 && campaignFamily !== 'wapahki',
        });
        for (const error of costErrors) {
          errors.push(`touch ${t.touch} ${error}`);
        }
      }
    } else {
      if (t.subject != null && String(t.subject).trim()) errors.push(`touch ${t.touch} LinkedIn subject must be null`);
      if (t.touch === 3 && body.length > 200) errors.push('touch 3 connection note exceeds 200 characters');
      if (t.touch === 3 && /\b(?:call|meeting|meet|minutes?)\b/i.test(body)) {
        errors.push('touch 3 connection request must not ask for a call or meeting');
      }
      if (/Thanks,\s*\nAndrew/i.test(body)) errors.push(`touch ${t.touch} LinkedIn message has an email signature`);
    }
  }

  const mutableTouches = touches.filter((touch) => String(touch.status || 'draft') === 'draft');
  const emailTouches = mutableTouches.filter((t) => t.channel === 'email');
  const touchOneSubject = String(touches.find((t) => Number(t.touch) === 1)?.subject || '').trim();
  const touchTwoSubject = String(touches.find((t) => Number(t.touch) === 2)?.subject || '').trim();
  const touchThreeSubject = String(touches.find((t) => Number(t.touch) === 3)?.subject || '').trim();
  const touchFourSubject = String(touches.find((t) => Number(t.touch) === 4)?.subject || '').trim();
  const touchFiveSubject = String(touches.find((t) => Number(t.touch) === 5)?.subject || '').trim();
  const touchSevenSubject = String(touches.find((t) => Number(t.touch) === 7)?.subject || '').trim();
  if (campaignFamily !== 'outagehub'
    && touchOneSubject && touchTwoSubject && touchOneSubject !== touchTwoSubject) {
    errors.push('touch 2 must repeat the touch 1 subject exactly');
  }
  if (campaignFamily !== 'outagehub'
    && touchOneSubject && touchFourSubject && !areDistinctSubjectThreads(touchOneSubject, touchFourSubject)) {
    errors.push('touch 4 must open a new email thread with a different subject');
  }
  // Stages 1 and 2 share the ownership thread; stage 4 (retrospective replay +
  // the call) opens a fresh thread. Stages 3 and 5 are LinkedIn (null subject).
  if (campaignFamily === 'outagehub' && touchOneSubject && touchTwoSubject
    && touchOneSubject !== touchTwoSubject) {
    errors.push('OutageHub touch 2 must repeat the touch 1 subject exactly');
  }
  if (campaignFamily === 'outagehub' && touchFourSubject && touchOneSubject
    && !areDistinctSubjectThreads(touchOneSubject, touchFourSubject)) {
    errors.push('OutageHub touch 4 must open a distinct retrospective-replay subject');
  }
  if (campaignFamily === 'wapahki' && touchFourSubject && touchFiveSubject
    && touchFourSubject !== touchFiveSubject) {
    errors.push('Wapahki touch 5 must stay in the touch 4 hypothesis thread');
  }
  if (campaignFamily === 'wapahki' && touchSevenSubject
    && [touchOneSubject, touchFourSubject].some((subject) => subject && !areDistinctSubjectThreads(subject, touchSevenSubject))) {
    errors.push('Wapahki touch 7 must use a distinct closing subject');
  }
  const allSentences = emailTouches.flatMap((t) => normalizedSentences(t.body));
  const repeats = allSentences.filter((s, i) => allSentences.indexOf(s) !== i);
  if (repeats.length) errors.push(`sequence repeats a full sentence: "${repeats[0]}"`);
  const repeatedQuestion = repeatedQuestionError(mutableTouches, campaignFamily !== 'wapahki');
  if (repeatedQuestion) errors.push(repeatedQuestion);

  const callAsks = mutableTouches.filter((t) => /\b(?:call|conversation|talk|meet|minutes?)\b/i.test(t.body));
  for (const t of callAsks) {
    if (/\b(?:give|spare|grab|take|find|worth|open to|have|book)\b[^.!?\n]{0,55}\b(?:minute|call|conversation|talk|meet)\b/i.test(t.body)
      && !/\b(?:20|twenty)[ -]?minute/i.test(t.body)) {
      errors.push(`touch ${t.touch} appears to ask for a call without a 20-minute scope`);
    }
  }

  const touchOne = touches.find((t) => Number(t.touch) === 1);
  if (touchOne && String(touchOne.status || 'draft') === 'draft'
    && /\b(?:20|twenty)[ -]?minute\b/i.test(touchOne.body)) {
    // The 20-minute ask must be its own question, not a run-on such as
    // "a 20-minute call or an email reply?". Wapahki no longer requires a
    // low-friction alternative sentence; a bare call question is fine.
    const validCallClose = campaignFamily === 'wapahki'
      ? /\b(?:20|twenty)[ -]?minute (?:call|conversation)(?: next week)?\?/i
      : /\b(?:20|twenty)[ -]?minute (?:call|conversation)\b[^.!?\n]{0,45}\?\s+(?:I|We)\b/i;
    if (!validCallClose.test(touchOne.body)) {
      errors.push('touch 1 must put the 20-minute call question and its low-friction alternative or payoff in separate sentences');
    }
  }

  if (isRoutingContact) {
    const sequenceBody = mutableTouches.map((touch) => String(touch.body || '')).join('\n');
    if (/\b(?:paid|fixed[- ]fee) pilot\b|\bscope (?:a|the|one) pilot\b/i.test(sequenceBody)) {
      errors.push('GnK routing sequence must not ask a routing contact to assess or advance a paid pilot');
    }
    if (/\b(?:20|twenty)[ -]?minute\b|\b(?:book|schedule|have) (?:a )?(?:call|meeting|conversation)\b/i.test(sequenceBody)) {
      errors.push('GnK routing sequence must not ask a routing contact for a discovery call');
    }
    if (/\bmaximum carton weight\b/i.test(sequenceBody)) {
      errors.push('GnK routing sequence invents a maximum-carton-weight compliance example');
    }
    if (/\brelease or hold\b|\brelease[- ]or[- ]hold\b/i.test(sequenceBody)) {
      errors.push('GnK routing sequence assumes release-or-hold terminology');
    }
    if (/\b(?:sizes?|weights?|colou?rs?)\b[^.!?\n]{0,100}\b(?:routing|labelling|labeling|shipping) requirements?\b/i.test(sequenceBody)) {
      errors.push('GnK routing sequence treats product attributes as evidence of retailer shipping compliance');
    }
  }

  if (campaignFamily === 'gnk') {
    const draftBodyFor = (touch) => {
      const item = touches.find((candidate) => Number(candidate.touch) === touch);
      return String(item?.status || 'draft') === 'draft' ? String(item?.body || '') : '';
    };
    const sequenceBody = mutableTouches.map((touch) => String(touch.body || '')).join('\n');
    const touchOneBody = draftBodyFor(1);
    const lastTouch = plan.length;
    const closeBody = draftBodyFor(lastTouch);

    // Touch 1 opens with a concrete when-event question and never asks for a
    // meeting from a cold contact. Discovery is earned later in the sequence.
    if (touchOneBody && (!/\bwhen\b/i.test(touchOneBody) || !/\?/.test(touchOneBody))) {
      errors.push('GnK touch 1 must ask a concrete when-event problem question');
    }
    if (touchOneBody && /\b(?:20|twenty)[ -]?minute\b|\b(?:book|schedule|have) (?:a )?(?:call|meeting|conversation)\b/i.test(touchOneBody)) {
      errors.push('GnK touch 1 must not ask for a meeting from a cold contact');
    }
    // The final touch closes the loop or routes to the right owner, once.
    if (closeBody
      && (!/\b(?:close|closing|last note|final note|leave it)\b/i.test(closeBody)
        || !/\b(?:owner|owns|right person|right role|right team|job title|name)\b/i.test(closeBody))) {
      errors.push(`GnK touch ${lastTouch} must close the loop or route to the right owner once`);
    }
    if (/\b(?:paid|fixed[- ]fee) pilot\b|\bscope (?:a|the|one) pilot\b/i.test(sequenceBody)) {
      errors.push('GnK no-reply sequence must not pitch a pilot before discovery confirms the task');
    }
    if (/\b(?:annual|per year|recoverable savings?|ROI)\b|(?:CAD|USD|\$)\s*\d/i.test(sequenceBody)) {
      errors.push('GnK no-reply sequence must not quantify an unconfirmed business case');
    }
    // The fundamental rule: internal research should make the copy more
    // specific, but internal uncertainty, qualification, and proof-boundary
    // notes must never reach the reader. Research goes in the brief, not the email.
    const leakage = [
      ['proof-boundary language', /\b(?:does not (?:prove|show|establish)|the source does not|not yet established|unknown until discovery|only after qualification)\b/i],
      ['internal qualification language', /\b(?:qualif(?:y|ied|ication)|proof boundary|kill condition|hypothesis to validate)\b/i],
      ['robotic operating-task jargon', /\boperating (?:task|owner|result|exception)\b|\baccountable operating owner\b/i],
      ['visible hedging about its own assumptions', /\bI (?:have not|am not|do not) assum|\bwithout assuming\b|\bI am not assuming\b/i],
    ];
    for (const [label, pattern] of leakage) {
      if (pattern.test(sequenceBody)) {
        errors.push(`GnK sequence leaks ${label} into buyer-facing copy`);
      }
    }
  }

  if (campaignFamily === 'wapahki') {
    const track = wapahkiTrackName || wapahkiTrackForContact(contact);
    const draftTouches = touches.filter((touch) => String(touch.status || 'draft') === 'draft');
    const sequenceBody = mutableTouches.map((touch) => String(touch.body || '')).join('\n');
    const draftBody = draftTouches.map((touch) => String(touch.body || '')).join('\n');
    const touchOne = touches.find((touch) => Number(touch.touch) === 1);
    const touchOneBody = String(touchOne?.body || '');
    const touchOneDraft = String(touchOne?.status || 'draft') === 'draft';

    // Guardrails: never sell and never assign ownership.
    const advancedPosture = [
      ['technical or fit screen', /\b(?:technical|fit|automation) screen(?:ing)?\b/i],
      ['qualification language', /\b(?:qualif(?:y|ication)|disqualif(?:y|ication))\b/i],
      ['weak-opportunity rejection', /\breject(?:ing)? (?:a |the )?weak opportunity\b/i],
      ['deployment or pilot language', /\b(?:deployment|deploying|paid pilot|pilot scope|scope a pilot)\b/i],
      ['premature motion specification', /\brequired rate\b[^.!?\n]{0,100}\bpickup\b[^.!?\n]{0,100}\bplacement\b/i],
    ];
    for (const [label, pattern] of advancedPosture) {
      if (pattern.test(sequenceBody)) errors.push(`Wapahki sequence uses premature ${label}`);
    }
    if (/\baccountable\b/i.test(sequenceBody)
      || (touchOneDraft && /\byou (?:own|are responsible for|are accountable for)\b/i.test(touchOneBody))) {
      errors.push('Wapahki sequence must not claim the recipient owns or is accountable for the process');
    }

    // T1 concreteness: a robot token plus a real physical verb so the reader can
    // picture the machine.
    if (touchOneDraft
      && !(/\brobot/i.test(touchOneBody)
        && /\b(?:picks?|picking|picked|places?|placed|placing|pick[- ]and[- ]place|transfers?|transferred|transferring|palletiz\w*|stack\w*|loads?|loading|unloads?|lifts?|lifting|moves?|moving|packs?|packing|pack[- ]out|assembl\w*)\b/i.test(touchOneBody))) {
      errors.push('Wapahki touch 1 must concretely name what Wapahki builds (a robot that performs one repeated pick-and-place or transfer motion)');
    }

    // Ask for real work, not theory: ban abstract framework language the
    // recipient cannot naturally answer.
    const bannedAbstract = [
      ['stays recognizable', /\bstays? recogniz/i],
      ['the checks change', /\bthe checks change\b/i],
      ['emerging or working hypothesis', /\b(?:emerging|working|current) hypothesis\b/i],
      ['learning question', /\blearning question\b/i],
      ['synthesis', /\bsynthesis\b/i],
      ['unfamiliar operating idea', /\bunfamiliar operating idea\b/i],
      ['where repeatable handling ends', /\bwhere repeatable\b/i],
    ];
    for (const [label, pattern] of bannedAbstract) {
      if (pattern.test(draftBody)) errors.push(`Wapahki copy uses abstract framework language: ${label}`);
    }

    // Anti-paraphrase: no two touches may ask the same question, and every
    // drafted email follow-up must carry a concrete anchor (a physical motion,
    // a program, an artifact, or a routing detail) rather than restate touch 1.
    const repeated = repeatedQuestionError(draftTouches);
    if (repeated) errors.push(`Wapahki sequence paraphrases itself: ${repeated}`);
    const concreteAnchor = /\b(?:transfers?|transferred|transferring|palletiz\w*|pallet|cases?|conveyor|hand-?off|packs?|packing|pack-?out|sketch|programs?|name|title|colleague|motion|movement)\b/i;
    for (const touch of draftTouches) {
      if (Number(touch.touch) === 1 || touch.channel === 'linkedin') continue;
      if (!concreteAnchor.test(String(touch.body || ''))) {
        errors.push(`Wapahki touch ${touch.touch} must add a concrete example, artifact, or routing detail, not restate the prior question`);
      }
    }

    // Role-specific opening: recall for operational, investment for economic,
    // ownership for routing.
    if (touchOneDraft) {
      if (track === 'economic'
        && !/\b(?:who (?:determines|decides|evaluates|would (?:determine|decide|evaluate|judge))|justif\w*|invest\w*|business case|enough (?:programs?|customers?)|across (?:several|multiple|enough))\b/i.test(touchOneBody)) {
        errors.push('Wapahki economic touch 1 must ask who determines whether the task repeats across enough programs to justify the investment');
      } else if (track === 'routing'
        && !/\bwho\b|\bwhich (?:team|role|person|group|function|department)\b|\bthe right person\b|\bsomeone in\b/i.test(touchOneBody)) {
        errors.push('Wapahki routing touch 1 must ask who owns the physical process');
      } else if (track === 'operational'
        && !/\b(?:recent|last|two (?:recent )?(?:production )?runs?|across (?:two |several )?runs?|example|already|actually happened)\b/i.test(touchOneBody)) {
        errors.push('Wapahki operational touch 1 must ask about a recent real example, not ask the recipient to theorize');
      }
    }

    // Stage roles: touch 5 routes; touches 6 and 7 never demand a meeting.
    const touchFive = touches.find((touch) => Number(touch.touch) === 5);
    const touchSix = touches.find((touch) => Number(touch.touch) === 6);
    const touchSeven = touches.find((touch) => Number(touch.touch) === 7);
    if (String(touchFive?.status || 'draft') === 'draft'
      && !/\b(?:right person|better person|closer to this|who (?:would|might|could) be|which (?:team|role|colleague|function)|someone in)\b/i.test(String(touchFive?.body || ''))) {
      errors.push('Wapahki touch 5 must check the route without assuming ownership');
    }
    if (String(touchSix?.status || 'draft') === 'draft'
      && /\b(?:call|meeting|meet)\b/i.test(String(touchSix?.body || ''))) {
      errors.push('Wapahki touch 6 must not request a meeting');
    }
    if (String(touchSeven?.status || 'draft') === 'draft'
      && /\b(?:20|twenty)[ -]?minute|\b(?:book|schedule) (?:a )?(?:call|meeting)\b/i.test(String(touchSeven?.body || ''))) {
      errors.push('Wapahki touch 7 must close without another meeting ask');
    }
  }

  if (campaignFamily === 'outagehub') {
    const sequenceBody = touches.map((touch) => String(touch.body || '')).join('\n');
    const bodyOf = (n) => String(touches.find((t) => Number(t.touch) === n)?.body || '');
    const isDraft = (n) => String(touches.find((t) => Number(t.touch) === n)?.status || 'draft') === 'draft';
    const touchOneBody = bodyOf(1);
    const touchOneBeforeProduct = touchOneBody.split(/\bI run OutageHub\b/i)[0] || touchOneBody;

    const unsupportedClaims = [
      ['N+1 diesels', /\bN\s*\+\s*1\b[^.!?\n]{0,45}\bdiesels?\b|\bdiesels?\b[^.!?\n]{0,45}\bN\s*\+\s*1\b/i],
      ['colocation risk', /\bcolocation risk\b/i],
      ['detection before tickets arrive', /\b(?:detect|identify|know|see|spot)(?:s|ed|ing)?\b[^.!?\n]{0,80}\bbefore\b[^.!?\n]{0,45}\b(?:tickets?|calls?|alarms?)\b/i],
      ['complete Canadian coverage', /\b(?:complete|full|nationwide|national) Canadian coverage\b/i],
      ['real-time or live coverage', /\b(?:real[- ]?time|live)\b[^.!?\n]{0,25}\b(?:feed|data|coverage|outage|updates?|monitoring|reports?)\b/i],
      ['exhaustive utility coverage', /\b(?:every|all|complete|full|comprehensive|nationwide|national)\b[^.!?\n]{0,25}\b(?:canadian )?utilit(?:y|ies)\b/i],
      ['invented operator phrasing', /\bemergency[- ]dispatch review\b|\balarm group\b[^.!?\n]{0,40}\b(?:review|reviewed|next)\b|\boutage[- ]context record\b/i],
      ['invented pricing or ROI', /\b(?:CAD|USD)\b|\$\s*\d|\bROI\b/i],
    ];
    for (const [label, pattern] of unsupportedClaims) {
      if (pattern.test(sequenceBody)) errors.push(`OutageHub sequence uses unsupported claim: ${label}`);
    }

    // Stage 1 — establish ownership. Ask whether the company still owns the
    // cause-and-dispatch decision or the carrier already sets it. Identity +
    // mechanism required, tuned to the buyer (no canned slogan). NO meeting ask.
    if (isDraft(1)
      && (!(touchOneBeforeProduct.match(/\?/g) || []).length
        || !/\b(?:today|already|currently|separately|still|check|correlat|determine|caus(?:e|es)|priorit|classif|triage|dispatch|carrier|upstream|who|which|does someone|first|work orders?|store by store|site by site|location by location|utility (?:site|report))\b/i.test(touchOneBeforeProduct))) {
      errors.push('OutageHub touch 1 must ask whether the company owns the cause-and-dispatch decision or the carrier already sets it');
    }
    // Mechanism must be conveyed, but tuned to the buyer in the writer's own
    // words — do NOT force one verbatim slogan (that made every email identical
    // and mislabelled insurers/comms leads as "multi-site operators").
    if (isDraft(1)) {
      if (!/\bI run OutageHub\b/i.test(touchOneBody)) {
        errors.push('OutageHub touch 1 must include the founder identity line "I run OutageHub"');
      }
      const namesPublicUtilityData = /\bpublic\b[^.!?\n]{0,40}\b(?:outage|utilit)/i.test(touchOneBody)
        || /\b(?:outage|power)\b[^.!?\n]{0,40}\bpublic(?:ly)?\b/i.test(touchOneBody)
        || /\butilit(?:y|ies)\b[^.!?\n]{0,45}\breport/i.test(touchOneBody);
      const namesLocationMatch = /\blocation[- ]matched\b/i.test(touchOneBody)
        || /\b(?:match\w*|map\w*|tie[sd]?|align\w*)\b[^.!?\n]{0,90}\b(?:location|site|store|facilit|propert|address|residence|network|territor|portfolio|area|branch)\w*/i.test(touchOneBody)
        || /\b(?:location|site|store|facilit|propert|address|residence|network|territor|portfolio|area|branch)\w*\b[^.!?\n]{0,90}\b(?:match\w*|map\w*)\b/i.test(touchOneBody);
      if (!namesPublicUtilityData || !namesLocationMatch) {
        errors.push('OutageHub touch 1 must describe the mechanism: public utility outage data matched to the buyer’s own locations');
      }
    }
    if (isDraft(1) && /\b(?:20|twenty)[ -]?minute\b/i.test(touchOneBody)) {
      errors.push('OutageHub touch 1 must not ask for a call; the only meeting ask is stage 4');
    }

    // Stage 2 — examine the handoff. A concrete question, no meeting.
    if (isDraft(2) && !/\?/.test(bodyOf(2))) {
      errors.push('OutageHub touch 2 must ask a concrete question about the alarm-to-work-order handoff');
    }
    if (isDraft(2) && /\b(?:20|twenty)[ -]?minute\b|\bmeeting\b/i.test(bodyOf(2))) {
      errors.push('OutageHub touch 2 must not ask for a meeting');
    }
    if (isDraft(2) && /\b(?:would you like|want me|happy)\b[^.!?\n]{0,45}\b(?:send|share)\b/i.test(bodyOf(2))) {
      errors.push('OutageHub touch 2 must not ask permission to send anything');
    }

    // Stage 3 — LinkedIn connection note. No meeting, no link.
    if (isDraft(3) && /\b(?:20|twenty)[ -]?minute\b|\bmeeting\b/i.test(bodyOf(3))) {
      errors.push('OutageHub touch 3 (LinkedIn connect) must not ask for a meeting');
    }
    if (isDraft(3) && /https?:\/\//i.test(bodyOf(3))) {
      errors.push('OutageHub touch 3 (LinkedIn connect) must not include a link');
    }

    // Stage 4 — retrospective replay carrying the ONLY 20-minute call ask.
    if (isDraft(4)
      && (!/\b(?:20|twenty)[ -]?minute (?:call|conversation)\b/i.test(bodyOf(4))
        || !/\b(?:retrospective|past|previous|closed|historical|prior|replay|reconstruct)\w*/i.test(bodyOf(4)))) {
      errors.push('OutageHub touch 4 must propose a retrospective replay and ask for the 20-minute call');
    }

    // Stage 5 — LinkedIn consequence question. One question, no meeting.
    if (isDraft(5) && (!/\?/.test(bodyOf(5)) || /\b(?:20|twenty)[ -]?minute\b|\bmeeting\b/i.test(bodyOf(5)))) {
      errors.push('OutageHub touch 5 must ask one consequence question without a meeting ask');
    }

    // Stage 6 — sharpen one angle. No further meeting ask.
    if (isDraft(6) && /\b(?:20|twenty)[ -]?minute\b|\bmeeting\b/i.test(bodyOf(6))) {
      errors.push('OutageHub touch 6 must not ask for another meeting');
    }

    // Stage 7 — classification close: does the company own the decision, an
    // external/upstream party (carrier, vendor, another team), or is it shared →
    // then ask for the owner or job title. The upstream party is a "carrier" only
    // for telecom buyers; do not require that literal word.
    if (isDraft(7)
      && (!/\?/.test(bodyOf(7))
        || !/\b(?:carrier|vendor|upstream|external|another (?:team|group|operations|function)|business[- ]continuity|central operations|the company|shared)\b/i.test(bodyOf(7))
        || !/\b(?:job title|title|who|owns?|prioriti|closest|right (?:person|team))\b/i.test(bodyOf(7)))) {
      errors.push('OutageHub touch 7 must classify who owns the decision (the company, an external/upstream party, or shared) and ask for the owner or job title');
    }
    if (isDraft(7) && /\b(?:incident[- ]system integration|integration owner|owns? the integration)\b/i.test(bodyOf(7))) {
      errors.push('OutageHub touch 7 must not ask about an integration owner before a manual check is confirmed');
    }

    // No invented consequence numbers in any follow-up (stages 2-7). Verified
    // facts (dates, site counts) belong in stage 1 only.
    for (const n of [2, 3, 4, 5, 6, 7]) {
      if (isDraft(n) && /\b(?:per year|annual(?:ly)?|\d+\s*(?:hours?|incidents?|calls?|dispatches?|%|percent))\b/i.test(bodyOf(n))) {
        errors.push(`OutageHub touch ${n} must not invent or quantify a consequence before discovery`);
      }
    }

    const boundaryMentions = (sequenceBody.match(/\b(?:external (?:context|signal)|public utility (?:data|reports?))\b[^.!?\n]{0,100}\b(?:not proof|does not prove|cannot prove|not determine|does not determine|would not determine)\b/gi) || []).length;
    if (boundaryMentions > 1) {
      errors.push('OutageHub sequence repeats the external-context proof boundary more than once');
    }
    if (/\b(?:paid )?(?:API )?pilot\b|\b(?:CAD|USD)\s*\$?\s*\d|\$\s*(?:40|75)k|\bfirst[- ]year deployment\b|\bannual (?:API )?(?:contract|licen[cs]e)\b/i.test(sequenceBody)) {
      errors.push('OutageHub cold sequence must not pitch or price a pilot, deployment, or annual contract');
    }
  }

  return [...new Set(errors)];
}

export function auditStoredSequences(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.person_id)) {
      let spokenBrief = null;
      try { spokenBrief = row.sales_brief ? JSON.parse(row.sales_brief) : null; } catch { /* invalid brief is reported below */ }
      grouped.set(row.person_id, {
        contact: {
          id: row.person_id,
          first_name: row.first_name || String(row.name || '').split(/\s+/)[0],
          title: row.title || '',
        },
        campaign: row.campaign,
        spokenBrief,
        touches: [],
      });
    }
    grouped.get(row.person_id).touches.push(row);
  }

  return [...grouped.values()].map((entry) => ({
    person_id: entry.contact.id,
    errors: [
      ...validateSequence(entry),
      ...(hasCompleteSequence(entry.campaign, entry.touches)
        ? validateSpokenBrief(entry.spokenBrief, entry.campaign)
        : []),
    ],
  }));
}
