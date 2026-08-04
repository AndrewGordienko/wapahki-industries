// The CRM grid: the spreadsheet of accounts → contacts → the messages to send,
// across the three businesses (Wapahki, GnK, OutageHub). Reads the real work the
// research/writing agents already produced (companies, people, sequences) and
// serves it as flat, scannable rows — no approval queue in the way.
import { db } from './db.js';
import {
  hasCompleteSequence,
  sequenceLengthForCampaign,
  sequencePlanForCampaign,
  sequencePlanForContact,
  validateSequence,
  validateSpokenBrief,
} from './outreach-quality.js';
import { buildSequenceSchedule } from './send-timing.js';
import {
  BUSINESS_SEND_TIMEZONES,
  EMAIL_DAILY_CAP,
  SCHEDULE_POLICY_VERSION,
  WEEKEND_SCHEDULE_POLICY,
} from './email-capacity.js';

// One business = a set of campaign keys. Companies and their generated message
// sequences are tagged with a campaign; several early experiment keys roll up
// into their parent business so the operator sees three books of business, not
// six half-labelled ones.
export const BUSINESSES = [
  {
    key: 'wapahki',
    label: 'Wapahki',
    full: 'Wapahki Industries',
    tagline: 'Early-stage robotics discovery focused on where repetitive handling genuinely resists automation.',
    campaigns: ['wapahki'],
  },
  {
    key: 'gnk',
    label: 'GnK',
    full: 'GnK',
    tagline: 'Turns messy operational data and manual workflows into decision systems, proven in 30–90 days.',
    campaigns: ['gnk', 'delay', 'football', 'row'],
  },
  {
    key: 'outagehub',
    label: 'OutageHub',
    full: 'OutageHub',
    tagline: 'Adds independent public-utility context to existing incident and location decisions.',
    campaigns: ['outagehub', 'outage'],
  },
  {
    key: 'outagehub-grants',
    label: 'OHUB Grants',
    full: 'OutageHub Grant Outreach',
    tagline: 'Ordered funding-program routes and seven-touch application-support cadences. Use one route at a time; do not contact all five in parallel.',
    campaigns: ['outagehub-grants'],
    calendar: false,
  },
];

const CAMPAIGN_TO_BUSINESS = new Map();
for (const b of BUSINESSES) for (const c of b.campaigns) CAMPAIGN_TO_BUSINESS.set(c, b.key);

export function businessForCampaign(campaign) {
  return CAMPAIGN_TO_BUSINESS.get(String(campaign || '')) || null;
}

function placeholders(n) {
  return Array.from({ length: n }, () => '?').join(',');
}

function safeJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function labeledNotes(value) {
  const out = {};
  for (const line of String(value || '').split(/\r?\n/)) {
    const match = line.match(/^([^:]{2,40}):\s*(.*)$/);
    if (match) out[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return out;
}

function hypothesisSections(value) {
  const text = String(value || '');
  const between = (start, end) => {
    const from = text.indexOf(start);
    if (from < 0) return '';
    const bodyStart = from + start.length;
    const to = end ? text.indexOf(end, bodyStart) : -1;
    return text.slice(bodyStart, to < 0 ? undefined : to).trim();
  };
  return {
    observed: between('Observed:', 'Hypothesis to validate:'),
    hypothesis: between('Hypothesis to validate:', 'Help:'),
    help: between('Help:', 'Why reply:'),
  };
}

function cad(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  if (amount >= 1_000_000) return `CAD $${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0)}m`;
  if (amount >= 1_000) return `CAD $${Math.round(amount / 1_000)}k`;
  return `CAD $${amount.toLocaleString('en-CA')}`;
}

function range(low, high, suffix = '') {
  if (low == null && high == null) return '';
  const left = cad(low ?? high);
  const right = cad(high ?? low);
  return `${left}${right && right !== left ? `–${right.replace(/^CAD \$/, '$')}` : ''}${suffix}`;
}

function commercialProblem(row, problemByTitle) {
  const business = businessForCampaign(row.campaign);
  if (!['gnk', 'outagehub'].includes(business)) return null;
  const sections = hypothesisSections(row.pursuit_problem || row.hypothesis);
  const labels = labeledNotes(row.company_notes);
  const json = safeJson(row.company_notes, null);
  if (business === 'outagehub') {
    const cost = labeledNotes(row.pursuit_cost_model);
    const evidence = safeJson(row.pursuit_evidence, []) || [];
    const observed = evidence
      .map((item) => {
        const claim = item.claim || item.fact || item.statement || '';
        const url = item.url || item.source_url || '';
        return [claim, url].filter(Boolean).join(' — ');
      })
      .filter(Boolean)
      .join('\n')
      || sections.observed
      || labels['why this company']
      || '';
    const currentProblem = row.pursuit_problem
      || sections.hypothesis
      || row.hypothesis
      || '';
    const economicCase = cost['economic case']
      || 'Not quantified yet. Discovery must validate locations or events × handling time or operational consequence before ROI is used.';
    const costBasis = cost['cost basis'] || row.pursuit_cost_model || '';
    const build = row.pursuit_offer
      || sections.help
      || 'OutageHub would match public outage data from supported Canadian utilities to company locations and add the result to the existing incident process through a feed, API, or central operations view.';
    const commercialEntry = row.desired_commitment
      || row.pursuit_commercial_path
      || 'After discovery, scope a bounded historical validation or first-year deployment with integration, support, SLA, licence, and agreed operating measures.';
    const title = String(row.pursuit_narrative || '').split('.')[0].trim()
      || labels['outagehub problem']
      || 'External utility context for one operating decision';
    const asText = [
      `Problem: ${currentProblem}`,
      `Economic case: ${economicCase}`,
      costBasis ? `Cost basis: ${costBasis}` : '',
      row.pursuit_consequence ? `Potential measured upside: ${row.pursuit_consequence}` : '',
      `What OutageHub changes: ${build}`,
      `Commercial entry: ${commercialEntry}`,
      observed ? `Evidence / fit: ${observed}` : '',
    ].filter(Boolean).join('\n');
    return {
      title,
      problem: currentProblem,
      economic_case: economicCase,
      cost_basis: costBasis,
      potential_savings: row.pursuit_consequence || '',
      what_we_build: build,
      solution_label: 'What OutageHub changes',
      commercial_entry: commercialEntry,
      observed,
      hypothesis: sections.hypothesis || currentProblem,
      as_text: asText,
    };
  }
  const ideaTitle = labels.idea || '';
  const model = problemByTitle.get(ideaTitle) || null;
  const currentProblem = model?.workflow_today
    || labels['workflow today']
    || sections.hypothesis
    || json?.decision_model?.value
    || json?.why_meaningful
    || json?.defensible_problem
    || row.pursuit_problem
    || row.hypothesis
    || '';
  const build = model?.proposed_solution
    || labels["what we'd build"]
    || sections.help
    || json?.ai_project
    || json?.decision_model?.output
    || '';
  const annualCost = range(model?.annual_cost_low, model?.annual_cost_high, ' per year');
  const savings = range(model?.savings_low, model?.savings_high, ' potential annual savings');
  const fee = range(model?.our_cut_low, model?.our_cut_high, ' pilot / first-version range');
  const economicCase = annualCost
    ? `${annualCost} — illustrative category model, not a verified cost at ${row.company_name}.`
    : 'Not quantified yet. Discovery must validate volume × frequency × time, error, delay or risk × rate before ROI is used.';
  const observed = sections.observed || json?.defensible_problem || labels['why this company'] || '';
  const title = model?.title || ideaTitle || 'Specific software problem to validate';
  const asText = [
    `Problem: ${currentProblem}`,
    `Economic case: ${economicCase}`,
    model?.cost_basis ? `Cost basis: ${model.cost_basis}` : '',
    savings ? `Potential measured upside: ${savings}` : '',
    `What GnK would build: ${build || 'A bounded software output will be defined after the workflow is validated.'}`,
    fee ? `Commercial entry: ${fee}` : '',
    observed ? `Evidence / fit: ${observed}` : '',
  ].filter(Boolean).join('\n');
  return {
    title,
    problem: currentProblem,
    economic_case: economicCase,
    cost_basis: model?.cost_basis || '',
    potential_savings: savings,
    what_we_build: build,
    solution_label: 'What GnK would build',
    commercial_entry: fee,
    observed,
    hypothesis: sections.hypothesis || '',
    as_text: asText,
  };
}

function sequenceReadiness(row, messages) {
  // A Wapahki routing contact is complete at one touch; everyone else keeps the
  // full campaign length. Deriving the plan from the contact's title keeps the
  // CRM from marking a routing email as perpetually incomplete.
  const contact = {
    first_name: row.first_name || String(row.name || '').split(/\s+/)[0],
    title: row.title,
  };
  const plan = sequencePlanForContact(row.campaign, contact);
  const expectedCount = plan.length;
  const touchIds = new Set((messages || []).map((message) => Number(message.touch)));
  const sequencePresent = Array.isArray(messages)
    && messages.length === expectedCount
    && plan.every(({ touch }) => touchIds.has(touch));
  if (!sequencePresent) {
    return {
      expected_touch_count: expectedCount,
      sequence_present: false,
      sequence_complete: false,
      sequence_errors: [`expected ${expectedCount} touches, got ${messages.length}`],
      brief_errors: [],
    };
  }
  const brief = safeJson(row.sales_brief, null);
  const sequenceErrors = validateSequence({
    contact,
    campaign: row.campaign,
    touches: messages,
  });
  const briefErrors = validateSpokenBrief(brief, row.campaign, contact);
  return {
    expected_touch_count: expectedCount,
    sequence_present: true,
    sequence_complete: !sequenceErrors.length && !briefErrors.length,
    sequence_errors: sequenceErrors,
    brief_errors: briefErrors,
  };
}

function readySequenceCount(campaigns) {
  const rows = db.prepare(`
    SELECT p.id AS person_id, p.name, p.first_name, p.title, p.sales_brief, c.campaign,
           s.touch, s.day, s.channel, s.subject, s.body, s.status
    FROM people p
    JOIN companies c ON c.id=p.company_id
    JOIN sequences s ON s.person_id=p.id
    WHERE c.archived_at IS NULL
      AND COALESCE(p.lifecycle_status, 'active') != 'archived'
      AND COALESCE(c.campaign, c.product, '') IN (${placeholders(campaigns.length)})
    ORDER BY p.id, s.touch
  `).all(...campaigns);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.person_id)) grouped.set(row.person_id, { row, messages: [] });
    grouped.get(row.person_id).messages.push(row);
  }
  return [...grouped.values()].filter(({ row, messages }) => (
    sequenceReadiness(row, messages).sequence_complete
  )).length;
}

// Per-business headline counts + the shared "what's working" signal the three
// books learn from each other with: how many messages are drafted vs. sent, and
// how many contacts have replied.
export function crmBusinesses() {
  return BUSINESSES.map((b) => {
    const ph = placeholders(b.campaigns.length);
    const accounts = db.prepare(
      `SELECT COUNT(*) n FROM companies WHERE archived_at IS NULL AND COALESCE(campaign, product) IN (${ph})`,
    ).get(...b.campaigns).n;
    const people = db.prepare(
      `SELECT COUNT(*) n FROM people p JOIN companies c ON c.id = p.company_id
       WHERE c.archived_at IS NULL
         AND COALESCE(p.lifecycle_status, 'active') != 'archived'
         AND COALESCE(c.campaign, c.product) IN (${ph})`,
    ).get(...b.campaigns).n;
    const msg = db.prepare(
      `SELECT COUNT(*) total, SUM(status='sent') sent
       FROM sequences WHERE campaign IN (${ph})`,
    ).get(...b.campaigns);
    const replied = db.prepare(
      `SELECT COUNT(*) n FROM people p JOIN companies c ON c.id = p.company_id
       WHERE c.archived_at IS NULL
         AND COALESCE(p.lifecycle_status, 'active') != 'archived'
         AND p.replied_at IS NOT NULL
         AND COALESCE(c.campaign, c.product) IN (${ph})`,
    ).get(...b.campaigns).n;
    const complete = readySequenceCount(b.campaigns);
    return {
      key: b.key,
      label: b.label,
      full: b.full,
      tagline: b.tagline,
      accounts,
      contacts: people,
      messages: msg.total || 0,
      sent: msg.sent || 0,
      replied,
      complete_sequences: complete,
      incomplete_contacts: Math.max(0, people - complete),
      sequence_size: sequenceLengthForCampaign(b.key),
    };
  });
}

function calendarBoundary(value, fallback) {
  const parsed = value ? new Date(value) : fallback;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Error('invalid calendar date range');
  return parsed;
}

function validRecipientEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

// Calendar projection over the canonical sequence rows. This deliberately does
// not create a second schedule store: a future sender can claim approved rows
// from sequences using the same scheduled_for timestamp and status fields that
// drive this view. Until that worker exists, draft/approved/sent remain honest,
// visible operating states and safety blockers are derived here in one place.
export function crmCalendar({
  start, end, search = '', limit = 20_000,
} = {}) {
  const now = new Date();
  const from = calendarBoundary(start, new Date(now.getTime() - (7 * 86_400_000)));
  const to = calendarBoundary(end, new Date(from.getTime() + (42 * 86_400_000)));
  if (to <= from) throw new Error('calendar end must be after start');
  if (to.getTime() - from.getTime() > 93 * 86_400_000) {
    throw new Error('calendar range cannot exceed 93 days');
  }

  const calendarBusinesses = BUSINESSES.filter((business) => business.calendar !== false);
  const campaigns = calendarBusinesses.flatMap((business) => business.campaigns);
  const where = [
    "s.channel = 'email'",
    "COALESCE(s.scheduled_for, '') != ''",
    's.scheduled_for >= ?',
    's.scheduled_for < ?',
    'c.archived_at IS NULL',
    `COALESCE(c.campaign, c.product, '') IN (${placeholders(campaigns.length)})`,
  ];
  const params = [from.toISOString(), to.toISOString(), ...campaigns];
  if (search) {
    where.push('(c.name LIKE ? OR p.name LIKE ? OR p.title LIKE ? OR p.email LIKE ? OR s.subject LIKE ?)');
    const needle = `%${search}%`;
    params.push(needle, needle, needle, needle, needle);
  }
  const requestedLimit = Math.min(Math.max(Number(limit) || 20_000, 1), 50_000);
  const rows = db.prepare(`
    SELECT s.id, s.person_id, s.campaign, s.touch, s.day, s.subject,
           s.status, s.scheduled_for, s.suggested_for, s.suggested_local,
           p.name recipient_name, p.title recipient_title, p.email recipient_email,
           p.replied_at, p.lifecycle_status,
           c.id company_id, c.name company_name, c.campaign account_campaign,
           c.product account_product
    FROM sequences s
    JOIN people p ON p.id=s.person_id
    JOIN companies c ON c.id=p.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.scheduled_for, c.name COLLATE NOCASE, p.name COLLATE NOCASE, s.touch
    LIMIT ?
  `).all(...params, requestedLimit);

  const events = rows.map((row) => {
    const blockers = [];
    if (!validRecipientEmail(row.recipient_email)) blockers.push('Recipient email is missing or invalid');
    if (row.replied_at) blockers.push('Contact has already replied');
    if (!['active', ''].includes(String(row.lifecycle_status || 'active'))) {
      blockers.push(`Contact lifecycle is ${row.lifecycle_status}`);
    }
    const rawStatus = String(row.status || 'draft').toLowerCase();
    const deliveryStatus = rawStatus === 'sent'
      ? 'sent'
      : blockers.length ? 'blocked'
        : rawStatus === 'approved' ? 'approved'
          : 'draft';
    return {
      id: row.id,
      person_id: row.person_id,
      company_id: row.company_id,
      business: businessForCampaign(row.account_campaign || row.account_product || row.campaign),
      campaign: row.campaign,
      company_name: row.company_name,
      recipient_name: row.recipient_name,
      recipient_title: row.recipient_title,
      recipient_email: row.recipient_email,
      touch: row.touch,
      day: row.day,
      channel: 'email',
      subject: row.subject,
      status: rawStatus,
      delivery_status: deliveryStatus,
      blockers,
      scheduled_for: row.scheduled_for,
      suggested_for: row.suggested_for,
      suggested_local: row.suggested_local,
    };
  });

  const summary = {
    total: events.length,
    draft: events.filter((event) => event.delivery_status === 'draft').length,
    approved: events.filter((event) => event.delivery_status === 'approved').length,
    sent: events.filter((event) => event.delivery_status === 'sent').length,
    blocked: events.filter((event) => event.delivery_status === 'blocked').length,
    by_business: Object.fromEntries(calendarBusinesses.map((business) => [
      business.key,
      events.filter((event) => event.business === business.key).length,
    ])),
  };
  const unscheduled = db.prepare(`
    SELECT COUNT(*) n
    FROM sequences s
    JOIN people p ON p.id=s.person_id
    JOIN companies c ON c.id=p.company_id
    WHERE s.channel='email' AND COALESCE(s.scheduled_for, '')=''
      AND s.status != 'sent' AND c.archived_at IS NULL
      AND COALESCE(c.campaign, c.product, '') IN (${placeholders(campaigns.length)})
  `).get(...campaigns).n;
  summary.unscheduled = unscheduled || 0;

  return {
    range: { start: from.toISOString(), end: to.toISOString() },
    events,
    summary,
    automation: {
      mode: 'manual',
      sender_connected: false,
      source_of_truth: 'sequences.scheduled_for',
      sendable_status: 'approved',
      daily_cap_per_business: EMAIL_DAILY_CAP,
      schedule_policy: SCHEDULE_POLICY_VERSION,
      sender_timezones: BUSINESS_SEND_TIMEZONES,
      weekend_policy: WEEKEND_SCHEDULE_POLICY,
      contract_version: 2,
    },
  };
}

// The flat contact grid for one business (or all). Each row is a contact with
// their company context and the full message sequence the agents wrote, so the
// UI can show the next message inline and expand to the whole cadence.
export function crmRows({
  business, search = '', status = '', limit = 2500,
} = {}) {
  const requestedLimit = Math.min(Math.max(Number(limit) || 2500, 1), 100_000);
  const biz = BUSINESSES.find((b) => b.key === business) || null;
  const campaigns = biz ? biz.campaigns : BUSINESSES.flatMap((b) => b.campaigns);
  const where = [
    'c.archived_at IS NULL',
    "COALESCE(p.lifecycle_status, 'active') != 'archived'",
    `COALESCE(c.campaign, c.product, '') IN (${placeholders(campaigns.length)})`,
  ];
  const params = [...campaigns];
  if (search) {
    where.push('(c.name LIKE ? OR p.name LIKE ? OR p.title LIKE ? OR p.email LIKE ? OR c.industry LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }
  const rows = db.prepare(`
    SELECT p.id person_id, p.name, p.first_name, p.title, p.email, p.email_status, p.linkedin_url,
           p.relevance_score, p.relevance_reason, p.status, p.role_type,
           p.contacted_at, p.replied_at, p.sales_brief,
           (SELECT MAX(person_sequence.created_at)
              FROM sequences person_sequence
             WHERE person_sequence.person_id = p.id) sequence_created_at,
           (SELECT MAX(company_sequence.created_at)
              FROM sequences company_sequence
              JOIN people sequence_person ON sequence_person.id = company_sequence.person_id
             WHERE sequence_person.company_id = c.id) company_sequence_created_at,
           c.id company_id, c.name company_name, c.industry, c.city, c.location,
           c.campaign, c.product, c.hypothesis, c.lead_score, c.stage, c.website,
           c.notes company_notes,
           pu.id pursuit_id, pu.pursuit_type, pu.status pursuit_status,
           pu.approval_status pursuit_approval_status, pu.problem pursuit_problem,
           pu.hypothesis_key, pu.observed_fact, pu.workflow_owner, pu.records,
           pu.kill_condition, pu.workflow_scorecard, pu.qualification,
           pu.evidence pursuit_evidence, pu.consequence pursuit_consequence,
           pu.cost_model pursuit_cost_model, pu.cost_confidence pursuit_cost_confidence,
           pu.offer pursuit_offer, pu.narrative pursuit_narrative,
           pu.desired_commitment, pu.commercial_path pursuit_commercial_path,
           pu.value_to_partner, pu.next_goal,
           pu.primary_person_id, pc.role pursuit_role, pc.state pursuit_contact_state
    FROM people p JOIN companies c ON c.id = p.company_id
    LEFT JOIN pursuits pu ON pu.company_id = c.id
    LEFT JOIN pursuit_contacts pc ON pc.pursuit_id = pu.id AND pc.person_id = p.id
    WHERE ${where.join(' AND ')}
    ORDER BY (company_sequence_created_at IS NULL), company_sequence_created_at DESC,
             sequence_created_at DESC, (c.lead_score IS NULL), c.lead_score DESC,
             c.name COLLATE NOCASE, p.id
    LIMIT ?
  `).all(...params, status ? 100_000 : requestedLimit);

  const seqByPerson = sequencesFor(rows.map((r) => r.person_id));
  const hasProblemCatalog = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='problems'",
  ).get();
  const problemCatalog = hasProblemCatalog ? db.prepare(`
      SELECT title, workflow_today, proposed_solution, annual_cost_low, annual_cost_high,
             cost_basis, savings_low, savings_high, our_cut_low, our_cut_high
      FROM problems
    `).all() : [];
  const problemByTitle = new Map(problemCatalog.map((problem) => [problem.title, problem]));

  const enriched = rows.map((r) => {
    const storedMessages = seqByPerson[r.person_id] || [];
    const fallbackTiming = new Map(buildSequenceSchedule({
      campaign: r.campaign,
      title: r.title,
      industry: r.industry,
      city: r.city,
      location: r.location,
      touches: storedMessages,
    }).map((timing) => [Number(timing.touch), timing]));
    // Writers that were already running when the scheduling columns were added
    // can still insert a legacy row. Fill only its missing presentation fields;
    // the next DB startup will persist the same deterministic backfill.
    const messages = storedMessages.map((message) => {
      const fallback = fallbackTiming.get(Number(message.touch)) || {};
      return {
        ...message,
        send_window: message.send_window || fallback.send_window || '',
        timing_reason: message.timing_reason || fallback.timing_reason || '',
        scheduled_for: message.scheduled_for || fallback.scheduled_for || '',
        scheduled_local: message.scheduled_local || fallback.scheduled_local || '',
        send_timezone: message.send_timezone || fallback.send_timezone || '',
      };
    });
    const sent = messages.filter((m) => m.status === 'sent').length;
    const nextTouch = messages.find((m) => m.status !== 'sent') || null;
    const readiness = sequenceReadiness(r, messages);
    const commercial = commercialProblem(r, problemByTitle);
    const { company_notes, ...publicRow } = r;
    return {
      ...publicRow,
      sales_brief: safeJson(r.sales_brief, null),
      business: businessForCampaign(r.campaign) || business || null,
      commercial_problem: commercial,
      messages,
      msg_count: messages.length,
      sent_count: sent,
      next_touch: nextTouch,
      ...readiness,
    };
  });

  let filtered = enriched;
  if (status === 'ready') filtered = enriched.filter((r) => r.next_touch);
  if (status === 'sent') filtered = enriched.filter((r) => r.msg_count > 0 && r.sent_count === r.msg_count);
  if (status === 'draft') filtered = enriched.filter((r) => r.msg_count > 0 && r.sent_count < r.msg_count);
  if (status === 'complete') filtered = enriched.filter((r) => r.sequence_complete);
  if (status === 'incomplete') filtered = enriched.filter((r) => !r.sequence_complete);
  if (status === 'no_messages') filtered = enriched.filter((r) => r.msg_count === 0);
  if (status === 'replied') filtered = enriched.filter((r) => r.replied_at);
  return filtered.slice(0, requestedLimit);
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return `"${text.replace(/"/g, '""')}"`;
}

function touchLabelsForBusiness(business) {
  if (!business) {
    return [
      'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7',
    ];
  }
  return sequencePlanForCampaign(business).map(({ touch, day, channel }, index, plan) => {
    const channelLabel = channel === 'linkedin'
      ? (touch === 3 ? 'LinkedIn connect' : 'LinkedIn message')
      : (index === plan.length - 1 ? 'closing email' : 'email');
    return `T${touch} · day ${day} · ${channelLabel}`;
  });
}

// Portable spreadsheet export: one contact per row with the campaign's full
// send-ready sequence across. Excel and Google Sheets both preserve subjects,
// paragraph breaks, and LinkedIn copy inside quoted CSV cells.
export function buildCrmCsv({ business = '', search = '', status = '' } = {}) {
  const rows = crmRows({ business, search, status, limit: 100_000 });
  const touchLabels = touchLabelsForBusiness(business);
  const headers = [
    'Business', 'Company', 'Website', 'Problem / hypothesis', 'Person', 'Title',
    'Email', 'LinkedIn', "Why they'd reply", 'Contact status', 'Sequence',
    'Sent touches', 'Research sources', ...touchLabels,
  ];
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    const messages = new Map(row.messages.map((message) => [Number(message.touch), message]));
    const sources = (row.sales_brief?.research_used || [])
      .map((source) => `${source.fact || ''}${source.source_url ? `\n${source.source_url}` : ''}`.trim())
      .filter(Boolean)
      .join('\n\n');
    const touchCells = touchLabels.map((_, index) => {
      const message = messages.get(index + 1);
      if (!message) return '';
      return [
        message.scheduled_local ? `Capacity-adjusted send: ${message.scheduled_local}` : '',
        message.suggested_local ? `Original suggested send: ${message.suggested_local}` : '',
        message.suggested_window || message.send_window ? `Suggested window: ${message.suggested_window || message.send_window}` : '',
        message.suggested_reason || message.timing_reason ? `Why this time: ${message.suggested_reason || message.timing_reason}` : '',
        message.subject ? `Subject: ${message.subject}` : '',
        message.body || '',
      ]
        .filter(Boolean)
        .join('\n\n');
    });
    lines.push([
      row.business || '', row.company_name, row.website || '',
      row.commercial_problem?.as_text || row.pursuit_problem || row.hypothesis || '', row.name, row.title || '',
      row.email || '', row.linkedin_url || '', row.relevance_reason || '', row.status || '',
      row.sequence_complete
        ? `${row.expected_touch_count}/${row.expected_touch_count} reviewed`
        : row.sequence_present
          ? `${row.expected_touch_count}/${row.expected_touch_count} needs rewrite`
          : `${row.msg_count}/${row.expected_touch_count} incomplete`,
      row.sent_count, sources, ...touchCells,
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// The old Dealroom stored one mostly-empty pursuit shell per account behind a
// separate click-through UI. This query turns that same strategy data into a
// flat account sheet and places live CRM activity beside it. It deliberately
// does not create a second message store: the action for a deal routes back to
// the contact/message rows returned by crmRows above.
export function crmDealRows({
  business, search = '', status = '', limit = 1000,
} = {}) {
  const biz = BUSINESSES.find((item) => item.key === business) || null;
  const campaigns = biz ? biz.campaigns : BUSINESSES.flatMap((item) => item.campaigns);
  const where = [
    'c.archived_at IS NULL',
    `COALESCE(c.campaign, c.product, '') IN (${placeholders(campaigns.length)})`,
  ];
  const params = [...campaigns];
  if (search) {
    where.push(`(
      c.name LIKE ? OR c.industry LIKE ? OR pu.observed_fact LIKE ? OR pu.problem LIKE ? OR
      pu.desired_commitment LIKE ? OR primary_person.name LIKE ?
    )`);
    const needle = `%${search}%`;
    params.push(needle, needle, needle, needle, needle, needle);
  }

  const rows = db.prepare(`
    WITH activity AS (
      SELECT p.company_id,
             COUNT(DISTINCT p.id) contact_count,
             COUNT(DISTINCT CASE WHEN p.email LIKE '%@%' THEN p.id END) emailable_count,
             COUNT(DISTINCT CASE WHEN p.replied_at IS NOT NULL THEN p.id END) replied_count,
             COUNT(DISTINCT s.id) message_count,
             COUNT(DISTINCT CASE WHEN s.status='sent' THEN s.id END) sent_count
      FROM people p
      LEFT JOIN sequences s ON s.person_id=p.id
      WHERE COALESCE(p.lifecycle_status, 'active') != 'archived'
      GROUP BY p.company_id
    )
    SELECT pu.id pursuit_id, c.id company_id, pu.product, pu.pursuit_type,
           pu.status pursuit_status, pu.phase, pu.hypothesis_key, pu.observed_fact,
           pu.problem, pu.workflow_owner, pu.consequence, pu.records,
           pu.offer, pu.kill_condition, pu.workflow_scorecard, pu.qualification,
           pu.narrative, pu.desired_commitment, pu.value_to_partner,
           pu.value_to_us, pu.decision_process, pu.commercial_path,
           pu.next_goal, pu.approval_status, pu.primary_person_id,
           c.name company_name, c.campaign, c.industry, c.city, c.location,
           c.website, c.hypothesis, c.lead_score,
           primary_person.name primary_name, primary_person.title primary_title,
           primary_person.email primary_email,
           suggested.id suggested_person_id, suggested.name suggested_name,
           suggested.title suggested_title,
           next_step.label next_step_label, next_step.narrative_job next_step_job,
           COALESCE(a.contact_count, 0) contact_count,
           COALESCE(a.emailable_count, 0) emailable_count,
           COALESCE(a.replied_count, 0) replied_count,
           COALESCE(a.message_count, 0) message_count,
           COALESCE(a.sent_count, 0) sent_count
    FROM companies c
    LEFT JOIN pursuits pu ON pu.company_id=c.id
    LEFT JOIN people primary_person ON primary_person.id=pu.primary_person_id
    LEFT JOIN people suggested ON suggested.id=COALESCE(
      pu.primary_person_id,
      (
        SELECT candidate.id FROM people candidate
        WHERE candidate.company_id=c.id
          AND COALESCE(candidate.lifecycle_status, 'active') != 'archived'
        ORDER BY CASE WHEN candidate.email LIKE '%@%' THEN 0 ELSE 1 END,
                 (candidate.relevance_score IS NULL), candidate.relevance_score DESC,
                 candidate.id
        LIMIT 1
      )
    )
    LEFT JOIN pursuit_steps next_step ON next_step.id=(
      SELECT step.id FROM pursuit_steps step
      WHERE step.pursuit_id=pu.id
        AND step.status NOT IN ('sent','complete','skipped')
      ORDER BY step.step_order LIMIT 1
    )
    LEFT JOIN activity a ON a.company_id=c.id
    WHERE ${where.join(' AND ')}
    ORDER BY (c.lead_score IS NULL), c.lead_score DESC, c.name COLLATE NOCASE
    LIMIT ?
  `).all(...params, Math.min(Math.max(Number(limit) || 1000, 1), 2500));

  const ids = rows.map((row) => row.company_id);
  const peopleByCompany = {};
  for (let index = 0; index < ids.length; index += 400) {
    const chunk = ids.slice(index, index + 400);
    if (!chunk.length) continue;
    const people = db.prepare(`
      SELECT id, company_id, name, title, email, relevance_score
      FROM people
      WHERE company_id IN (${placeholders(chunk.length)})
        AND COALESCE(lifecycle_status, 'active') != 'archived'
      ORDER BY company_id, CASE WHEN email LIKE '%@%' THEN 0 ELSE 1 END,
               (relevance_score IS NULL), relevance_score DESC, id
    `).all(...chunk);
    for (const person of people) (peopleByCompany[person.company_id] ||= []).push(person);
  }

  const enriched = rows.map((row) => ({
    ...row,
    workflow_scorecard: safeJson(row.workflow_scorecard, {}),
    qualification: safeJson(row.qualification, {}),
    business: businessForCampaign(row.campaign) || business || null,
    problem: row.problem || row.hypothesis || '',
    contacts: peopleByCompany[row.company_id] || [],
    has_context: Boolean(
      (row.problem || row.hypothesis)
      && row.desired_commitment
      && row.primary_person_id
    ),
  }));

  if (status === 'needs_context') return enriched.filter((row) => !row.has_context);
  if (status === 'needs_review') return enriched.filter((row) => row.approval_status === 'needs_review');
  if (status === 'approved') return enriched.filter((row) => row.approval_status === 'approved');
  if (status === 'active') return enriched.filter((row) => ['ready', 'active'].includes(row.pursuit_status));
  return enriched;
}

function sequencesFor(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    if (!chunk.length) continue;
    const rows = db.prepare(
      `SELECT id, person_id, touch, day, channel, subject, body,
              send_window, timing_reason, scheduled_for, scheduled_local, send_timezone,
              suggested_window, suggested_reason, suggested_for, suggested_local,
              suggested_timezone, schedule_policy, schedule_reason, status
       FROM sequences WHERE person_id IN (${placeholders(chunk.length)})
       ORDER BY person_id, touch`,
    ).all(...chunk);
    for (const s of rows) (out[s.person_id] ||= []).push(s);
  }
  return out;
}

// Direct, single-message edit + send-logging. This is the operator working one
// message by hand, so it writes straight to the row (no bulk-writer quarantine)
// and records a touchpoint when a message is marked sent.
export function editSequence(id, { subject, body, status } = {}) {
  const current = db.prepare('SELECT * FROM sequences WHERE id = ?').get(id);
  if (!current) throw new Error('message not found');
  if (current.status === 'sent') {
    const changesSubject = subject !== undefined && subject !== current.subject;
    const changesBody = body !== undefined && body !== current.body;
    const changesStatus = status !== undefined && status !== 'sent';
    if (changesSubject || changesBody || changesStatus) {
      throw new Error('Sent messages are immutable. Add a new follow-up instead of changing history.');
    }
    return current;
  }
  const sets = [];
  const vals = [];
  if (subject !== undefined) { sets.push('subject = ?'); vals.push(subject); }
  if (body !== undefined) { sets.push('body = ?'); vals.push(body); }
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (sets.length) {
    vals.push(id);
    db.prepare(`UPDATE sequences SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  if (status === 'sent' && current.status !== 'sent') logSend(current);
  return db.prepare('SELECT * FROM sequences WHERE id = ?').get(id);
}

function logSend(seq) {
  const person = db.prepare('SELECT company_id FROM people WHERE id = ?').get(seq.person_id);
  if (!person) return;
  db.prepare(`
    INSERT INTO touchpoints (company_id, person_id, product, channel, direction, outcome, summary)
    VALUES (?, ?, ?, ?, 'outbound', 'sent', ?)
  `).run(
    person.company_id,
    seq.person_id,
    businessForCampaign(seq.campaign),
    seq.channel || 'email',
    `Touch ${seq.touch}${seq.subject ? ` · ${seq.subject}` : ''}`,
  );
  db.prepare("UPDATE people SET status='emailed', contacted_at=COALESCE(contacted_at, datetime('now')) WHERE id=?")
    .run(seq.person_id);
}
