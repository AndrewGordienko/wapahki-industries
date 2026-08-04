// Deterministic completeness and copy-format audit for the finalized OutageHub
// set. Mirrors the hard gates in write-outagehub-touch1.js without model calls.
//   node scripts/audit-outagehub-touch1.js [--json]
import { db } from '../src/db.js';
import { normalizeSubject } from '../src/subject-lines.js';

const JSON_OUTPUT = process.argv.includes('--json');
const words = (text) => (String(text || '').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []).length;
const contentOnly = (body) => String(body || '')
  .replace(/^Hi [^,\n]+,\s*/i, '')
  .replace(/\s*(?:Best|Thanks),\s*\nAndrew Gordienko\s*\nOutageHub\s*$/i, '')
  .trim();
const isRoutingContact = (person) => /\b(?:marketing|communications?|sales|finance|financial|business development|legal|general counsel|human resources|procurement)\b/i
  .test(String(person.title || ''));
const banned = [
  ['do_not_contact', /\bdo_not_contact\b/i],
  ['I found you because', /\bI found you because\b/i],
  ['my guess is', /\bmy guess is\b/i],
  ['process breaks', /\b(?:the|your|this) process breaks\b/i],
  ["I'm building", /\bI['’]m building\b/i],
  ["I'm the founder", /\bI['’]m the founder\b/i],
  ["we're exploring", /\bwe['’]re exploring\b/i],
  ['we are exploring', /\bwe are exploring\b/i],
  ['email response alternative', /\b(?:email (?:reply|response)|reply by email|respond by email|write back instead)\b/i],
  ['just following up', /\bjust follow(?:ing)? up\b/i],
  ['just checking in', /\bjust checking in\b/i],
  ['quick call', /\bquick call\b/i],
  ['leverage', /\bleverag(?:e|ing)\b/i],
  ['unlock', /\bunlock(?:s|ed|ing)?\b/i],
  ['seamless', /\bseamless\b/i],
  ['streamline', /\bstreamlin(?:e|es|ed|ing)\b/i],
  ['workflow', /\bworkflows?\b/i],
  ['outage context', /\boutage context\b/i],
  ['messy reconciliation problem', /\bmessy reconciliation problem\b/i],
  ['where service impact may be coming from', /\bwhere service impact may be coming from\b/i],
  ['tell me if that is not a problem', /\btell me if (?:that|this|it)(?: is|['’]s) not (?:a )?problem\b/i],
  ['no need to continue', /\bno need to continue\b/i],
  ['N+1 diesels', /\bN\s*\+\s*1\b[^.!?\n]{0,45}\bdiesels?\b|\bdiesels?\b[^.!?\n]{0,45}\bN\s*\+\s*1\b/i],
  ['colocation risk', /\bcolocation risk\b/i],
  ['detection before tickets', /\b(?:detect|identify|know|see|spot)(?:s|ed|ing)?\b[^.!?\n]{0,80}\bbefore\b[^.!?\n]{0,45}\b(?:tickets?|calls?|alarms?)\b/i],
  ['early detection', /\bearl(?:y|ier)\b[^.!?\n]{0,55}\b(?:detect|signal|know|learn|see|identify)\w*\b|\b(?:detect|know|learn|see|identify)\w*\b[^.!?\n]{0,55}\bearl(?:y|ier)\b/i],
];

const rows = db.prepare(`
  SELECT c.id AS company_id, c.name AS company,
         p.id AS person_id, p.first_name, p.name AS person, p.title,
         s.id AS sequence_id, s.subject, s.body
  FROM companies c
  JOIN people p ON p.company_id=c.id AND p.email LIKE '%@%'
  LEFT JOIN sequences s ON s.person_id=p.id AND s.touch=1
  WHERE c.campaign='outagehub'
  ORDER BY c.id,p.relevance_score DESC,p.id
`).all();

const companyCounts = db.prepare(`
  SELECT c.id,c.name,COUNT(CASE WHEN p.email LIKE '%@%' THEN 1 END) AS emailable
  FROM companies c LEFT JOIN people p ON p.company_id=c.id
  WHERE c.campaign='outagehub'
  GROUP BY c.id ORDER BY c.id
`).all();
const failures = [];
const duplicateTouchOnes = db.prepare(`
  SELECT c.name AS company,p.id AS person_id,p.name AS person,COUNT(*) AS n
  FROM sequences s JOIN people p ON p.id=s.person_id JOIN companies c ON c.id=p.company_id
  WHERE c.campaign='outagehub' AND s.touch=1
  GROUP BY p.id HAVING COUNT(*)!=1
`).all();

if (companyCounts.length !== 50) {
  failures.push({ company: '(campaign)', person_id: null, errors: [`has ${companyCounts.length} companies, expected 50`] });
}
for (const company of companyCounts) {
  if (company.emailable !== 5) {
    failures.push({ company: company.name, person_id: null, errors: [`has ${company.emailable} emailable contacts, expected 5`] });
  }
}
for (const duplicate of duplicateTouchOnes) {
  failures.push({
    company: duplicate.company,
    person_id: duplicate.person_id,
    person: duplicate.person,
    errors: [`has ${duplicate.n} touch-1 rows, expected 1`],
  });
}

for (const row of rows) {
  const errors = [];
  const first = row.first_name || String(row.person || '').split(/\s+/)[0];
  const subject = String(row.subject || '').trim();
  const body = String(row.body || '').trim();
  if (!row.sequence_id) errors.push('missing touch 1');
  if (row.sequence_id && !subject) errors.push('missing subject');
  if (row.sequence_id && !body) errors.push('missing body');
  if (subject && subject !== normalizeSubject(subject)) errors.push('subject is not in natural sentence case');
  if (subject && (words(subject) < 2 || words(subject) > 5)) errors.push(`subject has ${words(subject)} words`);
  if (subject && /[:!?]/.test(subject)) errors.push('subject contains punctuation');
  if (body && !body.startsWith(`Hi ${first},`)) errors.push('greeting does not match');
  if (body && !body.startsWith(`Hi ${first},\n\n`)) errors.push('greeting must be followed by one blank line');
  if (body && !/Thanks,\s*\nAndrew Gordienko\s*\nOutageHub\s*$/.test(body)) errors.push('signature is wrong');
  if (body && !/\n\nThanks,\nAndrew Gordienko\nOutageHub\s*$/.test(body)) errors.push('signature must be preceded by one blank line');
  const contentWords = words(contentOnly(body));
  if (body && (contentWords < 90 || contentWords > 155)) errors.push(`body has ${contentWords} content words`);
  if (/[—–]/.test(body)) errors.push('body contains a long dash');
  if (/[:!]/.test(body)) errors.push('body contains a colon or exclamation point');
  if (/https?:\/\//i.test(body)) errors.push('body contains a URL');
  if (/^\s*[-*]\s+/m.test(contentOnly(body))) errors.push('body contains a bullet');
  if (/[ \t]{2,}/.test(body)) errors.push('body contains repeated spaces');
  if (/[ \t]+[,.?]/.test(body)) errors.push('body contains a space before punctuation');
  if (/[.?](?=[A-Z])/.test(contentOnly(body))) errors.push('body is missing a space after punctuation');
  if (body && !/\bI run OutageHub\b/i.test(body)) errors.push('missing approved identity line');
  if (body && !(
    /\bpublic\b[^.!?\n]{0,40}\b(?:outage|utilit)/i.test(body)
    || /\butilit(?:y|ies)\b[^.!?\n]{0,45}\breport/i.test(body)
  )) errors.push('missing public-utility-data mechanism');
  if (body && !(
    /\blocation[- ]matched\b/i.test(body)
    || /\b(?:match\w*|map\w*)\b[^.!?\n]{0,45}\b(?:location|site|store|facilit|propert|address|residence|network|territor|portfolio|area|branch)\w*/i.test(body)
    || /\b(?:location|site|store|facilit|propert|address|residence|network|territor|portfolio|area|branch)\w*\b[^.!?\n]{0,45}\b(?:match\w*|map\w*)\b/i.test(body)
  )) errors.push('missing location-matching value');
  if (body && !/\b(?:you would know|you see|puts you close|gives you (?:a|the) (?:view|perspective)|your role|as [^,.\n]{2,80}, you)\b/i.test(body)) errors.push('missing unique role insight');
  if (body && !/\b(?:does|do|can|when|how)\b[^?]{0,220}\b(?:today|already|currently|separately|store by store|site by site|location by location|utility (?:site|report)|correlat)\b[^?]*\?/i.test(body)) errors.push('missing current-process question');
  if (body && /\breal[- ]?time Canadian coverage\b|\b(?:paid )?(?:API )?pilot\b|\b(?:CAD|USD)\s*\$?\s*\d|\$\s*(?:40|75)k|\bfirst[- ]year deployment\b/i.test(body)) errors.push('contains unsupported coverage or premature commercial language');
  const identityIndex = body.search(/\bI run OutageHub\b/i);
  const firstQuestionIndex = body.indexOf('?');
  if (body && identityIndex >= 0 && identityIndex < 45) errors.push('opens with the product instead of the problem');
  if (body && !isRoutingContact(row) && (firstQuestionIndex < 0 || (identityIndex >= 0 && firstQuestionIndex > identityIndex))) {
    errors.push('missing a role-relevant problem question before the product');
  }
  const hasTwentyMinuteCta = /\b(?:20|twenty)[ -]?minutes?\b[^.!?\n]{0,60}\b(?:call|conversation)\b|\b(?:call|conversation)\b[^.!?\n]{0,60}\b(?:20|twenty)[ -]?minutes?\b/i.test(body);
  const hasReferral = /\b(?:referral|introduction|pointer|(?:point|direct|connect|introduce) (?:me|us)|who(?:ever)?\b[^.!?\n]{0,35}\b(?:owns|handles|leads)|(?:someone|somebody|another (?:team|person|leader)|a different team|a colleague)\b[^.!?\n]{0,50}\b(?:owns|handles|leads)|(?:right|appropriate) (?:person|team|owner|leader|contact))\b/i.test(body);
  if (body && isRoutingContact(row)) {
    if (hasTwentyMinuteCta) errors.push('routing contact is asked for a call');
    if (!hasReferral) errors.push('routing contact is missing the referral ask');
  } else if (body) {
    if (!hasTwentyMinuteCta) errors.push('missing primary 20-minute CTA');
    if (!hasReferral) errors.push('missing referral option');
  }
  if (body && row.person_id === 2603) {
    if (!/\b(?:residences?|residents?)\b/i.test(body)) errors.push('Andrea draft is missing the residence use case');
    if (!/\b(?:continuity|backup power|resident support)\b/i.test(body)) errors.push('Andrea draft is missing the continuity decision');
  }
  if (body && row.person_id === 2611) {
    if (!/\b(?:catastrophe|cat response|widespread event|severe weather)\b/i.test(body)) errors.push('John draft is missing the catastrophe-response frame');
    if (!/\b(?:capacity|where disruption|disruption is concentrating|concentration of disruption)\b/i.test(body)) errors.push('John draft is missing the capacity or concentration hypothesis');
    if (!/\b(?:would not|wouldn['’]t|is not|isn['’]t|not meant to)\b[^.!?\n]{0,80}\b(?:priority|prioritize|ranking?)\b[^.!?\n]{0,50}\bclaims?\b|\bclaims?\b[^.!?\n]{0,50}\b(?:priority|prioritize|ranking?)\b/i.test(body)) {
      errors.push('John draft is missing the individual-claim-priority boundary');
    }
  }
  if (body && row.person_id === 555) {
    if (!/\bcustomer\b[^.!?\n]{0,60}\bcommunicat/i.test(body)) errors.push('Alexandra draft is missing her customer-communications perspective');
    if (!/\bnetwork operations\b/i.test(body)) errors.push('Alexandra draft is missing the network-operations route');
    if (/\b(?:how|whether|could you explain)\b[^?]{0,100}\b(?:alarms?|telemetry|classif(?:y|ies|ication)|NOC)\b[^?]*\?/i.test(body)) {
      errors.push('Alexandra draft asks a NOC-level question');
    }
  }
  for (const [label, pattern] of banned) {
    if (pattern.test(body)) errors.push(`body uses ${label}`);
  }
  if (errors.length) failures.push({ company: row.company, person_id: row.person_id, person: row.person, errors });
}

const result = {
  companies: companyCounts.length,
  contacts: rows.length,
  touch1: rows.filter((row) => row.sequence_id).length,
  failed_contacts: failures.filter((failure) => failure.person_id != null).length,
  failures,
};
if (JSON_OUTPUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${result.companies} companies, ${result.contacts} contacts, ${result.touch1} touch-1 emails; ${result.failed_contacts} contacts failed.`);
  for (const failure of failures) {
    console.log(`\n${failure.company}${failure.person ? ` / ${failure.person} (${failure.person_id})` : ''}`);
    for (const error of failure.errors) console.log(`  - ${error}`);
  }
}
if (failures.length) process.exitCode = 1;
