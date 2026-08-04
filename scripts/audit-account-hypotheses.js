// Deterministic audit for the source-backed CRM problem hypotheses produced by
// research-account-hypotheses.js. Exits non-zero on missing structure, missing
// evidence, malformed URLs, mismatched company/pursuit text, or duplicates.
import { db } from '../src/db.js';

function safeJson(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

const rows = db.prepare(`
  SELECT c.id, c.name, c.campaign, c.hypothesis,
         pu.problem, pu.evidence, pu.offer, pu.value_to_partner
  FROM companies c
  LEFT JOIN pursuits pu ON pu.company_id=c.id
  WHERE c.archived_at IS NULL
  ORDER BY c.campaign, c.name COLLATE NOCASE
`).all();

const errors = [];
const warnings = [];
const generated = rows.filter((row) => String(row.problem || '').startsWith('Observed:'));
const seen = new Map();

for (const row of rows) {
  const label = `${row.campaign}:${row.name} (#${row.id})`;
  const companyText = String(row.hypothesis || '').trim();
  const pursuitText = String(row.problem || '').trim();
  if (!companyText) errors.push(`${label}: company hypothesis is blank`);
  if (!pursuitText) errors.push(`${label}: pursuit problem is blank`);
  if (companyText && pursuitText && companyText !== pursuitText) {
    warnings.push(`${label}: company and pursuit hypotheses differ`);
  }
  if (!pursuitText.startsWith('Observed:')) continue;

  for (const marker of ['Observed:', 'Hypothesis to validate:', 'Help:', 'Why reply:']) {
    if (!pursuitText.includes(marker)) errors.push(`${label}: missing ${marker}`);
  }
  if (pursuitText.length < 220 || pursuitText.length > 1_200) {
    errors.push(`${label}: hypothesis has ${pursuitText.length} characters`);
  }
  const hypothesisPart = pursuitText.split('Hypothesis to validate:')[1]?.split('Help:')[0] || '';
  if (!/\b(?:may|might|could|question is whether|hypothesis|to validate)\b/i.test(hypothesisPart)) {
    errors.push(`${label}: problem is not calibrated as uncertain`);
  }
  const helpPart = pursuitText.split('Help:')[1]?.split('Why reply:')[0] || '';
  if (!/\b(?:use|review|receive|compare|decide|prioritize|choose|classify|route|approve|schedule|prepare|identify)\b/i.test(helpPart)) {
    warnings.push(`${label}: bounded help may not name a concrete action/output`);
  }
  const replyPart = pursuitText.split('Why reply:')[1] || '';
  if (!/\b(?:because|can|know|knows|should|would|owns|leads|manages|role|remit|positioned|credible|responsib|confirm|clarify|correct|determine|assess)\b/i.test(replyPart)) {
    warnings.push(`${label}: why-reply logic may be too thin`);
  }

  const evidence = safeJson(row.evidence, []);
  if (!Array.isArray(evidence) || !evidence.length) {
    errors.push(`${label}: no pursuit evidence`);
  } else {
    for (const item of evidence) {
      const url = String(item.url || item.source_url || '');
      const claim = String(item.claim || item.fact || item.statement || '');
      if (!/^https?:\/\//i.test(url)) errors.push(`${label}: malformed evidence URL ${url || '(blank)'}`);
      if (/\b(?:google\.[^/]+\/search|bing\.com\/search|linkedin\.com|crunchbase\.com|zoominfo\.com)\b/i.test(url)) {
        errors.push(`${label}: disallowed indirect evidence URL ${url}`);
      }
      if (claim.split(/\s+/).filter(Boolean).length < 5) errors.push(`${label}: evidence claim is too thin`);
    }
  }
  if (seen.has(pursuitText)) errors.push(`${label}: duplicates ${seen.get(pursuitText)}`);
  else seen.set(pursuitText, label);
}

const byCampaign = Object.fromEntries(
  [...new Set(rows.map((row) => row.campaign))].map((campaign) => [campaign, {
    accounts: rows.filter((row) => row.campaign === campaign).length,
    generated: generated.filter((row) => row.campaign === campaign).length,
    blank: rows.filter((row) => row.campaign === campaign && !String(row.problem || '').trim()).length,
  }]),
);

console.log(JSON.stringify({
  accounts: rows.length,
  source_backed_hypotheses: generated.length,
  campaigns: byCampaign,
  errors: errors.length,
  warnings: warnings.length,
}, null, 2));
for (const error of errors) console.log(`ERROR ${error}`);
for (const warning of warnings.slice(0, 100)) console.log(`WARN  ${warning}`);
if (warnings.length > 100) console.log(`WARN  ... ${warnings.length - 100} more`);
if (errors.length) process.exitCode = 1;
