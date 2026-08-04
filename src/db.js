// SQLite storage using Node's built-in driver (no npm install needed).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { buildSequenceSchedule } from './send-timing.js';
import {
  EMAIL_DAILY_CAP,
  SCHEDULE_POLICY_VERSION,
  planCapacitySchedule,
} from './email-capacity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = process.env.CRM_DB_PATH
  ? resolve(process.env.CRM_DB_PATH)
  : join(DATA_DIR, 'crm.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 8000;');

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  domain        TEXT,
  website       TEXT,
  city          TEXT,
  location      TEXT,
  industry      TEXT,
  apollo_org_id TEXT,
  target_titles TEXT,                       -- JSON array of job titles to search in Apollo
  source        TEXT DEFAULT 'manual',      -- seed | manual | google
  notes         TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  name             TEXT,
  first_name       TEXT,
  last_name        TEXT,
  title            TEXT,
  email            TEXT,
  email_status     TEXT,                    -- verified | guessed | locked | unavailable | seed
  linkedin_url     TEXT,
  apollo_person_id TEXT,
  relevance_score  INTEGER,                 -- 0..10, higher = more likely to reply
  relevance_reason TEXT,                    -- "why they'd reply"
  status           TEXT DEFAULT 'new',      -- new | queued | emailed | replied | not_interested
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_people_company ON people(company_id);
CREATE INDEX IF NOT EXISTS idx_people_apollo  ON people(apollo_person_id);

CREATE TABLE IF NOT EXISTS sequences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL,
  campaign    TEXT,
  touch       INTEGER,                  -- 1..7
  day         INTEGER,                  -- send day offset
  channel     TEXT,                     -- email | linkedin
  subject     TEXT,                     -- email only
  body        TEXT,
  status      TEXT DEFAULT 'draft',     -- draft | approved | sent
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_seq_person ON sequences(person_id);
`);

// Lightweight migrations for columns added after first release.
// `campaign` is the legacy funnel key; `product` is its Problem Found successor
// (football | delay | row | outage). Account-based fields (hypothesis, stage,
// lead_score, …) turn each company row into a Problem Found "account".
const COMPANY_MIGRATIONS = [
  ['campaign', "TEXT DEFAULT 'wapahki'"],
  ['tier', 'TEXT'],
  ['product', 'TEXT'],                              // football | delay | row | outage
  ['hypothesis', 'TEXT'],                           // the written account hypothesis
  ['stage', "TEXT DEFAULT 'Researched'"],           // one of shared.stages
  ['lead_score', 'INTEGER'],                        // 0..100 (weighted)
  ['score_breakdown', 'TEXT'],                      // JSON: { factorKey: {points, of, note} }
  ['signals', 'TEXT'],                              // JSON array of captured public signals
  ['referral_path', 'TEXT'],                        // the potential warm route in
  ['gnk_status', "TEXT DEFAULT 'not_engaged'"],     // not_engaged | reviewing | estimated | scoped
  ['gnk_notes', 'TEXT'],                            // GNK feasibility / pricing notes
  ['archived_at', 'TEXT'],                          // soft-delete only; account history is never destroyed
];
for (const [col, decl] of COMPANY_MIGRATIONS) {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE companies ADD COLUMN ${col} ${decl}`);
}

// Canonicalize writes from stale local jobs that may still use the retired
// Forth campaign key. This preserves their work while keeping GnK as the only
// active brand in storage and in the UI.
db.exec(`
DROP TRIGGER IF EXISTS normalize_legacy_forth_company_insert;
DROP TRIGGER IF EXISTS normalize_legacy_forth_sequence_insert;

CREATE TRIGGER normalize_legacy_forth_company_insert
AFTER INSERT ON companies
WHEN lower(COALESCE(NEW.campaign, '')) = 'forth'
  OR COALESCE(NEW.notes, '') GLOB '*Forth*'
  OR COALESCE(NEW.hypothesis, '') GLOB '*Forth*'
  OR COALESCE(NEW.gnk_notes, '') GLOB '*Forth*'
  OR COALESCE(NEW.notes, '') GLOB '*GNK*'
  OR COALESCE(NEW.hypothesis, '') GLOB '*GNK*'
  OR COALESCE(NEW.gnk_notes, '') GLOB '*GNK*'
BEGIN
  UPDATE companies
  SET campaign = CASE WHEN lower(COALESCE(campaign, '')) = 'forth' THEN 'gnk' ELSE campaign END,
      source = replace(source, 'forth', 'gnk'),
      notes = replace(replace(replace(replace(notes, 'Forth Solutions', 'GnK'), 'ForthSolutions', 'GnK'), 'Forth', 'GnK'), 'GNK', 'GnK'),
      hypothesis = replace(replace(replace(replace(hypothesis, 'Forth Solutions', 'GnK'), 'ForthSolutions', 'GnK'), 'Forth', 'GnK'), 'GNK', 'GnK'),
      gnk_notes = replace(replace(replace(replace(gnk_notes, 'Forth Solutions', 'GnK'), 'ForthSolutions', 'GnK'), 'Forth', 'GnK'), 'GNK', 'GnK')
  WHERE id = NEW.id;
END;

CREATE TRIGGER normalize_legacy_forth_sequence_insert
AFTER INSERT ON sequences
WHEN lower(COALESCE(NEW.campaign, '')) = 'forth'
  OR COALESCE(NEW.subject, '') GLOB '*Forth*'
  OR COALESCE(NEW.body, '') GLOB '*Forth*'
  OR COALESCE(NEW.subject, '') GLOB '*GNK*'
  OR COALESCE(NEW.body, '') GLOB '*GNK*'
BEGIN
  UPDATE sequences
  SET campaign = CASE WHEN lower(COALESCE(campaign, '')) = 'forth' THEN 'gnk' ELSE campaign END,
      subject = replace(replace(replace(replace(subject, 'Forth Solutions', 'GnK'), 'ForthSolutions', 'GnK'), 'Forth', 'GnK'), 'GNK', 'GnK'),
      body = replace(replace(replace(replace(body, 'Forth Solutions', 'GnK'), 'ForthSolutions', 'GnK'), 'Forth', 'GnK'), 'GNK', 'GnK')
  WHERE id = NEW.id;
END;
`);

// Contact-map role on each person: economic_buyer | champion | technical | referral.
const PEOPLE_MIGRATIONS = [
  ['role_type', 'TEXT'],
  ['persona', 'TEXT'],
  ['sales_brief', 'TEXT'],               // JSON: role route, skeptical question, proof boundary, next step
  ['lifecycle_status', "TEXT DEFAULT 'active'"], // active | needs_verification | archived | suppressed
  ['last_verified_at', 'TEXT'],
  ['archived_at', 'TEXT'],
  ['suppression_reason', 'TEXT'],
  ['contacted_at', 'TEXT'],
  ['replied_at', 'TEXT'],
  ['bounced_at', 'TEXT'],
];
for (const [col, decl] of PEOPLE_MIGRATIONS) {
  const cols = db.prepare('PRAGMA table_info(people)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE people ADD COLUMN ${col} ${decl}`);
}

const SEQUENCE_MIGRATIONS = [
  ['send_window', 'TEXT'],
  ['timing_reason', 'TEXT'],
  ['scheduled_for', 'TEXT'],
  ['scheduled_local', 'TEXT'],
  ['send_timezone', 'TEXT'],
  ['suggested_window', 'TEXT'],
  ['suggested_reason', 'TEXT'],
  ['suggested_for', 'TEXT'],
  ['suggested_local', 'TEXT'],
  ['suggested_timezone', 'TEXT'],
  ['schedule_policy', 'TEXT'],
  ['schedule_reason', 'TEXT'],
];
for (const [col, decl] of SEQUENCE_MIGRATIONS) {
  const cols = db.prepare('PRAGMA table_info(sequences)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE sequences ADD COLUMN ${col} ${decl}`);
}

// Existing reviewed copy is preserved. Only its deterministic timing metadata
// is backfilled so old and newly generated sequences render consistently.
const timingUpdate = db.prepare(`
  UPDATE sequences
  SET send_window=?, timing_reason=?, scheduled_for=?, scheduled_local=?, send_timezone=?
  WHERE id=?
`);
const timingRows = db.prepare(`
  SELECT s.id, s.person_id, s.campaign, s.touch, s.day, s.channel,
         p.title, c.industry, c.city, c.location, c.campaign AS account_campaign
  FROM sequences s
  JOIN people p ON p.id = s.person_id
  JOIN companies c ON c.id = p.company_id
  WHERE COALESCE(s.schedule_policy, '') NOT IN ('gnk_recovery_hold_v1', 'gnk_recovery_draft_v1')
    AND (
      COALESCE(s.send_window, '') = '' OR COALESCE(s.timing_reason, '') = ''
      OR COALESCE(s.scheduled_for, '') = '' OR COALESCE(s.scheduled_local, '') = ''
      OR COALESCE(s.send_timezone, '') = ''
    )
  ORDER BY s.person_id, s.touch
`).all();
const timingByPerson = new Map();
for (const row of timingRows) {
  if (!timingByPerson.has(row.person_id)) timingByPerson.set(row.person_id, []);
  timingByPerson.get(row.person_id).push(row);
}
for (const rows of timingByPerson.values()) {
  const context = rows[0];
  const schedule = buildSequenceSchedule({
    campaign: context.account_campaign || context.campaign,
    title: context.title,
    industry: context.industry,
    city: context.city,
    location: context.location,
    touches: rows,
  });
  const byTouch = new Map(schedule.map((item) => [Number(item.touch), item]));
  for (const row of rows) {
    const timing = byTouch.get(Number(row.touch));
    if (!timing) continue;
    timingUpdate.run(
      timing.send_window, timing.timing_reason, timing.scheduled_for,
      timing.scheduled_local, timing.send_timezone, row.id,
    );
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_sequences_scheduled ON sequences(status, scheduled_for)');

// Problem Found account-model tables: offers/opportunities, discovery answers,
// and the manual outreach task queue.
db.exec(`
CREATE TABLE IF NOT EXISTS opportunities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  product     TEXT,
  offer_key   TEXT,                     -- sprint30 | pilot60 | deploy90 | annual
  label       TEXT,
  value_low   INTEGER,
  value_high  INTEGER,
  status      TEXT DEFAULT 'draft',     -- draft | proposed | won | lost
  sow         TEXT,                     -- generated statement-of-work / proposal text
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_opp_company ON opportunities(company_id);

CREATE TABLE IF NOT EXISTS discovery (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  qkey        TEXT NOT NULL,            -- qualification question key (workflow, cost, …)
  answer      TEXT,
  updated_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (company_id, qkey),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER,
  person_id   INTEGER,
  product     TEXT,
  channel     TEXT,                     -- email | linkedin | call | research
  touch       INTEGER,
  title       TEXT,
  body        TEXT,
  due_date    TEXT,
  status      TEXT DEFAULT 'todo',      -- todo | done | snoozed
  created_at  TEXT DEFAULT (datetime('now')),
  done_at     TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);

CREATE TABLE IF NOT EXISTS touchpoints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  person_id   INTEGER,
  product     TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  channel     TEXT NOT NULL,              -- email | linkedin | call | meeting | referral | research | note
  direction   TEXT DEFAULT 'outbound',    -- outbound | inbound | internal
  outcome     TEXT,                       -- sent | no_reply | replied | interested | not_interested | referred | meeting_booked | meeting_held | bounced | researched
  message_variant TEXT,                   -- controlled-test label for the message angle
  summary     TEXT,
  notes       TEXT,
  task_id     INTEGER,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_touchpoints_company ON touchpoints(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_touchpoints_person  ON touchpoints(person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_touchpoints_outcome ON touchpoints(outcome);

-- One account, one pursuit narrative. A pursuit is deliberately separate from
-- the broad company record so research can exist without authorizing outreach.
CREATE TABLE IF NOT EXISTS pursuits (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL UNIQUE,
  product           TEXT,
  pursuit_type      TEXT DEFAULT 'pilot_customer', -- pilot_customer | technology_partner | channel_partner | strategic_partner
  status            TEXT DEFAULT 'draft',        -- draft | researching | ready | active | paused | won | lost
  phase             TEXT DEFAULT 'research',     -- research | attention | validation | consensus | pilot | close
  hypothesis_key    TEXT,                        -- shared cohort hypothesis, not a bespoke product per account
  observed_fact     TEXT,                        -- public fact only; never proof of an internal problem
  problem           TEXT,
  evidence          TEXT DEFAULT '[]',           -- JSON [{claim,url,observed_at}]
  workflow_owner    TEXT,                        -- likely role/department; confirm in discovery
  consequence       TEXT,
  records           TEXT,                        -- documents/systems likely to contain the answer
  kill_condition    TEXT,                        -- explicit evidence that ends the pursuit
  workflow_scorecard TEXT DEFAULT '{}',          -- JSON: frequency,cost,measurable,records,owner,testable,engagement_value
  qualification     TEXT DEFAULT '{}',           -- JSON: workflow,consequence,owner,data,champion,pilot_outcome
  cost_model        TEXT,
  cost_confidence   TEXT DEFAULT 'illustrative', -- verified | public_model | illustrative
  offer             TEXT,
  narrative         TEXT,
  desired_commitment TEXT,
  value_to_partner  TEXT,
  value_to_us       TEXT,
  decision_process  TEXT,
  commercial_path   TEXT,
  proof_assets      TEXT DEFAULT '[]',           -- JSON [{name,url,status,owner}]
  success_metrics   TEXT DEFAULT '[]',           -- JSON [{metric,baseline,target,owner}]
  joint_action_plan TEXT DEFAULT '[]',           -- JSON [{milestone,owner,due_date,status}]
  primary_person_id INTEGER,
  next_goal         TEXT,
  approval_status   TEXT DEFAULT 'needs_review', -- needs_review | approved | rejected
  autonomy_status   TEXT DEFAULT 'human_only',   -- human_only | draft_only | approved_actions
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (primary_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pursuits_status ON pursuits(status, approval_status);

CREATE TABLE IF NOT EXISTS pursuit_contacts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pursuit_id       INTEGER NOT NULL,
  person_id        INTEGER NOT NULL,
  role             TEXT NOT NULL,                -- motion-specific functional role; primary route lives on pursuits
  priority         INTEGER DEFAULT 3,
  state            TEXT DEFAULT 'candidate',     -- candidate | selected | contacted | replied | paused | rejected
  reason           TEXT,
  last_verified_at TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  UNIQUE (pursuit_id, person_id),
  FOREIGN KEY (pursuit_id) REFERENCES pursuits(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pursuit_contacts_pursuit ON pursuit_contacts(pursuit_id, priority);

-- The narrative plan is stable; only the next incomplete step is drafted.
CREATE TABLE IF NOT EXISTS pursuit_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pursuit_id    INTEGER NOT NULL,
  step_order    INTEGER NOT NULL,
  step_key      TEXT NOT NULL,
  label         TEXT NOT NULL,
  phase         TEXT NOT NULL,
  channel       TEXT,
  narrative_job TEXT NOT NULL,
  status        TEXT DEFAULT 'planned',          -- planned | ready | drafted | approved | sent | skipped | complete
  person_id     INTEGER,
  planned_for   TEXT,
  completed_at  TEXT,
  outcome       TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  UNIQUE (pursuit_id, step_key),
  FOREIGN KEY (pursuit_id) REFERENCES pursuits(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pursuit_steps_next ON pursuit_steps(pursuit_id, status, step_order);

-- Canonical, append-only message drafts. Revisions create a new row instead of
-- overwriting the copy that Andrew approved or sent.
CREATE TABLE IF NOT EXISTS outreach_drafts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pursuit_id     INTEGER NOT NULL,
  step_id        INTEGER NOT NULL,
  person_id      INTEGER NOT NULL,
  channel        TEXT NOT NULL,
  subject        TEXT,
  body           TEXT NOT NULL,
  status         TEXT DEFAULT 'pending_review',  -- pending_review | approved | rejected | superseded | sent
  revision_of    INTEGER,
  source         TEXT DEFAULT 'manual',
  rationale      TEXT,
  quality_report TEXT DEFAULT '{}',
  created_at     TEXT DEFAULT (datetime('now')),
  approved_at    TEXT,
  rejected_at    TEXT,
  sent_at        TEXT,
  FOREIGN KEY (pursuit_id) REFERENCES pursuits(id) ON DELETE RESTRICT,
  FOREIGN KEY (step_id) REFERENCES pursuit_steps(id) ON DELETE RESTRICT,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
  FOREIGN KEY (revision_of) REFERENCES outreach_drafts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_review ON outreach_drafts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_pursuit ON outreach_drafts(pursuit_id, step_id, created_at);

-- Contacts recovered from backups remain non-sendable until a human verifies
-- employment and explicitly restores them to the live contact map.
CREATE TABLE IF NOT EXISTS contact_archive (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  source_db            TEXT NOT NULL,
  source_person_id     INTEGER NOT NULL,
  company_name         TEXT NOT NULL,
  matched_company_id   INTEGER,
  name                 TEXT,
  first_name           TEXT,
  last_name            TEXT,
  title                TEXT,
  email                TEXT,
  email_status         TEXT,
  linkedin_url         TEXT,
  apollo_person_id     TEXT,
  relevance_score      INTEGER,
  relevance_reason     TEXT,
  prior_status         TEXT,
  notes                TEXT,
  review_status        TEXT DEFAULT 'needs_verification', -- needs_verification | restored | stale | duplicate | suppressed
  restored_person_id   INTEGER,
  created_at           TEXT DEFAULT (datetime('now')),
  reviewed_at          TEXT,
  UNIQUE (source_db, source_person_id),
  FOREIGN KEY (matched_company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (restored_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_archive_review ON contact_archive(review_status, company_name);

-- Immutable audit trails for legacy tables that older scripts still touch.
CREATE TABLE IF NOT EXISTS contact_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER,
  company_id  INTEGER,
  event       TEXT NOT NULL,
  snapshot    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_revisions_person ON contact_revisions(person_id, created_at);

CREATE TABLE IF NOT EXISTS sequence_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER,
  person_id   INTEGER,
  event       TEXT NOT NULL,
  snapshot    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sequence_revisions_person ON sequence_revisions(person_id, created_at);

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('autonomous_sending_enabled', 'false'),
  ('require_human_approval', 'true'),
  ('legacy_writers_enabled', 'false'),
  ('max_new_contacts_per_account_day', '1'),
  ('max_emails_per_business_day', '${EMAIL_DAILY_CAP}'),
  ('email_schedule_policy_version', '${SCHEDULE_POLICY_VERSION}');

DROP TRIGGER IF EXISTS audit_person_update;
CREATE TRIGGER audit_person_update BEFORE UPDATE ON people
BEGIN
  INSERT INTO contact_revisions (person_id, company_id, event, snapshot)
  VALUES (
    OLD.id, OLD.company_id, 'update',
    json_object(
      'name', OLD.name, 'title', OLD.title, 'email', OLD.email,
      'email_status', OLD.email_status, 'status', OLD.status,
      'role_type', OLD.role_type, 'lifecycle_status', OLD.lifecycle_status,
      'notes', OLD.notes
    )
  );
END;

DROP TRIGGER IF EXISTS audit_person_delete;
CREATE TRIGGER audit_person_delete BEFORE DELETE ON people
BEGIN
  INSERT INTO contact_revisions (person_id, company_id, event, snapshot)
  VALUES (
    OLD.id, OLD.company_id, 'delete_attempt',
    json_object(
      'name', OLD.name, 'title', OLD.title, 'email', OLD.email,
      'email_status', OLD.email_status, 'status', OLD.status,
      'role_type', OLD.role_type, 'lifecycle_status', OLD.lifecycle_status,
      'notes', OLD.notes
    )
  );
END;

DROP TRIGGER IF EXISTS audit_sequence_update;
CREATE TRIGGER audit_sequence_update BEFORE UPDATE ON sequences
BEGIN
  INSERT INTO sequence_revisions (sequence_id, person_id, event, snapshot)
  VALUES (
    OLD.id, OLD.person_id, 'update',
    json_object(
      'campaign', OLD.campaign, 'touch', OLD.touch, 'day', OLD.day,
      'channel', OLD.channel, 'subject', OLD.subject, 'body', OLD.body,
      'status', OLD.status, 'created_at', OLD.created_at
    )
  );
END;

DROP TRIGGER IF EXISTS audit_sequence_delete;
CREATE TRIGGER audit_sequence_delete BEFORE DELETE ON sequences
BEGIN
  INSERT INTO sequence_revisions (sequence_id, person_id, event, snapshot)
  VALUES (
    OLD.id, OLD.person_id, 'delete_attempt',
    json_object(
      'campaign', OLD.campaign, 'touch', OLD.touch, 'day', OLD.day,
      'channel', OLD.channel, 'subject', OLD.subject, 'body', OLD.body,
      'status', OLD.status, 'created_at', OLD.created_at
    )
  );
END;
`);

const PURSUIT_MIGRATIONS = [
  ['pursuit_type', "TEXT DEFAULT 'pilot_customer'"],
  ['hypothesis_key', 'TEXT'],
  ['observed_fact', 'TEXT'],
  ['workflow_owner', 'TEXT'],
  ['records', 'TEXT'],
  ['kill_condition', 'TEXT'],
  ['workflow_scorecard', "TEXT DEFAULT '{}'"],
  ['qualification', "TEXT DEFAULT '{}'"],
  ['desired_commitment', 'TEXT'],
  ['value_to_partner', 'TEXT'],
  ['value_to_us', 'TEXT'],
  ['decision_process', 'TEXT'],
  ['commercial_path', 'TEXT'],
  ['proof_assets', "TEXT DEFAULT '[]'"],
  ['success_metrics', "TEXT DEFAULT '[]'"],
  ['joint_action_plan', "TEXT DEFAULT '[]'"],
];
for (const [col, decl] of PURSUIT_MIGRATIONS) {
  const cols = db.prepare('PRAGMA table_info(pursuits)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE pursuits ADD COLUMN ${col} ${decl}`);
}

const TOUCHPOINT_MIGRATIONS = [
  ['subject', 'TEXT'],
  ['body', 'TEXT'],
  ['outreach_draft_id', 'INTEGER'],
  ['message_variant', 'TEXT'],
];
for (const [col, decl] of TOUCHPOINT_MIGRATIONS) {
  const cols = db.prepare('PRAGMA table_info(touchpoints)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE touchpoints ADD COLUMN ${col} ${decl}`);
}

// Sort companies easy → medium → hard (untiered rows sort last, then by name).
const TIER_ORDER = "CASE lower(tier) WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 WHEN 'hard' THEN 2 ELSE 3 END";

// ---- Companies ----------------------------------------------------------

export function listCompanies(campaign) {
  const order = `ORDER BY ${TIER_ORDER}, name COLLATE NOCASE`;
  if (campaign) {
    return db.prepare(`SELECT * FROM companies WHERE campaign = ? AND archived_at IS NULL ${order}`).all(campaign);
  }
  return db.prepare(`SELECT * FROM companies WHERE archived_at IS NULL ${order}`).all();
}

// Count of companies + emailable contacts per campaign (for the funnel tabs).
export function campaignStats() {
  return db.prepare(`
    SELECT c.campaign AS campaign,
           COUNT(DISTINCT c.id) AS companies,
           COUNT(p.id) FILTER (
             WHERE p.email LIKE '%@%'
               AND COALESCE(p.lifecycle_status, 'active') != 'archived'
           ) AS contacts
    FROM companies c LEFT JOIN people p ON p.company_id = c.id
    GROUP BY c.campaign ORDER BY c.campaign
  `).all();
}

export function getCompany(id) {
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
}

export function getCompanyByName(name) {
  return db.prepare('SELECT * FROM companies WHERE name = ?').get(name);
}

export function insertCompany(c) {
  const stmt = db.prepare(`
    INSERT INTO companies (name, domain, website, city, location, industry, apollo_org_id, target_titles, source, notes, campaign, tier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    c.name,
    c.domain ?? null,
    c.website ?? null,
    c.city ?? null,
    c.location ?? null,
    c.industry ?? null,
    c.apollo_org_id ?? null,
    JSON.stringify(c.target_titles ?? []),
    c.source ?? 'manual',
    c.notes ?? null,
    c.campaign ?? 'wapahki',
    c.tier ?? null
  );
  return getCompany(Number(info.lastInsertRowid));
}

// Fields whose values are stored as JSON text.
const JSON_COMPANY_FIELDS = new Set(['target_titles', 'score_breakdown', 'signals']);

export function updateCompany(id, fields) {
  const allowed = [
    'domain', 'website', 'city', 'location', 'industry', 'apollo_org_id', 'target_titles', 'notes',
    // Problem Found account fields:
    'product', 'campaign', 'tier', 'hypothesis', 'stage', 'lead_score', 'score_breakdown',
    'signals', 'referral_path', 'gnk_status', 'gnk_notes',
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k} = ?`);
      vals.push(JSON_COMPANY_FIELDS.has(k) ? JSON.stringify(fields[k]) : fields[k]);
    }
  }
  if (!sets.length) return getCompany(id);
  vals.push(id);
  db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getCompany(id);
}

export function deleteCompany(id) {
  db.prepare(`
    UPDATE people
    SET lifecycle_status = 'archived', archived_at = COALESCE(archived_at, datetime('now'))
    WHERE company_id = ? AND lifecycle_status != 'archived'
  `).run(id);
  db.prepare("UPDATE companies SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?").run(id);
}

// ---- People -------------------------------------------------------------

export function listPeopleByCompany(companyId, { includeArchived = false } = {}) {
  const archived = includeArchived ? '' : "AND COALESCE(lifecycle_status, 'active') != 'archived'";
  return db
    .prepare(`SELECT * FROM people WHERE company_id = ? ${archived} ORDER BY relevance_score DESC, name COLLATE NOCASE`)
    .all(companyId);
}

export function getPerson(id) {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(id);
}

// Insert or update a person. De-dupes on apollo_person_id, else on (company_id, lowercased name).
export function upsertPerson(p) {
  let existing = null;
  if (p.apollo_person_id) {
    existing = db.prepare('SELECT * FROM people WHERE apollo_person_id = ?').get(p.apollo_person_id);
  }
  if (!existing && p.name) {
    existing = db
      .prepare('SELECT * FROM people WHERE company_id = ? AND lower(name) = lower(?)')
      .get(p.company_id, p.name);
  }

  if (existing) {
    // Merge: only overwrite fields when the incoming value is meaningful.
    const merged = {
      title: p.title ?? existing.title,
      email: p.email && !p.email.includes('email_not_unlocked') ? p.email : existing.email,
      email_status: p.email_status ?? existing.email_status,
      linkedin_url: p.linkedin_url ?? existing.linkedin_url,
      apollo_person_id: p.apollo_person_id ?? existing.apollo_person_id,
      first_name: p.first_name ?? existing.first_name,
      last_name: p.last_name ?? existing.last_name,
      relevance_score: p.relevance_score ?? existing.relevance_score,
      relevance_reason: p.relevance_reason ?? existing.relevance_reason,
    };
    db.prepare(`
      UPDATE people SET title=?, email=?, email_status=?, linkedin_url=?, apollo_person_id=?,
        first_name=?, last_name=?, relevance_score=?, relevance_reason=?
      WHERE id = ?
    `).run(
      merged.title, merged.email, merged.email_status, merged.linkedin_url, merged.apollo_person_id,
      merged.first_name, merged.last_name, merged.relevance_score, merged.relevance_reason, existing.id
    );
    return getPerson(existing.id);
  }

  const info = db.prepare(`
    INSERT INTO people (company_id, name, first_name, last_name, title, email, email_status,
      linkedin_url, apollo_person_id, relevance_score, relevance_reason, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.company_id, p.name ?? null, p.first_name ?? null, p.last_name ?? null, p.title ?? null,
    p.email ?? null, p.email_status ?? null, p.linkedin_url ?? null, p.apollo_person_id ?? null,
    p.relevance_score ?? null, p.relevance_reason ?? null, p.status ?? 'new', p.notes ?? null
  );
  return getPerson(Number(info.lastInsertRowid));
}

export function updatePerson(id, fields) {
  const allowed = [
    'name', 'title', 'email', 'email_status', 'linkedin_url', 'relevance_score',
    'relevance_reason', 'status', 'notes', 'role_type', 'persona', 'sales_brief',
    'lifecycle_status', 'last_verified_at', 'archived_at', 'suppression_reason',
    'contacted_at', 'replied_at', 'bounced_at',
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in fields) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (!sets.length) return getPerson(id);
  vals.push(id);
  db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getPerson(id);
}

export function deletePerson(id) {
  db.prepare(`
    UPDATE people
    SET lifecycle_status = 'archived',
        archived_at = COALESCE(archived_at, datetime('now'))
    WHERE id = ?
  `).run(id);
  return getPerson(id);
}

// ---- Sequences (generated 7-touch email/LinkedIn drafts) -----------------

export function listSequencesByPerson(personId) {
  return db.prepare('SELECT * FROM sequences WHERE person_id = ? ORDER BY touch').all(personId);
}

// Mark one touch (draft | approved | sent) — used by the Gmail-style sequence modal.
export function setSequenceStatus(id, status) {
  db.prepare('UPDATE sequences SET status = ? WHERE id = ?').run(status, id);
  return db.prepare('SELECT * FROM sequences WHERE id = ?').get(id);
}

function assertLegacySequenceWriteAllowed(campaign) {
  const setting = db.prepare("SELECT value FROM system_settings WHERE key = 'legacy_writers_enabled'").get();
  const explicitlyScopedCampaign = String(process.env.LEGACY_SEQUENCE_WRITE_CAMPAIGN || '').trim();
  const processIsAuthorized = process.env.ALLOW_LEGACY_SEQUENCE_WRITE === '1';
  if (processIsAuthorized && (
    setting?.value === 'true'
    || (explicitlyScopedCampaign && explicitlyScopedCampaign === String(campaign || '').trim())
  )) return;
  throw new Error(
    'Legacy sequence writers are quarantined. Use the pursuit next-touch workflow; '
    + 'a deliberate migration requires ALLOW_LEGACY_SEQUENCE_WRITE=1 plus either '
    + 'legacy_writers_enabled=true or an exact LEGACY_SEQUENCE_WRITE_CAMPAIGN scope.',
  );
}

// Replace a person's whole sequence with a fresh set of touches.
export function replaceSequence(personId, campaign, touches) {
  assertLegacySequenceWriteAllowed(campaign);
  const protectedCount = db.prepare(
    "SELECT COUNT(*) AS n FROM sequences WHERE person_id = ? AND status <> 'draft'",
  ).get(personId).n;
  if (protectedCount) throw new Error('Approved or sent messages cannot be replaced by a sequence writer.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM sequences WHERE person_id = ?').run(personId);
    const context = db.prepare(`
      SELECT p.title, c.industry, c.city, c.location, c.campaign AS account_campaign
      FROM people p JOIN companies c ON c.id = p.company_id
      WHERE p.id = ?
    `).get(personId) || {};
    const schedule = buildSequenceSchedule({
      campaign: context.account_campaign || campaign,
      title: context.title,
      industry: context.industry,
      city: context.city,
      location: context.location,
      touches,
    });
    const timingByTouch = new Map(schedule.map((item) => [Number(item.touch), item]));
    const stmt = db.prepare(`
      INSERT INTO sequences (
        person_id, campaign, touch, day, channel, subject, body,
        send_window, timing_reason, scheduled_for, scheduled_local, send_timezone,
        suggested_window, suggested_reason, suggested_for, suggested_local, suggested_timezone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of touches) {
      const timing = timingByTouch.get(Number(t.touch))
        || buildSequenceSchedule({
          campaign: context.account_campaign || campaign,
          title: context.title,
          industry: context.industry,
          city: context.city,
          location: context.location,
          touches: [t],
        })[0];
      stmt.run(
        personId, campaign, t.touch ?? null, t.day ?? null, t.channel ?? null,
        t.subject ?? null, t.body ?? null, timing.send_window, timing.timing_reason,
        timing.scheduled_for, timing.scheduled_local, timing.send_timezone,
        timing.send_window, timing.timing_reason, timing.scheduled_for,
        timing.scheduled_local, timing.send_timezone,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return listSequencesByPerson(personId);
}

// Complete or rewrite only the draft portion of a sequence while preserving
// approved/sent history byte-for-byte. Used when an account already has real
// outbound touches but still needs the remainder of the canonical sequence.
export function replaceDraftSequence(personId, campaign, touches) {
  assertLegacySequenceWriteAllowed(campaign);
  const protectedTouches = new Set(db.prepare(
    "SELECT touch FROM sequences WHERE person_id=? AND status<>'draft'",
  ).all(personId).map((row) => Number(row.touch)));
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("DELETE FROM sequences WHERE person_id=? AND status='draft'").run(personId);
    const context = db.prepare(`
      SELECT p.title,c.industry,c.city,c.location,c.campaign AS account_campaign
      FROM people p JOIN companies c ON c.id=p.company_id WHERE p.id=?
    `).get(personId) || {};
    const schedule = buildSequenceSchedule({
      campaign: context.account_campaign || campaign,
      title: context.title,
      industry: context.industry,
      city: context.city,
      location: context.location,
      touches,
    });
    const timingByTouch = new Map(schedule.map((item) => [Number(item.touch), item]));
    const insert = db.prepare(`
      INSERT INTO sequences(person_id,campaign,touch,day,channel,subject,body,
        send_window,timing_reason,scheduled_for,scheduled_local,send_timezone,
        suggested_window,suggested_reason,suggested_for,suggested_local,suggested_timezone)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const touch of touches) {
      if (protectedTouches.has(Number(touch.touch))) continue;
      const timing = timingByTouch.get(Number(touch.touch));
      insert.run(
        personId, campaign, touch.touch ?? null, touch.day ?? null, touch.channel ?? null,
        touch.subject ?? null, touch.body ?? null, timing.send_window, timing.timing_reason,
        timing.scheduled_for, timing.scheduled_local, timing.send_timezone,
        timing.send_window, timing.timing_reason, timing.scheduled_for,
        timing.scheduled_local, timing.send_timezone,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return listSequencesByPerson(personId);
}

export function sequenceCountByPerson(personId) {
  return db.prepare('SELECT COUNT(*) n FROM sequences WHERE person_id = ?').get(personId).n;
}

// Insert/replace a SINGLE touch (used by column-by-column generation).
export function replaceTouch(personId, campaign, t) {
  assertLegacySequenceWriteAllowed(campaign);
  db.prepare('DELETE FROM sequences WHERE person_id = ? AND touch = ?').run(personId, t.touch);
  const context = db.prepare(`
    SELECT p.title, c.industry, c.city, c.location, c.campaign AS account_campaign
    FROM people p JOIN companies c ON c.id = p.company_id
    WHERE p.id = ?
  `).get(personId) || {};
  const timing = buildSequenceSchedule({
    campaign: context.account_campaign || campaign,
    title: context.title,
    industry: context.industry,
    city: context.city,
    location: context.location,
    touches: [t],
  })[0];
  db.prepare(`INSERT INTO sequences (
                person_id, campaign, touch, day, channel, subject, body,
                send_window, timing_reason, scheduled_for, scheduled_local, send_timezone,
                suggested_window, suggested_reason, suggested_for, suggested_local, suggested_timezone
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    personId, campaign, t.touch ?? null, t.day ?? null, t.channel ?? null,
    t.subject ?? null, t.body ?? null, timing.send_window, timing.timing_reason,
    timing.scheduled_for, timing.scheduled_local, timing.send_timezone,
    timing.send_window, timing.timing_reason, timing.scheduled_for,
    timing.scheduled_local, timing.send_timezone);
  // T2 is a reply in T1's thread. Keep an unsent draft attached when a writer
  // repairs or personalizes T1 after T2 already exists.
  if (Number(t.touch) === 1) {
    db.prepare(`
      UPDATE sequences
      SET subject = ?
      WHERE person_id = ? AND touch = 2 AND channel = 'email' AND status = 'draft'
    `).run(t.subject ?? null, personId);
  }
  // Wapahki T5 is a reply in the emerging-hypothesis thread opened by T4.
  if (String(campaign || '').toLowerCase() === 'wapahki' && Number(t.touch) === 4) {
    db.prepare(`
      UPDATE sequences
      SET subject = ?
      WHERE person_id = ? AND touch = 5 AND channel = 'email' AND status = 'draft'
    `).run(t.subject ?? null, personId);
  }
}

// Rebuild every eligible unsent email against the shared brand-level capacity
// budget. This is explicit (CLI/API callers decide when to run it) because a
// full rebalance changes operating dates and must not happen invisibly whenever
// a single writer saves one draft.
export function rebalanceEmailSchedule({ start, dailyCap = EMAIL_DAILY_CAP, dryRun = false } = {}) {
  // New/legacy writers initially place their role-specific recommendation in
  // the scheduled_* fields. Capture it once before the capacity layer moves the
  // final delivery time; the recommendation remains immutable thereafter.
  if (!dryRun) {
    db.prepare(`
      UPDATE sequences
      SET suggested_window=send_window,
          suggested_reason=timing_reason,
          suggested_for=scheduled_for,
          suggested_local=scheduled_local,
          suggested_timezone=send_timezone
      WHERE channel='email' AND COALESCE(suggested_for, '')=''
        AND COALESCE(schedule_policy, '')=''
        AND COALESCE(scheduled_for, '')!=''
    `).run();
  }
  const rows = db.prepare(`
    SELECT s.id, s.person_id, s.campaign, s.touch, s.day, s.channel, s.status,
           s.scheduled_for, s.suggested_for, s.suggested_window,
           s.suggested_timezone, s.created_at, p.email,
           COALESCE(c.campaign, c.product, s.campaign) account_campaign
    FROM sequences s
    JOIN people p ON p.id=s.person_id
    JOIN companies c ON c.id=p.company_id
    WHERE s.channel='email'
      AND c.archived_at IS NULL
      AND p.replied_at IS NULL
      AND COALESCE(p.lifecycle_status, 'active')='active'
      AND COALESCE(s.schedule_policy, '') NOT IN ('gnk_recovery_hold_v1', 'gnk_recovery_draft_v1')
    ORDER BY s.person_id, s.touch
  `).all()
    .filter((row) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.email || '').trim()))
    .map((row) => ({ ...row, campaign: row.account_campaign || row.campaign }));
  const plan = planCapacitySchedule(rows, { start, dailyCap });
  if (dryRun) return plan;
  const update = db.prepare(`
    UPDATE sequences
    SET scheduled_for=?, scheduled_local=?, send_timezone=?, schedule_policy=?, schedule_reason=?
    WHERE id=? AND status!='sent' AND (
      COALESCE(scheduled_for, '') != ? OR COALESCE(scheduled_local, '') != ? OR
      COALESCE(send_timezone, '') != ? OR COALESCE(schedule_policy, '') != ? OR
      COALESCE(schedule_reason, '') != ?
    )
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    let appliedChanges = 0;
    for (const assignment of plan.assignments) {
      const result = update.run(
        assignment.scheduled_for,
        assignment.scheduled_local,
        assignment.send_timezone,
        plan.policy,
        assignment.schedule_reason,
        assignment.id,
        assignment.scheduled_for,
        assignment.scheduled_local,
        assignment.send_timezone,
        plan.policy,
        assignment.schedule_reason,
      );
      appliedChanges += Number(result.changes || 0);
    }
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) VALUES ('max_emails_per_business_day', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
    `).run(String(plan.daily_cap));
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) VALUES ('email_schedule_policy_version', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
    `).run(plan.policy);
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) VALUES ('email_schedule_start', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
    `).run(String(start || new Date().toISOString().slice(0, 10)));
    db.exec('COMMIT');
    plan.applied_changes = appliedChanges;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return plan;
}

// { person_id: touch_count } across all sequences (one query, for the UI badges).
export function sequenceCounts() {
  const m = {};
  for (const r of db.prepare('SELECT person_id, COUNT(*) n FROM sequences GROUP BY person_id').all()) m[r.person_id] = r.n;
  return m;
}

// { person_id: [touch, …] } — the actual messages, for the touch columns.
export function sequencesByPerson() {
  const m = {};
  for (const r of db.prepare('SELECT id, person_id, touch, day, channel, subject, body, send_window, timing_reason, scheduled_for, scheduled_local, send_timezone, suggested_window, suggested_reason, suggested_for, suggested_local, suggested_timezone, schedule_policy, schedule_reason, status, created_at FROM sequences ORDER BY person_id, touch').all()) {
    (m[r.person_id] ||= []).push(r);
  }
  return m;
}

// ---- Aggregates ---------------------------------------------------------

// Decode the JSON-encoded account fields and nest people. Shared by the
// legacy campaign view and the Problem Found account view.
function hydrateCompany(c, seqs) {
  const people = listPeopleByCompany(c.id).map((p) => {
    const sequence = seqs[p.id] || [];
    return {
      ...p,
      sales_brief: safeJson(p.sales_brief, null),
      sequence,
      msgs: sequence.length,
      latest_sequence_at: sequence.reduce((latest, message) => (
        String(message.created_at || '') > latest ? String(message.created_at || '') : latest
      ), ''),
    };
  }).sort((left, right) => (
    String(right.latest_sequence_at || '').localeCompare(String(left.latest_sequence_at || ''))
      || Number(right.relevance_score || 0) - Number(left.relevance_score || 0)
      || Number(left.id) - Number(right.id)
  ));
  return {
    ...c,
    target_titles: safeJson(c.target_titles, []),
    signals: safeJson(c.signals, []),
    score_breakdown: safeJson(c.score_breakdown, null),
    latest_sequence_at: people.reduce((latest, person) => (
      person.latest_sequence_at > latest ? person.latest_sequence_at : latest
    ), ''),
    people,
  };
}

// Companies with their people nested, sorted for the UI. Optionally scoped to one campaign.
export function companiesWithPeople(campaign) {
  const seqs = sequencesByPerson();
  return listCompanies(campaign)
    .map((c) => hydrateCompany(c, seqs))
    .sort((left, right) => (
      String(right.latest_sequence_at || '').localeCompare(String(left.latest_sequence_at || ''))
        || String(left.name || '').localeCompare(String(right.name || ''))
    ));
}

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

// ---- Problem Found: accounts by product --------------------------------

export function listCompaniesByProduct(product) {
  const order = `ORDER BY (lead_score IS NULL), lead_score DESC, name COLLATE NOCASE`;
  if (product) return db.prepare(`SELECT * FROM companies WHERE product = ? AND archived_at IS NULL ${order}`).all(product);
  return db.prepare(`SELECT * FROM companies WHERE archived_at IS NULL ${order}`).all();
}

// Accounts (companies) for one product, fully hydrated with people + counts.
export function accountsForProduct(product) {
  const seqs = sequencesByPerson();
  const oppN = countBy('SELECT company_id, COUNT(*) n FROM opportunities GROUP BY company_id');
  const taskN = countBy("SELECT company_id, COUNT(*) n FROM tasks WHERE status='todo' GROUP BY company_id");
  const discN = countBy('SELECT company_id, COUNT(*) n FROM discovery GROUP BY company_id');
  const touchN = countBy('SELECT company_id, COUNT(*) n FROM touchpoints GROUP BY company_id');
  const lastTouch = valueBy('SELECT company_id, MAX(occurred_at) value FROM touchpoints GROUP BY company_id');
  const nextAction = valueBy("SELECT company_id, MIN(due_date) value FROM tasks WHERE status='todo' AND due_date IS NOT NULL GROUP BY company_id");
  return listCompaniesByProduct(product).map((c) => ({
    ...hydrateCompany(c, seqs),
    opp_count: oppN[c.id] || 0,
    open_task_count: taskN[c.id] || 0,
    discovery_count: discN[c.id] || 0,
    touchpoint_count: touchN[c.id] || 0,
    last_touch_at: lastTouch[c.id] || null,
    next_action_at: nextAction[c.id] || null,
  }));
}

function countBy(sql) {
  const m = {};
  for (const r of db.prepare(sql).all()) m[r.company_id] = r.n;
  return m;
}

function valueBy(sql) {
  const m = {};
  for (const r of db.prepare(sql).all()) m[r.company_id] = r.value;
  return m;
}

// Per-product funnel counts for the dashboard tabs.
export function productStats() {
  return db.prepare(`
    SELECT c.product AS product,
           COUNT(DISTINCT c.id) AS accounts,
           COUNT(DISTINCT c.id) FILTER (WHERE c.lead_score >= 65) AS qualified,
           COUNT(p.id) FILTER (WHERE p.email LIKE '%@%') AS contacts
    FROM companies c LEFT JOIN people p ON p.company_id = c.id
    WHERE c.product IS NOT NULL
    GROUP BY c.product ORDER BY c.product
  `).all();
}

// ---- Opportunities (30/60/90 offers + SOW) -----------------------------

export function listOpportunities(companyId) {
  return db.prepare('SELECT * FROM opportunities WHERE company_id = ? ORDER BY id').all(companyId);
}

export function getOpportunity(id) {
  return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
}

export function createOpportunity(o) {
  const info = db.prepare(`
    INSERT INTO opportunities (company_id, product, offer_key, label, value_low, value_high, status, sow)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(o.company_id, o.product ?? null, o.offer_key ?? null, o.label ?? null,
    o.value_low ?? null, o.value_high ?? null, o.status ?? 'draft', o.sow ?? null);
  return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function updateOpportunity(id, fields) {
  const allowed = ['offer_key', 'label', 'value_low', 'value_high', 'status', 'sow'];
  const sets = [], vals = [];
  for (const k of allowed) if (k in fields) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  if (!sets.length) return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  vals.push(id);
  db.prepare(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
}

export function deleteOpportunity(id) {
  db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
}

// ---- Discovery answers (tied to qualification questions) ----------------

export function getDiscovery(companyId) {
  const m = {};
  for (const r of db.prepare('SELECT qkey, answer FROM discovery WHERE company_id = ?').all(companyId)) m[r.qkey] = r.answer;
  return m;
}

export function setDiscoveryAnswer(companyId, qkey, answer) {
  db.prepare(`
    INSERT INTO discovery (company_id, qkey, answer, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(company_id, qkey) DO UPDATE SET answer = excluded.answer, updated_at = datetime('now')
  `).run(companyId, qkey, answer);
  return getDiscovery(companyId);
}

// ---- Task queue (manual LinkedIn/email outreach + reminders) ------------

export function listTasks({ status, product } = {}) {
  const where = [], vals = [];
  if (status) { where.push('t.status = ?'); vals.push(status); }
  if (product) { where.push('t.product = ?'); vals.push(product); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT t.*, c.name AS company_name, p.name AS person_name, p.title AS person_title,
           p.email AS person_email, p.linkedin_url AS person_linkedin
    FROM tasks t
    LEFT JOIN companies c ON c.id = t.company_id
    LEFT JOIN people p ON p.id = t.person_id
    ${clause}
    ORDER BY (t.due_date IS NULL), t.due_date, t.id
  `).all(...vals);
}

export function createTask(t) {
  const info = db.prepare(`
    INSERT INTO tasks (company_id, person_id, product, channel, touch, title, body, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(t.company_id ?? null, t.person_id ?? null, t.product ?? null, t.channel ?? null,
    t.touch ?? null, t.title ?? null, t.body ?? null, t.due_date ?? null, t.status ?? 'todo');
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function updateTask(id, fields) {
  const allowed = ['channel', 'touch', 'title', 'body', 'due_date', 'status'];
  const sets = [], vals = [];
  for (const k of allowed) if (k in fields) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  if ('status' in fields) { sets.push('done_at = ?'); vals.push(fields.status === 'done' ? new Date().toISOString() : null); }
  if (!sets.length) return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  vals.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

export function deleteTask(id) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

// ---- Touchpoint ledger + next-action feedback loop ----------------------

export function listTouchpoints({
  companyId, personId, product, limit = 200,
} = {}) {
  const where = [], vals = [];
  if (companyId) { where.push('tp.company_id = ?'); vals.push(companyId); }
  if (personId) { where.push('tp.person_id = ?'); vals.push(personId); }
  if (product) { where.push('tp.product = ?'); vals.push(product); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  vals.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  return db.prepare(`
    SELECT tp.*, c.name AS company_name, p.name AS person_name, p.title AS person_title
    FROM touchpoints tp
    JOIN companies c ON c.id = tp.company_id
    LEFT JOIN people p ON p.id = tp.person_id
    ${clause}
    ORDER BY datetime(tp.occurred_at) DESC, tp.id DESC
    LIMIT ?
  `).all(...vals);
}

function insertTouchpoint(t) {
  const info = db.prepare(`
    INSERT INTO touchpoints (
      company_id, person_id, product, occurred_at, channel, direction,
      outcome, message_variant, summary, notes, task_id, subject, body, outreach_draft_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.company_id,
    t.person_id ?? null,
    t.product ?? null,
    t.occurred_at || new Date().toISOString(),
    t.channel,
    t.direction || 'outbound',
    t.outcome ?? null,
    t.message_variant ?? null,
    t.summary ?? null,
    t.notes ?? null,
    t.task_id ?? null,
    t.subject ?? null,
    t.body ?? null,
    t.outreach_draft_id ?? null,
  );
  return db.prepare('SELECT * FROM touchpoints WHERE id = ?').get(Number(info.lastInsertRowid));
}

const STAGE_ORDER = [
  'Researched', 'Ready for contact', 'Contacted', 'Replied',
  'Discovery scheduled', 'Problem confirmed', 'Data and budget qualified',
  'Design partner', 'Proposal sent', 'Contract negotiation', 'Contracted',
  'Delivery', 'Expansion',
];

function advanceCompanyFromOutcome(companyId, outcome) {
  const wanted = {
    sent: 'Contacted',
    no_reply: 'Contacted',
    replied: 'Replied',
    interested: 'Replied',
    referred: 'Replied',
    meeting_booked: 'Discovery scheduled',
    meeting_held: 'Problem confirmed',
  }[outcome];
  if (!wanted) return;
  const company = getCompany(companyId);
  const currentIndex = STAGE_ORDER.indexOf(company?.stage);
  const wantedIndex = STAGE_ORDER.indexOf(wanted);
  if (wantedIndex > currentIndex) updateCompany(companyId, { stage: wanted });
}

function updatePersonFromOutcome(personId, outcome) {
  if (!personId) return;
  const status = {
    sent: 'emailed',
    no_reply: 'emailed',
    replied: 'replied',
    interested: 'replied',
    referred: 'replied',
    meeting_booked: 'replied',
    meeting_held: 'replied',
    not_interested: 'not_interested',
    bounced: 'bounced',
  }[outcome];
  if (!status) return;
  const fields = { status };
  if (['sent', 'no_reply'].includes(outcome)) fields.contacted_at = new Date().toISOString();
  if (['replied', 'interested', 'referred', 'meeting_booked', 'meeting_held'].includes(outcome)) {
    fields.replied_at = new Date().toISOString();
  }
  if (outcome === 'bounced') fields.bounced_at = new Date().toISOString();
  updatePerson(personId, fields);
}

export function createTouchpoint(t) {
  const company = getCompany(t.company_id);
  if (!company) throw new Error('account not found');
  if (t.person_id) {
    const person = getPerson(t.person_id);
    if (!person || person.company_id !== t.company_id) throw new Error('contact does not belong to this account');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const touchpoint = insertTouchpoint({
      ...t,
      product: t.product ?? company.product ?? company.campaign ?? null,
    });
    updatePersonFromOutcome(t.person_id, t.outcome);
    advanceCompanyFromOutcome(t.company_id, t.outcome);
    let task = null;
    if (t.next_action_date) {
      task = createTask({
        company_id: t.company_id,
        person_id: t.person_id ?? null,
        product: t.product ?? company.product ?? company.campaign ?? null,
        channel: t.next_action_channel || t.channel,
        touch: t.next_touch ?? null,
        title: t.next_action_title || `Follow up after ${t.outcome || t.channel}`,
        body: t.next_action_body ?? null,
        due_date: t.next_action_date,
      });
    }
    db.exec('COMMIT');
    return { touchpoint, task };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function completeTask(id, fields = {}) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) throw new Error('task not found');
  if (task.status === 'done') return { task, touchpoint: null, next_task: null };
  const isOutreach = ['email', 'linkedin', 'call'].includes(task.channel);
  db.exec('BEGIN IMMEDIATE');
  try {
    const done = updateTask(id, { status: 'done' });
    let touchpoint = null;
    if (task.company_id && (isOutreach || task.channel === 'research')) {
      touchpoint = insertTouchpoint({
        company_id: task.company_id,
        person_id: task.person_id,
        product: task.product,
        occurred_at: fields.occurred_at || new Date().toISOString(),
        channel: task.channel,
        direction: task.channel === 'research' ? 'internal' : 'outbound',
        outcome: fields.outcome || (task.channel === 'research' ? 'researched' : 'sent'),
        summary: fields.summary || task.title,
        notes: fields.notes || task.body,
        task_id: task.id,
      });
      updatePersonFromOutcome(task.person_id, touchpoint.outcome);
      advanceCompanyFromOutcome(task.company_id, touchpoint.outcome);
    }
    let nextTask = null;
    if (fields.next_action_date) {
      nextTask = createTask({
        company_id: task.company_id,
        person_id: task.person_id,
        product: task.product,
        channel: fields.next_action_channel || task.channel,
        touch: fields.next_touch ?? (task.touch ? task.touch + 1 : null),
        title: fields.next_action_title || `Follow up: ${task.title || 'next touch'}`,
        body: fields.next_action_body ?? null,
        due_date: fields.next_action_date,
      });
    }
    db.exec('COMMIT');
    return { task: done, touchpoint, next_task: nextTask };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function salesLoopSummary(product) {
  const today = new Date().toISOString().slice(0, 10);
  const taskArgs = product ? [product] : [];
  const productFilter = product ? 'AND t.product = ?' : '';
  const touchProductFilter = product ? 'AND tp.product = ?' : '';
  const taskCounts = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE t.status='todo' AND t.due_date < ?) AS overdue,
      COUNT(*) FILTER (WHERE t.status='todo' AND t.due_date = ?) AS today,
      COUNT(*) FILTER (WHERE t.status='todo' AND t.due_date > ? AND t.due_date <= date(?, '+7 days')) AS next_seven,
      COUNT(*) FILTER (WHERE t.status='todo' AND t.due_date IS NULL) AS unscheduled
    FROM tasks t WHERE 1=1 ${productFilter}
  `).get(today, today, today, today, ...taskArgs);
  const outcomes = db.prepare(`
    SELECT COALESCE(tp.channel, 'unknown') AS channel,
           COUNT(*) AS attempts,
           COUNT(*) FILTER (WHERE tp.outcome IN ('replied','interested','referred','meeting_booked','meeting_held')) AS positive,
           COUNT(*) FILTER (WHERE tp.outcome IN ('meeting_booked','meeting_held')) AS meetings
    FROM touchpoints tp
    WHERE datetime(tp.occurred_at) >= datetime('now', '-30 days') ${touchProductFilter}
    GROUP BY tp.channel ORDER BY attempts DESC
  `).all(...taskArgs);
  const totals = outcomes.reduce((acc, row) => ({
    attempts: acc.attempts + row.attempts,
    positive: acc.positive + row.positive,
    meetings: acc.meetings + row.meetings,
  }), { attempts: 0, positive: 0, meetings: 0 });
  const best = outcomes
    .filter((row) => row.attempts >= 3)
    .sort((a, b) => (b.positive / b.attempts) - (a.positive / a.attempts))[0];
  const variants = db.prepare(`
    SELECT tp.message_variant AS variant,
           COUNT(*) AS attempts,
           COUNT(*) FILTER (WHERE tp.outcome IN ('replied','interested','referred','meeting_booked','meeting_held')) AS positive,
           COUNT(*) FILTER (WHERE tp.outcome IN ('meeting_booked','meeting_held')) AS meetings
    FROM touchpoints tp
    WHERE datetime(tp.occurred_at) >= datetime('now', '-30 days')
      AND trim(COALESCE(tp.message_variant, '')) <> ''
      ${touchProductFilter}
    GROUP BY tp.message_variant ORDER BY attempts DESC
  `).all(...taskArgs);
  const roles = db.prepare(`
    SELECT COALESCE(p.role_type, 'unassigned') AS role,
           COUNT(*) AS attempts,
           COUNT(*) FILTER (WHERE tp.outcome IN ('replied','interested','referred','meeting_booked','meeting_held')) AS positive,
           COUNT(*) FILTER (WHERE tp.outcome IN ('meeting_booked','meeting_held')) AS meetings
    FROM touchpoints tp
    LEFT JOIN people p ON p.id = tp.person_id
    WHERE datetime(tp.occurred_at) >= datetime('now', '-30 days') ${touchProductFilter}
    GROUP BY COALESCE(p.role_type, 'unassigned') ORDER BY attempts DESC
  `).all(...taskArgs);
  const bestVariant = variants
    .filter((row) => row.attempts >= 3)
    .sort((a, b) => (b.positive / b.attempts) - (a.positive / a.attempts))[0];
  const bestRole = roles
    .filter((row) => row.attempts >= 3)
    .sort((a, b) => (b.positive / b.attempts) - (a.positive / a.attempts))[0];
  const recommendations = [];
  if (!totals.attempts) recommendations.push('Log prior outreach so the platform can learn which channels and messages earn replies.');
  if (taskCounts.overdue) recommendations.push(`Clear ${taskCounts.overdue} overdue action${taskCounts.overdue === 1 ? '' : 's'} before adding more accounts.`);
  if (best) recommendations.push(`${best.channel} is the strongest measured route this month; prioritize it while continuing controlled tests.`);
  if (bestVariant) recommendations.push(`“${bestVariant.variant}” is the strongest measured message angle; keep it as the control and test one change at a time.`);
  if (bestRole) recommendations.push(`${bestRole.role.replaceAll('_', ' ')} contacts are producing the strongest measured response; bias new research toward that role.`);
  if (totals.attempts >= 10 && totals.positive / totals.attempts < 0.08) {
    recommendations.push('Reply yield is below 8%; refresh account evidence and test a new problem angle before increasing volume.');
  }
  if (!recommendations.length) recommendations.push('Keep the calendar current and compare reply yield by channel after every ten attempts.');
  return {
    generated_at: new Date().toISOString(),
    tasks: taskCounts,
    totals: {
      ...totals,
      positive_rate: totals.attempts ? Math.round((totals.positive / totals.attempts) * 1000) / 10 : 0,
    },
    channels: outcomes,
    variants,
    roles,
    recommendations,
  };
}

// ---- Metrics (replies, discoveries, qualified problems, proposals, revenue) ----

export function metrics(product) {
  const scope = product ? 'WHERE product = ?' : '';
  const args = product ? [product] : [];
  const acc = db.prepare(`
    SELECT COUNT(*) AS accounts,
           COUNT(*) FILTER (WHERE lead_score >= 65) AS qualified,
           COUNT(*) FILTER (WHERE stage IN ('Problem confirmed','Data and budget qualified','Design partner','Proposal sent','Contract negotiation','Contracted','Delivery','Expansion')) AS problems_confirmed,
           COUNT(*) FILTER (WHERE stage IN ('Proposal sent','Contract negotiation','Contracted','Delivery','Expansion')) AS proposals_sent,
           COUNT(*) FILTER (WHERE stage IN ('Contracted','Delivery','Expansion')) AS contracted
    FROM companies ${scope}
  `).get(...args);
  const replied = db.prepare(`
    SELECT COUNT(DISTINCT p.id) AS n FROM people p JOIN companies c ON c.id = p.company_id
    WHERE p.status = 'replied' ${product ? 'AND c.product = ?' : ''}
  `).get(...args).n;
  const discoveries = db.prepare(`
    SELECT COUNT(*) AS n FROM companies ${product ? 'WHERE product = ? AND' : 'WHERE'} stage IN
    ('Discovery scheduled','Problem confirmed','Data and budget qualified','Design partner','Proposal sent','Contract negotiation','Contracted','Delivery','Expansion')
  `).get(...args).n;
  const won = db.prepare(`
    SELECT COALESCE(SUM(o.value_low),0) AS low, COALESCE(SUM(o.value_high),0) AS high
    FROM opportunities o ${product ? 'JOIN companies c ON c.id=o.company_id WHERE o.status=\'won\' AND c.product = ?' : "WHERE o.status='won'"}
  `).get(...args);
  const activity = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE datetime(tp.occurred_at) >= datetime('now', '-30 days')) AS touches_30d,
      COUNT(*) FILTER (
        WHERE tp.outcome IN ('meeting_booked','meeting_held')
          AND datetime(tp.occurred_at) >= datetime('now', '-30 days')
      ) AS meetings_30d
    FROM touchpoints tp
    ${product ? 'WHERE tp.product = ?' : ''}
  `).get(...args);
  return {
    ...acc,
    replied,
    discoveries,
    touches_30d: activity.touches_30d,
    meetings_30d: activity.meetings_30d,
    revenue_low: won.low,
    revenue_high: won.high,
  };
}

// ---- GnK: societal-problem / project scoping board ----------------------
// Rename the legacy table in place so all existing research remains intact.
const legacyGnkBoard = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='forth_projects'",
).get();
const currentGnkBoard = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='gnk_projects'",
).get();
if (legacyGnkBoard && !currentGnkBoard) {
  db.exec('ALTER TABLE forth_projects RENAME TO gnk_projects');
}

db.exec(`
CREATE TABLE IF NOT EXISTS gnk_projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  problem       TEXT,                        -- the problem in society
  who_affected  TEXT,                        -- who it affects / how many
  why_it_matters TEXT,                        -- why it's worth doing
  what_we_build TEXT,                         -- the project idea we could build
  domain        TEXT,                         -- climate | health | civic | education | ...
  interest      INTEGER DEFAULT 3,            -- 1..5, how interesting/meaningful
  feasibility   INTEGER DEFAULT 3,            -- 1..5, how buildable by a small team
  status        TEXT DEFAULT 'idea',          -- idea | scoping | building | shelved
  links         TEXT,                         -- optional source URLs / notes
  created_at    TEXT DEFAULT (datetime('now'))
);
`);

export function listGnkProjects() {
  return db.prepare(`SELECT * FROM gnk_projects
    ORDER BY (interest + feasibility) DESC, interest DESC, created_at DESC`).all();
}
export function createGnkProject(p = {}) {
  const info = db.prepare(`INSERT INTO gnk_projects
    (title, problem, who_affected, why_it_matters, what_we_build, domain, interest, feasibility, status, links)
    VALUES (@title,@problem,@who_affected,@why_it_matters,@what_we_build,@domain,@interest,@feasibility,@status,@links)`).run({
    title: p.title || 'Untitled', problem: p.problem || null, who_affected: p.who_affected || null,
    why_it_matters: p.why_it_matters || null, what_we_build: p.what_we_build || null, domain: p.domain || null,
    interest: p.interest ?? 3, feasibility: p.feasibility ?? 3, status: p.status || 'idea', links: p.links || null,
  });
  return db.prepare('SELECT * FROM gnk_projects WHERE id = ?').get(info.lastInsertRowid);
}
export function updateGnkProject(id, patch = {}) {
  const allowed = ['title', 'problem', 'who_affected', 'why_it_matters', 'what_we_build', 'domain', 'interest', 'feasibility', 'status', 'links'];
  const sets = [], vals = [];
  for (const k of allowed) if (k in patch) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  if (sets.length) db.prepare(`UPDATE gnk_projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return db.prepare('SELECT * FROM gnk_projects WHERE id = ?').get(id);
}
export function deleteGnkProject(id) {
  db.prepare('DELETE FROM gnk_projects WHERE id = ?').run(id);
  return { ok: true };
}

// Compatibility exports for old local scripts; the product and table are GnK.
export const listForthProjects = listGnkProjects;
export const createForthProject = createGnkProject;
export const updateForthProject = updateGnkProject;
export const deleteForthProject = deleteGnkProject;
