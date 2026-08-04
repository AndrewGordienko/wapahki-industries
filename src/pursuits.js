import {
  db,
  getCompany,
  getPerson,
  listPeopleByCompany,
  upsertPerson,
  updatePerson,
  createTouchpoint,
} from './db.js';
import {
  defaultNextGoal,
  evaluateDealArchitecture,
  evaluateDraft,
  evaluatePursuitReadiness,
  getPursuitMotion,
  nextIncompleteStep,
  parseEvidence,
  parseList,
  PURSUIT_TYPES,
  stepsForPursuitType,
} from './pursuit-policy.js';

function safeJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function rowPursuit(row) {
  if (!row) return null;
  return {
    ...row,
    evidence: safeJson(row.evidence, []),
    workflow_scorecard: safeJson(row.workflow_scorecard, {}),
    qualification: safeJson(row.qualification, {}),
    proof_assets: safeJson(row.proof_assets, []),
    success_metrics: safeJson(row.success_metrics, []),
    joint_action_plan: safeJson(row.joint_action_plan, []),
  };
}

export function systemSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM system_settings ORDER BY key').all().map((row) => [row.key, row.value]));
}

export function setSystemSetting(key, value) {
  const allowed = new Set([
    'autonomous_sending_enabled',
    'require_human_approval',
    'legacy_writers_enabled',
    'max_new_contacts_per_account_day',
  ]);
  if (!allowed.has(key)) throw new Error('unknown system setting');
  // The operator (and the agents acting for them) own these settings. There is
  // no live email/LinkedIn send integration, so "sending" always means the
  // operator marking a message sent by hand — the settings are advisory, not gates.
  const normalized = String(value);
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(key, normalized);
  return systemSettings();
}

export function ensurePursuit(companyId) {
  const company = getCompany(companyId);
  if (!company || company.archived_at) throw new Error('account not found');
  let pursuit = db.prepare('SELECT * FROM pursuits WHERE company_id = ?').get(companyId);
  if (!pursuit) {
    const info = db.prepare(`
      INSERT INTO pursuits (
        company_id, product, pursuit_type, status, phase, problem, consequence, narrative,
        approval_status, autonomy_status
      ) VALUES (?, ?, 'pilot_customer', 'draft', 'research', ?, ?, ?, 'needs_review', 'human_only')
    `).run(
      companyId,
      company.product || company.campaign || null,
      company.hypothesis || null,
      null,
      company.hypothesis || null,
    );
    pursuit = db.prepare('SELECT * FROM pursuits WHERE id = ?').get(Number(info.lastInsertRowid));
  }
  ensurePursuitSteps(pursuit.id, pursuit.pursuit_type, pursuit.product || company.product || company.campaign);
  return getPursuit(pursuit.id);
}

export function ensurePursuitSteps(pursuitId, pursuitType, product) {
  const stored = db.prepare('SELECT pursuit_type,product FROM pursuits WHERE id=?').get(pursuitId);
  const type = PURSUIT_TYPES.includes(pursuitType) ? pursuitType : stored?.pursuit_type;
  const resolvedProduct = product || stored?.product;
  const steps = stepsForPursuitType(type, resolvedProduct);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO pursuit_steps (
      pursuit_id, step_order, step_key, label, phase, channel, narrative_job
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE pursuit_steps
    SET step_order=?, label=?, phase=?, channel=?, narrative_job=?,
        status=CASE WHEN status='skipped' AND outcome='motion_replaced' THEN 'planned' ELSE status END,
        outcome=CASE WHEN status='skipped' AND outcome='motion_replaced' THEN NULL ELSE outcome END,
        completed_at=CASE WHEN status='skipped' AND outcome='motion_replaced' THEN NULL ELSE completed_at END,
        updated_at=datetime('now')
    WHERE pursuit_id=? AND step_key=?
  `);
  steps.forEach((step, index) => {
    insert.run(
      pursuitId,
      (index + 1) * 10,
      step.step_key,
      step.label,
      step.phase,
      step.channel,
      step.narrative_job,
    );
    update.run(
      (index + 1) * 10,
      step.label,
      step.phase,
      step.channel,
      step.narrative_job,
      pursuitId,
      step.step_key,
    );
  });

  // Motion changes never delete history. Obsolete unstarted steps are moved out
  // of the active ladder; anything drafted, approved, sent, or completed stays.
  const keys = steps.map((step) => step.step_key);
  const placeholders = keys.map(() => '?').join(',');
  db.prepare(`
    UPDATE pursuit_steps
    SET status='skipped', outcome='motion_replaced',
        step_order=1000 + step_order, updated_at=datetime('now')
    WHERE pursuit_id=?
      AND step_key NOT IN (${placeholders})
      AND status IN ('planned','ready','rejected')
  `).run(pursuitId, ...keys);
}

export function getPursuit(id) {
  const base = db.prepare('SELECT pursuit_type,product FROM pursuits WHERE id=?').get(id);
  if (!base) return null;
  ensurePursuitSteps(id, base.pursuit_type, base.product);
  const pursuit = rowPursuit(db.prepare(`
    SELECT pu.*, c.name AS company_name, c.campaign, c.industry, c.website,
           c.stage AS company_stage, c.lead_score, c.archived_at AS company_archived_at,
           p.name AS primary_name, p.title AS primary_title, p.email AS primary_email,
           p.lifecycle_status AS primary_lifecycle_status
    FROM pursuits pu
    JOIN companies c ON c.id=pu.company_id
    LEFT JOIN people p ON p.id=pu.primary_person_id
    WHERE pu.id=?
  `).get(id));
  if (!pursuit) return null;
  pursuit.contacts = db.prepare(`
    SELECT pc.*, p.name, p.title, p.email, p.linkedin_url, p.status AS person_status,
           p.lifecycle_status, p.last_verified_at, p.suppression_reason
    FROM pursuit_contacts pc
    JOIN people p ON p.id=pc.person_id
    WHERE pc.pursuit_id=?
    ORDER BY CASE pc.role
      WHEN 'operator_champion' THEN 0 WHEN 'business_unit_owner' THEN 1
      WHEN 'champion' THEN 2 WHEN 'economic_buyer' THEN 3
      WHEN 'partner_owner' THEN 4 WHEN 'technical' THEN 5
      WHEN 'executive_sponsor' THEN 6 WHEN 'referral' THEN 7 ELSE 8 END,
      pc.priority, p.name COLLATE NOCASE
  `).all(id);
  pursuit.steps = db.prepare(`
    SELECT ps.*, p.name AS person_name, p.title AS person_title,
           (
             SELECT od.id FROM outreach_drafts od
             WHERE od.step_id=ps.id
             ORDER BY od.id DESC LIMIT 1
           ) AS latest_draft_id,
           (
             SELECT od.status FROM outreach_drafts od
             WHERE od.step_id=ps.id
             ORDER BY od.id DESC LIMIT 1
           ) AS latest_draft_status
    FROM pursuit_steps ps
    LEFT JOIN people p ON p.id=ps.person_id
    WHERE ps.pursuit_id=?
      AND NOT (ps.status='skipped' AND ps.outcome='motion_replaced')
    ORDER BY ps.step_order
  `).all(id);
  const primary = pursuit.primary_person_id ? getPerson(pursuit.primary_person_id) : null;
  const company = getCompany(pursuit.company_id);
  const mapped = new Map(pursuit.contacts.map((contact) => [contact.person_id, contact]));
  pursuit.account_people = listPeopleByCompany(pursuit.company_id).map((person) => ({
    ...person,
    pursuit_role: mapped.get(person.id)?.role || null,
    pursuit_state: mapped.get(person.id)?.state || null,
    is_primary: person.id === pursuit.primary_person_id,
  }));
  const history = db.prepare('SELECT * FROM touchpoints WHERE company_id=? ORDER BY occurred_at DESC').all(pursuit.company_id);
  pursuit.motion = getPursuitMotion(pursuit.pursuit_type, pursuit.product);
  pursuit.deal_architecture = evaluateDealArchitecture(pursuit);
  pursuit.readiness = evaluatePursuitReadiness({
    pursuit,
    company,
    primaryPerson: primary,
    contactHistory: history,
    settings: systemSettings(),
  });
  pursuit.next_step = nextIncompleteStep(pursuit.steps);
  return pursuit;
}

export function getPursuitByCompany(companyId) {
  const row = db.prepare('SELECT id FROM pursuits WHERE company_id=?').get(companyId);
  return row ? getPursuit(row.id) : ensurePursuit(companyId);
}

export function listPursuitProducts() {
  return db.prepare(`
    SELECT COALESCE(pu.product,c.product,c.campaign) AS id, COUNT(*) AS pursuits
    FROM pursuits pu
    JOIN companies c ON c.id=pu.company_id
    WHERE c.archived_at IS NULL
    GROUP BY COALESCE(pu.product,c.product,c.campaign)
    ORDER BY pursuits DESC, id
  `).all();
}

export function listPursuits({
  product, status, approvalStatus, pursuitType,
} = {}) {
  const where = ['c.archived_at IS NULL'];
  const values = [];
  if (product) { where.push('COALESCE(pu.product,c.product,c.campaign)=?'); values.push(product); }
  if (status) { where.push('pu.status=?'); values.push(status); }
  if (approvalStatus) { where.push('pu.approval_status=?'); values.push(approvalStatus); }
  if (pursuitType) { where.push('pu.pursuit_type=?'); values.push(pursuitType); }
  return db.prepare(`
    SELECT pu.*, c.name AS company_name, c.campaign, c.industry, c.stage AS company_stage,
           c.lead_score, p.name AS primary_name, p.title AS primary_title,
           COUNT(DISTINCT pc.id) AS mapped_contacts,
           COUNT(DISTINCT CASE WHEN od.status='pending_review' THEN od.id END) AS drafts_to_review,
           MIN(CASE WHEN ps.status NOT IN ('sent','complete','skipped') THEN ps.step_order END) AS next_step_order
    FROM pursuits pu
    JOIN companies c ON c.id=pu.company_id
    LEFT JOIN people p ON p.id=pu.primary_person_id
    LEFT JOIN pursuit_contacts pc ON pc.pursuit_id=pu.id
    LEFT JOIN pursuit_steps ps ON ps.pursuit_id=pu.id
    LEFT JOIN outreach_drafts od ON od.pursuit_id=pu.id
    WHERE ${where.join(' AND ')}
    GROUP BY pu.id
    ORDER BY
      CASE pu.approval_status WHEN 'approved' THEN 0 WHEN 'needs_review' THEN 1 ELSE 2 END,
      (c.lead_score IS NULL), c.lead_score DESC, c.name COLLATE NOCASE
  `).all(...values).map(rowPursuit);
}

export function updatePursuit(id, patch = {}) {
  const current = getPursuit(id);
  if (!current) throw new Error('pursuit not found');
  if ('pursuit_type' in patch && !PURSUIT_TYPES.includes(patch.pursuit_type)) {
    throw new Error('unknown pursuit type');
  }
  if ('approval_status' in patch && !['needs_review', 'approved', 'rejected'].includes(patch.approval_status)) {
    throw new Error('unknown approval status');
  }
  if ('primary_person_id' in patch && patch.primary_person_id != null && patch.primary_person_id !== '') {
    const person = getPerson(Number(patch.primary_person_id));
    if (!person || person.company_id !== current.company_id) {
      throw new Error('primary contact does not belong to this pursuit account');
    }
    patch.primary_person_id = Number(patch.primary_person_id);
  }
  const allowed = [
    'product', 'pursuit_type', 'status', 'phase', 'hypothesis_key', 'observed_fact',
    'problem', 'evidence', 'workflow_owner', 'consequence', 'records', 'kill_condition',
    'workflow_scorecard', 'qualification',
    'cost_model', 'cost_confidence', 'offer', 'narrative', 'primary_person_id',
    'desired_commitment', 'value_to_partner', 'value_to_us', 'decision_process',
    'commercial_path', 'proof_assets', 'success_metrics', 'joint_action_plan',
    'next_goal', 'approval_status', 'autonomy_status',
  ];
  const jsonFields = new Set([
    'evidence', 'workflow_scorecard', 'qualification',
    'proof_assets', 'success_metrics', 'joint_action_plan',
  ]);
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (!(key in patch)) continue;
    if (jsonFields.has(key)) {
      const parsed = key === 'evidence'
        ? parseEvidence(patch[key])
        : ['workflow_scorecard', 'qualification'].includes(key)
          ? (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]) ? patch[key] : {})
          : parseList(patch[key]);
      sets.push(`${key}=?`);
      values.push(JSON.stringify(parsed));
    } else {
      sets.push(`${key}=?`);
      values.push(key === 'primary_person_id' && patch[key] === '' ? null : patch[key]);
    }
  }

  const approvalSensitive = new Set([
    'pursuit_type', 'hypothesis_key', 'observed_fact', 'problem', 'evidence',
    'workflow_owner', 'consequence', 'records', 'kill_condition', 'workflow_scorecard',
    'qualification', 'cost_model',
    'cost_confidence', 'offer', 'narrative', 'primary_person_id',
    'desired_commitment', 'value_to_partner', 'value_to_us',
  ]);
  const invalidatesApproval = current.approval_status === 'approved'
    && patch.approval_status == null
    && Object.keys(patch).some((key) => approvalSensitive.has(key));
  if (invalidatesApproval) {
    sets.push("approval_status='needs_review'", "status='draft'");
  }

  if (patch.approval_status === 'approved') {
    const candidate = {
      ...current,
      ...patch,
      approval_status: 'approved',
      evidence: patch.evidence == null ? current.evidence : parseEvidence(patch.evidence),
      workflow_scorecard: patch.workflow_scorecard == null
        ? current.workflow_scorecard
        : patch.workflow_scorecard,
      qualification: patch.qualification == null ? current.qualification : patch.qualification,
      proof_assets: patch.proof_assets == null ? current.proof_assets : parseList(patch.proof_assets),
      success_metrics: patch.success_metrics == null ? current.success_metrics : parseList(patch.success_metrics),
      joint_action_plan: patch.joint_action_plan == null ? current.joint_action_plan : parseList(patch.joint_action_plan),
    };
    const company = getCompany(current.company_id);
    const primary = candidate.primary_person_id ? getPerson(candidate.primary_person_id) : null;
    const history = db.prepare('SELECT * FROM touchpoints WHERE company_id=?').all(current.company_id);
    const readiness = evaluatePursuitReadiness({
      pursuit: candidate,
      company,
      primaryPerson: primary,
      contactHistory: history,
      settings: systemSettings(),
    });
    // Approval is one of the readiness conditions; evaluate the candidate as approved.
    const nonApprovalErrors = readiness.errors.filter((error) => !/narrative has not been approved/i.test(error));
    if (nonApprovalErrors.length) throw new Error(nonApprovalErrors.join(' '));
  }
  if (sets.length) {
    sets.push("updated_at=datetime('now')");
    values.push(id);
    db.prepare(`UPDATE pursuits SET ${sets.join(', ')} WHERE id=?`).run(...values);
  }
  if ('pursuit_type' in patch || 'product' in patch) {
    ensurePursuitSteps(id, patch.pursuit_type || current.pursuit_type, patch.product || current.product);
  }
  if ('primary_person_id' in patch && patch.primary_person_id) {
    const existing = db.prepare('SELECT role FROM pursuit_contacts WHERE pursuit_id=? AND person_id=?').get(id, patch.primary_person_id);
    setPursuitContact(id, patch.primary_person_id, {
      role: existing?.role || 'reserve',
      state: 'selected',
      primary: true,
    });
  }
  if (patch.approval_status === 'approved') {
    db.prepare(`
      UPDATE pursuit_steps
      SET status='complete', completed_at=COALESCE(completed_at, datetime('now')),
          outcome='research_approved', updated_at=datetime('now')
      WHERE pursuit_id=? AND step_key='research'
    `).run(id);
    const steps = db.prepare('SELECT * FROM pursuit_steps WHERE pursuit_id=? ORDER BY step_order').all(id);
    const next = nextIncompleteStep(steps);
    db.prepare(`
      UPDATE pursuits
      SET status='ready', phase=?, next_goal=?, updated_at=datetime('now')
      WHERE id=?
    `).run(next?.phase || 'attention', defaultNextGoal(next), id);
  }
  const result = getPursuit(id);
  if (!result) throw new Error('pursuit not found');
  return result;
}

export function setPursuitContact(pursuitId, personId, {
  role = 'reserve',
  priority = 3,
  state = 'candidate',
  reason = null,
  primary = false,
} = {}) {
  const pursuit = getPursuit(pursuitId);
  const person = getPerson(personId);
  if (!pursuit || !person || person.company_id !== pursuit.company_id) {
    throw new Error('contact does not belong to this pursuit account');
  }
  if (!String(role || '').trim()) throw new Error('stakeholder role is required');
  if (!['candidate', 'selected', 'contacted', 'replied', 'paused', 'rejected'].includes(state)) {
    throw new Error('unknown stakeholder state');
  }
  const makePrimary = primary || role === 'primary';
  const functionalRole = role === 'primary' ? 'reserve' : role;
  db.prepare(`
    INSERT INTO pursuit_contacts (
      pursuit_id, person_id, role, priority, state, reason, last_verified_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(pursuit_id, person_id) DO UPDATE SET
      role=excluded.role, priority=excluded.priority, state=excluded.state,
      reason=excluded.reason, last_verified_at=excluded.last_verified_at,
      updated_at=datetime('now')
  `).run(pursuitId, personId, functionalRole, priority, state, reason, person.last_verified_at);
  if (makePrimary) {
    db.prepare("UPDATE pursuits SET primary_person_id=?, updated_at=datetime('now') WHERE id=?").run(personId, pursuitId);
  }
  return getPursuit(pursuitId);
}

export function updatePursuitStep(pursuitId, stepId, {
  status,
  outcome = null,
  plannedFor = null,
  personId = null,
} = {}) {
  const pursuit = getPursuit(pursuitId);
  if (!pursuit) throw new Error('pursuit not found');
  if (!pursuit.readiness.ready) throw new Error(pursuit.readiness.errors.join(' '));
  const step = pursuit.steps.find((item) => item.id === Number(stepId));
  if (!step) throw new Error('step does not belong to pursuit');
  if (personId) {
    const person = getPerson(Number(personId));
    if (!person || person.company_id !== pursuit.company_id) throw new Error('step owner does not belong to pursuit account');
  }

  const next = nextIncompleteStep(pursuit.steps);
  if (status && !['planned', 'complete', 'skipped'].includes(status)) throw new Error('unknown step status');
  if (['complete', 'skipped'].includes(status)) {
    if (pursuit.approval_status !== 'approved') throw new Error('Approve the pursuit narrative before advancing the commitment ladder.');
    if (!next || next.id !== step.id) throw new Error('Only the next incomplete commitment may be completed or skipped.');
    if (status === 'complete' && ['email', 'linkedin'].includes(step.channel)) {
      throw new Error('Message steps advance only after an approved draft is manually sent and recorded.');
    }
  }
  if (status === 'planned') {
    const laterFinished = pursuit.steps.some((item) => (
      item.step_order > step.step_order && ['sent', 'complete'].includes(item.status)
    ));
    if (laterFinished) throw new Error('A step cannot be reopened after a later commitment has been completed.');
  }

  const nextStatus = status || step.status;
  db.prepare(`
    UPDATE pursuit_steps
    SET status=?, outcome=?, planned_for=?, person_id=?,
        completed_at=CASE WHEN ? IN ('complete','skipped') THEN datetime('now') ELSE NULL END,
        updated_at=datetime('now')
    WHERE id=?
  `).run(
    nextStatus,
    outcome || null,
    plannedFor || step.planned_for || null,
    personId || step.person_id || null,
    nextStatus,
    step.id,
  );

  const refreshedSteps = db.prepare('SELECT * FROM pursuit_steps WHERE pursuit_id=? ORDER BY step_order').all(pursuitId);
  const upcoming = nextIncompleteStep(refreshedSteps);
  const pursuitStatus = upcoming ? 'active' : (nextStatus === 'complete' ? 'won' : 'paused');
  db.prepare(`
    UPDATE pursuits
    SET status=?, phase=?, next_goal=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    pursuitStatus,
    upcoming?.phase || 'close',
    upcoming
      ? defaultNextGoal(upcoming)
      : (pursuitStatus === 'won'
        ? 'Agreement secured. Confirm the implementation handoff and operating cadence.'
        : 'No signed commitment was recorded. Decide whether to pause, re-scope, or close the pursuit.'),
    pursuitId,
  );
  return getPursuit(pursuitId);
}

export function verifyPerson(personId, { active = true, note } = {}) {
  const person = getPerson(personId);
  if (!person) throw new Error('contact not found');
  if (person.suppression_reason && active) throw new Error('suppressed contacts cannot be reactivated without clearing the suppression reason');
  const notes = note
    ? [person.notes, `Verified ${new Date().toISOString().slice(0, 10)}: ${note}`].filter(Boolean).join('\n')
    : person.notes;
  return updatePerson(personId, {
    lifecycle_status: active ? 'active' : 'needs_verification',
    last_verified_at: active ? new Date().toISOString() : null,
    notes,
  });
}

function draftContext(draftId) {
  const draft = db.prepare(`
    SELECT od.*, ps.step_key, ps.narrative_job, ps.status AS step_status,
           pu.company_id, pu.product, pu.problem, pu.evidence, pu.consequence,
           pu.cost_model, pu.cost_confidence, pu.narrative, pu.approval_status,
           c.campaign
    FROM outreach_drafts od
    JOIN pursuit_steps ps ON ps.id=od.step_id
    JOIN pursuits pu ON pu.id=od.pursuit_id
    JOIN companies c ON c.id=pu.company_id
    WHERE od.id=?
  `).get(draftId);
  if (!draft) return null;
  const pursuit = getPursuit(draft.pursuit_id);
  const previousBodies = db.prepare(`
    SELECT body FROM outreach_drafts
    WHERE pursuit_id=? AND id!=? AND status IN ('approved','sent')
    ORDER BY id
  `).all(draft.pursuit_id, draftId).map((row) => row.body);
  const quality = evaluateDraft({
    draft,
    step: draft,
    campaign: draft.campaign,
    previousBodies,
    costConfidence: draft.cost_confidence,
  });
  return { draft, pursuit, quality };
}

export function createOutreachDraft({
  pursuitId,
  stepId,
  personId,
  channel,
  subject,
  body,
  source = 'manual',
  rationale = null,
  revisionOf = null,
}) {
  const pursuit = getPursuit(pursuitId);
  if (!pursuit) throw new Error('pursuit not found');
  const step = pursuit.steps.find((item) => item.id === Number(stepId));
  if (!step) throw new Error('step does not belong to pursuit');
  const next = nextIncompleteStep(pursuit.steps);
  if (!next || next.id !== step.id) throw new Error('Only the next incomplete narrative step may be drafted.');
  if (!['email', 'linkedin'].includes(channel || step.channel)) {
    throw new Error('This commitment is completed through research, a meeting, or a document—not an outreach message draft.');
  }
  const person = getPerson(personId);
  if (!person || person.company_id !== pursuit.company_id) throw new Error('contact does not belong to pursuit account');
  if (person.lifecycle_status !== 'active' || person.suppression_reason) throw new Error('contact is not active and sendable');
  const mappedContact = pursuit.contacts.find((contact) => (
    contact.person_id === Number(personId) && !['paused', 'rejected'].includes(contact.state)
  ));
  if (!mappedContact) throw new Error('contact must be selected on the pursuit stakeholder map before drafting.');
  const draftLike = { channel: channel || step.channel, subject, body };
  const previousBodies = db.prepare(`
    SELECT body FROM outreach_drafts
    WHERE pursuit_id=? AND status IN ('approved','sent')
    ORDER BY id
  `).all(pursuitId).map((row) => row.body);
  const quality = evaluateDraft({
    draft: draftLike,
    step,
    campaign: pursuit.campaign,
    previousBodies,
    costConfidence: pursuit.cost_confidence,
  });
  db.prepare(`
    UPDATE outreach_drafts
    SET status='superseded'
    WHERE pursuit_id=? AND step_id=? AND status IN ('pending_review','approved')
  `).run(pursuitId, stepId);
  const info = db.prepare(`
    INSERT INTO outreach_drafts (
      pursuit_id, step_id, person_id, channel, subject, body, status,
      revision_of, source, rationale, quality_report
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?)
  `).run(
    pursuitId,
    stepId,
    personId,
    channel || step.channel,
    subject || null,
    body,
    revisionOf || null,
    source,
    rationale,
    JSON.stringify(quality),
  );
  db.prepare(`
    UPDATE pursuit_steps
    SET status='drafted', person_id=?, updated_at=datetime('now')
    WHERE id=?
  `).run(personId, stepId);
  return getOutreachDraft(Number(info.lastInsertRowid));
}

export function getOutreachDraft(id) {
  const context = draftContext(id);
  if (!context) return null;
  return {
    ...context.draft,
    quality_report: context.quality,
    pursuit_readiness: context.pursuit.readiness,
    company_name: context.pursuit.company_name,
    primary_name: context.pursuit.primary_name,
    narrative_job: context.draft.narrative_job,
  };
}

export function listOutreachDrafts({ status, product, pursuitId, limit = 200 } = {}) {
  const where = [];
  const values = [];
  if (status) { where.push('od.status=?'); values.push(status); }
  if (product) { where.push('COALESCE(pu.product,c.product,c.campaign)=?'); values.push(product); }
  if (pursuitId) { where.push('od.pursuit_id=?'); values.push(pursuitId); }
  values.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  return db.prepare(`
    SELECT od.*, ps.step_key, ps.label AS step_label, ps.narrative_job,
           c.name AS company_name, c.campaign, p.name AS person_name, p.title AS person_title,
           pu.cost_confidence, pu.approval_status AS pursuit_approval
    FROM outreach_drafts od
    JOIN pursuit_steps ps ON ps.id=od.step_id
    JOIN pursuits pu ON pu.id=od.pursuit_id
    JOIN companies c ON c.id=pu.company_id
    JOIN people p ON p.id=od.person_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY od.created_at DESC, od.id DESC
    LIMIT ?
  `).all(...values).map((row) => ({
    ...row,
    quality_report: safeJson(row.quality_report, {}),
  }));
}

export function reviewOutreachDraft(id, {
  status,
  rationale,
} = {}) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('review status must be approved or rejected');
  const context = draftContext(id);
  if (!context) throw new Error('draft not found');
  if (status === 'approved') {
    if (!context.pursuit.readiness.ready) throw new Error(context.pursuit.readiness.errors.join(' '));
    if (!context.quality.pass) throw new Error(context.quality.errors.join(' '));
  }
  const timeColumn = status === 'approved' ? 'approved_at' : 'rejected_at';
  db.prepare(`
    UPDATE outreach_drafts
    SET status=?, rationale=COALESCE(?, rationale), quality_report=?, ${timeColumn}=datetime('now')
    WHERE id=?
  `).run(status, rationale || null, JSON.stringify(context.quality), id);
  db.prepare(`
    UPDATE pursuit_steps SET status=?, updated_at=datetime('now') WHERE id=?
  `).run(status, context.draft.step_id);
  return getOutreachDraft(id);
}

export function markOutreachDraftSent(id, { occurredAt, nextActionDate } = {}) {
  const context = draftContext(id);
  if (!context) throw new Error('draft not found');
  if (context.draft.status !== 'approved') throw new Error('Only an approved draft can be marked sent.');
  if (systemSettings().require_human_approval !== 'true') throw new Error('Human approval safety setting is disabled.');
  createTouchpoint({
    company_id: context.pursuit.company_id,
    person_id: context.draft.person_id,
    product: context.pursuit.product || context.pursuit.campaign,
    occurred_at: occurredAt || new Date().toISOString(),
    channel: context.draft.channel,
    direction: 'outbound',
    outcome: 'sent',
    summary: `${context.draft.step_key}: ${context.draft.subject || context.draft.narrative_job}`,
    notes: context.draft.rationale,
    subject: context.draft.subject,
    body: context.draft.body,
    outreach_draft_id: context.draft.id,
    next_action_date: nextActionDate || null,
    next_action_channel: context.draft.channel,
    next_action_title: nextActionDate ? `Review response and plan ${context.draft.step_key}` : null,
  });
  db.prepare("UPDATE outreach_drafts SET status='sent', sent_at=datetime('now') WHERE id=?").run(id);
  db.prepare(`
    UPDATE pursuit_steps
    SET status='sent', completed_at=datetime('now'), outcome='sent', updated_at=datetime('now')
    WHERE id=?
  `).run(context.draft.step_id);
  const updated = getPursuit(context.draft.pursuit_id);
  const next = nextIncompleteStep(updated.steps);
  db.prepare(`
    UPDATE pursuits SET phase=?, next_goal=?, status='active', updated_at=datetime('now') WHERE id=?
  `).run(next?.phase || 'close', defaultNextGoal(next), updated.id);
  return { draft: getOutreachDraft(id), pursuit: getPursuit(updated.id) };
}

export function listArchivedContacts({ status = 'needs_verification', company, limit = 250 } = {}) {
  const where = [];
  const values = [];
  if (status) { where.push('review_status=?'); values.push(status); }
  if (company) { where.push('lower(company_name) LIKE ?'); values.push(`%${String(company).toLowerCase()}%`); }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 1000));
  return db.prepare(`
    SELECT * FROM contact_archive
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY relevance_score DESC, company_name COLLATE NOCASE, name COLLATE NOCASE
    LIMIT ?
  `).all(...values);
}

export function restoreArchivedContact(id, {
  verify = false,
  roleType = null,
  note = null,
} = {}) {
  const archived = db.prepare('SELECT * FROM contact_archive WHERE id=?').get(id);
  if (!archived) throw new Error('archived contact not found');
  if (!archived.matched_company_id) throw new Error('No live account matches this archived contact.');
  const person = upsertPerson({
    company_id: archived.matched_company_id,
    name: archived.name,
    first_name: archived.first_name,
    last_name: archived.last_name,
    title: archived.title,
    email: archived.email,
    email_status: archived.email_status || 'historical',
    linkedin_url: archived.linkedin_url,
    apollo_person_id: archived.apollo_person_id,
    relevance_score: archived.relevance_score,
    relevance_reason: archived.relevance_reason,
    status: 'new',
    notes: [archived.notes, note, `Recovered from ${archived.source_db}`].filter(Boolean).join('\n'),
  });
  updatePerson(person.id, {
    lifecycle_status: verify ? 'active' : 'needs_verification',
    last_verified_at: verify ? new Date().toISOString() : null,
    role_type: roleType,
  });
  db.prepare(`
    UPDATE contact_archive
    SET review_status='restored', restored_person_id=?, reviewed_at=datetime('now')
    WHERE id=?
  `).run(person.id, id);
  return { archive: db.prepare('SELECT * FROM contact_archive WHERE id=?').get(id), person: getPerson(person.id) };
}

export function commandCenter(product) {
  const values = product ? [product] : [];
  const productWhere = product ? 'AND COALESCE(pu.product,c.product,c.campaign)=?' : '';
  const taskWhere = product ? 'AND t.product=?' : '';
  const touchWhere = product ? 'AND tp.product=?' : '';
  const today = new Date().toISOString().slice(0, 10);
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS pursuits,
      COUNT(*) FILTER (WHERE pu.approval_status='needs_review') AS narratives_to_review,
      COUNT(*) FILTER (WHERE pu.approval_status='approved' AND pu.status IN ('ready','active')) AS active_approved,
      COUNT(*) FILTER (WHERE pu.primary_person_id IS NULL) AS missing_primary
    FROM pursuits pu JOIN companies c ON c.id=pu.company_id
    WHERE c.archived_at IS NULL ${productWhere}
  `).get(...values);
  const byType = db.prepare(`
    SELECT pu.pursuit_type, COUNT(*) AS pursuits,
           COUNT(*) FILTER (WHERE pu.approval_status='approved') AS approved,
           COUNT(*) FILTER (WHERE pu.status='won') AS won
    FROM pursuits pu JOIN companies c ON c.id=pu.company_id
    WHERE c.archived_at IS NULL ${productWhere}
    GROUP BY pu.pursuit_type
    ORDER BY pursuits DESC
  `).all(...values);
  const tasks = db.prepare(`
    SELECT t.*, c.name AS company_name, p.name AS person_name
    FROM tasks t
    LEFT JOIN companies c ON c.id=t.company_id
    LEFT JOIN people p ON p.id=t.person_id
    WHERE t.status='todo' ${taskWhere}
    ORDER BY (t.due_date IS NULL), t.due_date, t.id
    LIMIT 30
  `).all(...values);
  const due = tasks.filter((task) => task.due_date && task.due_date <= today);
  const reviews = listOutreachDrafts({ status: 'pending_review', product, limit: 20 });
  const recent = db.prepare(`
    SELECT tp.*, c.name AS company_name, p.name AS person_name
    FROM touchpoints tp
    JOIN companies c ON c.id=tp.company_id
    LEFT JOIN people p ON p.id=tp.person_id
    WHERE 1=1 ${touchWhere}
    ORDER BY datetime(tp.occurred_at) DESC, tp.id DESC
    LIMIT 20
  `).all(...values);
  return {
    generated_at: new Date().toISOString(),
    settings: systemSettings(),
    counts: { ...counts, due_actions: due.length, drafts_to_review: reviews.length },
    by_type: byType,
    due_actions: due,
    upcoming_actions: tasks.filter((task) => !due.includes(task)),
    drafts_to_review: reviews,
    recent_conversations: recent,
  };
}

export function systemAudit() {
  const settings = systemSettings();
  const checks = [
    {
      key: 'autonomous_send_off',
      pass: settings.autonomous_sending_enabled === 'false',
      detail: `autonomous_sending_enabled=${settings.autonomous_sending_enabled}`,
    },
    {
      key: 'human_approval_on',
      pass: settings.require_human_approval === 'true',
      detail: `require_human_approval=${settings.require_human_approval}`,
    },
    {
      key: 'legacy_writers_off',
      pass: settings.legacy_writers_enabled === 'false',
      detail: `legacy_writers_enabled=${settings.legacy_writers_enabled}`,
    },
    {
      key: 'human_only_pursuits',
      pass: !db.prepare("SELECT 1 FROM pursuits WHERE autonomy_status NOT IN ('human_only','draft_only') LIMIT 1").get(),
      detail: 'no pursuit can act autonomously',
    },
    {
      key: 'known_pursuit_types',
      pass: !db.prepare(`
        SELECT 1 FROM pursuits
        WHERE pursuit_type IS NULL
           OR pursuit_type NOT IN ('pilot_customer','technology_partner','channel_partner','strategic_partner')
        LIMIT 1
      `).get(),
      detail: 'all pursuits use a governed commercial motion',
    },
    {
      key: 'person_history_trigger',
      pass: !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='audit_person_update'").get(),
      detail: 'contact updates are versioned',
    },
    {
      key: 'sequence_history_trigger',
      pass: !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='audit_sequence_delete'").get(),
      detail: 'legacy sequence deletes are versioned',
    },
  ];
  const data = {
    accounts_without_pursuits: db.prepare(`
      SELECT COUNT(*) n FROM companies c
      WHERE c.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM pursuits pu WHERE pu.company_id=c.id)
    `).get().n,
    pursuits_needing_review: db.prepare("SELECT COUNT(*) n FROM pursuits WHERE approval_status='needs_review'").get().n,
    pending_draft_reviews: db.prepare("SELECT COUNT(*) n FROM outreach_drafts WHERE status='pending_review'").get().n,
    recovered_contacts_waiting: db.prepare("SELECT COUNT(*) n FROM contact_archive WHERE review_status='needs_verification'").get().n,
    people_marked_emailed_without_ledger: db.prepare(`
      SELECT COUNT(*) n FROM people p
      WHERE p.status='emailed' AND NOT EXISTS (
        SELECT 1 FROM touchpoints tp WHERE tp.person_id=p.id AND tp.outcome='sent'
      )
    `).get().n,
  };
  return {
    safe_mode: checks.every((check) => check.pass),
    checks,
    data,
  };
}
