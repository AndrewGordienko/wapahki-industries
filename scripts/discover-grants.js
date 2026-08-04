// Current grant discovery for OutageHub and Wapahki Industries.
//
// The pipeline deliberately separates broad recall from strict verification:
//
//   1) SWEEP — search across federal, Ontario/Toronto, sector, talent, export,
//      procurement, tax-credit and accelerator tracks for named programs.
//   2) VERIFY + SCORE — open official pages, test one applicant against the
//      actual rules, capture deadlines/amounts/gaps, find a published program
//      contact and draft a narrow eligibility email.
//
// Nothing is submitted or sent. Results go to crm.db and data/grants.json.
//
//   npm run grants:discover -- --count 16
//   npm run grants:discover -- --venture outagehub --track grid-climate
//   npm run grants:discover -- --refresh --count 20
//   npm run grants:discover -- --dry-run
import {
  readFileSync, writeFileSync, renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex } from '../src/codex.js';
import {
  existingGrants, grantSlug, listGrants, upsertGrant, upsertGrantContact,
} from '../src/grants.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(root, 'data', 'grant-applicants.json');
const MIRROR_PATH = join(root, 'data', 'grants.json');
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const profiles = new Map(config.applicants.map((profile) => [profile.id, profile]));

const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback;
}

const COUNT = Math.min(Math.max(Number(flag('count', 16)) || 16, 1), 60);
const CONCURRENCY = Math.min(Math.max(Number(flag('concurrency', 3)) || 3, 1), 6);
const VENTURE = flag('venture', 'both');
const TRACK = flag('track', '');
const REFRESH = args.includes('--refresh');
const DRY_RUN = args.includes('--dry-run');
const MODEL = process.env.GRANT_MODEL || process.env.CODEX_MODEL || 'gpt-5.6-sol';
const REASONING = process.env.GRANT_REASONING || 'medium';
const CALL_TIMEOUT_MS = Number(process.env.GRANT_TIMEOUT_MS) || 480_000;
const RUN_ID = flag('run-id', `grants-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const TODAY = new Date().toISOString().slice(0, 10);

if (!['both', ...profiles.keys()].includes(VENTURE)) {
  throw new Error(`--venture must be both, ${[...profiles.keys()].join(', ')}`);
}

const log = (message) => console.log(`[grants] ${message}`);
const str = { type: 'string' };
const nstr = { type: ['string', 'null'] };
const nint = { type: ['integer', 'null'] };

const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'applicant', 'program_name', 'funder', 'stream', 'funding_type',
          'possible_official_url', 'discovery_reason',
        ],
        properties: {
          applicant: { type: 'string', enum: [...profiles.keys()] },
          program_name: str,
          funder: str,
          stream: str,
          funding_type: str,
          possible_official_url: str,
          discovery_reason: str,
        },
      },
    },
  },
};

const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'url', 'source_type', 'supports'],
  properties: {
    title: str,
    url: str,
    source_type: { type: 'string', enum: ['official', 'secondary'] },
    supports: str,
  },
};

const contactSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'organization', 'contact_name', 'contact_title', 'contact_email',
    'contact_phone', 'contact_url', 'email_confidence', 'why_contact',
    'email_subject', 'email_body',
  ],
  properties: {
    organization: str,
    contact_name: nstr,
    contact_title: str,
    contact_email: nstr,
    contact_phone: nstr,
    contact_url: str,
    email_confidence: { type: 'string', enum: ['published', 'not_found'] },
    why_contact: str,
    email_subject: str,
    email_body: str,
  },
};

const enrichSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'program_name', 'funder', 'stream', 'jurisdiction', 'funding_type',
    'amount_min', 'amount_max', 'coverage_percent', 'stackable',
    'intake_status', 'deadline', 'deadline_note', 'recurring', 'official_url',
    'application_url', 'summary', 'eligible_applicants', 'eligible_costs',
    'project_fit', 'why_fit', 'eligibility_result', 'eligibility_reason',
    'eligibility_gaps', 'application_requirements', 'next_steps', 'score',
    'score_breakdown', 'confidence', 'sources', 'contacts',
  ],
  properties: {
    program_name: str,
    funder: str,
    stream: str,
    jurisdiction: str,
    funding_type: {
      type: 'string',
      enum: [
        'grant', 'non-repayable contribution', 'repayable contribution',
        'tax credit', 'wage subsidy', 'procurement challenge', 'prize',
        'accelerator', 'loan', 'other',
      ],
    },
    amount_min: nint,
    amount_max: nint,
    coverage_percent: nint,
    stackable: str,
    intake_status: {
      type: 'string',
      enum: ['open', 'rolling', 'upcoming', 'closed', 'unknown'],
    },
    deadline: nstr,
    deadline_note: str,
    recurring: { type: 'boolean' },
    official_url: str,
    application_url: nstr,
    summary: str,
    eligible_applicants: str,
    eligible_costs: str,
    project_fit: str,
    why_fit: str,
    eligibility_result: {
      type: 'string',
      enum: ['eligible', 'conditional', 'ineligible', 'unknown'],
    },
    eligibility_reason: str,
    eligibility_gaps: { type: 'array', items: str },
    application_requirements: { type: 'array', items: str },
    next_steps: { type: 'array', items: str },
    score: { type: 'integer', minimum: 0, maximum: 100 },
    score_breakdown: {
      type: 'array',
      minItems: 7,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['factor', 'points', 'of', 'note'],
        properties: {
          factor: str,
          points: { type: 'integer' },
          of: { type: 'integer' },
          note: str,
        },
      },
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    sources: { type: 'array', minItems: 1, items: sourceSchema },
    contacts: { type: 'array', minItems: 1, maxItems: 3, items: contactSchema },
  },
};

const SCORE_FACTORS = [
  ['Mandatory applicant and project eligibility', 25],
  ['Intake is accessible now or has a credible next date', 20],
  ['Fit with a concrete near-term project', 20],
  ['Funding value and eligible-cost coverage', 10],
  ['Readiness with known evidence and resources', 10],
  ['Strategic value beyond the cash', 10],
  ['Application effort and realistic odds', 5],
];

function selectedProfiles() {
  return VENTURE === 'both' ? [...profiles.values()] : [profiles.get(VENTURE)];
}

function selectedTracks() {
  const tracks = TRACK
    ? config.research_tracks.filter((track) => track.id === TRACK)
    : config.research_tracks;
  if (!tracks.length) {
    throw new Error(`Unknown --track ${TRACK}; use ${config.research_tracks.map((t) => t.id).join(', ')}`);
  }
  return tracks;
}

function buildWaves(tracks) {
  if (TRACK) return tracks.map((track) => ({ label: track.label, tracks: [track] }));
  const buckets = [
    ['Public programs', ['federal-rd', 'ontario-toronto']],
    ['Sector programs', ['grid-climate', 'robotics-manufacturing']],
    ['Capability programs', ['talent-academic', 'export-procurement']],
    ['Other non-dilutive routes', ['credits-finance', 'accelerators-prizes']],
  ];
  return buckets
    .map(([label, ids]) => ({
      label,
      tracks: tracks.filter((track) => ids.includes(track.id)),
    }))
    .filter((wave) => wave.tracks.length);
}

function profileBlock(profile) {
  return `APPLICANT: ${profile.display_name} (${profile.id})
Location: ${profile.location}
Stage: ${profile.stage}
What it is: ${profile.description}
Possible fundable projects:
${profile.candidate_projects.map((item) => `- ${item}`).join('\n')}
Known facts:
${profile.known_facts.map((item) => `- ${item}`).join('\n')}
Facts that are UNKNOWN and must not be assumed:
${profile.unknowns.map((item) => `- ${item}`).join('\n')}`;
}

function sweepPrompt(wave, target, known) {
  const queryBlock = wave.tracks.map((track) => (
    `${track.label}:\n${track.queries.map((query) => `- ${query}`).join('\n')}`
  )).join('\n\n');
  const knownBlock = known.length
    ? known.map((item) => `- ${item.applicant}: ${item.program_name}${item.stream ? ` — ${item.stream}` : ''} (${item.official_url})`).join('\n')
    : '- none';
  return `You are a Canadian innovation-funding scout. Today is ${TODAY}.

Find up to ${target} DISTINCT, NAMED funding programs in this research wave:
${wave.label}

Search prompts to expand (do real web search; do not merely repeat the examples):
${queryBlock}

Applicants:
${selectedProfiles().map(profileBlock).join('\n\n')}

Already in the grant board; do not return the same program × applicant × stream:
${knownBlock}

High-recall rules:
- Search current official federal, Ontario, Toronto and program-administrator pages, plus credible ecosystem pages when they lead to a named program.
- Include grants, non-repayable or repayable government contributions, tax credits, wage subsidies, procurement challenges, prizes and accelerators. Loans may be included only when clearly labeled "loan".
- A program may be returned once for each applicant only when there is a distinct plausible fit for both.
- Include a closed but recurring or announced-next-intake program only when it is genuinely worth watching; label the discovery reason accordingly.
- Do not return generic funding directories, ordinary VC/equity, consumer rebates, normal commercial loans, or a program that plainly fails geography/stage/sector.
- Never infer protected identity, Indigenous ownership, age, citizenship, incorporation, revenue, headcount, matching funds, partnerships or IP facts.
- possible_official_url must be the best program page you found, not a search-result URL.
- Balance results across the supplied applicants when evidence supports it. Fewer grounded programs are better than invented ones.

This is discovery only; the next agent will verify every rule and date. Return the structured object only.`;
}

function verifyPrompt(candidate, profile) {
  const scoreBlock = SCORE_FACTORS
    .map(([factor, points], index) => `${index + 1}. "${factor}" — of ${points}`)
    .join('\n');
  return `You are the verification and grant-strategy agent for ONE Canadian funding opportunity. Today is ${TODAY}.

Candidate:
${JSON.stringify(candidate, null, 2)}

Applicant ground truth:
${profileBlock(profile)}

Open and read the CURRENT official program, eligibility, application-guide, intake/deadline and contact pages. Use web search to find those official pages if the candidate URL moved.

Return an evidence-backed application brief:
- Preserve the exact current program and stream names.
- funding_type must accurately distinguish free money, repayable money, a tax credit, a wage subsidy, procurement, prize, accelerator or loan.
- Amounts are whole Canadian dollars. Use null when no reliable public amount exists. Never turn a project-cost ceiling into the funder's contribution.
- deadline must be YYYY-MM-DD only when an official source gives one; otherwise null. deadline_note explains rolling, upcoming, closed, expression-of-interest stages and time zone.
- intake_status is open, rolling, upcoming, closed or unknown AS OF ${TODAY}. Do not call an old page open.
- recurring means there is evidence of recurring intakes, not merely hope.
- official_url and application_url must go directly to official program pages.
- Test every mandatory rule against the facts above. Unknown applicant facts stay unknown. eligibility_result:
  * eligible: every mandatory rule is supported by known facts;
  * conditional: plausible, but one or more user-confirmable mandatory facts are unknown;
  * ineligible: an actual known fact fails a mandatory rule;
  * unknown: the program rules/current intake cannot be verified.
- eligibility_gaps must be a concrete checklist of unknowns or missing evidence. Do not use vague items like "confirm eligibility".
- project_fit names ONE bounded project the applicant could seek funding for without pretending work/results already exist.
- application_requirements captures the concrete documents, partner commitments, quotes, registrations, project timing and matching funds the official guide requires.
- next_steps is an ordered, practical list. Put deadline-critical actions first.
- Use exactly these seven scoring factors and maximums:
${scoreBlock}
  The score must equal the sum. Closed/ineligible opportunities should not score above 49. Conditional opportunities with a critical entity/ownership/funding gap should not score above 74.
- Sources: cite every official page used plus only essential secondary sources. At least one source must be official.

Contact research and email:
- Find 1–3 PUBLISHED program contacts or official advisory routes. Prefer a named program officer only when an official or reputable source actually identifies them.
- Never invent or pattern-guess an email. contact_email is non-null only when the exact address is published at contact_url; then email_confidence is published. Otherwise use null/not_found and provide the official contact page/form URL.
- Draft one short email per route. Its purpose is to resolve the most important eligibility gap, not to ask the program team to write the application.
- Mention ${profile.display_name}, Toronto, and one bounded proposed project. State early-stage facts honestly.
- Ask one or two precise questions based on the actual rules. 90–160 words, plain language, respectful, no hype, no "AI" unless the program itself requires the term.
- Subject: 2–6 lowercase words, no sales punctuation.
- Sign:

Thanks,
Andrew Gordienko
${profile.display_name}

Nothing is being submitted or sent. Return the structured object only.`;
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeDeadline(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeScore(breakdown = [], cap = 100) {
  const normalized = SCORE_FACTORS.map(([factor, of], index) => {
    const supplied = breakdown.find((item) => item.factor === factor) || breakdown[index] || {};
    const points = Math.min(Math.max(Number(supplied.points) || 0, 0), of);
    return {
      factor,
      points: Math.round(points),
      of,
      note: String(supplied.note || ''),
    };
  });
  let score = normalized.reduce((total, item) => total + item.points, 0);
  let excess = Math.max(score - cap, 0);
  for (let index = normalized.length - 1; index >= 0 && excess > 0; index--) {
    const deduction = Math.min(normalized[index].points, excess);
    normalized[index].points -= deduction;
    excess -= deduction;
  }
  score = normalized.reduce((total, item) => total + item.points, 0);
  return { score, breakdown: normalized };
}

function initialStatus(item, score) {
  if (item.intake_status === 'closed') return 'closed';
  if (item.eligibility_result === 'ineligible') return 'not_eligible';
  if (item.intake_status === 'upcoming') return 'watching';
  if (item.eligibility_result === 'eligible' && score >= 65) return 'eligible';
  if (item.eligibility_result === 'conditional') return 'verify';
  return 'discovered';
}

function normalizeEmail(contact, profile) {
  let subject = String(contact.email_subject || '')
    .trim()
    .toLowerCase()
    .replace(/[!?]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');
  if (!subject) subject = 'program eligibility question';
  let body = String(contact.email_body || '').trim();
  const signature = `Thanks,\nAndrew Gordienko\n${profile.display_name}`;
  if (!body.endsWith(signature)) {
    body = body.replace(/\n+(thanks|best|regards),?[\s\S]*$/i, '').trim();
    body = `${body}\n\n${signature}`;
  }
  return { subject, body };
}

function mirror() {
  const temp = `${MIRROR_PATH}.tmp`;
  const data = {
    generated_at: new Date().toISOString(),
    applicants: config.applicants,
    grants: listGrants(),
  };
  writeFileSync(temp, JSON.stringify(data, null, 2));
  renameSync(temp, MIRROR_PATH);
  return data.grants.length;
}

function refreshCandidates() {
  return listGrants()
    .filter((grant) => VENTURE === 'both' || grant.applicant === VENTURE)
    .slice(0, COUNT)
    .map((grant) => ({
      applicant: grant.applicant,
      program_name: grant.program_name,
      funder: grant.funder,
      stream: grant.stream || '',
      funding_type: grant.funding_type || 'other',
      possible_official_url: grant.official_url,
      discovery_reason: `Refresh current rules, intake, deadline and contact data last verified ${grant.last_verified_at || 'unknown'}.`,
      existing_slug: grant.slug,
    }));
}

async function sweepCandidates(waves, known) {
  const perWave = Math.max(2, Math.ceil(COUNT / waves.length));
  const batches = await pool(waves, Math.min(2, waves.length), async (wave) => {
    log(`  sweeping ${wave.label}…`);
    try {
      const output = await runCodex({
        prompt: sweepPrompt(wave, perWave, known),
        schema: candidateSchema,
        model: MODEL,
        reasoning: REASONING,
        webSearch: true,
        timeoutMs: CALL_TIMEOUT_MS,
        cwd: root,
      });
      return Array.isArray(output.candidates) ? output.candidates : [];
    } catch (error) {
      log(`  ! ${wave.label}: ${error.message.split('\n')[0]}`);
      return [];
    }
  });
  const seen = new Set(known.map((item) => item.slug));
  const fresh = [];
  for (const batch of batches) {
    for (const candidate of batch) {
      if (!profiles.has(candidate.applicant)) continue;
      if (VENTURE !== 'both' && candidate.applicant !== VENTURE) continue;
      const slug = grantSlug(candidate.applicant, candidate.program_name, candidate.stream);
      if (seen.has(slug)) continue;
      seen.add(slug);
      fresh.push({ ...candidate, possible_official_url: normalizeUrl(candidate.possible_official_url) });
      if (fresh.length >= COUNT) return fresh;
    }
  }
  return fresh;
}

async function main() {
  const tracks = selectedTracks();
  const waves = buildWaves(tracks);
  const known = existingGrants();
  log(`${REFRESH ? 'refresh' : 'discovery'} run ${RUN_ID} · model ${MODEL}/${REASONING} · target ${COUNT} · concurrency ${CONCURRENCY}`);
  log(`applicants ${selectedProfiles().map((p) => p.display_name).join(' + ')} · tracks ${tracks.map((t) => t.id).join(', ')} · ${known.length} existing`);

  if (DRY_RUN) {
    for (const wave of waves) {
      log(`would sweep ${wave.label}: ${wave.tracks.map((track) => track.label).join(' + ')}`);
    }
    log(`would then verify up to ${COUNT} program × applicant opportunities, score them, source public contacts and draft eligibility emails.`);
    return;
  }

  let candidates;
  if (REFRESH) {
    candidates = refreshCandidates();
    log(`stage 1/2 — selected ${candidates.length} existing opportunities to re-verify.`);
  } else {
    log(`stage 1/2 — ${waves.length} parallel coverage sweeps with current web search…`);
    candidates = await sweepCandidates(waves, known);
    log(`found ${candidates.length} new program × applicant candidates after de-duplication.`);
  }
  if (!candidates.length) {
    mirror();
    log('nothing to verify.');
    return;
  }

  log(`stage 2/2 — verifying official rules, eligibility, deadlines and contacts…`);
  let completed = 0;
  let saved = 0;
  let contacts = 0;
  let failed = 0;
  await pool(candidates, CONCURRENCY, async (candidate) => {
    const profile = profiles.get(candidate.applicant);
    try {
      const output = await runCodex({
        prompt: verifyPrompt(candidate, profile),
        schema: enrichSchema,
        model: MODEL,
        reasoning: REASONING,
        webSearch: true,
        timeoutMs: CALL_TIMEOUT_MS,
        cwd: root,
      });
      const officialUrl = normalizeUrl(output.official_url);
      const officialSources = (output.sources || []).filter(
        (source) => source.source_type === 'official' && normalizeUrl(source.url),
      );
      if (!officialUrl || !officialSources.length) {
        throw new Error('verification returned no valid official program URL/source');
      }
      const scoreCap = output.intake_status === 'closed' || output.eligibility_result === 'ineligible'
        ? 49
        : 100;
      const { score, breakdown } = normalizeScore(output.score_breakdown, scoreCap);
      const status = initialStatus(output, score);
      const grant = upsertGrant({
        slug: candidate.existing_slug
          || grantSlug(candidate.applicant, output.program_name, output.stream),
        applicant: candidate.applicant,
        program_name: output.program_name,
        funder: output.funder,
        stream: output.stream || '',
        jurisdiction: output.jurisdiction,
        funding_type: output.funding_type,
        amount_min: output.amount_min,
        amount_max: output.amount_max,
        coverage_percent: output.coverage_percent,
        stackable: output.stackable,
        intake_status: output.intake_status,
        deadline: normalizeDeadline(output.deadline),
        deadline_note: output.deadline_note,
        recurring: output.recurring,
        official_url: officialUrl,
        application_url: normalizeUrl(output.application_url) || null,
        summary: output.summary,
        eligible_applicants: output.eligible_applicants,
        eligible_costs: output.eligible_costs,
        project_fit: output.project_fit,
        why_fit: output.why_fit,
        eligibility_result: output.eligibility_result,
        eligibility_reason: output.eligibility_reason,
        eligibility_gaps: output.eligibility_gaps,
        application_requirements: output.application_requirements,
        next_steps: output.next_steps,
        score,
        score_breakdown: breakdown,
        confidence: output.confidence,
        sources: output.sources.map((source) => ({
          ...source,
          url: normalizeUrl(source.url),
        })).filter((source) => source.url),
        status,
        last_verified_at: TODAY,
        run_id: RUN_ID,
      });
      saved++;

      for (const raw of output.contacts || []) {
        const contactUrl = normalizeUrl(raw.contact_url);
        const publishedEmail = raw.email_confidence === 'published'
          && raw.contact_email && contactUrl
          ? String(raw.contact_email).trim()
          : null;
        const email = normalizeEmail(raw, profile);
        upsertGrantContact({
          grant_id: grant.id,
          organization: raw.organization || output.funder,
          contact_name: raw.contact_name,
          contact_title: raw.contact_title,
          contact_email: publishedEmail,
          contact_phone: raw.contact_phone,
          contact_url: contactUrl || officialUrl,
          email_confidence: publishedEmail ? 'published' : 'not_found',
          why_contact: raw.why_contact,
          email_subject: email.subject,
          email_body: email.body,
          status: publishedEmail ? 'ready' : 'verify',
        });
        contacts++;
      }
      mirror();
      log(`  [${++completed}/${candidates.length}] ${profile.display_name} · ${output.program_name} → ${score}/100 · ${output.eligibility_result}/${output.intake_status}`);
    } catch (error) {
      failed++;
      log(`  ! [${++completed}/${candidates.length}] ${profile.display_name} · ${candidate.program_name}: ${error.message.split('\n')[0]}`);
    }
  });

  const total = mirror();
  log(`done. saved ${saved} opportunities and ${contacts} contact drafts; ${failed} failed; board now ${total}.`);
  if (!saved && failed) process.exitCode = 1;
}

main().catch((error) => {
  log(`fatal: ${error.message}`);
  process.exitCode = 1;
});
