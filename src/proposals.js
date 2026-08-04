// Deterministic statement-of-work / proposal generator.
//
// Builds a proposal from the account hypothesis, the chosen 30/60/90 offer, the
// product outcome and whatever discovery answers exist. No LLM — it stitches the
// spec's offer structure and qualification data into a reviewable draft the user
// edits and copies out. GnK is only named as delivery once gnk_status is scoped.
import { shared, companyMeta } from './products.js';

const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US')}`);

// A phased timeline appropriate to the offer length.
function timeline(days) {
  if (days <= 30) return [
    'Week 1 — Data intake, current-workflow interviews, scope confirmation.',
    'Week 2–3 — Historical audit + prototype build against real examples.',
    'Week 4 — Quantified business case and readout; go / no-go on a pilot.',
  ];
  if (days <= 60) return [
    'Week 1–2 — Data access, workflow mapping, acceptance criteria signed off.',
    'Week 3–6 — Working system built on real customer data (shadow mode).',
    'Week 7–8 — Side-by-side against the current process; measured results readout.',
  ];
  if (days <= 90) return [
    'Week 1–3 — Integrations, permissions and data pipelines stood up.',
    'Week 4–9 — Live workflow adoption with the operating team; iterate on feedback.',
    'Week 10–13 — Handover, training, success metrics locked, expansion plan.',
  ];
  return [
    'Ongoing — Additional modules, maintenance and portfolio-wide deployment on a quarterly cadence.',
  ];
}

// account: hydrated company row; product: getProduct(id); offer: shared.offers entry;
// discovery: { qkey: answer } map (optional).
export function generateSOW({ account, product, offer, discovery = {} } = {}) {
  const co = companyMeta();
  const S = shared();
  const gnkScoped = account?.gnk_status === 'scoped' || account?.gnk_status === 'estimated';

  const dataReq = discovery.tools
    || 'To be confirmed in discovery — the schedules, records, exports or feeds the workflow already produces.';
  const outcomeText = (product?.outcome || 'the target outcome').replace(/\.\s*$/, '').toLowerCase();
  const acceptance = discovery.pilot_bar
    || `A clear demonstration of ${outcomeText}, against the account's own data.`;
  const painLine = discovery.cost
    || 'the time, cost or risk the current manual workflow creates (to be quantified in discovery)';

  const lines = [];
  lines.push(`# ${offer.label} — ${account?.name || 'Prospect'}`);
  lines.push('');
  lines.push(`**Product:** ${product?.product_name || product?.id} · **Prepared by:** ${co.name}`);
  lines.push('');
  lines.push('## The problem we are solving');
  lines.push(account?.hypothesis
    || `We believe ${account?.name || 'this organization'} experiences a costly manual workflow that ${product?.product_name || 'this product'} can turn into a decision system. (Hypothesis to be finalized.)`);
  lines.push('');
  lines.push('## What you buy');
  lines.push(`${offer.buys}. This is a **${offer.days}-day** engagement.`);
  lines.push('');
  lines.push(`**Outcome:** ${product?.outcome || '—'}`);
  lines.push(`**Investment:** ${money(offer.value_low)}–${money(offer.value_high)}`);
  lines.push('');
  lines.push('## Data we will need from you');
  lines.push(dataReq);
  lines.push('');
  lines.push('## Acceptance criteria');
  lines.push(`We consider this engagement successful when: ${acceptance}`);
  lines.push('');
  lines.push('## Why now');
  lines.push(`This addresses ${painLine}.`);
  lines.push('');
  lines.push('## Timeline');
  for (const t of timeline(offer.days)) lines.push(`- ${t}`);
  lines.push('');
  lines.push('## Delivery');
  lines.push(gnkScoped
    ? `${co.name} owns discovery, scoping, client management and engineering delivery, and has agreed this scope and pricing.`
    : `${co.name} owns discovery and scoping. Engineering delivery is confirmed against a written estimate before any commitment is made to you — no build is promised until feasibility and pricing are agreed.`);
  lines.push('');
  lines.push('---');
  lines.push('_Draft proposal — edit before sending. AI is an implementation detail, not the thing being sold._');
  return lines.join('\n');
}
