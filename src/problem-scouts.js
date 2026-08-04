// Shared research roles for the GnK and OutageHub opportunity pipelines.
//
// The existing broad ideator starts from a market/workflow and imagines a
// problem. The other roles start from a public company signal and work
// backwards: what did a named company actually say, spend, hire for, or try to
// fix? Keeping the roles explicit makes it possible to reject "advertised pain"
// candidates that arrive without a direct, dated source.

export const PROBLEM_SCOUTS = Object.freeze([
  Object.freeze({
    id: 'broad-ideation',
    label: 'Broad Problem Ideator',
    searchPatternKey: null,
    requiresAdvertisedSignal: false,
    directive: `Start from expensive, recurring workflows and current market evidence.
You may ideate a problem that is not yet tied to a company admission. Return an
empty advertised_signals array unless a named company really did publish a
relevant signal.`,
  }),
  Object.freeze({
    id: 'company-admissions',
    label: 'Company Pain Admissions Scout',
    searchPatternKey: 'company_admissions',
    requiresAdvertisedSignal: true,
    directive: `Start with named companies publicly describing a costly problem,
missed target, delay, outage, write-down, service failure, manual bottleneck,
capacity constraint, customer-impacting issue, or material operational risk.
Prefer first-party annual reports, earnings material, investor presentations,
official newsroom posts, engineering postmortems, status reports, executive
talks, and company-authored case studies. A candidate is invalid without a
direct, dated source for what the company actually disclosed.`,
  }),
  Object.freeze({
    id: 'talent-bottlenecks',
    label: 'Workforce & Knowledge Bottleneck Scout',
    searchPatternKey: 'talent_bottlenecks',
    requiresAdvertisedSignal: true,
    directive: `Start with named employers publicly describing hard-to-fill
skills, ageing or concentrated institutional knowledge, repeated vacancies,
training or apprenticeship investment, dependency on scarce specialists, or a
workflow whose growth is capped by expert availability. A single ordinary job
posting proves demand, not a shortage. Look for repetition or an explicit
company statement. Translate the signal into workflow continuity, expert
decision support, knowledge capture, or automation of preparatory work—not a
generic recruiting product and never an inference about an individual's age.`,
  }),
  Object.freeze({
    id: 'buying-signals',
    label: 'Active Buying & Change Scout',
    searchPatternKey: 'buying_signals',
    requiresAdvertisedSignal: true,
    directive: `Start with named companies actively allocating effort or money
to a problem: an RFP/RFI, modernization program, remediation plan, vendor
search, relevant hiring cluster, transformation budget, implementation
partnership, or stated operational initiative. Identify the underlying
workflow and the measurable consequence. Buying activity is timing evidence,
not proof that our proposed solution is the right one.`,
  }),
]);

export const ADVERTISED_SIGNAL_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'company', 'statement', 'consequence', 'url', 'observed_at',
    'signal_type', 'relationship',
  ],
  properties: {
    company: { type: 'string' },
    statement: {
      type: 'string',
      description: 'A concise paraphrase of what the named company publicly disclosed.',
    },
    consequence: {
      type: 'string',
      description: 'The disclosed cost, delay, risk, capacity limit, or business effect; say "not quantified" when necessary.',
    },
    url: { type: 'string' },
    observed_at: {
      type: 'string',
      description: 'The date the source was published or observed, preferably YYYY-MM-DD.',
    },
    signal_type: {
      type: 'string',
      enum: [
        'operational-admission',
        'financial-impact',
        'incident-or-failure',
        'talent-shortage',
        'hiring-pattern',
        'active-buying',
        'strategic-priority',
        'ownership-transition',
      ],
    },
    relationship: {
      type: 'string',
      enum: [
        'target-admission',
        'market-validation',
        'buying-intent',
      ],
      description: 'Whether the source company has the problem, validates a wider market problem, or is visibly trying to buy/change something.',
    },
  },
});

const DEFAULT_ROTATION = Object.freeze([
  'company-admissions',
  'broad-ideation',
  'talent-bottlenecks',
  'buying-signals',
  'company-admissions',
  'broad-ideation',
]);

// Allocate the requested total across roles without multiplying the downstream
// enrichment bill. At the dashboard default of six this yields 2 admissions,
// 2 broad ideas, 1 talent bottleneck, and 1 buying signal.
export function allocateScoutCounts(total, scouts = PROBLEM_SCOUTS, requestedRotation = DEFAULT_ROTATION) {
  const wanted = Math.max(1, Math.floor(Number(total) || 1));
  const byId = new Map(scouts.map((scout) => [scout.id, scout]));
  const counts = new Map(scouts.map((scout) => [scout.id, 0]));
  const rotation = requestedRotation.filter((id) => byId.has(id));
  const fallback = scouts.map((scout) => scout.id);
  const sequence = rotation.length ? rotation : fallback;

  for (let index = 0; index < wanted; index += 1) {
    const id = sequence[index % sequence.length];
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  return scouts
    .filter((scout) => (counts.get(scout.id) || 0) > 0)
    .map((scout) => ({ scout, count: counts.get(scout.id) }));
}

export function isSourcedAdvertisedSignal(signal) {
  if (!signal || typeof signal !== 'object') return false;
  if (!String(signal.company || '').trim()) return false;
  if (!String(signal.statement || '').trim()) return false;
  if (!String(signal.observed_at || '').trim()) return false;
  try {
    const parsed = new URL(String(signal.url || ''));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function acceptScoutCandidate(candidate, scout) {
  if (!scout?.requiresAdvertisedSignal) return true;
  return Array.isArray(candidate?.advertised_signals)
    && candidate.advertised_signals.some(isSourcedAdvertisedSignal);
}

export function summarizeScoutAllocations(allocations) {
  return allocations
    .map(({ scout, count }) => `${scout.label}: ${count}`)
    .join(' · ');
}
