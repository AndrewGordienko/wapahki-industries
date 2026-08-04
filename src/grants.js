// Grant opportunity store.
//
// A grant row is one program × one applicant. Keeping the applicant on the row
// makes eligibility, gaps, scoring, next actions and outreach independently
// reviewable when the same program could fit both ventures.
import { db } from './db.js';

export const GRANT_STATUSES = [
  'discovered', 'verify', 'eligible', 'preparing', 'applied',
  'won', 'rejected', 'not_eligible', 'watching', 'closed',
];
export const CONTACT_STATUSES = ['drafted', 'verify', 'ready', 'sent', 'replied', 'skip'];
export const APPLICANTS = ['outagehub', 'wapahki'];

db.exec(`
CREATE TABLE IF NOT EXISTS grants (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                  TEXT NOT NULL UNIQUE,
  applicant             TEXT NOT NULL,
  program_name          TEXT NOT NULL,
  funder                TEXT NOT NULL,
  stream                TEXT,
  jurisdiction          TEXT,
  funding_type          TEXT,
  amount_min            INTEGER,
  amount_max            INTEGER,
  coverage_percent      INTEGER,
  stackable             TEXT,
  intake_status         TEXT,
  deadline              TEXT,
  deadline_note         TEXT,
  recurring             INTEGER DEFAULT 0,
  official_url          TEXT NOT NULL,
  application_url       TEXT,
  summary               TEXT,
  eligible_applicants   TEXT,
  eligible_costs        TEXT,
  project_fit           TEXT,
  why_fit               TEXT,
  eligibility_result    TEXT,
  eligibility_reason    TEXT,
  eligibility_gaps      TEXT,
  application_requirements TEXT,
  next_steps            TEXT,
  score                 INTEGER,
  score_breakdown       TEXT,
  confidence            TEXT,
  sources               TEXT,
  status                TEXT DEFAULT 'discovered',
  notes                 TEXT,
  last_verified_at      TEXT,
  run_id                TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grants_applicant ON grants(applicant);
CREATE INDEX IF NOT EXISTS idx_grants_status ON grants(status);
CREATE INDEX IF NOT EXISTS idx_grants_score ON grants(score);
CREATE INDEX IF NOT EXISTS idx_grants_deadline ON grants(deadline);

CREATE TABLE IF NOT EXISTS grant_contacts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id       INTEGER NOT NULL,
  contact_key    TEXT NOT NULL,
  organization   TEXT,
  contact_name   TEXT,
  contact_title  TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  contact_url    TEXT,
  email_confidence TEXT,
  why_contact    TEXT,
  email_subject  TEXT,
  email_body     TEXT,
  status         TEXT DEFAULT 'drafted',
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(grant_id, contact_key),
  FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_grant_contacts_grant ON grant_contacts(grant_id);
`);

const JSON_COLUMNS = new Set([
  'eligibility_gaps', 'application_requirements', 'next_steps',
  'score_breakdown', 'sources',
]);
const GRANT_COLUMNS = [
  'applicant', 'program_name', 'funder', 'stream', 'jurisdiction',
  'funding_type', 'amount_min', 'amount_max', 'coverage_percent', 'stackable',
  'intake_status', 'deadline', 'deadline_note', 'recurring', 'official_url',
  'application_url', 'summary', 'eligible_applicants', 'eligible_costs',
  'project_fit', 'why_fit', 'eligibility_result', 'eligibility_reason',
  'eligibility_gaps', 'application_requirements', 'next_steps', 'score',
  'score_breakdown', 'confidence', 'sources', 'status', 'notes',
  'last_verified_at', 'run_id',
];
const CONTACT_COLUMNS = [
  'organization', 'contact_name', 'contact_title', 'contact_email',
  'contact_phone', 'contact_url', 'email_confidence', 'why_contact',
  'email_subject', 'email_body', 'status',
];
const MANUAL_GRANT_STATUSES = new Set([
  'preparing', 'applied', 'won', 'rejected', 'not_eligible',
]);

function safeJson(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function encode(key, value) {
  if (JSON_COLUMNS.has(key)) return JSON.stringify(value ?? []);
  if (key === 'recurring') return value ? 1 : 0;
  return value ?? null;
}

function hydrateGrant(row) {
  if (!row) return row;
  const out = { ...row, recurring: Boolean(row.recurring) };
  for (const key of JSON_COLUMNS) out[key] = safeJson(row[key], []);
  return out;
}

export function grantSlug(applicant, programName, stream = '') {
  const text = `${applicant}-${programName}-${stream}`;
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110) || `${applicant}-grant`;
}

export function contactKey(contact = {}) {
  const email = String(contact.contact_email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  return ['role', contact.organization, contact.contact_name, contact.contact_title]
    .map((value) => String(value || '').trim().toLowerCase())
    .join('|')
    .slice(0, 220);
}

export function getGrant(id) {
  return hydrateGrant(db.prepare('SELECT * FROM grants WHERE id = ?').get(id));
}

export function getGrantBySlug(slug) {
  return hydrateGrant(db.prepare('SELECT * FROM grants WHERE slug = ?').get(slug));
}

export function existingGrants() {
  return db.prepare(`
    SELECT slug, applicant, program_name, stream, official_url, intake_status
    FROM grants ORDER BY applicant, program_name
  `).all();
}

export function listGrantContacts(grantId) {
  return db.prepare(`
    SELECT * FROM grant_contacts WHERE grant_id = ?
    ORDER BY CASE status WHEN 'ready' THEN 0 WHEN 'drafted' THEN 1 ELSE 2 END, id
  `).all(grantId);
}

export function listGrants({ applicant, status, eligibility } = {}) {
  const where = [];
  const values = [];
  if (applicant) { where.push('applicant = ?'); values.push(applicant); }
  if (status) { where.push('status = ?'); values.push(status); }
  if (eligibility) { where.push('eligibility_result = ?'); values.push(eligibility); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT * FROM grants ${clause}
    ORDER BY
      CASE WHEN deadline IS NOT NULL AND deadline >= date('now') THEN 0 ELSE 1 END,
      CASE WHEN deadline IS NOT NULL AND deadline >= date('now') THEN deadline END,
      score DESC,
      updated_at DESC
  `).all(...values);
  return rows.map((row) => ({
    ...hydrateGrant(row),
    contacts: listGrantContacts(row.id),
  }));
}

export function upsertGrant(input) {
  const slug = input.slug || grantSlug(input.applicant, input.program_name, input.stream);
  const existing = db.prepare('SELECT * FROM grants WHERE slug = ?').get(slug);
  if (existing) {
    const fields = { ...input };
    if (MANUAL_GRANT_STATUSES.has(existing.status)) delete fields.status;
    const sets = [];
    const values = [];
    for (const key of GRANT_COLUMNS) {
      if (!(key in fields)) continue;
      sets.push(`${key} = ?`);
      values.push(encode(key, fields[key]));
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(existing.id);
      db.prepare(`UPDATE grants SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    return getGrant(existing.id);
  }

  const keys = GRANT_COLUMNS.filter((key) => key in input);
  const cols = ['slug', ...keys];
  const values = [slug, ...keys.map((key) => encode(key, input[key]))];
  const marks = cols.map(() => '?').join(', ');
  const info = db.prepare(`
    INSERT INTO grants (${cols.join(', ')}) VALUES (${marks})
  `).run(...values);
  return getGrant(Number(info.lastInsertRowid));
}

export function updateGrant(id, fields) {
  const sets = [];
  const values = [];
  for (const key of GRANT_COLUMNS) {
    if (!(key in fields)) continue;
    sets.push(`${key} = ?`);
    values.push(encode(key, fields[key]));
  }
  if (!sets.length) return getGrant(id);
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE grants SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getGrant(id);
}

export function deleteGrant(id) {
  db.prepare('DELETE FROM grants WHERE id = ?').run(id);
  return { ok: true };
}

export function getGrantContact(id) {
  return db.prepare('SELECT * FROM grant_contacts WHERE id = ?').get(id);
}

export function upsertGrantContact(input) {
  const key = input.contact_key || contactKey(input);
  const existing = db.prepare(`
    SELECT * FROM grant_contacts WHERE grant_id = ? AND contact_key = ?
  `).get(input.grant_id, key);
  if (existing) {
    const sets = [];
    const values = [];
    for (const column of CONTACT_COLUMNS) {
      if (!(column in input)) continue;
      sets.push(`${column} = ?`);
      values.push(input[column] ?? null);
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(existing.id);
      db.prepare(`UPDATE grant_contacts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    return getGrantContact(existing.id);
  }
  const keys = CONTACT_COLUMNS.filter((column) => column in input);
  const columns = ['grant_id', 'contact_key', ...keys];
  const values = [input.grant_id, key, ...keys.map((column) => input[column] ?? null)];
  const marks = columns.map(() => '?').join(', ');
  const info = db.prepare(`
    INSERT INTO grant_contacts (${columns.join(', ')}) VALUES (${marks})
  `).run(...values);
  return getGrantContact(Number(info.lastInsertRowid));
}

export function updateGrantContact(id, fields) {
  const sets = [];
  const values = [];
  for (const key of CONTACT_COLUMNS) {
    if (!(key in fields)) continue;
    sets.push(`${key} = ?`);
    values.push(fields[key] ?? null);
  }
  if (!sets.length) return getGrantContact(id);
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE grant_contacts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getGrantContact(id);
}

export function deleteGrantContact(id) {
  db.prepare('DELETE FROM grant_contacts WHERE id = ?').run(id);
  return { ok: true };
}

export function grantStats(applicant) {
  const grantWhere = applicant ? 'WHERE applicant = ?' : '';
  const contactWhere = applicant ? 'WHERE g.applicant = ?' : '';
  const values = applicant ? [applicant] : [];
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS opportunities,
      COUNT(*) FILTER (WHERE eligibility_result = 'eligible') AS eligible,
      COUNT(*) FILTER (WHERE eligibility_result = 'conditional') AS conditional,
      COUNT(*) FILTER (
        WHERE deadline >= date('now') AND deadline <= date('now', '+45 days')
          AND status NOT IN ('applied', 'won', 'rejected', 'not_eligible', 'closed')
      ) AS due_soon,
      COALESCE(SUM(
        CASE WHEN eligibility_result IN ('eligible', 'conditional')
          AND status NOT IN ('not_eligible', 'closed', 'rejected')
        THEN amount_max ELSE 0 END
      ), 0) AS potential_max
    FROM grants
    ${grantWhere}
  `).get(...values);
  const contacts = db.prepare(`
    SELECT
      COUNT(*) AS contacts,
      COUNT(*) FILTER (WHERE contact_email LIKE '%@%') AS published_emails,
      COUNT(*) FILTER (WHERE email_body IS NOT NULL AND email_body != '') AS email_drafts
    FROM grant_contacts c
    JOIN grants g ON g.id = c.grant_id
    ${contactWhere}
  `).get(...values);
  const byApplicant = Object.fromEntries(
    db.prepare('SELECT applicant, COUNT(*) AS n FROM grants GROUP BY applicant')
      .all().map((row) => [row.applicant, row.n]),
  );
  return {
    ...totals,
    ...contacts,
    byApplicant,
    statuses: GRANT_STATUSES,
    applicants: APPLICANTS,
  };
}
