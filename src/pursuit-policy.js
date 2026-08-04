// Pure policy for the account-pursuit workflow. Keeping this module free of
// database and model calls makes the commercial guardrails easy to test.
import {
  looksLikeIllustrativeCostAnalysis,
  validateIllustrativeCostAnalysis,
} from './cost-analysis.js';

export const PURSUIT_PHASES = [
  'research',
  'attention',
  'validation',
  'consensus',
  'pilot',
  'close',
];

const researchStep = {
  step_key: 'research',
  label: 'Earn the right to engage',
  phase: 'research',
  channel: 'research',
  narrative_job: 'Verify the opportunity, the relevant business unit, public evidence, likely owner, and the assumptions that still need to be tested.',
};

const openStep = {
  step_key: 'open',
  label: 'Reach the work owner',
  phase: 'attention',
  channel: 'email',
  narrative_job: 'Open one useful conversation with a role-relevant observation and one easy-to-answer question. Do not pitch the whole relationship.',
};

export const PURSUIT_TYPES = [
  'pilot_customer',
  'technology_partner',
  'channel_partner',
  'strategic_partner',
];

export const PURSUIT_MOTIONS = {
  pilot_customer: {
    label: 'Paid pilot customer',
    short_label: 'Pilot customer',
    description: 'Win a signed, paid, measurable pilot on a real operating line and create a credible path to deployment.',
    commitment_example: 'A signed paid pilot for one line, cell, or workflow with an agreed start date.',
    required_roles: ['operator_champion', 'economic_buyer', 'technical', 'safety_procurement'],
    proof_requirements: [
      'Relevant robot or workflow demonstration',
      'Site or line constraints captured',
      'Safety and integration approach',
      'Pilot success measures and baseline',
      'Commercial scope, price, and start date',
    ],
    steps: [
      researchStep,
      openStep,
      {
        step_key: 'problem_validation',
        label: 'Validate the line problem',
        phase: 'validation',
        channel: 'meeting',
        narrative_job: 'Confirm the current task, frequency, variability, labour and quality impact, and why the operation has not already automated it.',
      },
      {
        step_key: 'site_discovery',
        label: 'Inspect the real line',
        phase: 'validation',
        channel: 'meeting',
        narrative_job: 'Capture cycle time, payload, product variation, layout, utilities, guarding, upstream and downstream dependencies, and the people who must sign off.',
      },
      {
        step_key: 'pilot_hypothesis',
        label: 'Return a bounded pilot',
        phase: 'pilot',
        channel: 'email',
        narrative_job: 'Show one bounded automation concept with a measurable outcome, explicit assumptions, human exception path, and the proof still required.',
      },
      {
        step_key: 'stakeholder_alignment',
        label: 'Align the buying group',
        phase: 'consensus',
        channel: 'meeting',
        narrative_job: 'Bring the operator champion, budget owner, technical owner, and safety or procurement route into one shared decision.',
      },
      {
        step_key: 'pilot_scope',
        label: 'Agree pilot scope',
        phase: 'pilot',
        channel: 'document',
        narrative_job: 'Agree deliverables, responsibilities, site access, acceptance criteria, baseline, timeline, price, and what happens after a successful pilot.',
      },
      {
        step_key: 'technical_safety_review',
        label: 'Clear technical and safety review',
        phase: 'pilot',
        channel: 'meeting',
        narrative_job: 'Resolve integration, guarding, data, maintenance, operator training, security, insurance, and change-control requirements.',
      },
      {
        step_key: 'pilot_signed',
        label: 'Sign and schedule the pilot',
        phase: 'close',
        channel: 'document',
        narrative_job: 'Obtain the signed agreement, purchase order or deposit, named owners, site date, kickoff date, and a clear implementation handoff.',
      },
    ],
  },
  technology_partner: {
    label: 'Technology partner',
    short_label: 'Technology',
    description: 'Create a technical integration or co-development relationship that makes both products more useful and defensible.',
    commitment_example: 'A signed integration or co-development agreement with named technical owners and a proof-of-concept date.',
    required_roles: ['partner_owner', 'technical', 'product_owner', 'executive_sponsor'],
    proof_requirements: [
      'Integration architecture and boundary',
      'Working technical proof or sandbox result',
      'Security, data, and support responsibilities',
      'Customer or workflow value evidence',
      'Roadmap and ownership commitment',
    ],
    steps: [
      researchStep,
      openStep,
      {
        step_key: 'mutual_fit',
        label: 'Confirm mutual product value',
        phase: 'validation',
        channel: 'meeting',
        narrative_job: 'Confirm the customer problem each side improves, why an integration is better than separate products, and what each party will contribute.',
      },
      {
        step_key: 'technical_sponsor',
        label: 'Secure technical sponsors',
        phase: 'consensus',
        channel: 'meeting',
        narrative_job: 'Name empowered technical and product owners on both sides and agree the feasibility questions they must answer.',
      },
      {
        step_key: 'technical_validation',
        label: 'Validate the integration',
        phase: 'pilot',
        channel: 'document',
        narrative_job: 'Test the smallest useful integration, including data, APIs, security, performance, support boundaries, and measurable user value.',
      },
      {
        step_key: 'business_case',
        label: 'Agree the business case',
        phase: 'consensus',
        channel: 'meeting',
        narrative_job: 'Agree who benefits, commercial treatment, roadmap priority, resourcing, support, intellectual property, and the reason to act now.',
      },
      {
        step_key: 'joint_action_plan',
        label: 'Run the joint action plan',
        phase: 'pilot',
        channel: 'document',
        narrative_job: 'Assign owners and dates for technical proof, security, legal, commercial approval, announcement, launch, and success review.',
      },
      {
        step_key: 'agreement_signed',
        label: 'Sign and launch the partnership',
        phase: 'close',
        channel: 'document',
        narrative_job: 'Sign the agreement, confirm launch owners and dates, and hand the relationship into an operating cadence.',
      },
    ],
  },
  channel_partner: {
    label: 'Channel / integrator partner',
    short_label: 'Channel',
    description: 'Give an integrator, distributor, consultant, or reseller a repeatable way to originate and deliver qualified opportunities with Wapahki.',
    commitment_example: 'A signed referral, reseller, or delivery agreement plus one named launch account.',
    required_roles: ['partner_owner', 'sales_owner', 'delivery_owner', 'executive_sponsor'],
    proof_requirements: [
      'Ideal joint customer and disqualification rules',
      'Repeatable offer and division of delivery work',
      'Commercial model and deal registration',
      'Enablement material and proof',
      'First shared account or opportunity',
    ],
    steps: [
      researchStep,
      openStep,
      {
        step_key: 'route_fit',
        label: 'Confirm channel fit',
        phase: 'validation',
        channel: 'meeting',
        narrative_job: 'Confirm customer overlap, trust, delivery fit, geographic or industry coverage, and why the partner would bring Wapahki into a deal.',
      },
      {
        step_key: 'partner_owner',
        label: 'Secure a partner owner',
        phase: 'consensus',
        channel: 'meeting',
        narrative_job: 'Name the person accountable for enabling sellers or delivery teams, not merely a friendly introduction.',
      },
      {
        step_key: 'commercial_model',
        label: 'Design the commercial model',
        phase: 'consensus',
        channel: 'document',
        narrative_job: 'Agree lead ownership, qualification, pricing, margin or referral fee, delivery responsibilities, customer support, and conflict rules.',
      },
      {
        step_key: 'enablement_pilot',
        label: 'Prove one joint pursuit',
        phase: 'pilot',
        channel: 'meeting',
        narrative_job: 'Work one qualified opportunity together and measure responsiveness, role clarity, sales friction, delivery fit, and customer value.',
      },
      {
        step_key: 'joint_action_plan',
        label: 'Run the joint action plan',
        phase: 'pilot',
        channel: 'document',
        narrative_job: 'Assign owners and dates for enablement, target-account selection, first introductions, commercial approval, launch, and review.',
      },
      {
        step_key: 'agreement_signed',
        label: 'Sign and activate the channel',
        phase: 'close',
        channel: 'document',
        narrative_job: 'Sign the operating agreement, enable the first partner team, register the first account, and schedule a pipeline review.',
      },
    ],
  },
  strategic_partner: {
    label: 'Strategic partner',
    short_label: 'Strategic',
    description: 'Build a multi-stakeholder relationship around a specific strategic advantage, with a concrete give/get and an executable first commitment.',
    commitment_example: 'A signed joint initiative with executive sponsors, named business-unit owners, resources, milestones, and a launch date.',
    required_roles: ['business_unit_owner', 'technical', 'executive_sponsor', 'legal_procurement'],
    proof_requirements: [
      'Business-unit-specific strategic thesis',
      'Credible proof that Wapahki can contribute',
      'Concrete mutual give/get',
      'Technical, legal, brand, and commercial boundaries',
      'Executive-backed joint action plan',
    ],
    steps: [
      researchStep,
      openStep,
      {
        step_key: 'strategic_thesis',
        label: 'Validate the strategic thesis',
        phase: 'validation',
        channel: 'meeting',
        narrative_job: 'Confirm the initiative supports a named business-unit priority and creates value neither side can produce as effectively alone.',
      },
      {
        step_key: 'business_unit',
        label: 'Land in the right business unit',
        phase: 'validation',
        channel: 'meeting',
        narrative_job: 'Find the operating group with the problem, budget, technical context, and authority; avoid treating the company as one monolithic buyer.',
      },
      {
        step_key: 'sponsor_coalition',
        label: 'Build a sponsor coalition',
        phase: 'consensus',
        channel: 'meeting',
        narrative_job: 'Develop a working-level champion, business owner, technical sponsor, and executive sponsor who share the same case for action.',
      },
      {
        step_key: 'give_get',
        label: 'Agree the mutual give / get',
        phase: 'consensus',
        channel: 'document',
        narrative_job: 'Make each party contribution and benefit explicit: technology, access, distribution, data, engineering, credibility, customers, capital, or revenue.',
      },
      {
        step_key: 'technical_validation',
        label: 'Prove the smallest joint win',
        phase: 'pilot',
        channel: 'document',
        narrative_job: 'Run a bounded proof that reduces the central technical or market risk and produces evidence for the executive decision.',
      },
      {
        step_key: 'executive_alignment',
        label: 'Align executive decisions',
        phase: 'consensus',
        channel: 'meeting',
        narrative_job: 'Resolve strategic priority, resources, commercial boundaries, risk ownership, public positioning, and the decision process.',
      },
      {
        step_key: 'joint_action_plan',
        label: 'Run the joint action plan',
        phase: 'pilot',
        channel: 'document',
        narrative_job: 'Assign owners and dates for proof, security, legal, procurement, commercial approval, executive review, launch, and public communication.',
      },
      {
        step_key: 'agreement_signed',
        label: 'Sign and launch the initiative',
        phase: 'close',
        channel: 'document',
        narrative_job: 'Sign the agreement, commit resources, confirm launch and review dates, and establish the operating cadence.',
      },
    ],
  },
};

export const GNK_PILOT_CUSTOMER_MOTION = Object.freeze({
  label: 'Hypothesis-led paid pilot',
  short_label: 'GnK pilot',
  description: 'Confirm one costly recurring workflow, prove the case on historical records, then expand only from measured evidence.',
  commitment_example: 'A signed $40k–$90k historical-data pilot with a 30–45 day test, named owner, success measure, and kill condition.',
  required_roles: ['operator', 'process_owner', 'economic_buyer', 'technical_security_owner'],
  proof_requirements: [
    'Recent case reconstructed with the operator',
    'Frequency and consequence measured by the process owner',
    'Historical records confirmed accessible by the technical/security owner',
    'Pilot baseline, success measure, and kill condition agreed',
    'Commercial scope, price, and expansion decision defined',
  ],
  steps: [
    {
      ...researchStep,
      label: '1. Evidence',
      narrative_job: 'Record the public fact, source, cohort hypothesis, likely records, likely owner, and kill condition without presenting the hypothesis as a confirmed problem.',
    },
    {
      ...openStep,
      label: '2. Problem hypothesis',
      narrative_job: 'Ask one concrete workflow question. The email earns a correction or recent example; it does not sell software, quantify an unverified cost, or pitch a pilot.',
    },
    {
      step_key: 'correct_owner',
      label: '3. Correct owner',
      phase: 'attention',
      channel: 'email',
      narrative_job: 'Confirm the operator and accountable process owner. A router gets one initial note and at most one follow-up, then the route closes.',
    },
    {
      step_key: 'discovery',
      label: '4. Discovery',
      phase: 'validation',
      channel: 'meeting',
      narrative_job: 'Reconstruct one recent case: trigger, people, steps, systems, records, delay, frequency, consequence, owner, prior attempts, accessible data, champion, and paid-pilot bar.',
    },
    {
      step_key: 'quantified_case',
      label: '5. Quantified case',
      phase: 'consensus',
      channel: 'document',
      narrative_job: 'Build a transparent case from confirmed frequency, time, error, risk, and value inputs. Pause when two or more qualification conditions remain missing.',
    },
    {
      step_key: 'paid_pilot',
      label: '6. Paid pilot',
      phase: 'pilot',
      channel: 'document',
      narrative_job: 'Sign a $40k–$90k, 30–45 day historical-data pilot with a bounded sample, human decision boundary, deliverables, acceptance criteria, responsibilities, price, and kill condition.',
    },
    {
      step_key: 'expansion',
      label: '7. Expansion',
      phase: 'close',
      channel: 'meeting',
      narrative_job: 'Compare the measured result with the baseline and decide whether to stop, repeat, integrate, or expand into the next workflow or business unit.',
    },
  ],
});

export const GNK_WORKFLOW_SCORECARD_FIELDS = Object.freeze([
  'frequent',
  'expensive_when_poor',
  'measurable',
  'records_exist',
  'identifiable_owner',
  'testable_30_45_days',
  'supports_40k_90k_engagement',
]);

export const GNK_QUALIFICATION_FIELDS = Object.freeze([
  'recurring_workflow',
  'measurable_consequence',
  'named_owner',
  'accessible_data',
  'credible_champion',
  'defined_pilot_outcome',
]);

export const DEFAULT_PURSUIT_STEPS = PURSUIT_MOTIONS.pilot_customer.steps;

export function isGnkProduct(product) {
  return ['gnk', 'delay', 'football', 'row'].includes(String(product || '').toLowerCase());
}

export function getPursuitMotion(type, product) {
  const safeType = PURSUIT_TYPES.includes(type) ? type : 'pilot_customer';
  if (safeType === 'pilot_customer' && isGnkProduct(product)) return GNK_PILOT_CUSTOMER_MOTION;
  return PURSUIT_MOTIONS[safeType];
}

export function stepsForPursuitType(type, product) {
  return getPursuitMotion(type, product).steps;
}

const URL_RE = /^https?:\/\/[^\s]+$/i;
const USABLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BANNED_COPY = [
  ['quick call', /\bquick call\b/i],
  ['touch base', /\btouch base\b/i],
  ['circle back', /\bcircle back\b/i],
  ['revolutionize', /\brevolutioni[sz]e\b/i],
  ['synergy', /\bsynerg(?:y|ies)\b/i],
  ['game-changer', /\bgame[- ]changer\b/i],
  ['hope this finds you well', /\bhope this finds you well\b/i],
  ['just following up', /\bjust follow(?:ing)? up\b/i],
  ['bumping this', /\bbump(?:ing)? this\b/i],
  ['I found you because', /\bi found you because\b/i],
];

export function parseEvidence(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function verifiedEvidence(value) {
  return parseEvidence(value).filter((item) => (
    item
    && String(item.claim || '').trim().length >= 12
    && URL_RE.test(String(item.url || '').trim())
  ));
}

export function parseList(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function evaluateDealArchitecture(pursuit = {}) {
  const errors = [];
  const warnings = [];
  const type = PURSUIT_TYPES.includes(pursuit.pursuit_type) ? pursuit.pursuit_type : null;
  const motion = getPursuitMotion(type, pursuit.product);
  if (!type) errors.push('Choose a valid pursuit type.');
  if (!String(pursuit.desired_commitment || '').trim()) {
    errors.push('Define the concrete commitment this pursuit is meant to win.');
  }
  if (!String(pursuit.value_to_partner || '').trim()) {
    errors.push('Define the value the other company receives.');
  }
  if (!String(pursuit.value_to_us || '').trim()) {
    errors.push(isGnkProduct(pursuit.product)
      ? 'Define what GnK receives in return.'
      : 'Define what Wapahki receives in return.');
  }

  const activeContacts = (pursuit.contacts || []).filter((contact) => (
    contact.state !== 'rejected' && contact.lifecycle_status !== 'archived'
  ));
  const mappedRoles = new Set(activeContacts.map((contact) => contact.role));
  const missingRoles = motion.required_roles.filter((role) => !mappedRoles.has(role));
  if (missingRoles.length) warnings.push(`Stakeholder gaps: ${missingRoles.join(', ')}.`);

  const proofAssets = parseList(pursuit.proof_assets);
  if (!proofAssets.length) warnings.push('No proof assets are mapped to this pursuit yet.');
  const successMetrics = parseList(pursuit.success_metrics);
  if (!successMetrics.length) warnings.push('No success measures have been defined yet.');
  const jointActionPlan = parseList(pursuit.joint_action_plan);
  if (!jointActionPlan.length) warnings.push('The joint action plan has no owned milestones yet.');
  if (!String(pursuit.decision_process || '').trim()) warnings.push('The decision and approval path is still unknown.');
  if (!String(pursuit.commercial_path || '').trim()) warnings.push('The commercial path is still unknown.');

  const checks = [
    Boolean(type),
    Boolean(String(pursuit.desired_commitment || '').trim()),
    Boolean(String(pursuit.value_to_partner || '').trim()),
    Boolean(String(pursuit.value_to_us || '').trim()),
    missingRoles.length === 0,
    proofAssets.length > 0,
    successMetrics.length > 0,
    jointActionPlan.length > 0,
    Boolean(String(pursuit.decision_process || '').trim()),
    Boolean(String(pursuit.commercial_path || '').trim()),
  ];
  return {
    type: type || 'pilot_customer',
    label: motion.label,
    description: motion.description,
    commitment_example: motion.commitment_example,
    required_roles: motion.required_roles,
    missing_roles: missingRoles,
    proof_requirements: motion.proof_requirements,
    completeness: Math.round((checks.filter(Boolean).length / checks.length) * 100),
    ready_for_approval: errors.length === 0,
    errors,
    warnings,
  };
}

export function evaluateGnkHypothesis(pursuit = {}) {
  const errors = [];
  const warnings = [];
  const requiredText = [
    ['observed_fact', 'Record the observed public fact separately from the hypothesis.'],
    ['problem', 'Write the recurring workflow as a hypothesis, not a confirmed problem.'],
    ['workflow_owner', 'Name the likely role or department that owns the workflow.'],
    ['consequence', 'Name the measurable time, money, error, or risk consequence to validate.'],
    ['records', 'Name the records or systems that could contain the answer.'],
    ['offer', 'Define a 30–45 day historical-data pilot test.'],
    ['kill_condition', 'Define what finding would end the pursuit.'],
  ];
  for (const [field, message] of requiredText) {
    if (!String(pursuit[field] || '').trim()) errors.push(message);
  }

  const scorecard = pursuit.workflow_scorecard && typeof pursuit.workflow_scorecard === 'object'
    ? pursuit.workflow_scorecard
    : {};
  const failedCriteria = GNK_WORKFLOW_SCORECARD_FIELDS.filter((field) => scorecard[field] !== true);
  if (failedCriteria.length) {
    errors.push(`Workflow screen incomplete: ${failedCriteria.join(', ')}.`);
  }

  const qualification = pursuit.qualification && typeof pursuit.qualification === 'object'
    ? pursuit.qualification
    : {};
  const missingQualification = GNK_QUALIFICATION_FIELDS.filter((field) => qualification[field] !== true);
  if (missingQualification.length >= 2) {
    warnings.push(`Pause after discovery unless these are confirmed: ${missingQualification.join(', ')}.`);
  }
  return {
    ready: errors.length === 0,
    errors,
    warnings,
    failed_criteria: failedCriteria,
    missing_qualification: missingQualification,
  };
}

export function usableEmail(value) {
  return USABLE_EMAIL_RE.test(String(value || '').trim())
    && !/not_unlocked|unavailable/i.test(String(value || ''));
}

export function evaluatePursuitReadiness({
  pursuit,
  company,
  primaryPerson,
  contactHistory = [],
  settings = {},
} = {}) {
  const errors = [];
  const warnings = [];
  if (!pursuit) return { ready: false, errors: ['No pursuit exists for this account.'], warnings };
  if (!company || company.archived_at) errors.push('The account is missing or archived.');
  if (pursuit.approval_status !== 'approved') errors.push('The account narrative has not been approved.');
  if (isGnkProduct(pursuit.product || company?.product || company?.campaign)) {
    const hypothesis = evaluateGnkHypothesis(pursuit);
    errors.push(...hypothesis.errors);
    warnings.push(...hypothesis.warnings);
  }
  const architecture = evaluateDealArchitecture(pursuit);
  errors.push(...architecture.errors);
  warnings.push(...architecture.warnings);
  if (!String(pursuit.problem || '').trim()) errors.push('Name one specific problem before drafting outreach.');
  if (!String(pursuit.consequence || '').trim()) errors.push('Define the operational or financial consequence.');
  if (!String(pursuit.narrative || '').trim()) errors.push('Define the pursuit narrative.');
  if (!verifiedEvidence(pursuit.evidence).length) {
    errors.push('Add at least one public evidence item with a claim and source URL.');
  }
  if (!primaryPerson) errors.push('Select one primary contact.');
  if (primaryPerson) {
    if (primaryPerson.company_id !== company?.id) errors.push('The primary contact belongs to a different account.');
    if (primaryPerson.lifecycle_status !== 'active') errors.push('The primary contact is not active and verified.');
    if (primaryPerson.status === 'not_interested' || primaryPerson.suppression_reason) {
      errors.push('The primary contact is suppressed or has opted out.');
    }
    if (!usableEmail(primaryPerson.email)) errors.push('The primary contact does not have a usable email.');
    if (!primaryPerson.last_verified_at) warnings.push('The primary contact has no employment-verification date.');
  }
  if (contactHistory.some((event) => ['not_interested', 'bounced'].includes(event.outcome))) {
    errors.push('Contact history contains a stop signal; review it before any further outreach.');
  }
  if (settings.require_human_approval !== 'true') {
    warnings.push('Human approval is not enforced in system settings.');
  }
  if (pursuit.cost_model && !['verified', 'public_model', 'illustrative'].includes(pursuit.cost_confidence)) {
    errors.push('Label the cost model as verified, public_model, or illustrative.');
  }
  if (!String(pursuit.cost_model || '').trim()) {
    warnings.push('No cost model is recorded; define the unit, frequency, duration, rate, and source boundary before using economics in outreach.');
  } else if (pursuit.cost_confidence === 'illustrative') {
    const costWarnings = validateIllustrativeCostAnalysis(pursuit.cost_model, {
      requireCalibration: false,
    });
    warnings.push(...costWarnings.map((warning) => `Illustrative cost model: ${warning}.`));
  }
  return { ready: errors.length === 0, errors, warnings };
}

function contentWords(body) {
  return (String(body || '').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []).length;
}

function normalizedSignature(campaign) {
  if (campaign === 'wapahki') return /Andrew Gordienko\s*\n(?:Founder,\s*)?Wapahki/i;
  if (campaign === 'outagehub') return /Andrew Gordienko\s*\nOutageHub/i;
  return /Andrew Gordienko\s*\nGnK/i;
}

export function evaluateDraft({
  draft,
  step,
  campaign,
  previousBodies = [],
  costConfidence,
} = {}) {
  const errors = [];
  const warnings = [];
  const body = String(draft?.body || '').trim();
  const subject = String(draft?.subject || '').trim();
  const words = contentWords(body);
  const isEmail = (draft?.channel || step?.channel) === 'email';

  if (!body) errors.push('The message body is empty.');
  if (isEmail && !/^Hi [^,\n]+,/i.test(body)) errors.push('Email must open with a natural first-name greeting.');
  if (isEmail && !normalizedSignature(campaign).test(body)) errors.push('Email signature does not match the campaign.');
  if (isEmail && (!subject || subject.split(/\s+/).length < 2 || subject.split(/\s+/).length > 8)) {
    errors.push('Subject must be a plain 2–8 word work topic.');
  }
  const questionCount = (body.match(/\?/g) || []).length;
  if (questionCount !== 1) errors.push('The message must ask exactly one question.');

  const firstContact = step?.step_key === 'open';
  const minWords = firstContact ? 75 : 35;
  const maxWords = firstContact ? 155 : 125;
  if (words < minWords || words > maxWords) errors.push(`Message is ${words} words; expected ${minWords}–${maxWords}.`);

  for (const [label, pattern] of BANNED_COPY) {
    if (pattern.test(body)) errors.push(`Remove canned phrase: ${label}.`);
  }
  if (looksLikeIllustrativeCostAnalysis(body) && costConfidence === 'illustrative') {
    const costErrors = validateIllustrativeCostAnalysis(body, {
      requireCalibration: false,
    });
    errors.push(...costErrors.map((error) => `Illustrative economics: ${error}.`));
    if (!costErrors.length) {
      warnings.push('The copy uses a transparent illustrative model; confirm every input before approval.');
    }
  }
  if (/\bmy guess is\b/i.test(body)) warnings.push('“My guess is” is becoming a house template; use only when it improves honesty.');
  if (/\bI run (?:GnK|OutageHub|Wapahki)\b/i.test(body)) warnings.push('The standard company introduction is repeated; make sure the surrounding sentence earns its place.');
  if (/\b20-minute\b/i.test(body) && firstContact) {
    warnings.push('A meeting ask is allowed, but a lower-friction answer may be better unless the evidence is strong.');
  }

  const lower = body.toLowerCase().replace(/\s+/g, ' ');
  for (const prior of previousBodies) {
    const priorLower = String(prior || '').toLowerCase().replace(/\s+/g, ' ');
    const repeated = lower.split(/[.!?]/).map((s) => s.trim()).filter((s) => s.length > 35 && priorLower.includes(s));
    if (repeated.length) {
      errors.push('The draft repeats a substantive sentence from an earlier touch.');
      break;
    }
  }
  const score = Math.max(0, 100 - (errors.length * 20) - (warnings.length * 5));
  return { pass: errors.length === 0, score, words, errors, warnings };
}

export function nextIncompleteStep(steps = []) {
  return [...steps]
    .filter((step) => !['sent', 'complete', 'skipped'].includes(step.status))
    .sort((a, b) => a.step_order - b.step_order)[0] || null;
}

export function defaultNextGoal(step) {
  if (!step) return 'Choose whether to expand, nurture, or close the pursuit.';
  return step.narrative_job;
}
