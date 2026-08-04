// Fill every active, emailable OutageHub contact from the top of the CRM down
// with one reviewed four-email sequence. Each bounded chunk retries only the
// contacts that still fail the deterministic sequence and spoken-brief gates.
// Existing non-draft messages remain protected by the underlying writer.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';
import { validateSequence, validateSpokenBrief } from '../src/outreach-quality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chunkSize = Math.min(30, Math.max(3, Number(process.env.OHUB_CONTACT_CHUNK || 15)));
const contactLimit = Math.max(0, Number(process.env.OHUB_CONTACT_LIMIT || 0));
const maxAttempts = Math.min(3, Math.max(1, Number(process.env.OHUB_SEQUENCE_ATTEMPTS || 2)));
const setting = db.prepare(
  "SELECT value FROM system_settings WHERE key='legacy_writers_enabled'",
).get();
const priorValue = setting?.value || 'false';
let restored = false;
let child = null;

function setLegacyWriterSetting(value) {
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('legacy_writers_enabled', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(value);
}

function restore() {
  if (restored) return;
  restored = true;
  setLegacyWriterSetting(priorValue);
  console.log(`Restored legacy_writers_enabled=${priorValue}.`);
}

process.once('exit', restore);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (child && !child.killed) child.kill(signal);
  });
}

const companies = db.prepare(`
  SELECT c.id, c.name, pu.cost_model, pu.desired_commitment
  FROM companies c
  LEFT JOIN pursuits pu ON pu.company_id=c.id
  WHERE c.campaign='outagehub' AND c.archived_at IS NULL
`).all();
if (companies.length !== 50) {
  throw new Error(`Expected the curated OutageHub list to contain 50 companies, found ${companies.length}.`);
}
const missingCommercial = companies.filter((company) => (
  !String(company.cost_model || '').includes('Economic case:')
  || !String(company.desired_commitment || '').trim()
));
if (missingCommercial.length) {
  throw new Error(`Commercial hypothesis is missing for ${missingCommercial.length} companies: ${missingCommercial.map((company) => company.name).join(', ')}`);
}

let contacts = db.prepare(`
  SELECT p.id, p.name, p.first_name, p.title, p.sales_brief,
         c.id company_id, c.name company, c.lead_score
  FROM people p
  JOIN companies c ON c.id=p.company_id
  WHERE c.campaign='outagehub' AND c.archived_at IS NULL
    AND p.email LIKE '%@%'
    AND COALESCE(p.lifecycle_status, 'active')!='archived'
  ORDER BY (c.lead_score IS NULL), c.lead_score DESC,
           c.name COLLATE NOCASE, c.id, p.id
`).all();
if (contactLimit) contacts = contacts.slice(0, contactLimit);

function validContactIds(ids = null) {
  const idSet = ids ? new Set(ids.map(Number)) : null;
  const rows = db.prepare(`
    SELECT p.id person_id, p.first_name, p.name, p.title, p.sales_brief,
           s.touch, s.day, s.channel, s.subject, s.body, s.status
    FROM people p
    JOIN companies c ON c.id=p.company_id
    JOIN sequences s ON s.person_id=p.id
    WHERE c.campaign='outagehub' AND c.archived_at IS NULL
    ORDER BY p.id, s.touch
  `).all().filter((row) => !idSet || idSet.has(Number(row.person_id)));
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.person_id)) grouped.set(row.person_id, { row, touches: [] });
    grouped.get(row.person_id).touches.push(row);
  }
  const valid = new Set();
  for (const { row, touches } of grouped.values()) {
    let brief = null;
    try { brief = row.sales_brief ? JSON.parse(row.sales_brief) : null; } catch { /* validation reports it */ }
    const errors = [
      ...validateSequence({
        contact: {
          first_name: row.first_name || String(row.name || '').split(/\s+/)[0],
          title: row.title || '',
        },
        campaign: 'outagehub',
        touches,
      }),
      ...validateSpokenBrief(brief, 'outagehub'),
    ];
    if (!errors.length) valid.add(Number(row.person_id));
  }
  return valid;
}

async function runWriter(personIds) {
  child = spawn(process.execPath, [join(root, 'scripts', 'write-sequences.js'), 'outagehub'], {
    cwd: root,
    env: {
      ...process.env,
      ALLOW_LEGACY_SEQUENCE_WRITE: '1',
      WRITER_IDS: personIds.join(','),
      WRITER_REWRITE: '1',
      WRITER_FORCE_COVERAGE: '1',
      WRITER_BATCH: process.env.WRITER_BATCH || '3',
      WRITER_CONCURRENCY: process.env.WRITER_CONCURRENCY || '3',
      WRITER_REVIEW: process.env.WRITER_REVIEW || '1',
    },
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

try {
  setLegacyWriterSetting('true');
  console.log(`OutageHub all-contact fill: ${contacts.length} contacts in CRM order, ${chunkSize} per chunk.`);
  for (let offset = 0; offset < contacts.length; offset += chunkSize) {
    const chunk = contacts.slice(offset, offset + chunkSize);
    let pending = chunk.map((contact) => contact.id)
      .filter((id) => !validContactIds([id]).has(id));
    for (let attempt = 1; attempt <= maxAttempts && pending.length; attempt++) {
      console.log(`Chunk ${Math.floor(offset / chunkSize) + 1}/${Math.ceil(contacts.length / chunkSize)}, attempt ${attempt}/${maxAttempts}: ${pending.length} contacts (${chunk[0].company} onward).`);
      await runWriter(pending);
      const valid = validContactIds(pending);
      pending = pending.filter((id) => !valid.has(id));
    }
    if (pending.length) {
      console.log(`Chunk remains incomplete after retries: ${pending.join(',')}`);
    }
    const complete = validContactIds().size;
    console.log(`Coverage after chunk: ${complete}/${contacts.length} active OutageHub contacts.`);
  }

  const valid = validContactIds();
  const missing = contacts.filter((contact) => !valid.has(contact.id));
  console.log(`Final coverage: ${valid.size}/${contacts.length} active OutageHub contacts with validated four-email sequences.`);
  if (missing.length) {
    console.log(`Still missing: ${missing.map((contact) => `${contact.id} ${contact.company} / ${contact.name}`).join(' | ')}`);
    process.exitCode = 1;
  }
} finally {
  restore();
}
