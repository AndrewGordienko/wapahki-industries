// Minimal zero-dependency web server: serves the CRM UI and a small JSON API.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

import { config, PORT } from './config.js';
import {
  db, companiesWithPeople, insertCompany, deleteCompany, updateCompany,
  upsertPerson, updatePerson, deletePerson, getCompany, getPerson, listPeopleByCompany,
  campaignStats, listSequencesByPerson, setSequenceStatus,
  // Problem Found account model:
  accountsForProduct, productStats, listOpportunities, getOpportunity, createOpportunity,
  updateOpportunity, deleteOpportunity, getDiscovery, setDiscoveryAnswer,
  listTasks, createTask, updateTask, completeTask, deleteTask,
  listTouchpoints, createTouchpoint, salesLoopSummary, metrics as accountMetrics,
  rebalanceEmailSchedule,
  // GnK societal-problem board:
  listGnkProjects, createGnkProject, updateGnkProject, deleteGnkProject,
} from './db.js';
import { SCHEDULE_POLICY_VERSION } from './email-capacity.js';
import {
  listProblems, getProblem, updateProblem, deleteProblem, problemStats,
} from './problems.js';
import { loadCampaigns } from './campaigns.js';
import { loadProducts, getProduct, productsByPriority, shared as sharedConfig } from './products.js';
import { computeLeadScore, outreachAllowed } from './scoring.js';
import { generateSOW } from './proposals.js';
import { scoreContact } from './relevance.js';
import * as apollo from './apollo.js';
import * as pipeline from './pipeline.js';
import * as discovery from './discovery.js';
import * as outagehub from './outagehub.js';
import * as grants from './grants.js';
import {
  commandCenter,
  createOutreachDraft,
  ensurePursuit,
  getOutreachDraft,
  getPursuit,
  getPursuitByCompany,
  listArchivedContacts,
  listOutreachDrafts,
  listPursuitProducts,
  listPursuits,
  markOutreachDraftSent,
  restoreArchivedContact,
  reviewOutreachDraft,
  setPursuitContact,
  setSystemSetting,
  systemAudit,
  systemSettings,
  updatePursuit,
  updatePursuitStep,
  verifyPerson,
} from './pursuits.js';
import { PURSUIT_MOTIONS, PURSUIT_TYPES } from './pursuit-policy.js';
import {
  buildCrmCsv, businessForCampaign, crmBusinesses, crmCalendar, crmDealRows, crmRows, editSequence,
} from './crm.js';
import { hasCompleteSequence, sequenceLengthForCampaign } from './outreach-quality.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const ROOT_DIR = join(__dirname, '..');
const MVP_QUEUE = join(ROOT_DIR, 'data', 'mvp-queue.json');

// In-memory state of the problem-discovery scout-team run (spawned child process).
// The dashboard polls /api/problems/discover/status to stream progress.
const discoverRun = { running: false, startedAt: null, finishedAt: null, exitCode: null, log: [] };
const outageHubRun = { running: false, startedAt: null, finishedAt: null, exitCode: null, log: [] };
const grantRun = { running: false, startedAt: null, finishedAt: null, exitCode: null, log: [] };
let capacityRebalanceRunning = false;

function reconcileEmailCapacitySchedule() {
  if (capacityRebalanceRunning) return;
  const unsafe = db.prepare(`
    SELECT COUNT(*) n
    FROM sequences s
    JOIN people p ON p.id=s.person_id
    JOIN companies c ON c.id=p.company_id
    WHERE s.channel='email' AND s.status!='sent'
      AND c.archived_at IS NULL AND p.replied_at IS NULL
      AND COALESCE(p.lifecycle_status, 'active')='active'
      AND p.email LIKE '%@%.%'
      AND COALESCE(s.schedule_policy, '') NOT IN ('gnk_recovery_hold_v1', 'gnk_recovery_draft_v1')
      AND COALESCE(s.schedule_policy, '') != ?
  `).get(SCHEDULE_POLICY_VERSION).n;
  if (!unsafe) return;
  capacityRebalanceRunning = true;
  try {
    const setting = db.prepare("SELECT value FROM system_settings WHERE key='email_schedule_start'").get();
    const plan = rebalanceEmailSchedule({ start: setting?.value || new Date().toISOString().slice(0, 10) });
    console.log(`  Email capacity reconciled: ${unsafe} new/unsafe rows; ${plan.applied_changes || 0} calendar rows changed.`);
  } catch (error) {
    console.error(`  Email capacity reconciliation failed: ${error.message}`);
  } finally {
    capacityRebalanceRunning = false;
  }
}

function startDiscovery({ count = 6 } = {}) {
  if (discoverRun.running) return { started: false, reason: 'a discovery run is already in progress' };
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  Object.assign(discoverRun, { running: true, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, log: [] });
  const script = join(ROOT_DIR, 'scripts', 'discover-problems.js');
  const child = spawn(process.execPath, [script, '--count', String(count), '--run-id', runId], {
    cwd: ROOT_DIR, env: process.env,
  });
  const push = (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      const t = line.trim();
      if (t) discoverRun.log.push(t);
    }
    if (discoverRun.log.length > 400) discoverRun.log.splice(0, discoverRun.log.length - 400);
  };
  const finish = (code, message) => {
    if (!discoverRun.running) return;
    discoverRun.running = false;
    discoverRun.finishedAt = new Date().toISOString();
    discoverRun.exitCode = code;
    discoverRun.log.push(message);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('close', (code) => {
    if (!discoverRun.running) return;
    if (code !== 0) {
      finish(code, `[server] idea discovery finished with exit code ${code}`);
      return;
    }
    discoverRun.log.push('[server] adding new research to the GNK idea workspace…');
    const sync = spawn(process.execPath, [join(ROOT_DIR, 'scripts', 'problems-to-gnk.js')], {
      cwd: ROOT_DIR,
      env: process.env,
    });
    sync.stdout.on('data', push);
    sync.stderr.on('data', push);
    sync.on('close', (syncCode) => {
      finish(syncCode, `[server] idea discovery finished with exit code ${syncCode}`);
    });
    sync.on('error', (error) => {
      finish(-1, `[server] failed to update the GNK workspace: ${error.message}`);
    });
  });
  child.on('error', (err) => {
    finish(-1, `[server] failed to launch discovery: ${err.message}`);
  });
  return { started: true, runId };
}

function startOutageHubDiscovery({ count = 6 } = {}) {
  if (outageHubRun.running) return { started: false, reason: 'an OutageHub research run is already in progress' };
  const runId = `outagehub-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  Object.assign(outageHubRun, {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    log: [],
  });
  const child = spawn(process.execPath, [
    join(ROOT_DIR, 'scripts', 'outagehub-discover.js'),
    '--count', String(count),
    '--run-id', runId,
  ], { cwd: ROOT_DIR, env: process.env });
  const push = (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      const text = line.trim();
      if (text) outageHubRun.log.push(text);
    }
    if (outageHubRun.log.length > 400) outageHubRun.log.splice(0, outageHubRun.log.length - 400);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('close', (code) => {
    outageHubRun.running = false;
    outageHubRun.finishedAt = new Date().toISOString();
    outageHubRun.exitCode = code;
    outageHubRun.log.push(`[server] OutageHub research finished with exit code ${code}`);
  });
  child.on('error', (error) => {
    outageHubRun.running = false;
    outageHubRun.finishedAt = new Date().toISOString();
    outageHubRun.exitCode = -1;
    outageHubRun.log.push(`[server] failed to launch OutageHub research: ${error.message}`);
  });
  return { started: true, runId };
}

function startGrantDiscovery({
  count = 16, venture = 'both', track = '', refresh = false,
} = {}) {
  if (grantRun.running) return { started: false, reason: 'a grant research run is already in progress' };
  const runId = `grants-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  Object.assign(grantRun, {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    log: [],
  });
  const childArgs = [
    join(ROOT_DIR, 'scripts', 'discover-grants.js'),
    '--count', String(count),
    '--venture', venture,
    '--run-id', runId,
  ];
  if (track) childArgs.push('--track', track);
  if (refresh) childArgs.push('--refresh');
  const child = spawn(process.execPath, childArgs, { cwd: ROOT_DIR, env: process.env });
  const push = (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      const text = line.trim();
      if (text) grantRun.log.push(text);
    }
    if (grantRun.log.length > 500) grantRun.log.splice(0, grantRun.log.length - 500);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('close', (code) => {
    grantRun.running = false;
    grantRun.finishedAt = new Date().toISOString();
    grantRun.exitCode = code;
    grantRun.log.push(`[server] grant research finished with exit code ${code}`);
  });
  child.on('error', (error) => {
    grantRun.running = false;
    grantRun.finishedAt = new Date().toISOString();
    grantRun.exitCode = -1;
    grantRun.log.push(`[server] failed to launch grant research: ${error.message}`);
  });
  return { started: true, runId };
}

// Append an autonomous MVP build request to the queue the factory drains.
async function enqueueMvpBuild(problem) {
  let queue = [];
  if (existsSync(MVP_QUEUE)) { try { queue = JSON.parse(readFileSync(MVP_QUEUE, 'utf8')); } catch { queue = []; } }
  if (!queue.some((q) => q.slug === problem.slug && q.status !== 'done')) {
    queue.push({
      slug: problem.slug, problem_id: problem.id, title: problem.title,
      demo_idea: problem.demo_idea, requested_at: new Date().toISOString(), status: 'queued',
    });
    await writeFile(MVP_QUEUE, JSON.stringify(queue, null, 2));
  }
  return queue;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-cache, no-store, must-revalidate' });
  res.end();
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

// Wrap async handlers so thrown errors become clean JSON (with Apollo status).
function handler(fn) {
  return async (req, res, params) => {
    try {
      await fn(req, res, params);
    } catch (err) {
      const status = err.code === 'NO_KEY' || err.code === 'NO_GOOGLE_KEY' ? 400 : (err.status || 500);
      send(res, status, { error: err.message, code: err.code || null, details: err.data || null });
    }
  };
}

// ---- Agent message generation (background jobs) -------------------------
// A per-contact full-sequence run. It reuses the source-backed draft -> review
// -> native-language -> revision writer in scripts/write-sequences.js,
// spawned as a child so a slow model backend never blocks the HTTP request. The
// UI starts a job, then polls its status.
const SUPPORTED_GEN_CAMPAIGNS = new Set(['wapahki', 'gnk', 'outagehub']);
const generationJobs = new Map(); // personId -> job
const GENERATION_TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS) || 40 * 60 * 1000;

function publicJob(job) {
  if (!job) return null;
  return {
    person_id: job.personId,
    status: job.status,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    error: job.error,
    log_tail: job.log.slice(-12),
    messages: job.messages,
    sales_brief: job.salesBrief,
  };
}

function startContactGeneration(personId) {
  const existing = generationJobs.get(personId);
  if (existing && existing.status === 'running') return existing;

  const person = getPerson(personId);
  if (!person) { const e = new Error('contact not found'); e.status = 404; throw e; }
  const company = getCompany(person.company_id);
  const campaign = businessForCampaign(company?.campaign);
  if (!SUPPORTED_GEN_CAMPAIGNS.has(campaign)) {
    const e = new Error(`Agent regeneration is not wired for the "${campaign || 'unknown'}" campaign yet.`);
    e.status = 400; throw e;
  }
  if (!String(person.email || '').includes('@')) {
    const e = new Error(`This contact needs a usable email before the ${sequenceLengthForCampaign(campaign)}-touch sequence can be written.`);
    e.status = 400; throw e;
  }
  const seq = listSequencesByPerson(personId);
  const protectedTouches = seq.filter((touch) => touch.status !== 'draft');
  if (protectedTouches.length) {
    const e = new Error('Sent or approved messages are protected. Mark them as drafts before rewriting the full sequence.');
    e.status = 400; throw e;
  }
  const beforeFingerprint = JSON.stringify(seq.map((touch) => ({
    id: touch.id,
    touch: touch.touch,
    subject: touch.subject,
    body: touch.body,
  })));

  // The agent writes for the operator; open the writer path it needs.
  setSystemSetting('legacy_writers_enabled', 'true');

  const job = {
    personId, status: 'running', startedAt: new Date().toISOString(),
    finishedAt: null, error: null, log: [], messages: null, salesBrief: null, timedOut: false,
  };
  generationJobs.set(personId, job);

  const child = spawn(process.execPath, [
    join(ROOT_DIR, 'scripts', 'write-sequences.js'),
    campaign,
  ], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ALLOW_LEGACY_SEQUENCE_WRITE: '1',
      WRITER_IDS: String(personId),
      WRITER_REWRITE: '1',
      WRITER_BATCH: '1',
      WRITER_CONCURRENCY: '1',
      WRITER_REVIEW: '1',
      // The complete sequence has already passed subject, evidence, and
      // language review. Do not mutate T1/T2 after that final audit.
      SKIP_SUBJECT_AGENTS: '1',
      // Best model for message writing: 5.6-sol at xhigh reasoning for the two
      // passes that actually write copy (draft + revise). The editorial critics
      // (review/language) stay at high so runs are not needlessly slower.
      DRAFT_MODEL: process.env.DRAFT_MODEL || 'gpt-5.6-sol',
      DRAFT_REASONING: process.env.DRAFT_REASONING || 'xhigh',
      REVIEW_REASONING: process.env.REVIEW_REASONING || 'high',
      LANGUAGE_REASONING: process.env.LANGUAGE_REASONING || 'high',
      REVISE_MODEL: process.env.REVISE_MODEL || 'gpt-5.6-sol',
      REVISE_REASONING: process.env.REVISE_REASONING || 'xhigh',
      // Give the (sometimes slow) model backend more runway per call.
      CODEX_TIMEOUT_MS: process.env.CODEX_TIMEOUT_MS || '600000',
    },
  });

  const push = (chunk) => {
    for (const line of chunk.toString().split('\n')) { const t = line.trim(); if (t) job.log.push(t); }
    if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);

  const timer = setTimeout(() => {
    job.timedOut = true;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }, GENERATION_TIMEOUT_MS);

  child.on('close', (code) => {
    clearTimeout(timer);
    job.finishedAt = new Date().toISOString();
    const logText = job.log.join('\n');
    const messages = listSequencesByPerson(personId);
    const expectedTouches = sequenceLengthForCampaign(campaign);
    const complete = hasCompleteSequence(campaign, messages);
    const afterFingerprint = JSON.stringify(messages.map((touch) => ({
      id: touch.id,
      touch: touch.touch,
      subject: touch.subject,
      body: touch.body,
    })));
    const changed = afterFingerprint !== beforeFingerprint;
    if (complete && changed) {
      job.status = 'done';
      job.messages = messages;
      const savedBrief = getPerson(personId)?.sales_brief;
      try { job.salesBrief = savedBrief ? JSON.parse(savedBrief) : null; } catch { job.salesBrief = null; }
    } else {
      job.status = 'error';
      if (job.timedOut) {
        job.error = 'The agent run timed out. The model backend is slow right now — try again shortly.';
      } else if (/timed out after/i.test(logText)) {
        job.error = 'The writing model timed out while responding. The backend is slow right now — try again shortly.';
      } else if (/Codex CLI failed/i.test(logText)) {
        job.error = 'The writing model failed to respond. Check `codex login status`, then try again.';
      } else if (/do_not_contact|skipped person/i.test(logText)) {
        job.error = 'The research or role fit was too weak for a defensible sequence. No draft was stored.';
      } else if (!complete) {
        job.error = `The agent did not produce all ${expectedTouches} messages that passed the quality checks. Nothing partial was accepted.`;
      } else if (!changed) {
        job.error = 'The agent did not return a new reviewed sequence. Try again.';
      } else {
        job.error = `The writer exited with code ${code}.`;
      }
    }
  });
  child.on('error', (err) => {
    clearTimeout(timer);
    job.status = 'error';
    job.finishedAt = new Date().toISOString();
    job.error = `Failed to launch the writer: ${err.message}`;
  });

  return job;
}

// ---- Routes -------------------------------------------------------------

const routes = [
  ['GET', /^\/api\/health$/, handler(async (req, res) => {
    send(res, 200, {
      apollo: { present: config.hasApollo, source: config.apolloKeySource },
    });
  })],

  ['POST', /^\/api\/test-apollo$/, handler(async (req, res) => {
    const profile = await apollo.testConnection();
    send(res, 200, { ok: true, profile });
  })],

  // ---- Pursuit command center: one governed commercial motion per account ----
  ['GET', /^\/api\/pursuit-motions$/, handler(async (req, res) => {
    send(res, 200, {
      types: PURSUIT_TYPES,
      motions: PURSUIT_MOTIONS,
      products: listPursuitProducts(),
    });
  })],
  ['GET', /^\/api\/command-center$/, handler(async (req, res) => {
    const product = new URL(req.url, 'http://x').searchParams.get('product') || undefined;
    send(res, 200, { command_center: commandCenter(product) });
  })],
  ['GET', /^\/api\/pursuits$/, handler(async (req, res) => {
    const query = new URL(req.url, 'http://x').searchParams;
    send(res, 200, {
      pursuits: listPursuits({
        product: query.get('product') || undefined,
        status: query.get('status') || undefined,
        approvalStatus: query.get('approval_status') || undefined,
        pursuitType: query.get('pursuit_type') || undefined,
      }),
    });
  })],
  ['GET', /^\/api\/pursuits\/(\d+)$/, handler(async (req, res, [id]) => {
    const pursuit = getPursuit(Number(id));
    if (!pursuit) return send(res, 404, { error: 'pursuit not found' });
    send(res, 200, { pursuit });
  })],
  ['GET', /^\/api\/accounts\/(\d+)\/pursuit$/, handler(async (req, res, [id]) => {
    const account = getCompany(Number(id));
    if (!account) return send(res, 404, { error: 'account not found' });
    send(res, 200, { pursuit: getPursuitByCompany(Number(id)) });
  })],
  ['PATCH', /^\/api\/pursuits\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, { pursuit: updatePursuit(Number(id), await readBody(req)) });
  })],
  ['PUT', /^\/api\/pursuits\/(\d+)\/contacts\/(\d+)$/, handler(async (req, res, [pursuitId, personId]) => {
    send(res, 200, {
      pursuit: setPursuitContact(
        Number(pursuitId),
        Number(personId),
        await readBody(req),
      ),
    });
  })],
  ['PATCH', /^\/api\/pursuits\/(\d+)\/steps\/(\d+)$/, handler(async (req, res, [pursuitId, stepId]) => {
    send(res, 200, {
      pursuit: updatePursuitStep(
        Number(pursuitId),
        Number(stepId),
        await readBody(req),
      ),
    });
  })],
  ['POST', /^\/api\/pursuits\/(\d+)\/drafts$/, handler(async (req, res, [pursuitId]) => {
    const body = await readBody(req);
    const draft = createOutreachDraft({
      pursuitId: Number(pursuitId),
      stepId: Number(body.step_id),
      personId: Number(body.person_id),
      channel: body.channel,
      subject: body.subject,
      body: body.body,
      source: body.source || 'manual',
      rationale: body.rationale || null,
      revisionOf: body.revision_of ? Number(body.revision_of) : null,
    });
    send(res, 201, { draft });
  })],
  ['GET', /^\/api\/outreach-drafts$/, handler(async (req, res) => {
    const query = new URL(req.url, 'http://x').searchParams;
    send(res, 200, {
      drafts: listOutreachDrafts({
        status: query.get('status') || undefined,
        product: query.get('product') || undefined,
        pursuitId: query.get('pursuit_id') ? Number(query.get('pursuit_id')) : undefined,
        limit: query.get('limit') ? Number(query.get('limit')) : undefined,
      }),
    });
  })],
  ['GET', /^\/api\/outreach-drafts\/(\d+)$/, handler(async (req, res, [id]) => {
    const draft = getOutreachDraft(Number(id));
    if (!draft) return send(res, 404, { error: 'draft not found' });
    send(res, 200, { draft });
  })],
  ['PATCH', /^\/api\/outreach-drafts\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, { draft: reviewOutreachDraft(Number(id), await readBody(req)) });
  })],
  ['POST', /^\/api\/outreach-drafts\/(\d+)\/sent$/, handler(async (req, res, [id]) => {
    send(res, 200, markOutreachDraftSent(Number(id), await readBody(req)));
  })],
  ['POST', /^\/api\/people\/(\d+)\/verify$/, handler(async (req, res, [id]) => {
    send(res, 200, { person: verifyPerson(Number(id), await readBody(req)) });
  })],
  ['GET', /^\/api\/contact-archive$/, handler(async (req, res) => {
    const query = new URL(req.url, 'http://x').searchParams;
    send(res, 200, {
      contacts: listArchivedContacts({
        status: query.get('status') || undefined,
        company: query.get('company') || undefined,
        limit: query.get('limit') ? Number(query.get('limit')) : undefined,
      }),
    });
  })],
  ['POST', /^\/api\/contact-archive\/(\d+)\/restore$/, handler(async (req, res, [id]) => {
    send(res, 200, restoreArchivedContact(Number(id), await readBody(req)));
  })],
  ['GET', /^\/api\/system-audit$/, handler(async (req, res) => {
    send(res, 200, { audit: systemAudit() });
  })],
  ['GET', /^\/api\/system-settings$/, handler(async (req, res) => {
    send(res, 200, { settings: systemSettings() });
  })],
  ['PATCH', /^\/api\/system-settings\/([a-z_]+)$/, handler(async (req, res, [key]) => {
    const body = await readBody(req);
    send(res, 200, { settings: setSystemSetting(key, body.value) });
  })],

  // Funnel tabs: each campaign's label + company/contact counts
  ['GET', /^\/api\/campaigns$/, handler(async (req, res) => {
    const defs = loadCampaigns();
    const stats = Object.fromEntries(campaignStats().map((s) => [s.campaign, s]));
    const campaigns = Object.entries(defs).map(([id, d]) => ({
      id, label: d.label || id, icon: d.icon || null,
      short: d.short || d.label || id, tagline: d.tagline || '',
      companies: stats[id]?.companies || 0,
      contacts: stats[id]?.contacts || 0,
    }));
    send(res, 200, { campaigns });
  })],

  ['GET', /^\/api\/companies$/, handler(async (req, res) => {
    const campaign = new URL(req.url, 'http://x').searchParams.get('campaign') || undefined;
    send(res, 200, { companies: companiesWithPeople(campaign) });
  })],

  // ---- GnK: societal-problem / project scoping board ----
  // /api/forth remains a compatibility alias for saved local links.
  ['GET', /^\/api\/(?:gnk|forth)$/, handler(async (req, res) => {
    send(res, 200, { projects: listGnkProjects(), run: discoverRun });
  })],
  ['POST', /^\/api\/(?:gnk|forth)$/, handler(async (req, res) => {
    send(res, 201, { project: createGnkProject(await readBody(req)) });
  })],
  ['POST', /^\/api\/gnk\/discover$/, handler(async (req, res) => {
    const body = await readBody(req);
    const result = startDiscovery({ count: Math.min(Math.max(Number(body.count) || 6, 1), 12) });
    send(res, result.started ? 202 : 409, result);
  })],
  ['GET', /^\/api\/gnk\/discover\/status$/, handler(async (req, res) => {
    send(res, 200, discoverRun);
  })],
  ['PATCH', /^\/api\/(?:gnk|forth)\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, { project: updateGnkProject(Number(id), await readBody(req)) });
  })],
  ['DELETE', /^\/api\/(?:gnk|forth)\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, deleteGnkProject(Number(id)));
  })],

  // ---- OutageHub: problem -> company -> buyer -> first-touch workspace ----
  ['GET', /^\/api\/outagehub$/, handler(async (req, res) => {
    send(res, 200, {
      problems: outagehub.listOutagehubProblems(),
      stats: outagehub.outagehubStats(),
      run: outageHubRun,
    });
  })],
  ['PATCH', /^\/api\/outagehub\/problems\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, { problem: outagehub.updateProblem(Number(id), await readBody(req)) });
  })],
  ['DELETE', /^\/api\/outagehub\/problems\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, outagehub.deleteProblem(Number(id)));
  })],
  ['PATCH', /^\/api\/outagehub\/targets\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, { target: outagehub.updateTarget(Number(id), await readBody(req)) });
  })],
  ['DELETE', /^\/api\/outagehub\/targets\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, outagehub.deleteTarget(Number(id)));
  })],
  ['POST', /^\/api\/outagehub\/discover$/, handler(async (req, res) => {
    const body = await readBody(req);
    const result = startOutageHubDiscovery({
      count: Math.min(Math.max(Number(body.count) || 6, 1), 12),
    });
    send(res, result.started ? 202 : 409, result);
  })],
  ['GET', /^\/api\/outagehub\/discover\/status$/, handler(async (req, res) => {
    send(res, 200, outageHubRun);
  })],

  // ---- Grants: program -> applicant fit -> contact -> eligibility email ----
  ['GET', /^\/api\/grants$/, handler(async (req, res) => {
    const query = new URL(req.url, 'http://x').searchParams;
    const requestedApplicant = query.get('applicant');
    const applicant = grants.APPLICANTS.includes(requestedApplicant) ? requestedApplicant : undefined;
    send(res, 200, {
      grants: grants.listGrants({
        applicant,
        status: query.get('status') || undefined,
        eligibility: query.get('eligibility') || undefined,
      }),
      stats: grants.grantStats(applicant),
      run: grantRun,
    });
  })],
  ['PATCH', /^\/api\/grants\/(\d+)$/, handler(async (req, res, [id]) => {
    const body = await readBody(req);
    const allowed = {};
    for (const key of ['status', 'notes']) if (key in body) allowed[key] = body[key];
    send(res, 200, { grant: grants.updateGrant(Number(id), allowed) });
  })],
  ['DELETE', /^\/api\/grants\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, grants.deleteGrant(Number(id)));
  })],
  ['PATCH', /^\/api\/grant-contacts\/(\d+)$/, handler(async (req, res, [id]) => {
    const body = await readBody(req);
    const allowed = {};
    for (const key of ['status']) if (key in body) allowed[key] = body[key];
    send(res, 200, { contact: grants.updateGrantContact(Number(id), allowed) });
  })],
  ['POST', /^\/api\/grants\/discover$/, handler(async (req, res) => {
    const body = await readBody(req);
    const venture = ['both', 'outagehub', 'wapahki'].includes(body.venture) ? body.venture : 'both';
    const result = startGrantDiscovery({
      count: Math.min(Math.max(Number(body.count) || 16, 1), 60),
      venture,
      track: String(body.track || ''),
      refresh: Boolean(body.refresh),
    });
    send(res, result.started ? 202 : 409, result);
  })],
  ['GET', /^\/api\/grants\/discover\/status$/, handler(async (req, res) => {
    send(res, 200, grantRun);
  })],
  ['GET', /^\/api\/grants\/export$/, handler(async (req, res) => {
    const query = new URL(req.url, 'http://x').searchParams;
    const requestedApplicant = query.get('applicant');
    const applicant = grants.APPLICANTS.includes(requestedApplicant) ? requestedApplicant : undefined;
    const csv = buildGrantCsv(applicant);
    const applicantName = applicant === 'outagehub' ? 'outagehub' : applicant === 'wapahki' ? 'wahpaki' : 'all';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${applicantName}-grant-opportunities.csv"`,
    });
    res.end(csv);
  })],

  // ---- Problem discovery: the "expensive problems we can solve" backlog ----

  // List discovered problems (optionally ?status= or ?minScore=) + headline stats
  ['GET', /^\/api\/problems$/, handler(async (req, res) => {
    const u = new URL(req.url, 'http://x').searchParams;
    const problems = listProblems({
      status: u.get('status') || undefined,
      minScore: u.get('minScore') != null ? Number(u.get('minScore')) : undefined,
    });
    send(res, 200, { problems, stats: problemStats() });
  })],

  // Update a problem's pipeline status / notes / product mapping
  ['PATCH', /^\/api\/problems\/(\d+)$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const allowed = {};
    for (const k of ['status', 'notes', 'product', 'mvp_path']) if (k in b) allowed[k] = b[k];
    send(res, 200, { problem: updateProblem(Number(id), allowed) });
  })],

  ['DELETE', /^\/api\/problems\/(\d+)$/, handler(async (req, res, [id]) => {
    deleteProblem(Number(id));
    send(res, 200, { ok: true });
  })],

  // Kick off a problem-discovery run (the script orchestrates four Codex scouts)
  ['POST', /^\/api\/problems\/discover$/, handler(async (req, res) => {
    const b = await readBody(req);
    const result = startDiscovery({ count: Math.min(Math.max(Number(b.count) || 6, 1), 12) });
    send(res, result.started ? 202 : 409, result);
  })],

  // Poll the running (or last) discovery run's progress log
  ['GET', /^\/api\/problems\/discover\/status$/, handler(async (req, res) => {
    send(res, 200, discoverRun);
  })],

  // Enqueue an autonomous MVP build for one problem and mark it building
  ['POST', /^\/api\/problems\/(\d+)\/build$/, handler(async (req, res, [id]) => {
    const problem = getProblem(Number(id));
    if (!problem) return send(res, 404, { error: 'problem not found' });
    await enqueueMvpBuild(problem);
    send(res, 202, { problem: updateProblem(Number(id), { status: 'building' }) });
  })],

  // ---- Problem Found: products, accounts, discovery, offers, tasks, metrics ----

  // Product tabs + per-product funnel stats
  ['GET', /^\/api\/products$/, handler(async (req, res) => {
    const stats = Object.fromEntries(productStats().map((s) => [s.product, s]));
    const products = productsByPriority().map((p) => ({
      id: p.id, label: p.label, short: p.short, product_name: p.product_name,
      icon: p.icon, tagline: p.tagline, outcome: p.outcome, priority: p.priority,
      active: !!p.active, pilot_range: p.pilot_range,
      accounts: stats[p.id]?.accounts || 0,
      qualified: stats[p.id]?.qualified || 0,
      contacts: stats[p.id]?.contacts || 0,
    }));
    send(res, 200, { products, company: loadProducts().company });
  })],

  // Full config for one product (personas, signals, exclusions, discovery cfg) + shared rules
  ['GET', /^\/api\/products\/([a-z]+)\/config$/, handler(async (req, res, [id]) => {
    send(res, 200, { product: getProduct(id), shared: sharedConfig() });
  })],

  // Accounts for a product (hydrated: people, signals, score breakdown, counts)
  ['GET', /^\/api\/accounts$/, handler(async (req, res) => {
    const product = new URL(req.url, 'http://x').searchParams.get('product') || undefined;
    const accounts = accountsForProduct(product).map((a) => ({ ...a, outreach: outreachAllowed(a) }));
    send(res, 200, { accounts });
  })],

  // Create an account (company) tied to a product
  ['POST', /^\/api\/accounts$/, handler(async (req, res) => {
    const b = await readBody(req);
    if (!b.name) return send(res, 400, { error: 'name is required' });
    if (require_unique(b.name)) return send(res, 409, { error: 'account already exists' });
    const p = b.product ? getProduct(b.product) : null;
    const company = insertCompany({
      name: b.name, city: b.city || null, location: b.location || null,
      industry: b.industry || null, website: b.website || null, domain: b.domain || null,
      source: 'manual', campaign: b.product || 'wapahki',
      target_titles: (p && p.target_titles) || [],
    });
    const account = updateCompany(company.id, {
      product: b.product || null, stage: 'Researched',
      hypothesis: b.hypothesis || null, signals: b.signals || [],
    });
    ensurePursuit(account.id);
    send(res, 201, { account: { ...account, people: [] } });
  })],

  // Update account fields (hypothesis, stage, signals, referral, gnk_status/notes, product)
  ['PATCH', /^\/api\/accounts\/(\d+)$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    send(res, 200, { account: updateCompany(Number(id), b) });
  })],

  // Fast manual contact capture for people already known from prior outreach.
  ['POST', /^\/api\/accounts\/(\d+)\/people$/, handler(async (req, res, [id]) => {
    const companyId = Number(id);
    const company = getCompany(companyId);
    if (!company) return send(res, 404, { error: 'account not found' });
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    if (!name) return send(res, 400, { error: 'name is required' });
    const parts = name.split(/\s+/);
    const person = upsertPerson({
      company_id: companyId,
      name,
      first_name: b.first_name || parts[0] || null,
      last_name: b.last_name || (parts.length > 1 ? parts.slice(1).join(' ') : null),
      title: b.title || null,
      email: b.email || null,
      email_status: b.email ? 'manual' : null,
      linkedin_url: b.linkedin_url || null,
      role_type: b.role_type || null,
      status: b.status || 'new',
      notes: b.notes || null,
    });
    if (b.role_type) updatePerson(person.id, { role_type: b.role_type });
    send(res, 201, { person: getPerson(person.id) });
  })],

  // Complete outreach history and next-action scheduling for an account.
  ['GET', /^\/api\/touchpoints$/, handler(async (req, res) => {
    const query = new URL(req.url, 'http://x').searchParams;
    send(res, 200, {
      touchpoints: listTouchpoints({
        companyId: query.get('company_id') ? Number(query.get('company_id')) : undefined,
        personId: query.get('person_id') ? Number(query.get('person_id')) : undefined,
        product: query.get('product') || undefined,
        limit: query.get('limit') ? Number(query.get('limit')) : undefined,
      }),
    });
  })],
  ['POST', /^\/api\/accounts\/(\d+)\/touchpoints$/, handler(async (req, res, [id]) => {
    const companyId = Number(id);
    const b = await readBody(req);
    if (!b.channel) return send(res, 400, { error: 'channel is required' });
    send(res, 201, createTouchpoint({
      ...b,
      company_id: companyId,
      person_id: b.person_id ? Number(b.person_id) : null,
    }));
  })],

  // Compute + store the weighted lead score from per-factor ratings
  ['POST', /^\/api\/accounts\/(\d+)\/score$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const result = computeLeadScore(b.inputs || {});
    updateCompany(Number(id), { lead_score: result.score, score_breakdown: result.breakdown });
    send(res, 200, result);
  })],

  // Discovery answers (qualification questions)
  ['GET', /^\/api\/accounts\/(\d+)\/discovery$/, handler(async (req, res, [id]) => {
    send(res, 200, { answers: getDiscovery(Number(id)), questions: sharedConfig().qualification_questions });
  })],
  ['PUT', /^\/api\/accounts\/(\d+)\/discovery$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    if (!b.qkey) return send(res, 400, { error: 'qkey is required' });
    send(res, 200, { answers: setDiscoveryAnswer(Number(id), b.qkey, b.answer ?? '') });
  })],

  // Opportunities / 30-60-90 offer builder
  ['GET', /^\/api\/accounts\/(\d+)\/opportunities$/, handler(async (req, res, [id]) => {
    send(res, 200, { opportunities: listOpportunities(Number(id)), offers: sharedConfig().offers });
  })],
  ['POST', /^\/api\/accounts\/(\d+)\/opportunities$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const account = getCompany(Number(id));
    const offer = (sharedConfig().offers || []).find((o) => o.key === b.offer_key);
    if (!offer) return send(res, 400, { error: 'unknown offer_key' });
    const opp = createOpportunity({
      company_id: Number(id), product: account?.product || null, offer_key: offer.key,
      label: offer.label, value_low: offer.value_low, value_high: offer.value_high, status: 'draft',
    });
    send(res, 201, { opportunity: opp });
  })],
  ['PATCH', /^\/api\/opportunities\/(\d+)$/, handler(async (req, res, [id]) => {
    send(res, 200, { opportunity: updateOpportunity(Number(id), await readBody(req)) });
  })],
  ['DELETE', /^\/api\/opportunities\/(\d+)$/, handler(async (req, res, [id]) => {
    deleteOpportunity(Number(id));
    send(res, 200, { ok: true });
  })],
  // Generate an SOW/proposal for one opportunity and store it
  ['POST', /^\/api\/opportunities\/(\d+)\/sow$/, handler(async (req, res, [id]) => {
    const opp = getOpportunity(Number(id));
    if (!opp) return send(res, 404, { error: 'opportunity not found' });
    const account = getCompany(opp.company_id);
    const acctHydrated = { ...account, signals: safeParse(account?.signals) };
    const product = account?.product ? getProduct(account.product) : null;
    const offer = (sharedConfig().offers || []).find((o) => o.key === opp.offer_key)
      || { label: opp.label, days: 30, buys: '', value_low: opp.value_low, value_high: opp.value_high };
    const sow = generateSOW({ account: acctHydrated, product, offer, discovery: getDiscovery(opp.company_id) });
    send(res, 200, { opportunity: updateOpportunity(Number(id), { sow }), sow });
  })],

  // Task queue (manual LinkedIn/email outreach + reminders)
  ['GET', /^\/api\/tasks$/, handler(async (req, res) => {
    const u = new URL(req.url, 'http://x').searchParams;
    send(res, 200, { tasks: listTasks({ status: u.get('status') || undefined, product: u.get('product') || undefined }) });
  })],
  ['POST', /^\/api\/tasks$/, handler(async (req, res) => {
    send(res, 201, { task: createTask(await readBody(req)) });
  })],
  ['PATCH', /^\/api\/tasks\/(\d+)$/, handler(async (req, res, [id]) => {
    const body = await readBody(req);
    if (body.status === 'done') {
      return send(res, 200, completeTask(Number(id), body));
    }
    send(res, 200, { task: updateTask(Number(id), body) });
  })],
  ['POST', /^\/api\/tasks\/(\d+)\/complete$/, handler(async (req, res, [id]) => {
    send(res, 200, completeTask(Number(id), await readBody(req)));
  })],
  ['DELETE', /^\/api\/tasks\/(\d+)$/, handler(async (req, res, [id]) => {
    deleteTask(Number(id));
    send(res, 200, { ok: true });
  })],

  // Metrics dashboard (optionally per product)
  ['GET', /^\/api\/metrics$/, handler(async (req, res) => {
    const product = new URL(req.url, 'http://x').searchParams.get('product') || undefined;
    send(res, 200, { metrics: accountMetrics(product) });
  })],
  ['GET', /^\/api\/sales-loop$/, handler(async (req, res) => {
    const product = new URL(req.url, 'http://x').searchParams.get('product') || undefined;
    send(res, 200, { loop: salesLoopSummary(product) });
  })],

  // The CRM grid: accounts → contacts → the messages to send, per business.
  ['GET', /^\/api\/crm$/, handler(async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const business = q.get('business') || '';
    const rows = crmRows({
      business,
      search: q.get('search') || '',
      status: q.get('status') || '',
      limit: q.get('limit') ? Number(q.get('limit')) : undefined,
    });
    send(res, 200, { businesses: crmBusinesses(), business, rows, total: rows.length });
  })],

  // All-business email calendar. The UI and a future sender service share this
  // projection, while sequences remains the canonical schedule/message table.
  ['GET', /^\/api\/crm\/calendar$/, handler(async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    send(res, 200, {
      businesses: crmBusinesses(),
      ...crmCalendar({
        start: q.get('start') || undefined,
        end: q.get('end') || undefined,
        search: q.get('search') || '',
        limit: q.get('limit') ? Number(q.get('limit')) : undefined,
      }),
    });
  })],

  // Download the visible contact set with the full campaign-specific sequence.
  ['GET', /^\/api\/crm\/export\.csv$/, handler(async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const business = q.get('business') || '';
    const csv = buildCrmCsv({
      business,
      search: q.get('search') || '',
      status: q.get('status') || '',
    });
    const slug = business || 'all-businesses';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-outreach-sequence.csv"`,
    });
    res.end(csv);
  })],

  // The deal strategy sheet uses the same account/contact/message records as
  // the CRM. It is a view over that system, not a second outreach workflow.
  ['GET', /^\/api\/crm\/deals$/, handler(async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const business = q.get('business') || '';
    const rows = crmDealRows({
      business,
      search: q.get('search') || '',
      status: q.get('status') || '',
      limit: q.get('limit') ? Number(q.get('limit')) : undefined,
    });
    send(res, 200, { businesses: crmBusinesses(), business, rows, total: rows.length });
  })],

  // Kick off an agent regeneration of a contact's messages (background job).
  ['POST', /^\/api\/crm\/contacts\/(\d+)\/generate$/, handler(async (req, res, [id]) => {
    const job = startContactGeneration(Number(id));
    send(res, 202, { job: publicJob(job) });
  })],
  // Poll the status of a contact's agent regeneration.
  ['GET', /^\/api\/crm\/contacts\/(\d+)\/generate$/, handler(async (req, res, [id]) => {
    send(res, 200, { job: publicJob(generationJobs.get(Number(id))) });
  })],

  // A contact's generated campaign sequence (for the UI to display drafts)
  ['GET', /^\/api\/people\/(\d+)\/sequence$/, handler(async (req, res, [id]) => {
    send(res, 200, { sequence: listSequencesByPerson(Number(id)) });
  })],

  // Edit or send a single message inline. Marking sent records a touchpoint.
  ['PATCH', /^\/api\/sequences\/(\d+)$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const patch = {};
    if ('subject' in b) patch.subject = b.subject;
    if ('body' in b) patch.body = b.body;
    if ('status' in b) patch.status = b.status;
    send(res, 200, { sequence: editSequence(Number(id), patch) });
  })],

  // Explicit "record as sent" — marks the touch sent and logs the touchpoint.
  ['POST', /^\/api\/sequences\/(\d+)\/sent$/, handler(async (req, res, [id]) => {
    send(res, 200, { sequence: editSequence(Number(id), { status: 'sent' }) });
  })],

  ['POST', /^\/api\/companies$/, handler(async (req, res) => {
    const b = await readBody(req);
    if (!b.name) return send(res, 400, { error: 'name is required' });
    if (getCompany && require_unique(b.name)) return send(res, 409, { error: 'company already exists' });
    const company = insertCompany({
      name: b.name,
      city: b.city || null,
      location: b.location || 'Ontario, Canada',
      industry: b.industry || null,
      website: b.website || null,
      domain: b.domain || null,
      source: 'manual',
      target_titles: b.target_titles && b.target_titles.length
        ? b.target_titles
        : ['Production Supervisor', 'Process Engineer', 'Operations Manager', 'Maintenance Manager', 'Warehouse Supervisor'],
    });
    ensurePursuit(company.id);
    send(res, 201, { company: { ...company, people: [] } });
  })],

  ['PATCH', /^\/api\/companies\/(\d+)$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const company = updateCompany(Number(id), b);
    send(res, 200, { company });
  })],

  ['DELETE', /^\/api\/companies\/(\d+)$/, handler(async (req, res, [id]) => {
    deleteCompany(Number(id));
    send(res, 200, { ok: true });
  })],

  // Apollo: find people for one company by target titles
  ['POST', /^\/api\/companies\/(\d+)\/find-people$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const result = await pipeline.findPeopleForCompany(Number(id), { limit: b.limit || 5 });
    send(res, 200, result);
  })],

  // Apollo: build up to 5 emailable, currently-employed contacts (search + enrich in one shot)
  ['POST', /^\/api\/companies\/(\d+)\/build$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const result = await pipeline.buildCompanyContacts(Number(id), { limit: b.limit || 5 });
    send(res, 200, result);
  })],

  // Apollo: unlock emails for one company's people (costs credits)
  ['POST', /^\/api\/companies\/(\d+)\/enrich$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const result = await pipeline.enrichCompanyEmails(Number(id), { revealPersonalEmails: !!b.revealPersonalEmails });
    send(res, 200, result);
  })],

  // Apollo: unlock one person's email
  ['POST', /^\/api\/people\/(\d+)\/enrich$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    const person = await pipeline.enrichPerson(Number(id), { revealPersonalEmails: !!b.revealPersonalEmails });
    send(res, 200, { person });
  })],

  ['PATCH', /^\/api\/people\/(\d+)$/, handler(async (req, res, [id]) => {
    const b = await readBody(req);
    // If title changed, recompute relevance from the company name.
    if (b.title) {
      const person = getPersonCompany(Number(id));
      const { score, reason } = scoreContact(b.title, person?.company_name || 'the company');
      b.relevance_score = score;
      b.relevance_reason = reason;
    }
    const person = updatePerson(Number(id), b);
    send(res, 200, { person });
  })],

  ['DELETE', /^\/api\/people\/(\d+)$/, handler(async (req, res, [id]) => {
    deletePerson(Number(id));
    send(res, 200, { ok: true });
  })],

  // Company discovery via Apollo (no Google key needed)
  ['POST', /^\/api\/discover$/, handler(async (req, res) => {
    const b = await readBody(req);
    const added = await discovery.discoverCompanies({ limit: b.limit || 40 });
    send(res, 200, { added: added.length, companies: added });
  })],

  ['GET', /^\/api\/export\.csv$/, handler(async (req, res) => {
    const csv = buildCsv();
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="wapahki-crm.csv"',
    });
    res.end(csv);
  })],
];

// Helpers that need db access -------------------------------------------
function require_unique(name) {
  return db.prepare('SELECT 1 FROM companies WHERE name = ?').get(name);
}
function getPersonCompany(personId) {
  return db.prepare(`
    SELECT p.*, c.name AS company_name FROM people p
    JOIN companies c ON c.id = p.company_id WHERE p.id = ?
  `).get(personId);
}

function safeParse(str, fallback = []) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv() {
  const header = ['company', 'domain', 'person', 'title', 'email', 'email_status', 'relevance', 'why_they_would_reply', 'linkedin', 'status'];
  const rows = [header.join(',')];
  for (const c of companiesWithPeople()) {
    for (const p of c.people) {
      rows.push([
        c.name, c.domain, p.name, p.title, p.email, p.email_status,
        p.relevance_score, p.relevance_reason, p.linkedin_url, p.status,
      ].map(csvCell).join(','));
    }
  }
  return rows.join('\n');
}

function buildGrantCsv(applicant) {
  const header = [
    'applicant', 'program', 'stream', 'funder', 'jurisdiction', 'funding_type',
    'amount_min_cad', 'amount_max_cad', 'coverage_percent', 'intake_status',
    'deadline', 'eligibility', 'score', 'status', 'project_fit', 'eligibility_gaps',
    'next_steps', 'contact_name', 'contact_title', 'contact_email', 'contact_url',
    'official_url', 'application_url', 'last_verified_at',
  ];
  const rows = [header.join(',')];
  for (const grant of grants.listGrants({ applicant })) {
    const contactRows = grant.contacts?.length ? grant.contacts : [{}];
    for (const contact of contactRows) {
      rows.push([
        grant.applicant, grant.program_name, grant.stream, grant.funder,
        grant.jurisdiction, grant.funding_type, grant.amount_min, grant.amount_max,
        grant.coverage_percent, grant.intake_status, grant.deadline,
        grant.eligibility_result, grant.score, grant.status, grant.project_fit,
        (grant.eligibility_gaps || []).join(' | '), (grant.next_steps || []).join(' | '),
        contact.contact_name, contact.contact_title, contact.contact_email,
        contact.contact_url, grant.official_url, grant.application_url,
        grant.last_verified_at,
      ].map(csvCell).join(','));
    }
  }
  return rows.join('\n');
}

// ---- Dispatcher ---------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path.startsWith('/api/')) {
    for (const [method, pattern, fn] of routes) {
      if (req.method !== method) continue;
      const m = pattern.exec(path);
      if (m) return fn(req, res, m.slice(1));
    }
    return send(res, 404, { error: `no route for ${req.method} ${path}` });
  }

  // Deal strategy now lives beside the contacts/messages it informs. Keep the
  // old URL as a compatibility route into the CRM's spreadsheet Deals view.
  if (path === '/dealroom' || path === '/dealroom.html') return redirect(res, '/?view=deals');
  // Clean URL for the problem-discovery dashboard.
  if (path === '/problems') return serveStatic(res, '/problems.html');
  // Clean URL for the outreach spreadsheet (company -> people -> 7 touch columns).
  if (path === '/outreach') return serveStatic(res, '/outreach.html');
  // GnK opportunity board. Old Forth routes remain compatibility aliases.
  if (path === '/gnk' || path === '/forth' || path === '/forthsolutions') return serveStatic(res, '/gnk.html');
  // OutageHub: use-case research, target accounts, contacts and first-touch drafts.
  if (path === '/outagehub') return serveStatic(res, '/outagehub.html');
  // Venture-specific non-dilutive funding research.
  if (path === '/outagehub/grants' || path === '/ohub/grants') return serveStatic(res, '/grants.html');
  if (path === '/wahpaki/grants' || path === '/grants') return serveStatic(res, '/grants.html');

  return serveStatic(res, path);
});

server.listen(PORT, () => {
  console.log(`\n  Outreach OS →  http://localhost:${PORT}  ·  Deals sheet →  http://localhost:${PORT}/?view=deals  ·  Problem Radar →  http://localhost:${PORT}/problems\n`);
  console.log(`  Apollo key:  ${config.hasApollo ? `set (${config.apolloKeySource})` : 'NOT set — set it with  export APOLLO_API_KEY=...  then restart'}\n`);
  // Writers can finish while the CRM is running. Reconcile their newly created
  // per-recipient suggestions into the shared 30/day calendar without sending.
  setTimeout(reconcileEmailCapacitySchedule, 1_500).unref();
  setInterval(reconcileEmailCapacitySchedule, 60_000).unref();
});
