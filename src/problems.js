// Problem store: the "expensive problems we can solve" backlog that feeds the
// discovery dashboard and (next) the autonomous MVP factory. Shares the same
// crm.db so a discovered problem can later link to accounts/opportunities.
//
// A problem is a scored hypothesis: some set of Canadian organisations bleeds
// money on a manual/underserved workflow, we can build software that fixes it,
// and we get paid a cut of the savings. The `status` column is the pipeline the
// dashboard drives:
//   discovered → approved → building → demo_ready → in_outreach → won | killed
import { db } from './db.js';

export const PROBLEM_STATUSES = [
  'discovered', 'approved', 'building', 'demo_ready', 'in_outreach', 'won', 'killed',
];

db.exec(`
CREATE TABLE IF NOT EXISTS problems (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  sector            TEXT,
  region            TEXT,                       -- Canadian region or "National"
  one_liner         TEXT,                       -- the crisp problem statement
  who_has_it        TEXT,                       -- profile of orgs with the problem
  workflow_today    TEXT,                       -- how it's done now (the manual pain)
  why_expensive     TEXT,                       -- what makes it cost money
  annual_cost_low   INTEGER,                    -- CAD / org / year the problem costs
  annual_cost_high  INTEGER,
  cost_basis        TEXT,                       -- how the cost was estimated
  recurrence        TEXT,                       -- daily | weekly | per-project | …
  measurable        TEXT,                       -- the metric that proves it
  data_availability TEXT,                       -- what data exists + where
  why_unsolved      TEXT,                       -- why software hasn't fixed it yet
  proposed_solution TEXT,                       -- the system we'd build
  savings_low       INTEGER,                    -- CAD / org / year we could save
  savings_high      INTEGER,
  our_cut_low       INTEGER,                     -- our fee (a cut of the savings)
  our_cut_high      INTEGER,
  pricing_basis     TEXT,                        -- how our cut maps to the savings
  demo_idea         TEXT,                        -- what an MVP demo would show
  problem_origin    TEXT,                        -- broad-ideation | company-admissions | talent-bottlenecks | buying-signals
  advertised_signals TEXT,                       -- JSON direct, dated company disclosures
  target_companies  TEXT,                        -- JSON [{name, region, why}]
  buyer_roles       TEXT,                        -- JSON [title, …] who owns the budget/pain
  score             INTEGER,                     -- 0..100
  score_breakdown   TEXT,                        -- JSON [{factor, points, of, note}]
  confidence        TEXT,                        -- low | medium | high
  sources           TEXT,                        -- JSON [{title, url, note}]
  status            TEXT DEFAULT 'discovered',
  product           TEXT,                        -- links to products.json key if it maps to one
  mvp_path          TEXT,                        -- website route once a demo is built
  notes             TEXT,
  run_id            TEXT,                        -- discovery run that produced this
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_problems_status ON problems(status);
CREATE INDEX IF NOT EXISTS idx_problems_score  ON problems(score);
`);

// CREATE TABLE does not add columns to an existing crm.db.
const problemTableColumns = new Set(
  db.prepare('PRAGMA table_info(problems)').all().map((column) => column.name),
);
if (!problemTableColumns.has('problem_origin')) {
  db.exec('ALTER TABLE problems ADD COLUMN problem_origin TEXT');
}
if (!problemTableColumns.has('advertised_signals')) {
  db.exec('ALTER TABLE problems ADD COLUMN advertised_signals TEXT');
}

const JSON_FIELDS = new Set([
  'advertised_signals', 'target_companies', 'buyer_roles', 'score_breakdown', 'sources',
]);

// Every writable column (used by upsert + updateProblem).
const COLUMNS = [
  'title', 'sector', 'region', 'one_liner', 'who_has_it', 'workflow_today',
  'why_expensive', 'annual_cost_low', 'annual_cost_high', 'cost_basis',
  'recurrence', 'measurable', 'data_availability', 'why_unsolved',
  'proposed_solution', 'savings_low', 'savings_high', 'our_cut_low',
  'our_cut_high', 'pricing_basis', 'demo_idea', 'problem_origin',
  'advertised_signals', 'target_companies',
  'buyer_roles', 'score', 'score_breakdown', 'confidence', 'sources',
  'status', 'product', 'mvp_path', 'notes', 'run_id',
];

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'problem';
}

function encode(key, value) {
  if (value === undefined) return null;
  return JSON_FIELDS.has(key) ? JSON.stringify(value ?? (key === 'buyer_roles' ? [] : [])) : value;
}

function hydrate(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of JSON_FIELDS) out[key] = safeJson(row[key], key === 'buyer_roles' ? [] : []);
  return out;
}

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

export function getProblem(id) {
  return hydrate(db.prepare('SELECT * FROM problems WHERE id = ?').get(id));
}

export function getProblemBySlug(slug) {
  return hydrate(db.prepare('SELECT * FROM problems WHERE slug = ?').get(slug));
}

export function listProblems({ status, minScore } = {}) {
  const where = [], vals = [];
  if (status) { where.push('status = ?'); vals.push(status); }
  if (minScore != null) { where.push('score >= ?'); vals.push(minScore); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM problems ${clause} ORDER BY (score IS NULL), score DESC, updated_at DESC`)
    .all(...vals);
  return rows.map(hydrate);
}

// Slugs already stored — the discovery agent uses this to avoid re-proposing the same problem.
export function existingSlugs() {
  return db.prepare('SELECT slug, title FROM problems').all();
}

// Insert a new problem, or update an existing one by slug. Content fields are
// refreshed on re-discovery, but a human/pipeline status advance is preserved
// (we never drag a problem backwards to "discovered" just because it resurfaced).
export function upsertProblem(p) {
  const slug = p.slug || slugify(p.title);
  const existing = db.prepare('SELECT * FROM problems WHERE slug = ?').get(slug);

  if (existing) {
    const sets = [], vals = [];
    for (const key of COLUMNS) {
      if (!(key in p)) continue;
      if (key === 'status') continue; // never regress status on re-discovery
      sets.push(`${key} = ?`);
      vals.push(encode(key, p[key]));
    }
    sets.push("updated_at = datetime('now')");
    vals.push(existing.id);
    db.prepare(`UPDATE problems SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return getProblem(existing.id);
  }

  const cols = ['slug', ...COLUMNS.filter((k) => k in p)];
  const placeholders = cols.map(() => '?').join(', ');
  const vals = [slug, ...COLUMNS.filter((k) => k in p).map((k) => encode(k, p[k]))];
  const info = db.prepare(`INSERT INTO problems (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  return getProblem(Number(info.lastInsertRowid));
}

export function updateProblem(id, fields) {
  const sets = [], vals = [];
  for (const key of COLUMNS) {
    if (!(key in fields)) continue;
    sets.push(`${key} = ?`);
    vals.push(encode(key, fields[key]));
  }
  if (!sets.length) return getProblem(id);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE problems SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getProblem(id);
}

export function deleteProblem(id) {
  db.prepare('DELETE FROM problems WHERE id = ?').run(id);
}

// Counts per status + headline totals for the dashboard header.
export function problemStats() {
  const byStatus = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) n FROM problems GROUP BY status').all().map((r) => [r.status, r.n]),
  );
  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE score >= 65) AS qualified,
           COALESCE(SUM(our_cut_low), 0)  AS pipeline_cut_low,
           COALESCE(SUM(our_cut_high), 0) AS pipeline_cut_high
    FROM problems
  `).get();
  return { byStatus, ...totals, statuses: PROBLEM_STATUSES };
}
