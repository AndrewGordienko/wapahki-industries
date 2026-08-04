// Deterministic completeness and copy-format audit for the highest-scored GnK
// companies. Mirrors scripts/write-gnk-touch1.js ranking and contact selection.
//
//   node scripts/audit-gnk-touch1.js [--ui-order] [--limit 50] [--people 5] [--stored-only] [--json]
import { db } from '../src/db.js';
import { listProblems } from '../src/problems.js';
import { normalizeSubject } from '../src/subject-lines.js';

const args = process.argv.slice(2);
const numberArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const LIMIT = numberArg('--limit', 50);
const PEOPLE = numberArg('--people', 5);
const UI_ORDER = args.includes('--ui-order');
const STORED_ONLY = args.includes('--stored-only');
const JSON_OUTPUT = args.includes('--json');

const field = (notes, key) => (
  String(notes || '').match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || []
)[1] || '';
const scoreByIdea = new Map(listProblems().map((problem) => [problem.title, problem.score || 0]));

const rows = db.prepare(`
  SELECT p.id AS person_id, p.first_name, p.name AS person_name, p.title,
         p.relevance_score, p.company_id, c.name AS company, c.tier, c.notes,
         s.id AS sequence_id, s.subject, s.body
  FROM people p
  JOIN companies c ON c.id = p.company_id
  LEFT JOIN sequences s ON s.person_id = p.id AND s.touch = 1
  WHERE c.campaign = 'gnk' AND p.email LIKE '%@%'
  ORDER BY p.company_id, p.relevance_score DESC
`).all();

const byCompany = new Map();
for (const row of rows) {
  if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
  byCompany.get(row.company_id).push(row);
}

const scoreSort = (a, b) => {
  const scoreA = scoreByIdea.get(field(a[0].notes, 'Idea')) || 0;
  const scoreB = scoreByIdea.get(field(b[0].notes, 'Idea')) || 0;
  return scoreB - scoreA || a[0].company_id - b[0].company_id;
};
const tierRank = (tier) => ({ easy: 0, medium: 1, hard: 2 }[String(tier || '').toLowerCase()] ?? 3);
const uiSort = (a, b) => tierRank(a[0].tier) - tierRank(b[0].tier)
  || String(a[0].company).localeCompare(String(b[0].company), undefined, { sensitivity: 'base' });
const selected = STORED_ONLY
  ? [...byCompany.values()]
    .map((companyRows) => companyRows.filter((row) => row.sequence_id))
    .filter((companyRows) => companyRows.length)
  : [...byCompany.values()]
    .filter((companyRows) => companyRows.length >= PEOPLE)
    .sort(UI_ORDER ? uiSort : scoreSort)
    .slice(0, LIMIT)
    .map((companyRows) => companyRows.slice(0, PEOPLE));

const words = (text) => (
  String(text || '').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []
).length;
const contentOnly = (body) => String(body || '')
  .replace(/^Hi [^,\n]+,\s*/i, '')
  .replace(/\s*(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nGnK\s*$/i, '')
  .trim();

const banned = [
  ['AI', /\bAI\b/i],
  ['machine learning', /\bmachine learning\b/i],
  ['automation platform', /\bautomation platform\b/i],
  ['revolutionize', /\brevolutioni[sz]e\b/i],
  ['synergy', /\bsynerg(?:y|ies)\b/i],
  ['quick call', /\bquick call\b/i],
  ['circle back', /\bcircle back\b/i],
  ['touch base', /\btouch base\b/i],
  ['cutting-edge', /\bcutting-edge\b/i],
  ['leverage', /\bleverag(?:e|ing)\b/i],
  ['seamless', /\bseamless\b/i],
  ['hope this finds you well', /\bhope this finds you well\b/i],
];

const failures = [];
for (const companyRows of selected) {
  if (!STORED_ONLY && companyRows.length !== PEOPLE) {
    failures.push({
      company: companyRows[0]?.company || '(unknown)',
      person_id: null,
      errors: [`expected ${PEOPLE} emailable contacts, got ${companyRows.length}`],
    });
  }
  for (const row of companyRows) {
    const errors = [];
    const subject = String(row.subject || '').trim();
    const body = String(row.body || '').trim();
    const first = row.first_name || String(row.person_name || '').split(/\s+/)[0];

    if (!row.sequence_id) errors.push('missing touch 1');
    if (!subject) errors.push('missing subject');
    if (subject && subject !== normalizeSubject(subject)) errors.push('subject is not in natural sentence case');
    if (subject && (words(subject) < 2 || words(subject) > 5)) {
      errors.push(`subject is ${words(subject)} words, expected 2-5`);
    }
    if (/[:!?]/.test(subject)) errors.push('subject contains salesy punctuation');
    if (!body.startsWith(`Hi ${first},`)) errors.push('greeting does not match first name');
    if (!body.startsWith(`Hi ${first},\n\n`)) errors.push('greeting must be followed by one blank line');
    if (!/(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nGnK\s*$/.test(body)) {
      errors.push('signature is missing or malformed');
    }
    if (!/\n\n(?:Best|Thanks),\nAndrew Gordienko\nGnK\s*$/.test(body)) {
      errors.push('signature must be preceded by one blank line');
    }
    const contentWords = words(contentOnly(body));
    if (body && (contentWords < 90 || contentWords > 145)) {
      errors.push(`body content is ${contentWords} words, expected 90-145`);
    }
    if (/[—–]/.test(body)) errors.push('body contains an em/en dash');
    if (/!/.test(body)) errors.push('body contains an exclamation point');
    if (/:/.test(body)) errors.push('body contains a colon');
    if (/https?:\/\//i.test(body)) errors.push('body contains a URL');
    if (/^\s*[-*]\s+/m.test(contentOnly(body))) errors.push('body contains a bullet');
    if (/[ \t]{2,}/.test(body)) errors.push('body contains repeated spaces');
    if (/[ \t]+[,.?]/.test(body)) errors.push('body contains a space before punctuation');
    if (/[.?](?=[A-Z])/.test(contentOnly(body))) errors.push('body is missing a space after punctuation');
    for (const [label, pattern] of banned) {
      if (pattern.test(body)) errors.push(`body uses banned phrase: ${label}`);
    }
    if (errors.length) {
      failures.push({
        company: row.company,
        person_id: row.person_id,
        person: row.person_name,
        errors,
      });
    }
  }
}

const result = {
  companies: selected.length,
  contacts: selected.reduce((count, companyRows) => count + companyRows.length, 0),
  failed_contacts: failures.filter((failure) => failure.person_id != null).length,
  failures,
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${result.companies} GnK companies and ${result.contacts} contacts audited in ${UI_ORDER ? 'UI' : 'score'} order; ${result.failed_contacts} contacts failed.`);
  for (const failure of failures) {
    const label = failure.person_id == null
      ? failure.company
      : `${failure.company} / ${failure.person} (${failure.person_id})`;
    console.log(`\n${label}`);
    for (const error of failure.errors) console.log(`  - ${error}`);
  }
}

if (failures.length) process.exitCode = 1;
