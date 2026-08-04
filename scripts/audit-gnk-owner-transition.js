// Deterministic guardrails for the GNK owner-independence research lane.
//
// This does not judge whether a hypothesis will sell. It makes sure every
// queued account has the evidence, bounded workflow, human approval, metric and
// CRM linkage the strategy requires—and that demographic targeting did not leak
// into the dossier.
import { existsSync, readFileSync } from 'node:fs';
import { db } from '../src/db.js';
import { isSourcedAdvertisedSignal } from '../src/problem-scouts.js';

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const path = fileIndex >= 0
  ? args[fileIndex + 1]
  : 'data/gnk-owner-transition-opportunities.json';

if (!existsSync(path)) throw new Error(`Queue not found: ${path}`);
const opportunities = JSON.parse(readFileSync(path, 'utf8'));
const failures = [];
const warnings = [];

const forbidden = [
  ['baby-boomer targeting', /\bbaby[\s-]?boomer\b/i],
  ['older-owner targeting', /\bolder owner\b|\bageing owner\b|\baging owner\b/i],
  ['appearance inference', /\bgrey hair\b|\bgray hair\b/i],
  ['personal retirement inference', /\bbefore you retire\b|\bretirement plan\b/i],
  ['whole-business automation', /\bautomate (?:the|your|their) (?:entire|whole) business\b/i],
  ['job-replacement pitch', /\breplace (?:staff|employees|jobs|workers)\b/i],
];

for (const item of opportunities) {
  const label = item.org || '(unnamed)';
  const fullText = JSON.stringify(item);
  if (!item.org || !item.domain) failures.push(`${label}: missing organization/domain`);
  if (item.problem_origin !== 'ownership-transition') failures.push(`${label}: wrong problem_origin`);
  if (item.theme !== 'owner independence / business continuity') failures.push(`${label}: wrong theme`);
  if (!String(item.budget_signal || '').trim()) failures.push(`${label}: missing budget evidence`);
  if (!String(item.reachability || '').trim()) failures.push(`${label}: missing sponsor/reachability route`);
  if (!Array.isArray(item.ideal_contacts) || item.ideal_contacts.length < 2) failures.push(`${label}: fewer than two contact routes`);
  if (!['easy', 'medium', 'hard'].includes(item.close_tier)) failures.push(`${label}: invalid close tier`);
  if (!([30, 60, 90].includes(item.days_to_close))) failures.push(`${label}: invalid days_to_close`);

  const signals = Array.isArray(item.advertised_signals) ? item.advertised_signals : [];
  const transitionSignals = signals.filter((signal) => (
    signal.signal_type === 'ownership-transition'
    && signal.relationship === 'target-admission'
    && isSourcedAdvertisedSignal(signal)
  ));
  if (!transitionSignals.length) failures.push(`${label}: no direct, dated company transition signal`);
  if (signals.some((signal) => !isSourcedAdvertisedSignal(signal))) failures.push(`${label}: malformed advertised signal`);

  const project = String(item.ai_project || '');
  if (!/(approv|human review|retains? (?:authority|control)|shadow.mode)/i.test(project)) {
    failures.push(`${label}: project has no explicit human approval/control`);
  }
  if (!/(measure|compare|cycle time|turnaround|backlog|rework|escalation|interrupt)/i.test(project)) {
    failures.push(`${label}: project has no measurable pilot outcome`);
  }
  if (!/(hypothesis|does not|do not|not disclosed|no current|no existing|no .* claimed|must be validated)/i.test(String(item.defensible_problem || ''))) {
    warnings.push(`${label}: defensible_problem may not clearly separate fact from hypothesis`);
  }
  for (const [name, pattern] of forbidden) {
    if (pattern.test(fullText)) failures.push(`${label}: contains ${name}`);
  }

  const crm = db.prepare(`
    SELECT id, campaign, source, notes FROM companies WHERE lower(name) = lower(?)
  `).get(item.org);
  if (!crm) {
    failures.push(`${label}: not linked into the CRM`);
  } else {
    if (crm.campaign !== 'gnk') failures.push(`${label}: CRM campaign is ${crm.campaign}, not gnk`);
    if (crm.source !== 'codex-scout:ownership-transition') warnings.push(`${label}: CRM source is ${crm.source}`);
    let notes = {};
    try { notes = JSON.parse(crm.notes || '{}'); } catch { failures.push(`${label}: CRM notes are invalid JSON`); }
    if (notes.problem_origin !== 'ownership-transition') failures.push(`${label}: CRM dossier lost problem_origin`);
  }
}

console.log(`${opportunities.length} owner-transition opportunities · ${failures.length} failures · ${warnings.length} warnings`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
for (const warning of warnings) console.log(`  WARN ${warning}`);
if (failures.length) process.exitCode = 1;

