// Estimate the annual operating cost + recoverable savings of each GnK idea as
// its OWN task (Codex, batched) — where estimating is the job, so the model gives
// a real number instead of retreating to "substantial" under email-honesty rules.
// Stored on the problems table (annual_cost_low/high, savings_low/high, cost_basis)
// so the email writer and CRM can use a transparent, hedged model.
//   node scripts/estimate-gnk-cost.js [--rewrite]
import { db } from '../src/db.js';
import { listProblems, updateProblem } from '../src/problems.js';
import { runCodex } from '../src/codex.js';
import { validateIllustrativeCostAnalysis } from '../src/cost-analysis.js';

const REWRITE = process.argv.includes('--rewrite');
const MODEL = process.env.CODEX_MODEL || 'gpt-5.6-sol';

const titles = new Set(
  db.prepare("SELECT notes FROM companies WHERE campaign='gnk'").all()
    .map((r) => (String(r.notes || '').match(/^Idea:\s*(.+)$/m) || [])[1]).filter(Boolean),
);
const ideas = listProblems().filter((p) => titles.has(p.title) && (REWRITE || !p.annual_cost_low));
console.log(`Estimating annual cost for ${ideas.length} GnK ideas (batched)…`);

const schema = {
  type: 'object', additionalProperties: false, required: ['estimates'],
  properties: {
    estimates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'annual_cost_low', 'annual_cost_high', 'savings_low', 'savings_high', 'cost_basis'],
        properties: {
          title: { type: 'string' },
          annual_cost_low: { type: 'integer' }, annual_cost_high: { type: 'integer' },
          savings_low: { type: 'integer' }, savings_high: { type: 'integer' },
          cost_basis: { type: 'string' },
        },
      },
    },
  },
};

function prompt(batch) {
  const list = batch.map((p) => `- "${p.title}" | who has it: ${p.who_has_it} | problem: ${p.one_liner} | how it's done today: ${p.workflow_today} | why it's expensive: ${p.why_expensive} | metric: ${p.measurable}`).join('\n');
  return `You estimate what a manual operational problem costs a TYPICAL mid-size Canadian organisation per year. For each idea below give a CONSERVATIVE, defensible illustrative model (round numbers, order-of-magnitude is fine):
- annual_cost_low / annual_cost_high (CAD/year): what the manual workflow plausibly costs ONE typical org to run — labour (people x hours/week x ~$65-90/hr loaded x 52), plus penalties, trapped cash, waste, rework, or avoidable downtime where relevant.
- savings_low / savings_high (CAD/year): what a working system could realistically recover — a FRACTION of the cost, not all of it.
- cost_basis: ONE short sentence that starts with "Assuming" and shows the arithmetic (e.g. "Assuming 2 staff x 12 hours/week x 52 weeks x $75/hour, the base burden is about $94k, before unpriced penalty exposure"). Keep contingent penalties, trapped cash, downtime, and revenue separate from the base calculation unless a sourced expected value exists.
Be honest and conservative; vary the numbers by the real shape of each problem (a food-spoilage problem and a megaproject-delay problem are not the same size).
Ideas:
${list}
Return {estimates:[...]} with one entry per idea, title matching EXACTLY.`;
}

const batches = [];
for (let i = 0; i < ideas.length; i += 8) batches.push(ideas.slice(i, i + 8));
const byTitle = new Map(ideas.map((p) => [p.title, p]));
let n = 0, done = 0;
for (const b of batches) {
  done++;
  try {
    const out = await runCodex({ prompt: prompt(b), schema, model: MODEL, reasoning: 'medium', webSearch: false, timeoutMs: 240000, cwd: process.cwd() });
    for (const e of out.estimates || []) {
      const p = byTitle.get(e.title);
      if (!p) continue;
      const costErrors = validateIllustrativeCostAnalysis(e.cost_basis, {
        requireCalibration: false,
      });
      if (costErrors.length) {
        console.log(`  ! ${e.title}: ${costErrors.join('; ')}`);
        continue;
      }
      updateProblem(p.id, { annual_cost_low: e.annual_cost_low, annual_cost_high: e.annual_cost_high, savings_low: e.savings_low, savings_high: e.savings_high, cost_basis: e.cost_basis });
      n++;
    }
    console.log(`  batch ${done}/${batches.length} → ${n} ideas estimated`);
  } catch (e) { console.log(`  ! batch ${done}: ${String(e.message).split('\n')[0]}`); }
}
console.log(`Done. Estimated annual cost for ${n} ideas.`);
