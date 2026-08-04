// OutageHub venture store: the research-driven board behind the /outagehub page.
//
// OutageHub normalizes public outage data from supported Canadian utilities and
// matches it to company locations so an existing incident can receive external
// grid context. It does not prove site impact or replace telemetry. This module mirrors
// the GnK "problem → companies → first-touch email" pipeline for that product.
//
// Two tables, both in the shared crm.db:
//   outagehub_problems  — a specific, expensive Canadian problem that live
//                         outage data + SMS/email alerting can solve.
//   outagehub_targets   — a real named company + a buyer contact for one problem,
//                         each carrying a drafted first-touch email.
//
// The discovery agent (scripts/outagehub-discover.js) fills both tables; the
// page reads listOutagehubProblems() (problems with their targets nested).
import { db } from './db.js';

export const OUTAGEHUB_STATUSES = ['discovered', 'approved', 'in_outreach', 'won', 'shelved'];

db.exec(`
CREATE TABLE IF NOT EXISTS outagehub_problems (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  sector             TEXT,
  region             TEXT,                        -- Canadian region or "National"
  one_liner          TEXT,                        -- the crisp problem statement
  who_has_it         TEXT,                        -- profile of orgs with the problem
  workflow_today     TEXT,                        -- how they learn about outages now
  why_expensive      TEXT,                        -- what the blind spot costs them
  outagehub_solution TEXT,                        -- how the API + SMS/email alert layer fixes it
  data_signal        TEXT,                        -- which outage signal/field drives the value
  demo_idea          TEXT,                        -- what a real outage record would show them
  measurable         TEXT,                        -- the metric it moves
  problem_origin     TEXT,                        -- which research scout found it
  advertised_signals TEXT,                        -- JSON direct, dated company disclosures
  buyer_roles        TEXT,                        -- JSON [title, …] who owns budget + pain
  score              INTEGER,                     -- 0..100
  score_breakdown    TEXT,                        -- JSON [{factor, points, of, note}]
  confidence         TEXT,                        -- low | medium | high
  sources            TEXT,                        -- JSON [{title, url, note}]
  status             TEXT DEFAULT 'discovered',
  notes              TEXT,
  run_id             TEXT,                        -- discovery run that produced this
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oh_problems_status ON outagehub_problems(status);
CREATE INDEX IF NOT EXISTS idx_oh_problems_score  ON outagehub_problems(score);

CREATE TABLE IF NOT EXISTS outagehub_targets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id     INTEGER NOT NULL,
  company        TEXT NOT NULL,
  domain         TEXT,
  hq             TEXT,                             -- city/province
  segment        TEXT,                             -- what they do, one line
  why_them       TEXT,                             -- why this company has the problem
  contact_name   TEXT,                             -- named person if found, else a role
  contact_title  TEXT,
  contact_email  TEXT,                             -- real/guessed email if known, else null
  email_subject  TEXT,                             -- drafted first-touch subject
  email_body     TEXT,                             -- drafted first-touch body
  status         TEXT DEFAULT 'drafted',           -- drafted | queued | sent | replied | skip
  created_at     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (problem_id) REFERENCES outagehub_problems(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oh_targets_problem ON outagehub_targets(problem_id);
`);

const outagehubProblemColumns = new Set(
  db.prepare('PRAGMA table_info(outagehub_problems)').all().map((column) => column.name),
);
if (!outagehubProblemColumns.has('problem_origin')) {
  db.exec('ALTER TABLE outagehub_problems ADD COLUMN problem_origin TEXT');
}
if (!outagehubProblemColumns.has('advertised_signals')) {
  db.exec('ALTER TABLE outagehub_problems ADD COLUMN advertised_signals TEXT');
}

const PROBLEM_JSON = new Set([
  'advertised_signals', 'buyer_roles', 'score_breakdown', 'sources',
]);

const PROBLEM_COLUMNS = [
  'title', 'sector', 'region', 'one_liner', 'who_has_it', 'workflow_today',
  'why_expensive', 'outagehub_solution', 'data_signal', 'demo_idea', 'measurable',
  'problem_origin', 'advertised_signals', 'buyer_roles', 'score',
  'score_breakdown', 'confidence', 'sources',
  'status', 'notes', 'run_id',
];

const TARGET_COLUMNS = [
  'company', 'domain', 'hq', 'segment', 'why_them', 'contact_name',
  'contact_title', 'contact_email', 'email_subject', 'email_body', 'status',
];

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'problem';
}

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}
function encode(key, value) {
  if (value === undefined) return null;
  return PROBLEM_JSON.has(key) ? JSON.stringify(value ?? []) : value;
}
function hydrateProblem(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of PROBLEM_JSON) out[key] = safeJson(row[key], []);
  return out;
}

// ---- Problems -----------------------------------------------------------

export function getProblem(id) {
  return hydrateProblem(db.prepare('SELECT * FROM outagehub_problems WHERE id = ?').get(id));
}
export function getProblemBySlug(slug) {
  return hydrateProblem(db.prepare('SELECT * FROM outagehub_problems WHERE slug = ?').get(slug));
}

export function existingSlugs() {
  return db.prepare('SELECT slug, title FROM outagehub_problems').all();
}

// Problems with their target companies+contacts nested, best score first.
export function listOutagehubProblems({ status } = {}) {
  const where = [], vals = [];
  if (status) { where.push('status = ?'); vals.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM outagehub_problems ${clause} ORDER BY (score IS NULL), score DESC, updated_at DESC`)
    .all(...vals);
  return rows.map((r) => ({ ...hydrateProblem(r), targets: listTargets(r.id) }));
}

// Insert a new problem, or refresh an existing one by slug (never regress status).
export function upsertProblem(p) {
  const slug = p.slug || slugify(p.title);
  const existing = db.prepare('SELECT * FROM outagehub_problems WHERE slug = ?').get(slug);
  if (existing) {
    const sets = [], vals = [];
    for (const key of PROBLEM_COLUMNS) {
      if (!(key in p) || key === 'status') continue;
      sets.push(`${key} = ?`);
      vals.push(encode(key, p[key]));
    }
    sets.push("updated_at = datetime('now')");
    vals.push(existing.id);
    db.prepare(`UPDATE outagehub_problems SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return getProblem(existing.id);
  }
  const cols = ['slug', ...PROBLEM_COLUMNS.filter((k) => k in p)];
  const placeholders = cols.map(() => '?').join(', ');
  const vals = [slug, ...PROBLEM_COLUMNS.filter((k) => k in p).map((k) => encode(k, p[k]))];
  const info = db.prepare(`INSERT INTO outagehub_problems (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  return getProblem(Number(info.lastInsertRowid));
}

export function updateProblem(id, fields) {
  const sets = [], vals = [];
  for (const key of PROBLEM_COLUMNS) {
    if (!(key in fields)) continue;
    sets.push(`${key} = ?`);
    vals.push(encode(key, fields[key]));
  }
  if (!sets.length) return getProblem(id);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE outagehub_problems SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getProblem(id);
}

export function deleteProblem(id) {
  db.prepare('DELETE FROM outagehub_problems WHERE id = ?').run(id);
  return { ok: true };
}

// ---- Targets (company + contact + first-touch email) --------------------

export function listTargets(problemId) {
  return db.prepare('SELECT * FROM outagehub_targets WHERE problem_id = ? ORDER BY id').all(problemId);
}
export function getTarget(id) {
  return db.prepare('SELECT * FROM outagehub_targets WHERE id = ?').get(id);
}

// De-dupe a target within a problem on lowercased company name.
export function upsertTarget(t) {
  const existing = db
    .prepare('SELECT * FROM outagehub_targets WHERE problem_id = ? AND lower(company) = lower(?)')
    .get(t.problem_id, t.company);
  if (existing) {
    const sets = [], vals = [];
    for (const key of TARGET_COLUMNS) {
      if (!(key in t)) continue;
      sets.push(`${key} = ?`);
      vals.push(t[key] ?? null);
    }
    if (!sets.length) return existing;
    vals.push(existing.id);
    db.prepare(`UPDATE outagehub_targets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return getTarget(existing.id);
  }
  const cols = ['problem_id', ...TARGET_COLUMNS.filter((k) => k in t)];
  const placeholders = cols.map(() => '?').join(', ');
  const vals = [t.problem_id, ...TARGET_COLUMNS.filter((k) => k in t).map((k) => t[k] ?? null)];
  const info = db.prepare(`INSERT INTO outagehub_targets (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  return getTarget(Number(info.lastInsertRowid));
}

export function updateTarget(id, fields) {
  const sets = [], vals = [];
  for (const key of TARGET_COLUMNS) {
    if (!(key in fields)) continue;
    sets.push(`${key} = ?`);
    vals.push(fields[key] ?? null);
  }
  if (!sets.length) return getTarget(id);
  vals.push(id);
  db.prepare(`UPDATE outagehub_targets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getTarget(id);
}

export function deleteTarget(id) {
  db.prepare('DELETE FROM outagehub_targets WHERE id = ?').run(id);
  return { ok: true };
}

// ---- Stats --------------------------------------------------------------

export function outagehubStats() {
  const byStatus = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) n FROM outagehub_problems GROUP BY status').all().map((r) => [r.status, r.n]),
  );
  const totals = db.prepare(`
    SELECT COUNT(*) AS problems,
           COUNT(*) FILTER (WHERE score >= 65) AS qualified
    FROM outagehub_problems
  `).get();
  const targets = db.prepare(`
    SELECT COUNT(*) AS companies,
           COUNT(*) FILTER (WHERE email_body IS NOT NULL AND email_body != '') AS emails,
           COUNT(*) FILTER (WHERE contact_email LIKE '%@%') AS emailable
    FROM outagehub_targets
  `).get();
  return { byStatus, ...totals, ...targets, statuses: OUTAGEHUB_STATUSES };
}
