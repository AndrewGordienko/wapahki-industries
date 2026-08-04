// Nightly sales research and adaptation cycle.
//
// Public-web research is written into draft-only pursuits and queued for human
// review. This script never approves copy and never sends outreach.
//
//   node scripts/sales-research-cycle.js --count 3
//   node scripts/sales-research-cycle.js --product outage --count 2
import { runCodex } from '../src/codex.js';
import { validateIllustrativeCostAnalysis } from '../src/cost-analysis.js';
import { createTask, db, salesLoopSummary } from '../src/db.js';
import { productsByPriority } from '../src/products.js';
import { DEFAULT_PURSUIT_STEPS } from '../src/pursuit-policy.js';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const count = Math.min(Math.max(Number(valueAfter('--count', '3')) || 3, 1), 8);
const wantedProduct = valueAfter('--product');
const model = process.env.SALES_RESEARCH_MODEL || 'gpt-5.6-terra';
const reasoning = process.env.SALES_RESEARCH_REASONING || 'medium';
const activeProducts = productsByPriority()
  .filter((product) => product.active && (!wantedProduct || product.id === wantedProduct));
if (!activeProducts.length) throw new Error('No active product matches this research cycle.');

const productIds = activeProducts.map((product) => product.id);
const candidates = db.prepare(`
  SELECT c.*,
         p.id AS pursuit_id,
         p.updated_at AS pursuit_updated_at,
         (SELECT COUNT(*) FROM people pe
          WHERE pe.company_id=c.id AND COALESCE(pe.lifecycle_status, 'active')='active') AS contact_count,
         (SELECT COUNT(*) FROM tasks t
          WHERE t.company_id=c.id AND t.status='todo' AND t.channel='research') AS open_research_tasks
  FROM companies c
  LEFT JOIN pursuits p ON p.company_id=c.id
  WHERE c.archived_at IS NULL
    AND c.product IN (${productIds.map(() => '?').join(',')})
    AND (
      c.lead_score >= 65
      OR p.status IN ('researching','ready','active')
    )
    AND (
      p.id IS NULL
      OR datetime(p.updated_at) < datetime('now', '-14 days')
    )
  ORDER BY (c.lead_score IS NULL), c.lead_score DESC, c.id
  LIMIT ?
`).all(...productIds, count);

const researchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['result'],
  properties: {
    result: {
      type: 'object',
      additionalProperties: false,
      required: [
        'company_id', 'verdict', 'problem', 'evidence', 'consequence',
        'cost_model', 'cost_confidence', 'narrative', 'next_goal',
      ],
      properties: {
        company_id: { type: 'integer' },
        verdict: { type: 'string', enum: ['pursue', 'hold'] },
        problem: { type: 'string' },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['claim', 'url', 'observed_at'],
            properties: {
              claim: { type: 'string' },
              url: { type: 'string' },
              observed_at: { type: 'string' },
            },
          },
        },
        consequence: { type: 'string' },
        cost_model: { type: 'string' },
        cost_confidence: { type: 'string', enum: ['verified', 'public_model', 'illustrative'] },
        narrative: { type: 'string' },
        next_goal: { type: 'string' },
      },
    },
  },
};

const experimentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['experiment'],
  properties: {
    experiment: {
      type: 'object',
      additionalProperties: false,
      required: ['hypothesis', 'audience', 'single_change', 'control', 'success_metric', 'sample_size'],
      properties: {
        hypothesis: { type: 'string' },
        audience: { type: 'string' },
        single_change: { type: 'string' },
        control: { type: 'string' },
        success_metric: { type: 'string' },
        sample_size: { type: 'integer', minimum: 10, maximum: 100 },
      },
    },
  },
};

const parseJson = (value, fallback) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const compact = (value, max = 4000) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);
const validEvidence = (items) => (items || []).filter((item) => (
  compact(item.claim).length >= 12
  && /^https?:\/\/\S+$/i.test(compact(item.url))
  && compact(item.observed_at).length >= 4
));

function ensurePursuit(company, result) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO pursuits (
        company_id, product, status, phase, problem, evidence, consequence,
        cost_model, cost_confidence, narrative, next_goal,
        approval_status, autonomy_status, updated_at
      ) VALUES (?, ?, ?, 'research', ?, ?, ?, ?, ?, ?, ?, 'needs_review', 'draft_only', datetime('now'))
      ON CONFLICT(company_id) DO UPDATE SET
        product=excluded.product,
        status=excluded.status,
        phase='research',
        problem=excluded.problem,
        evidence=excluded.evidence,
        consequence=excluded.consequence,
        cost_model=excluded.cost_model,
        cost_confidence=excluded.cost_confidence,
        narrative=excluded.narrative,
        next_goal=excluded.next_goal,
        approval_status='needs_review',
        autonomy_status='draft_only',
        updated_at=datetime('now')
    `).run(
      company.id,
      company.product,
      result.verdict === 'pursue' ? 'ready' : 'paused',
      compact(result.problem),
      JSON.stringify(result.evidence),
      compact(result.consequence),
      compact(result.cost_model),
      result.cost_confidence,
      compact(result.narrative),
      compact(result.next_goal),
    );
    const pursuit = db.prepare('SELECT * FROM pursuits WHERE company_id = ?').get(company.id);
    const insertStep = db.prepare(`
      INSERT OR IGNORE INTO pursuit_steps (
        pursuit_id, step_order, step_key, label, phase, channel, narrative_job, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    DEFAULT_PURSUIT_STEPS.forEach((step, index) => insertStep.run(
      pursuit.id,
      index + 1,
      step.step_key,
      step.label,
      step.phase,
      step.channel,
      step.narrative_job,
      index === 0 ? 'ready' : 'planned',
    ));
    db.exec('COMMIT');
    return pursuit;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

let researched = 0;
let held = 0;
let failed = 0;
for (const company of candidates) {
  const product = activeProducts.find((item) => item.id === company.product);
  const loop = salesLoopSummary(company.product);
  const prompt = [
    'Research one target account for a founder-led, problem-led software pursuit.',
    'Use current public web evidence. Prefer the company website, filings, procurement notices, regulator or government records, and named trade publications.',
    'Do not infer a private workflow as fact. Separate observed evidence from the commercial hypothesis.',
    'Every evidence item must include the exact direct source URL and the date or year it was observed/published.',
    'If there is no specific timely problem with a plausible owner, return verdict hold.',
    'Build the cost model as a visible equation using the smallest useful set of inputs: unit x frequency x duration x rate, or an equivalent conversion model. Use rounded values. Distinguish sourced inputs from assumptions. If the model is illustrative, start with explicit assumption language and never treat contingent exposure as expected loss or the whole burden as recoverable savings.',
    'Do not write outreach copy and do not claim anyone has agreed to meet.',
    '',
    `Account: ${company.name}`,
    `Website/domain: ${company.website || company.domain || 'unknown'}`,
    `Industry/location: ${company.industry || 'unknown'} / ${company.location || company.city || 'unknown'}`,
    `Product: ${product?.product_name || company.product}`,
    `Product outcome: ${product?.outcome || ''}`,
    `Existing hypothesis: ${compact(company.hypothesis) || 'none'}`,
    `Existing signals: ${JSON.stringify(parseJson(company.signals, []))}`,
    `Existing notes: ${compact(company.notes) || 'none'}`,
    `Known active contacts: ${company.contact_count}`,
    `Measured sales loop so far: ${JSON.stringify(loop)}`,
  ].join('\n');
  try {
    const output = await runCodex({
      prompt,
      schema: researchSchema,
      model,
      reasoning,
      webSearch: true,
      timeoutMs: Number(process.env.SALES_RESEARCH_TIMEOUT_MS) || 600_000,
    });
    const result = output.result;
    if (Number(result.company_id) !== company.id) throw new Error('research returned the wrong company id');
    result.evidence = validEvidence(result.evidence);
    if (result.verdict === 'pursue' && !result.evidence.length) {
      throw new Error('pursue verdict had no valid source URL');
    }
    if (result.verdict === 'pursue' && result.cost_confidence === 'illustrative') {
      const costErrors = validateIllustrativeCostAnalysis(result.cost_model, {
        requireCalibration: false,
      });
      if (costErrors.length) throw new Error(costErrors.join('; '));
    }
    ensurePursuit(company, result);
    if (!company.open_research_tasks) {
      createTask({
        company_id: company.id,
        product: company.product,
        channel: 'research',
        title: result.verdict === 'pursue'
          ? `Review fresh pursuit evidence for ${company.name}`
          : `Review hold recommendation for ${company.name}`,
        body: `${compact(result.next_goal)}\n\nSources:\n${result.evidence.map((item) => item.url).join('\n')}`,
        due_date: new Date().toISOString().slice(0, 10),
      });
    }
    if (result.verdict === 'pursue') researched++;
    else held++;
    console.log(`${company.name}: ${result.verdict} (${result.evidence.length} source${result.evidence.length === 1 ? '' : 's'})`);
  } catch (error) {
    failed++;
    console.log(`${company.name}: failed — ${String(error.message).split('\n')[0]}`);
  }
}

// Once enough outcomes exist, propose one controlled experiment. It is queued
// for approval rather than silently rewriting the playbook.
for (const product of activeProducts) {
  const loop = salesLoopSummary(product.id);
  if (loop.totals.attempts < 10) continue;
  const existing = db.prepare(`
    SELECT 1 FROM tasks
    WHERE product=? AND status='todo' AND title LIKE 'Approve sales experiment:%'
  `).get(product.id);
  if (existing) continue;
  try {
    const output = await runCodex({
      prompt: [
        'Design exactly one controlled founder-led sales experiment from measured CRM outcomes.',
        'Change only one variable: target role, channel, message angle, proof, or CTA.',
        'Do not recommend higher volume as the experiment. Use a control and a clear positive-reply or meeting metric.',
        `Product: ${product.product_name}`,
        `Positioning: ${product.positioning}`,
        `Measured last-30-day results: ${JSON.stringify(loop)}`,
      ].join('\n'),
      schema: experimentSchema,
      model,
      reasoning,
      timeoutMs: Number(process.env.SALES_RESEARCH_TIMEOUT_MS) || 600_000,
    });
    const experiment = output.experiment;
    createTask({
      product: product.id,
      channel: 'research',
      title: `Approve sales experiment: ${compact(experiment.single_change, 120)}`,
      body: JSON.stringify(experiment, null, 2),
      due_date: new Date().toISOString().slice(0, 10),
    });
    console.log(`${product.id}: queued one measured sales experiment`);
  } catch (error) {
    failed++;
    console.log(`${product.id}: experiment failed — ${String(error.message).split('\n')[0]}`);
  }
}

console.log(`Done. Researched ${researched}; held ${held}; failed ${failed}; candidates ${candidates.length}.`);
if (failed) process.exitCode = 1;
