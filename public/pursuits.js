const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const api = {
  async request(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: body == null ? undefined : { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  },
  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  patch: (path, body) => api.request('PATCH', path, body),
};

const state = {
  products: [],
  motions: {},
  pursuitTypes: [],
  pursuits: [],
  commandCenter: null,
  product: '',
  pursuitType: '',
  approvalStatus: '',
  search: '',
  selectedId: null,
  pursuit: null,
  composeStep: null,
};

const ROLE_LABELS = {
  operator: 'Operator',
  process_owner: 'Process owner',
  operator_champion: 'Operator champion',
  champion: 'Champion',
  economic_buyer: 'Economic buyer',
  technical: 'Technical owner',
  technical_security_owner: 'Technical / security owner',
  safety_procurement: 'Safety / procurement',
  partner_owner: 'Partner owner',
  product_owner: 'Product owner',
  executive_sponsor: 'Executive sponsor',
  sales_owner: 'Sales owner',
  delivery_owner: 'Delivery owner',
  business_unit_owner: 'Business-unit owner',
  legal_procurement: 'Legal / procurement',
  referral: 'Referral route',
  router: 'Router',
  reserve: 'Reserve / unknown',
};
const GNK_PRODUCTS = new Set(['gnk', 'delay', 'football', 'row']);
const GNK_SCORECARD = [
  ['frequent', 'Repeated frequently'],
  ['expensive_when_poor', 'Expensive when handled poorly'],
  ['measurable', 'Measurable in time, money, errors, or risk'],
  ['records_exist', 'Supported by records the company already has'],
  ['identifiable_owner', 'Owned by an identifiable department'],
  ['testable_30_45_days', 'Testable in 30–45 days'],
  ['supports_40k_90k_engagement', 'Can justify a $40k–$90k first engagement'],
];
const GNK_QUALIFICATION = [
  ['recurring_workflow', 'Recurring workflow confirmed'],
  ['measurable_consequence', 'Measurable consequence confirmed'],
  ['named_owner', 'Named owner'],
  ['accessible_data', 'Accessible data'],
  ['credible_champion', 'Credible champion'],
  ['defined_pilot_outcome', 'Defined pilot outcome'],
];
const ALL_ROLES = Object.keys(ROLE_LABELS);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function toast(message, kind = '') {
  const element = $('#toast');
  element.textContent = message;
  element.className = `deal-toast ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add('hidden'), 4600);
}

function labelize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncate(value, length = 150) {
  const text = String(value || '').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function sameValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left || []) === JSON.stringify(right || []);
  }
  return String(left ?? '') === String(right ?? '');
}

function statusChip(value, extra = '') {
  return `<span class="status-chip ${esc(value)} ${extra}">${esc(labelize(value))}</span>`;
}

function roleLabel(role) {
  return ROLE_LABELS[role] || labelize(role);
}

function roleOptions(selected, roles = ALL_ROLES) {
  const ordered = [...new Set([...roles, ...ALL_ROLES])];
  return ordered.map((role) => (
    `<option value="${esc(role)}" ${role === selected ? 'selected' : ''}>${esc(roleLabel(role))}</option>`
  )).join('');
}

function setUrlPursuit(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('pursuit', id);
  else url.searchParams.delete('pursuit');
  history.replaceState(null, '', url);
}

function renderSafety(audit) {
  const pill = $('#safetyPill');
  pill.className = `safety-pill ${audit.safe_mode ? 'safe' : 'unsafe'}`;
  pill.textContent = audit.safe_mode
    ? 'Safeguards on · human approval'
    : 'Safety audit needs attention';
  const waiting = audit.data?.recovered_contacts_waiting || 0;
  $('#archiveBtn').textContent = `Recovered contacts${waiting ? ` · ${waiting}` : ''}`;
}

function renderFilters() {
  const productOptions = state.products.map((product) => (
    `<option value="${esc(product.id)}" ${product.id === state.product ? 'selected' : ''}>${esc(product.short || product.label || product.id)}</option>`
  )).join('');
  $('#productFilter').innerHTML = `<option value="">All products</option>${productOptions}`;
  $('#typeFilter').innerHTML = '<option value="">All deal motions</option>' + state.pursuitTypes.map((type) => (
    `<option value="${esc(type)}" ${type === state.pursuitType ? 'selected' : ''}>${esc(state.motions[type].label)}</option>`
  )).join('');
  $('#approvalFilter').value = state.approvalStatus;
}

function queryString() {
  const query = new URLSearchParams();
  if (state.product) query.set('product', state.product);
  if (state.pursuitType) query.set('pursuit_type', state.pursuitType);
  if (state.approvalStatus) query.set('approval_status', state.approvalStatus);
  return query.toString();
}

async function loadPursuits({ openFirst = true } = {}) {
  const query = queryString();
  const [pursuitData, centerData] = await Promise.all([
    api.get(`/api/pursuits${query ? `?${query}` : ''}`),
    api.get(`/api/command-center${state.product ? `?product=${encodeURIComponent(state.product)}` : ''}`),
  ]);
  state.pursuits = pursuitData.pursuits;
  state.commandCenter = centerData.command_center;
  renderMetrics();
  renderPursuitList();
  if (state.selectedId && !state.pursuits.some((pursuit) => pursuit.id === state.selectedId)) {
    state.selectedId = null;
    state.pursuit = null;
    setUrlPursuit(null);
    renderEmptyWorkspace();
  }
  if (openFirst && !state.selectedId && state.pursuits.length) await openPursuit(state.pursuits[0].id);
}

function renderMetrics() {
  const center = state.commandCenter || {};
  const counts = center.counts || {};
  const metrics = [
    ['Pursuits', counts.pursuits || 0, state.product ? 'in this product' : 'across all products'],
    ['Needs review', counts.narratives_to_review || 0, 'research is not approved'],
    ['Active + approved', counts.active_approved || 0, 'allowed to draft next step'],
    ['Missing primary', counts.missing_primary || 0, 'no accountable first route'],
    ['Draft review', counts.drafts_to_review || 0, 'messages waiting on you'],
    ['Due actions', counts.due_actions || 0, 'manual work due today'],
  ];
  $('#metrics').innerHTML = metrics.map(([label, value, note]) => (
    `<div class="deal-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><em>${esc(note)}</em></div>`
  )).join('');
  $('#reviewCount').textContent = counts.drafts_to_review || 0;
}

function visiblePursuits() {
  const needle = state.search.toLowerCase().trim();
  if (!needle) return state.pursuits;
  return state.pursuits.filter((pursuit) => [
    pursuit.company_name,
    pursuit.primary_name,
    pursuit.problem,
    pursuit.narrative,
    pursuit.industry,
  ].some((value) => String(value || '').toLowerCase().includes(needle)));
}

function renderPursuitList() {
  const pursuits = visiblePursuits();
  $('#railCount').textContent = pursuits.length;
  $('#pursuitList').innerHTML = pursuits.length ? pursuits.map((pursuit) => {
    const motion = state.motions[pursuit.pursuit_type] || {};
    return `
      <button class="pursuit-card ${pursuit.id === state.selectedId ? 'active' : ''}" data-pursuit-id="${pursuit.id}" data-motion="${esc(pursuit.pursuit_type)}">
        <span class="motion-bar"></span>
        <span>
          <span class="pcard-top">
            <strong>${esc(pursuit.company_name)}</strong>
            ${statusChip(pursuit.approval_status)}
          </span>
          <span class="pcard-problem">${esc(truncate(pursuit.problem || 'Research shell: define the specific problem and commitment before outreach.'))}</span>
          <span class="pcard-bottom">
            <span>${esc(motion.short_label || labelize(pursuit.pursuit_type))}</span>
            <span>·</span>
            <span>${pursuit.mapped_contacts || 0} mapped</span>
            <span>·</span>
            <span>${esc(labelize(pursuit.status))}</span>
            ${pursuit.primary_name ? `<span>· ${esc(pursuit.primary_name)}</span>` : ''}
          </span>
        </span>
      </button>`;
  }).join('') : '<div class="workspace-empty"><p>No pursuits match these filters.</p></div>';
  $$('[data-pursuit-id]', $('#pursuitList')).forEach((button) => {
    button.addEventListener('click', () => openPursuit(Number(button.dataset.pursuitId)));
  });
}

function renderEmptyWorkspace() {
  $('#workspace').innerHTML = `
    <div class="workspace-empty">
      <div class="empty-orbit">◎</div>
      <h2>Select a pursuit</h2>
      <p>The account narrative, stakeholder map, proof plan, and commitment ladder will appear here.</p>
    </div>`;
}

async function openPursuit(id) {
  state.selectedId = Number(id);
  renderPursuitList();
  $('#workspace').innerHTML = '<div class="workspace-empty"><p>Loading deal workspace…</p></div>';
  try {
    const { pursuit } = await api.get(`/api/pursuits/${id}`);
    state.pursuit = pursuit;
    setUrlPursuit(id);
    renderWorkspace();
  } catch (error) {
    renderEmptyWorkspace();
    toast(error.message, 'error');
  }
}

function evidenceRows(items = []) {
  const rows = items.length ? items : [{ claim: '', url: '', observed_at: '' }];
  return rows.map((item) => `
    <div class="structured-row evidence-row" data-row>
      <input data-key="claim" value="${esc(item.claim || '')}" placeholder="Exact public fact or observable evidence" />
      <input data-key="url" type="url" value="${esc(item.url || '')}" placeholder="https:// direct source" />
      <input data-key="observed_at" value="${esc(item.observed_at || '')}" placeholder="Date / year" title="Observed or published date" />
      <button class="remove-row" data-remove-row title="Remove">×</button>
    </div>`).join('');
}

function proofRows(items = []) {
  const rows = items.length ? items : [{ name: '', url: '', status: 'planned', owner: '' }];
  return rows.map((item) => `
    <div class="structured-row" data-row>
      <input data-key="name" value="${esc(item.name || '')}" placeholder="Proof asset" />
      <input data-key="url" type="url" value="${esc(item.url || '')}" placeholder="Link, if available" />
      <select data-key="status">
        ${['missing', 'planned', 'in_progress', 'ready'].map((status) => `<option value="${status}" ${item.status === status ? 'selected' : ''}>${labelize(status)}</option>`).join('')}
      </select>
      <input data-key="owner" value="${esc(item.owner || '')}" placeholder="Owner" />
      <button class="remove-row" data-remove-row title="Remove">×</button>
    </div>`).join('');
}

function metricRows(items = []) {
  const rows = items.length ? items : [{ metric: '', baseline: '', target: '', owner: '' }];
  return rows.map((item) => `
    <div class="structured-row" data-row>
      <input data-key="metric" value="${esc(item.metric || '')}" placeholder="What will be measured?" />
      <input data-key="baseline" value="${esc(item.baseline || '')}" placeholder="Baseline" />
      <input data-key="target" value="${esc(item.target || '')}" placeholder="Target / acceptance" />
      <input data-key="owner" value="${esc(item.owner || '')}" placeholder="Owner" />
      <button class="remove-row" data-remove-row title="Remove">×</button>
    </div>`).join('');
}

function planRows(items = []) {
  const rows = items.length ? items : [{ milestone: '', owner: '', due_date: '', status: 'planned' }];
  return rows.map((item) => `
    <div class="structured-row plan-row" data-row>
      <input data-key="milestone" value="${esc(item.milestone || '')}" placeholder="Decision, proof, or launch milestone" />
      <input data-key="owner" value="${esc(item.owner || '')}" placeholder="Named owner" />
      <input data-key="due_date" type="date" value="${esc(item.due_date || '')}" />
      <select data-key="status">
        ${['planned', 'in_progress', 'blocked', 'complete'].map((status) => `<option value="${status}" ${item.status === status ? 'selected' : ''}>${labelize(status)}</option>`).join('')}
      </select>
      <button class="remove-row" data-remove-row title="Remove">×</button>
    </div>`).join('');
}

function checklistHtml(items, values, prefix) {
  return `<div class="gnk-checklist">${items.map(([key, label]) => `
    <label><input type="checkbox" data-${prefix}="${esc(key)}" ${values?.[key] === true ? 'checked' : ''} /> <span>${esc(label)}</span></label>
  `).join('')}</div>`;
}

function collectChecklist(attribute) {
  return Object.fromEntries($$(`[${attribute}]`).map((input) => [input.getAttribute(attribute), input.checked]));
}

function readinessHtml(pursuit) {
  const errors = pursuit.readiness?.errors || [];
  const warnings = pursuit.readiness?.warnings || [];
  return `
    <div class="readiness-panel">
      <div class="readiness-box ${errors.length ? 'blocked' : 'clear'}">
        <strong>${errors.length ? `${errors.length} approval block${errors.length === 1 ? '' : 's'}` : 'Approval gate clear'}</strong>
        ${errors.length ? `<ul>${errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>` : '<span class="field-help">The narrative and first route satisfy the hard safety checks.</span>'}
      </div>
      <div class="readiness-box ${warnings.length ? 'guidance' : 'clear'}">
        <strong>${warnings.length ? 'Deal gaps to close' : 'Commercial map complete'}</strong>
        ${warnings.length ? `<ul>${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>` : '<span class="field-help">Stakeholders, proof, measures, and joint plan are mapped.</span>'}
      </div>
    </div>`;
}

function stakeholdersHtml(pursuit) {
  const required = pursuit.motion.required_roles || [];
  const mappedRoles = new Set(pursuit.contacts.filter((contact) => contact.state !== 'rejected').map((contact) => contact.role));
  const gapChips = required.map((role) => (
    `<span class="role-chip ${mappedRoles.has(role) ? 'filled' : 'missing'}">${mappedRoles.has(role) ? '✓' : '+'} ${esc(roleLabel(role))}</span>`
  )).join('');
  const rows = pursuit.contacts.length ? pursuit.contacts.map((contact) => {
    const primary = contact.person_id === pursuit.primary_person_id;
    return `
      <tr data-contact="${contact.person_id}">
        <td><span class="person-name">${primary ? '<span class="primary-star">★</span> ' : ''}${esc(contact.name || 'Unknown')}</span><div class="person-title">${esc(contact.title || '')}</div></td>
        <td><select data-contact-role>${roleOptions(contact.role, required)}</select></td>
        <td><select data-contact-state>
          ${['candidate', 'selected', 'contacted', 'replied', 'paused', 'rejected'].map((status) => `<option value="${status}" ${contact.state === status ? 'selected' : ''}>${labelize(status)}</option>`).join('')}
        </select></td>
        <td>${contact.lifecycle_status === 'active' ? statusChip(contact.last_verified_at ? 'verified' : 'active') : statusChip(contact.lifecycle_status || 'unknown')}</td>
        <td>
          <button class="quiet-button" data-save-contact="${contact.person_id}">Save</button>
          ${primary ? '' : `<button class="quiet-button" data-primary-contact="${contact.person_id}">Make primary</button>`}
          ${contact.last_verified_at ? '' : `<button class="quiet-button" data-verify-contact="${contact.person_id}">Verify</button>`}
        </td>
      </tr>`;
  }).join('') : '<tr><td colspan="5">No stakeholders mapped. Add the best available route below.</td></tr>';

  const available = pursuit.account_people.filter((person) => person.lifecycle_status !== 'archived');
  const peopleOptions = available.map((person) => (
    `<option value="${person.id}">${esc(person.name || 'Unknown')} · ${esc(person.title || 'No title')} · ${esc(person.lifecycle_status || 'active')}</option>`
  )).join('');
  const defaultRole = pursuit.deal_architecture.missing_roles?.[0] || required[0] || 'reserve';
  return `
    <div class="stakeholder-gaps">${gapChips}</div>
    <table class="stakeholder-table">
      <thead><tr><th>Person</th><th>Deal role</th><th>Relationship state</th><th>Verification</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="map-person">
      <select id="mapPerson"><option value="">Choose an account contact…</option>${peopleOptions}</select>
      <select id="mapRole">${roleOptions(defaultRole, required)}</select>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px"><input id="mapPrimary" type="checkbox" style="width:auto" /> Primary route</label>
      <button class="primary-button" id="mapPersonBtn" ${available.length ? '' : 'disabled'}>Map stakeholder</button>
    </div>`;
}

function ladderHtml(pursuit) {
  const nextId = pursuit.next_step?.id;
  return `<div class="commitment-ladder">${pursuit.steps.map((step, index) => {
    const done = ['complete', 'sent', 'skipped'].includes(step.status);
    const current = step.id === nextId;
    const latest = step.latest_draft_status;
    let actions = '';
    if (current && pursuit.approval_status === 'approved') {
      if (['email', 'linkedin'].includes(step.channel)) {
        if (latest === 'pending_review') actions = `<button class="primary-button" data-review-step="${step.id}">Review draft</button>`;
        else if (latest === 'approved') actions = `<button class="primary-button" data-record-sent="${step.latest_draft_id}">Record manual send</button>`;
        else actions = `<button class="primary-button" data-compose-step="${step.id}">Draft ${esc(step.channel)}</button>`;
      } else if (step.step_key !== 'research') {
        actions = `<button class="primary-button" data-complete-step="${step.id}">Mark complete</button><button class="quiet-button" data-skip-step="${step.id}">Skip with reason</button>`;
      }
    }
    return `
      <div class="ladder-step ${done ? 'done' : ''} ${current ? 'current' : ''}">
        <span class="step-index">${done ? '✓' : index + 1}</span>
        <div class="step-copy">
          <strong>${esc(step.label)}</strong>
          <p>${esc(step.narrative_job)}</p>
          <div class="step-meta">
            <span class="channel-chip">${esc(step.channel || 'internal')}</span>
            ${statusChip(step.status, current ? 'next' : '')}
            ${latest ? statusChip(latest) : ''}
            ${step.person_name ? `<span class="field-help">Owner: ${esc(step.person_name)}</span>` : ''}
          </div>
        </div>
        <div class="step-actions">${actions}</div>
      </div>`;
  }).join('')}</div>`;
}

function renderWorkspace() {
  const pursuit = state.pursuit;
  if (!pursuit) return renderEmptyWorkspace();
  const motionOptions = state.pursuitTypes.map((type) => (
    `<option value="${type}" ${type === pursuit.pursuit_type ? 'selected' : ''}>${esc(state.motions[type].label)}</option>`
  )).join('');
  const evidence = pursuit.evidence || [];
  const confidenceOptions = ['illustrative', 'public_model', 'verified'].map((value) => (
    `<option value="${value}" ${value === pursuit.cost_confidence ? 'selected' : ''}>${labelize(value)}</option>`
  )).join('');
  const approvalAction = pursuit.approval_status === 'approved'
    ? '<button class="danger-button" id="rejectPursuitBtn">Return to review</button>'
    : '<button class="primary-button" id="approvePursuitBtn">Approve narrative</button>';
  const proofRequirements = pursuit.motion.proof_requirements.map((requirement) => (
    `<div class="proof-requirement">${esc(requirement)}</div>`
  )).join('');
  const isGnk = GNK_PRODUCTS.has(String(pursuit.product || pursuit.campaign || '').toLowerCase());
  const gnkThesisFields = isGnk ? `
    <label>Shared cohort hypothesis<input id="hypothesisKey" value="${esc(pursuit.hypothesis_key || '')}" placeholder="e.g. retail_chargeback_evidence" /><span class="field-help">Use one or two hypotheses across 30–50 similar accounts.</span></label>
    <label>Likely workflow owner<textarea id="workflowOwner" rows="3" placeholder="Role or department; confirm in discovery.">${esc(pursuit.workflow_owner || '')}</textarea></label>
    <label class="span-2">Observed fact<textarea id="observedFact" rows="3" placeholder="Only what the cited public source actually says.">${esc(pursuit.observed_fact || '')}</textarea></label>
    <label class="span-2">Records / systems<textarea id="records" rows="3" placeholder="Documents or systems that could contain the answer; do not assume access.">${esc(pursuit.records || '')}</textarea></label>
    <label class="span-2">Kill condition<textarea id="killCondition" rows="3" placeholder="What would prove this is not worth pursuing?">${esc(pursuit.kill_condition || '')}</textarea></label>
    <div class="span-2 gnk-gate"><strong>Worth-pursuing screen</strong><span class="field-help">All seven must be credible before outreach.</span>${checklistHtml(GNK_SCORECARD, pursuit.workflow_scorecard, 'gnk-score')}</div>
    <div class="span-2 gnk-gate"><strong>Discovery qualification</strong><span class="field-help">Pause the opportunity when two or more remain missing after discovery.</span>${checklistHtml(GNK_QUALIFICATION, pursuit.qualification, 'gnk-qualification')}</div>
  ` : '';

  $('#workspace').innerHTML = `
    <div class="workspace-head">
      <div class="architecture-score" title="Deal architecture completeness">${pursuit.deal_architecture.completeness}%</div>
      <div class="head-main">
        <h2>${esc(pursuit.company_name)}</h2>
        <p>${esc(pursuit.industry || 'Industry not recorded')} · ${esc(pursuit.motion.label)} · ${esc(pursuit.primary_name ? `Primary: ${pursuit.primary_name}` : 'No primary route')}</p>
      </div>
      <div class="head-actions">
        ${statusChip(pursuit.approval_status)}
        ${statusChip(pursuit.status)}
        <button class="quiet-button" id="savePursuitBtn">Save workspace</button>
        ${approvalAction}
      </div>
    </div>
    <div class="workspace-body">
      ${readinessHtml(pursuit)}

      <section class="deal-section">
        <div class="section-heading">
          <div><h3>1. Deal architecture</h3><p>The exact commitment, mutual value, and decision path—not a vague “partnership conversation.”</p></div>
        </div>
        <div class="section-body">
          <div class="motion-banner">
            <div><strong>${esc(pursuit.motion.label)}</strong><p>${esc(pursuit.motion.description)}</p></div>
            <div class="motion-commitment"><b>Useful finish line:</b><br />${esc(pursuit.motion.commitment_example)}</div>
          </div>
          <div class="field-grid">
            <label>Commercial motion<select id="pursuitType">${motionOptions}</select><span class="field-help">Changing motion replaces only unstarted ladder steps and requires reapproval.</span></label>
            <label>Product / venture<input id="pursuitProduct" value="${esc(pursuit.product || '')}" /></label>
            <label class="span-2">Concrete commitment<textarea id="desiredCommitment" rows="2" placeholder="${esc(pursuit.motion.commitment_example)}">${esc(pursuit.desired_commitment || '')}</textarea></label>
            <label>Value to the partner<textarea id="valueToPartner" rows="3" placeholder="Operational, technical, market, revenue, or risk value they receive.">${esc(pursuit.value_to_partner || '')}</textarea></label>
            <label>Value to ${isGnk ? 'GnK' : 'Wapahki'}<textarea id="valueToUs" rows="3" placeholder="Revenue, proof, access, evidence, expansion rights, credibility, or another explicit return.">${esc(pursuit.value_to_us || '')}</textarea></label>
            <label>Decision process<textarea id="decisionProcess" rows="3" placeholder="Who recommends, validates, approves, procures, and signs?">${esc(pursuit.decision_process || '')}</textarea></label>
            <label>Commercial path<textarea id="commercialPath" rows="3" placeholder="SOW, vendor onboarding, legal, PO, deposit, partner agreement, launch…">${esc(pursuit.commercial_path || '')}</textarea></label>
          </div>
        </div>
      </section>

      <section class="deal-section">
        <div class="section-heading"><div><h3>2. Account thesis</h3><p>${isGnk ? 'Observed fact → hypothesis → owner → consequence → records → historical pilot → kill condition.' : 'Separate public evidence from the hypothesis. Approval authorizes drafting, never sending.'}</p></div></div>
        <div class="section-body">
          <div class="field-grid">
            ${gnkThesisFields}
            <label class="span-2">${isGnk ? 'Problem hypothesis' : 'Specific problem'}<textarea id="problem" rows="3">${esc(pursuit.problem || '')}</textarea></label>
            <label class="span-2">Consequence<textarea id="consequence" rows="3">${esc(pursuit.consequence || '')}</textarea></label>
            <label>${isGnk ? 'Historical-data pilot test' : 'Offer / first useful move'}<textarea id="offer" rows="3">${esc(pursuit.offer || '')}</textarea></label>
            <label>Cost model<textarea id="costModel" rows="3" placeholder="If 4 people x 10 hours/week x 8 weeks x $125/hour, the burden is about $40,000. Mark sourced vs illustrative inputs.">${esc(pursuit.cost_model || '')}</textarea><span class="field-help">Show the equation. Keep assumptions visibly hypothetical and separate base burden from contingent exposure.</span></label>
            <label>Cost confidence<select id="costConfidence">${confidenceOptions}</select></label>
            <label class="span-2">Pursuit narrative<textarea id="narrative" rows="4" placeholder="Why this account, why this motion, why now, and what the first conversation must learn.">${esc(pursuit.narrative || '')}</textarea></label>
          </div>
          <div class="section-heading" style="padding-left:0;padding-right:0;margin-top:14px"><div><h3>Public evidence</h3><p>Each claim needs a direct source URL.</p></div></div>
          <div id="evidenceList" class="structured-list" data-list="evidence">${evidenceRows(evidence)}</div>
          <button class="quiet-button add-row" data-add-row="evidence">+ Evidence item</button>
        </div>
      </section>

      <section class="deal-section">
        <div class="section-heading"><div><h3>3. Stakeholder coalition</h3><p>Large-company relationships are won inside a business unit by several people with different reasons to act.</p></div></div>
        <div class="section-body">${stakeholdersHtml(pursuit)}</div>
      </section>

      <section class="deal-section">
        <div class="section-heading"><div><h3>4. Proof and success plan</h3><p>Map the evidence the buying group will need before the commitment can be signed.</p></div></div>
        <div class="section-body">
          <div class="proof-requirements">${proofRequirements}</div>
          <div id="proofList" class="structured-list" data-list="proof">${proofRows(pursuit.proof_assets)}</div>
          <button class="quiet-button add-row" data-add-row="proof">+ Proof asset</button>
          <div class="section-heading" style="padding-left:0;padding-right:0;margin-top:18px"><div><h3>Success measures</h3><p>Agree the baseline, target, and owner before the proof becomes political.</p></div></div>
          <div id="metricList" class="structured-list" data-list="metric">${metricRows(pursuit.success_metrics)}</div>
          <button class="quiet-button add-row" data-add-row="metric">+ Success measure</button>
        </div>
      </section>

      <section class="deal-section">
        <div class="section-heading"><div><h3>5. Joint action plan</h3><p>The shared checklist that turns interest into decisions, owners, dates, and a launch.</p></div></div>
        <div class="section-body">
          <div id="planList" class="structured-list" data-list="plan">${planRows(pursuit.joint_action_plan)}</div>
          <button class="quiet-button add-row" data-add-row="plan">+ Joint milestone</button>
        </div>
      </section>

      <section class="deal-section">
        <div class="section-heading"><div><h3>6. Commitment ladder</h3><p>Only the next incomplete commitment can advance. Meetings and documents are logged as decisions; messages enter human review.</p></div></div>
        <div class="section-body">${ladderHtml(pursuit)}</div>
      </section>
    </div>`;
  wireWorkspace();
}

function collectRows(selector) {
  return $$('[data-row]', $(selector)).map((row) => {
    const item = {};
    $$('[data-key]', row).forEach((input) => { item[input.dataset.key] = input.value.trim(); });
    return item;
  }).filter((item) => Object.values(item).some((value) => value && !['planned', 'missing'].includes(value)));
}

function pursuitPatch() {
  const gnkFields = $('#observedFact') ? {
    hypothesis_key: $('#hypothesisKey').value.trim(),
    observed_fact: $('#observedFact').value.trim(),
    workflow_owner: $('#workflowOwner').value.trim(),
    records: $('#records').value.trim(),
    kill_condition: $('#killCondition').value.trim(),
    workflow_scorecard: collectChecklist('data-gnk-score'),
    qualification: collectChecklist('data-gnk-qualification'),
  } : {};
  return {
    pursuit_type: $('#pursuitType').value,
    product: $('#pursuitProduct').value.trim(),
    desired_commitment: $('#desiredCommitment').value.trim(),
    value_to_partner: $('#valueToPartner').value.trim(),
    value_to_us: $('#valueToUs').value.trim(),
    decision_process: $('#decisionProcess').value.trim(),
    commercial_path: $('#commercialPath').value.trim(),
    problem: $('#problem').value.trim(),
    consequence: $('#consequence').value.trim(),
    offer: $('#offer').value.trim(),
    cost_model: $('#costModel').value.trim(),
    cost_confidence: $('#costConfidence').value,
    narrative: $('#narrative').value.trim(),
    ...gnkFields,
    evidence: collectRows('#evidenceList'),
    proof_assets: collectRows('#proofList'),
    success_metrics: collectRows('#metricList'),
    joint_action_plan: collectRows('#planList'),
  };
}

async function refreshSummary() {
  const query = queryString();
  const [pursuitData, centerData] = await Promise.all([
    api.get(`/api/pursuits${query ? `?${query}` : ''}`),
    api.get(`/api/command-center${state.product ? `?product=${encodeURIComponent(state.product)}` : ''}`),
  ]);
  state.pursuits = pursuitData.pursuits;
  state.commandCenter = centerData.command_center;
  renderMetrics();
  renderPursuitList();
}

async function savePursuit({ quiet = false } = {}) {
  const proposed = pursuitPatch();
  const patch = Object.fromEntries(Object.entries(proposed).filter(([key, value]) => !sameValue(value, state.pursuit[key])));
  if (!Object.keys(patch).length) {
    if (!quiet) toast('Workspace is already up to date.');
    return state.pursuit;
  }
  const { pursuit } = await api.patch(`/api/pursuits/${state.pursuit.id}`, patch);
  state.pursuit = pursuit;
  renderWorkspace();
  await refreshSummary();
  if (!quiet) toast(
    pursuit.approval_status === 'needs_review' && patch.pursuit_type
      ? 'Motion changed. Unstarted steps were safely replaced and the narrative needs review.'
      : 'Deal workspace saved.',
    'success',
  );
  return pursuit;
}

async function approvePursuit() {
  try {
    await savePursuit({ quiet: true });
    const { pursuit } = await api.patch(`/api/pursuits/${state.pursuit.id}`, { approval_status: 'approved' });
    state.pursuit = pursuit;
    renderWorkspace();
    await refreshSummary();
    toast('Narrative approved. The research gate is complete; only the next step may advance.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function returnToReview() {
  try {
    const { pursuit } = await api.patch(`/api/pursuits/${state.pursuit.id}`, { approval_status: 'needs_review', status: 'draft' });
    state.pursuit = pursuit;
    renderWorkspace();
    await refreshSummary();
    toast('Pursuit returned to human review.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function addStructuredRow(type) {
  const templates = {
    evidence: evidenceRows([]),
    proof: proofRows([]),
    metric: metricRows([]),
    plan: planRows([]),
  };
  const container = $(`[data-list="${type}"]`);
  container.insertAdjacentHTML('beforeend', templates[type]);
}

async function saveContact(personId, primary = false) {
  const row = $(`[data-contact="${personId}"]`);
  try {
    const { pursuit } = await api.put(`/api/pursuits/${state.pursuit.id}/contacts/${personId}`, {
      role: $('[data-contact-role]', row).value,
      state: $('[data-contact-state]', row).value,
      primary,
    });
    state.pursuit = pursuit;
    renderWorkspace();
    await refreshSummary();
    toast(primary ? 'Primary route updated.' : 'Stakeholder map updated.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function mapPerson() {
  const personId = Number($('#mapPerson').value);
  if (!personId) return toast('Choose an account contact first.', 'error');
  try {
    const { pursuit } = await api.put(`/api/pursuits/${state.pursuit.id}/contacts/${personId}`, {
      role: $('#mapRole').value,
      state: 'selected',
      primary: $('#mapPrimary').checked,
    });
    state.pursuit = pursuit;
    renderWorkspace();
    await refreshSummary();
    toast('Stakeholder added to the deal map.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function verifyContact(personId) {
  if (!window.confirm('Confirm that this person currently works in the recorded role. This records today as the employment-verification date.')) return;
  try {
    await api.post(`/api/people/${personId}/verify`, {
      active: true,
      note: 'Employment and role confirmed by human review in the Dealroom.',
    });
    await openPursuit(state.pursuit.id);
    toast('Employment verification recorded.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function advanceStep(stepId, status) {
  const promptText = status === 'skipped'
    ? 'Why is this commitment being skipped?'
    : 'What was agreed, learned, or completed?';
  const outcome = window.prompt(promptText, '');
  if (outcome == null) return;
  if (!outcome.trim()) return toast('Record the decision or learning before advancing.', 'error');
  try {
    const { pursuit } = await api.patch(`/api/pursuits/${state.pursuit.id}/steps/${stepId}`, { status, outcome });
    state.pursuit = pursuit;
    renderWorkspace();
    await refreshSummary();
    toast(status === 'skipped' ? 'Step skipped with a recorded reason.' : 'Commitment recorded. The next decision is now active.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openComposer(stepId) {
  const step = state.pursuit.steps.find((item) => item.id === Number(stepId));
  if (!step) return;
  state.composeStep = step;
  const people = state.pursuit.contacts.filter((person) => (
    person.lifecycle_status === 'active'
    && !person.suppression_reason
    && !['paused', 'rejected'].includes(person.state)
  )).sort((left, right) => (
    Number(right.person_id === state.pursuit.primary_person_id)
    - Number(left.person_id === state.pursuit.primary_person_id)
  ));
  $('#composerTitle').textContent = step.label;
  $('#composerPerson').innerHTML = people.map((person) => (
    `<option value="${person.person_id}" ${person.person_id === (step.person_id || state.pursuit.primary_person_id) ? 'selected' : ''}>${esc(person.name || 'Unknown')} · ${esc(person.title || 'No title')}</option>`
  )).join('');
  $('#composerChannel').value = step.channel;
  $('#composerChannel').disabled = true;
  $('#composerSubjectLabel').classList.toggle('hidden', step.channel !== 'email');
  $('#composerSubject').value = '';
  $('#composerBody').value = '';
  $('#composerRationale').value = step.narrative_job;
  $('#composerModal').classList.remove('hidden');
}

async function queueDraft() {
  if (!state.composeStep) return;
  const personId = Number($('#composerPerson').value);
  if (!personId) return toast('Choose a verified contact.', 'error');
  try {
    await api.post(`/api/pursuits/${state.pursuit.id}/drafts`, {
      step_id: state.composeStep.id,
      person_id: personId,
      channel: state.composeStep.channel,
      subject: state.composeStep.channel === 'email' ? $('#composerSubject').value.trim() : null,
      body: $('#composerBody').value.trim(),
      rationale: $('#composerRationale').value.trim(),
      source: 'manual',
    });
    $('#composerModal').classList.add('hidden');
    await openPursuit(state.pursuit.id);
    await refreshSummary();
    toast('Draft queued for human review. Nothing was sent.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function recordSent(draftId) {
  if (!window.confirm('Confirm that you already sent this approved message manually. This action only records the send; it does not contact anyone.')) return;
  try {
    const result = await api.post(`/api/outreach-drafts/${draftId}/sent`, {});
    state.pursuit = result.pursuit;
    renderWorkspace();
    await refreshSummary();
    toast('Manual send recorded in the immutable outreach ledger.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function wireWorkspace() {
  $('#savePursuitBtn').addEventListener('click', () => savePursuit().catch((error) => toast(error.message, 'error')));
  $('#approvePursuitBtn')?.addEventListener('click', approvePursuit);
  $('#rejectPursuitBtn')?.addEventListener('click', returnToReview);
  $$('[data-add-row]', $('#workspace')).forEach((button) => button.addEventListener('click', () => addStructuredRow(button.dataset.addRow)));
  $('#mapPersonBtn')?.addEventListener('click', mapPerson);
  $$('[data-save-contact]', $('#workspace')).forEach((button) => button.addEventListener('click', () => saveContact(Number(button.dataset.saveContact))));
  $$('[data-primary-contact]', $('#workspace')).forEach((button) => button.addEventListener('click', () => saveContact(Number(button.dataset.primaryContact), true)));
  $$('[data-verify-contact]', $('#workspace')).forEach((button) => button.addEventListener('click', () => verifyContact(Number(button.dataset.verifyContact))));
  $$('[data-complete-step]', $('#workspace')).forEach((button) => button.addEventListener('click', () => advanceStep(Number(button.dataset.completeStep), 'complete')));
  $$('[data-skip-step]', $('#workspace')).forEach((button) => button.addEventListener('click', () => advanceStep(Number(button.dataset.skipStep), 'skipped')));
  $$('[data-compose-step]', $('#workspace')).forEach((button) => button.addEventListener('click', () => openComposer(Number(button.dataset.composeStep))));
  $$('[data-review-step]', $('#workspace')).forEach((button) => button.addEventListener('click', openDraftReview));
  $$('[data-record-sent]', $('#workspace')).forEach((button) => button.addEventListener('click', () => recordSent(Number(button.dataset.recordSent))));
}

async function openDraftReview() {
  $('#draftModal').classList.remove('hidden');
  $('#draftReviewBody').innerHTML = '<div class="workspace-empty"><p>Loading review queue…</p></div>';
  try {
    const { drafts } = await api.get(`/api/outreach-drafts?status=pending_review${state.product ? `&product=${encodeURIComponent(state.product)}` : ''}`);
    $('#draftReviewBody').innerHTML = drafts.length ? drafts.map((draft) => {
      const quality = draft.quality_report || {};
      const issues = [...(quality.errors || []), ...(quality.warnings || [])];
      return `
        <article class="draft-card" data-draft-card="${draft.id}">
          <div class="draft-head">
            <div><strong>${esc(draft.company_name)} · ${esc(draft.person_name)}</strong><p>${esc(draft.step_label)} · ${esc(draft.person_title || '')}</p></div>
            ${statusChip(quality.pass ? 'quality_pass' : 'quality_blocked')}
            <span class="status-chip">${quality.score ?? 0}/100</span>
          </div>
          ${draft.subject ? `<div class="draft-subject">Subject: ${esc(draft.subject)}</div>` : ''}
          <div class="draft-message">${esc(draft.body)}</div>
          ${issues.length ? `<ul class="quality-list">${issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul>` : ''}
          <div class="draft-actions">
            <button class="quiet-button" data-open-draft-pursuit="${draft.pursuit_id}">Open pursuit</button>
            <button class="danger-button" data-review-draft="${draft.id}" data-status="rejected">Reject</button>
            <button class="primary-button" data-review-draft="${draft.id}" data-status="approved" ${quality.pass ? '' : 'disabled'}>Approve</button>
          </div>
        </article>`;
    }).join('') : '<div class="workspace-empty"><h2>Queue clear</h2><p>No drafts are waiting for review.</p></div>';
    $$('[data-review-draft]', $('#draftReviewBody')).forEach((button) => button.addEventListener('click', () => reviewDraft(Number(button.dataset.reviewDraft), button.dataset.status)));
    $$('[data-open-draft-pursuit]', $('#draftReviewBody')).forEach((button) => button.addEventListener('click', async () => {
      $('#draftModal').classList.add('hidden');
      await openPursuit(Number(button.dataset.openDraftPursuit));
    }));
  } catch (error) {
    $('#draftReviewBody').innerHTML = `<div class="workspace-empty"><p>${esc(error.message)}</p></div>`;
  }
}

async function reviewDraft(id, status) {
  try {
    await api.patch(`/api/outreach-drafts/${id}`, {
      status,
      rationale: status === 'approved' ? 'Approved by human review in the Dealroom.' : 'Rejected by human review in the Dealroom.',
    });
    await openDraftReview();
    await refreshSummary();
    if (state.selectedId) await openPursuit(state.selectedId);
    toast(status === 'approved' ? 'Draft approved. It still requires a manual send.' : 'Draft rejected; the step is available for revision.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openArchive() {
  $('#archiveModal').classList.remove('hidden');
  await loadArchive();
}

async function loadArchive() {
  $('#archiveBody').innerHTML = '<div class="workspace-empty"><p>Loading recovered contacts…</p></div>';
  const company = $('#archiveSearch').value.trim();
  try {
    const { contacts } = await api.get(`/api/contact-archive?status=needs_verification&limit=250${company ? `&company=${encodeURIComponent(company)}` : ''}`);
    $('#archiveBody').innerHTML = contacts.length ? `
      <table class="archive-table">
        <thead><tr><th>Company</th><th>Person</th><th>Historical email</th><th>Why retained</th><th></th></tr></thead>
        <tbody>${contacts.map((contact) => `
          <tr>
            <td>${esc(contact.company_name)}</td>
            <td><b>${esc(contact.name || 'Unknown')}</b><br />${esc(contact.title || '')}</td>
            <td>${esc(contact.email || '')}</td>
            <td>${esc(truncate(contact.relevance_reason || contact.notes || 'Recovered from a safety snapshot.', 180))}</td>
            <td><button class="quiet-button" data-restore-contact="${contact.id}">Restore for verification</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="workspace-empty"><p>No quarantined contacts match.</p></div>';
    $$('[data-restore-contact]', $('#archiveBody')).forEach((button) => button.addEventListener('click', () => restoreContact(Number(button.dataset.restoreContact))));
  } catch (error) {
    $('#archiveBody').innerHTML = `<div class="workspace-empty"><p>${esc(error.message)}</p></div>`;
  }
}

async function restoreContact(id) {
  if (!window.confirm('Restore this historical contact as needs-verification? They will remain blocked from outreach until employment is checked.')) return;
  try {
    await api.post(`/api/contact-archive/${id}/restore`, {
      verify: false,
      note: 'Restored from the quarantined recovery set in the Dealroom.',
    });
    await loadArchive();
    if (state.selectedId) await openPursuit(state.selectedId);
    toast('Contact restored in needs-verification state; they are not sendable.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function closeModal(id) {
  $(`#${id}`).classList.add('hidden');
}

async function boot() {
  try {
    const [motionData, productData, auditData] = await Promise.all([
      api.get('/api/pursuit-motions'),
      api.get('/api/products'),
      api.get('/api/system-audit'),
    ]);
    state.motions = motionData.motions;
    state.pursuitTypes = motionData.types;
    const productDefinitions = new Map(productData.products.map((product) => [product.id, product]));
    state.products = motionData.products.map((row) => ({
      ...(productDefinitions.get(row.id) || {}),
      id: row.id,
      short: productDefinitions.get(row.id)?.short || ({
        wapahki: 'Wapahki Robotics',
        gnk: 'GnK',
        outagehub: 'OutageHub',
      }[row.id] || labelize(row.id)),
      pursuits: row.pursuits,
    }));
    const url = new URL(location.href);
    const requestedProduct = url.searchParams.get('product');
    state.product = requestedProduct != null
      ? requestedProduct
      : (state.products.some((product) => product.id === 'wapahki') ? 'wapahki' : '');
    state.selectedId = Number(url.searchParams.get('pursuit')) || null;
    renderSafety(auditData.audit);
    renderFilters();
    await loadPursuits({ openFirst: !state.selectedId });
    if (state.selectedId) await openPursuit(state.selectedId);
  } catch (error) {
    toast(`Could not start the Dealroom: ${error.message}`, 'error');
  }
}

$('#productFilter').addEventListener('change', async (event) => {
  state.product = event.target.value;
  state.selectedId = null;
  state.pursuit = null;
  const url = new URL(location.href);
  if (state.product) url.searchParams.set('product', state.product);
  else url.searchParams.delete('product');
  url.searchParams.delete('pursuit');
  history.replaceState(null, '', url);
  await loadPursuits();
});
$('#typeFilter').addEventListener('change', async (event) => {
  state.pursuitType = event.target.value;
  state.selectedId = null;
  state.pursuit = null;
  await loadPursuits();
});
$('#approvalFilter').addEventListener('change', async (event) => {
  state.approvalStatus = event.target.value;
  state.selectedId = null;
  state.pursuit = null;
  await loadPursuits();
});
$('#pursuitSearch').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderPursuitList();
});
$('#refreshBtn').addEventListener('click', () => loadPursuits({ openFirst: false }).catch((error) => toast(error.message, 'error')));
$('#reviewBtn').addEventListener('click', openDraftReview);
$('#archiveBtn').addEventListener('click', openArchive);
$('#archiveSearchBtn').addEventListener('click', loadArchive);
$('#archiveSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadArchive(); });
$('#composerChannel').addEventListener('change', (event) => $('#composerSubjectLabel').classList.toggle('hidden', event.target.value !== 'email'));
$('#composerSave').addEventListener('click', queueDraft);
$('#workspace').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove-row]');
  if (!remove) return;
  const list = remove.closest('[data-list]');
  remove.closest('[data-row]').remove();
  if (!list.querySelector('[data-row]')) addStructuredRow(list.dataset.list);
});
$$('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('.deal-modal').forEach((modal) => modal.addEventListener('click', (event) => {
  if (event.target === modal) modal.classList.add('hidden');
}));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $$('.deal-modal').forEach((modal) => modal.classList.add('hidden'));
});

boot();
