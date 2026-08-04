// Weighted lead scoring for Problem Found accounts.
//
// The spec scores each account out of 100 across 7 factors (weights in
// data/products.json → shared.scoring). Scoring is a human judgement: for each
// factor the user supplies a rating 0..1 (fraction of that factor's weight the
// account earns) plus an optional note explaining why. Only accounts scoring
// >= shared.min_outreach_score (65) may enter active personalized outreach.
import { shared } from './products.js';

// Normalize a rating to 0..1. Accepts 0..1 fractions or 0..100 percentages.
function norm(r) {
  const n = Number(r);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1) return Math.min(n / 100, 1);
  return Math.min(n, 1);
}

// inputs: { [factorKey]: number | { rating, note } }
// returns { score, gate, min, breakdown: { [key]: {label, weight, rating, points, note} } }
export function computeLeadScore(inputs = {}) {
  const cfg = shared();
  const factors = cfg.scoring || [];
  const min = cfg.min_outreach_score ?? 65;

  const breakdown = {};
  let score = 0;
  for (const f of factors) {
    const raw = inputs[f.key];
    const rating = norm(raw && typeof raw === 'object' ? raw.rating : raw);
    const note = raw && typeof raw === 'object' ? (raw.note ?? '') : '';
    const points = Math.round(rating * f.weight);
    score += points;
    breakdown[f.key] = { label: f.label, weight: f.weight, rating, points, note };
  }
  score = Math.min(Math.round(score), 100);
  return { score, min, gate: score >= min, breakdown };
}

// Human-readable one-liner explaining a stored score.
export function explainScore(breakdown = {}) {
  return Object.values(breakdown)
    .filter((b) => b && b.points != null)
    .sort((a, b) => b.points - a.points)
    .map((b) => `${b.label}: ${b.points}/${b.weight}${b.note ? ` — ${b.note}` : ''}`)
    .join(' · ');
}

// Does this account clear the gate to generate outreach? Requires the score
// threshold AND (per spec) at least one credible public signal.
export function outreachAllowed(account) {
  const cfg = shared();
  const min = cfg.min_outreach_score ?? 65;
  const signals = Array.isArray(account?.signals) ? account.signals : [];
  return {
    allowed: (account?.lead_score ?? 0) >= min && signals.length > 0,
    scoreOk: (account?.lead_score ?? 0) >= min,
    hasSignal: signals.length > 0,
    min,
  };
}
