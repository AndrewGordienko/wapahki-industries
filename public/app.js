// Problem Found — account CRM front-end. Vanilla JS, no build step.
// Pairs with the account model in src/server.js (/api/products, /api/accounts,
// /api/opportunities, /api/tasks, /api/metrics). The Problem Radar (/problems)
// is a separate view; this file only drives the accounts side.

const $ = (sel, root = document) => root.querySelector(sel);
const api = {
  async req(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${res.status} error`);
    return data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
  patch: (p, b) => api.req('PATCH', p, b),
  put: (p, b) => api.req('PUT', p, b),
  del: (p) => api.req('DELETE', p),
};

const state = {
  products: [], product: null, accounts: [], metrics: null,
  configByProduct: {}, filter: '', stageFilter: '', gateOnly: false, openId: null,
};

// ---- helpers ----
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${kind}`;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 4200);
  t.classList.remove('hidden');
}
function scoreTier(s) { if (s == null) return 'none'; if (s >= 80) return 'best'; if (s >= 65) return 'strong'; if (s >= 40) return 'ok'; return 'weak'; }
const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US')}`);
const usableEmail = (e) => e && e.includes('@') && !/not_unlocked/i.test(e);
const datePlus = (days = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const shortDate = (value) => {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
};
function copyText(text, btn) {
  navigator.clipboard.writeText(text || '').then(() => {
    if (btn) { const o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = o; }, 1100); }
  }, () => toast('Copy failed', 'err'));
}
const cfg = () => state.configByProduct[state.product] || null;
const ROLE_KEYS = ['economic_buyer', 'champion', 'technical', 'referral'];
const ROLE_LABEL = { economic_buyer: 'Economic buyer', champion: 'Champion', technical: 'Technical / data', referral: 'Referral', unassigned: 'Unassigned' };

// ---- data ----
async function loadProducts() {
  const { products } = await api.get('/api/products');
  state.products = products;
  if (!state.product || !products.some((p) => p.id === state.product)) {
    state.product = (products.find((p) => p.active) || products[0] || {}).id;
  }
  renderTabs();
}
async function loadConfig(product) {
  if (state.configByProduct[product]) return state.configByProduct[product];
  const c = await api.get(`/api/products/${product}/config`);
  state.configByProduct[product] = c;
  return c;
}
async function loadAccounts() {
  const { accounts } = await api.get(`/api/accounts?product=${encodeURIComponent(state.product)}`);
  state.accounts = accounts;
  renderAccounts();
  if (state.openId) { const a = accounts.find((x) => x.id === state.openId); if (a) renderAccountModal(a); }
}
async function loadMetrics() {
  const { metrics } = await api.get(`/api/metrics?product=${encodeURIComponent(state.product)}`);
  state.metrics = metrics; renderMetrics();
}
async function switchProduct(id) {
  if (id === state.product) return;
  state.product = id; renderTabs();
  try { history.replaceState(null, '', `?product=${encodeURIComponent(id)}`); } catch { /* ignore */ }
  await loadConfig(id); renderPlaybook(); populateStageFilter();
  await Promise.all([loadAccounts(), loadMetrics()]);
}

// ---- tabs / metrics / playbook ----
function renderTabs() {
  $('#productTabs').innerHTML = state.products.map((p) => `
    <div class="tab ${p.id === state.product ? 'active' : ''} ${p.active ? '' : 'inactive'}" data-p="${esc(p.id)}" title="${esc(p.label)}">
      <span class="${p.active ? 'live-dot' : 'paused-dot'}" title="${p.active ? 'actively prospecting' : 'paused'}"></span>
      <span>${esc(p.short)}</span>
      <span class="sub-count">${p.accounts} acct · ${p.qualified} qual</span>
    </div>`).join('');
  $('#productTabs').querySelectorAll('[data-p]').forEach((el) => el.addEventListener('click', () => switchProduct(el.dataset.p)));
}
function renderMetrics() {
  const m = state.metrics || {};
  const cards = [
    ['Accounts', m.accounts ?? 0], ['Qualified 65+', m.qualified ?? 0],
    ['Replied', m.replied ?? 0], ['Discoveries', m.discoveries ?? 0],
    ['Touches · 30d', m.touches_30d ?? 0], ['Meetings · 30d', m.meetings_30d ?? 0],
    ['Proposals', m.proposals_sent ?? 0], ['Contracted', m.contracted ?? 0],
  ];
  let html = cards.map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  html += `<div class="metric"><div class="k">Won revenue</div><div class="v rev">${money(m.revenue_low || 0)}–${money(m.revenue_high || 0)}</div></div>`;
  $('#metricbar').innerHTML = html;
}
function renderPlaybook() {
  const c = cfg(); if (!c) return;
  const p = c.product;
  const col = (label, items, cls = '') => items && items.length
    ? `<div class="pb-col ${cls}"><div class="pc-label">${label}</div><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : '';
  const roles = p.personas || {};
  $('#playbook').innerHTML = `
    <summary>${esc(p.product_name)} playbook — who to find, what to look for, what to avoid</summary>
    <div class="pb-body">
      <div class="pb-pos">${esc(p.positioning)}</div>
      ${col('Ideal account', p.ideal_account || p.ideal_project)}
      ${col('Economic buyers', roles.economic_buyer)}
      ${col('Champions', roles.champion)}
      ${col('Technical / data', roles.technical)}
      ${col('Signals to capture', p.signals)}
      ${col('Exclude', p.exclusions, 'exclude')}
    </div>`;
}
function populateStageFilter() {
  const c = cfg(); if (!c) return;
  const stages = c.shared.stages || [];
  $('#stageFilter').innerHTML = '<option value="">All stages</option>' + stages.map((s) => `<option value="${esc(s)}" ${state.stageFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
}

// ---- account cards ----
function visibleAccounts() {
  const f = state.filter.trim().toLowerCase();
  return state.accounts.filter((a) => {
    if (state.stageFilter && a.stage !== state.stageFilter) return false;
    if (state.gateOnly && !(a.outreach && a.outreach.allowed)) return false;
    if (!f) return true;
    return (a.name || '').toLowerCase().includes(f) || (a.industry || '').toLowerCase().includes(f);
  });
}
const HOT = new Set(['Design partner', 'Proposal sent', 'Contract negotiation', 'Contracted', 'Delivery', 'Expansion']);
const WARM = new Set(['Replied', 'Discovery scheduled', 'Problem confirmed', 'Data and budget qualified']);

function accountCard(a) {
  const tier = scoreTier(a.lead_score);
  const stageCls = HOT.has(a.stage) ? 'hot' : WARM.has(a.stage) ? 'warm' : '';
  const gate = a.outreach && a.outreach.allowed;
  const roles = {}; for (const p of a.people || []) { const r = ROLE_KEYS.includes(p.role_type) ? p.role_type : 'unassigned'; roles[r] = (roles[r] || 0) + 1; }
  const need = { economic_buyer: 1, champion: 2, technical: 1, referral: 1 };
  const roleChips = ROLE_KEYS.map((r) => {
    const have = roles[r] || 0; const gap = have < need[r];
    return `<span class="rolecount ${gap ? 'gap' : ''}" title="${ROLE_LABEL[r]}">${ROLE_LABEL[r].split(' ')[0]} <b>${have}</b>/${need[r]}</span>`;
  }).join('');
  const hyp = a.hypothesis ? `<div class="ac-hyp">${esc(a.hypothesis.slice(0, 180))}${a.hypothesis.length > 180 ? '…' : ''}</div>`
    : `<div class="ac-hyp empty">No hypothesis yet — click to write one.</div>`;
  return `
    <div class="acard" data-id="${a.id}">
      <div class="ac-top">
        <div class="ac-score ${tier}">${a.lead_score ?? '<small>NO<br>SCORE</small>'}${a.lead_score != null ? '<small>/100</small>' : ''}</div>
        <div class="ac-heads">
          <div class="ac-name">${esc(a.name)}</div>
          <div class="ac-meta">
            <span class="ac-stage ${stageCls}">${esc(a.stage || 'Researched')}</span>
            <span class="gate ${gate ? 'on' : 'off'}">${gate ? '✓ outreach-ready' : 'gated'}</span>
            ${a.industry ? `<span class="dot">·</span><span>${esc(a.industry)}</span>` : ''}
          </div>
        </div>
      </div>
      ${hyp}
      <div class="ac-foot">
        ${roleChips}
        <span class="grow"></span>
        ${a.open_task_count ? `<span class="miniflag">☑ ${a.open_task_count}</span>` : ''}
        ${a.next_action_at ? `<span class="miniflag">next ${esc(shortDate(a.next_action_at))}</span>` : ''}
        ${a.last_touch_at ? `<span class="miniflag">last ${esc(shortDate(a.last_touch_at))}</span>` : ''}
        ${a.opp_count ? `<span class="miniflag">◷ ${a.opp_count} offer${a.opp_count > 1 ? 's' : ''}</span>` : ''}
        ${(a.signals || []).length ? `<span class="miniflag">◎ ${(a.signals || []).length} signal${(a.signals || []).length > 1 ? 's' : ''}</span>` : ''}
      </div>
    </div>`;
}
function renderAccounts() {
  const rows = visibleAccounts();
  $('#empty').classList.toggle('hidden', state.accounts.length > 0);
  $('#accounts').innerHTML = rows.map(accountCard).join('');
  $('#accounts').querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => openAccount(Number(el.dataset.id))));
}

// ---- account detail modal ----
async function openAccount(id) {
  state.openId = id;
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  try { history.replaceState(null, '', `?product=${encodeURIComponent(state.product)}#acct=${id}`); } catch { /* ignore */ }
  await loadConfig(state.product);
  renderAccountModal(a);
  $('#acctModal').classList.remove('hidden');
}

function renderAccountModal(a) {
  const c = cfg(); const S = c.shared; const P = c.product;
  const tier = scoreTier(a.lead_score);
  const stageOpts = (S.stages || []).map((s) => `<option ${a.stage === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
  const gnkOpts = (S.gnk_status || []).map((g) => `<option value="${g.key}" ${a.gnk_status === g.key ? 'selected' : ''}>${esc(g.label)}</option>`).join('');

  // signals
  const sigChips = (a.signals || []).map((s, i) => `<span class="sig">${esc(s)}<span class="x" data-sig="${i}">×</span></span>`).join('') || '<span class="muted" style="font-size:12px">No signals captured yet.</span>';

  // score panel
  const bd = a.score_breakdown || {};
  const factors = (S.scoring || []).map((f) => {
    const stored = bd[f.key]; const pct = stored ? Math.round((stored.rating || 0) * 100) : 0;
    const pts = stored ? stored.points : 0;
    return `<div class="factor">
      <div class="fl">${esc(f.label)} <small>(${f.weight})</small></div>
      <input type="range" min="0" max="100" step="25" value="${pct}" data-factor="${f.key}" data-weight="${f.weight}" />
      <div class="fp" data-fp="${f.key}">${pts}</div>
    </div>`;
  }).join('');

  // contact map
  const buckets = { economic_buyer: [], champion: [], technical: [], referral: [], unassigned: [] };
  for (const p of a.people || []) { const r = ROLE_KEYS.includes(p.role_type) ? p.role_type : 'unassigned'; buckets[r].push(p); }
  const need = { economic_buyer: 1, champion: 2, technical: 1, referral: 1 };
  const roleCol = (rk) => {
    const list = buckets[rk] || [];
    const met = rk !== 'unassigned' && list.length >= (need[rk] || 1);
    const head = rk === 'unassigned'
      ? `<div class="pc-label"><span>Unassigned</span></div>`
      : `<div class="pc-label"><span>${ROLE_LABEL[rk]}</span><span class="need ${met ? 'met' : ''}">${list.length}/${need[rk]}${met ? ' ✓' : ''}</span></div>`;
    const people = list.length ? list.map((p) => personRow(p)).join('') : '<div class="cmap-empty">—</div>';
    return `<div class="cmap-col">${head}${people}</div>`;
  };
  const cmap = [...ROLE_KEYS, 'unassigned'].filter((rk) => rk !== 'unassigned' || buckets.unassigned.length).map(roleCol).join('');
  const personOpts = (a.people || []).map((p) => (
    `<option value="${p.id}">${esc(p.name || 'Unknown')}${p.title ? ` · ${esc(p.title)}` : ''}</option>`
  )).join('');

  const gate = a.outreach || {};
  $('#acctCard').innerHTML = `
    <div class="acct-head">
      <div class="ac-score ${tier}">${a.lead_score ?? '<small>NO</small>'}</div>
      <div class="grow">
        <h3>${esc(a.name)}</h3>
        <div class="ac-meta">
          <span class="gate ${gate.allowed ? 'on' : 'off'}">${gate.allowed ? '✓ outreach-ready' : `gated — ${gate.scoreOk ? '' : `need 65+ (${a.lead_score ?? 0})`}${!gate.hasSignal ? ' need a signal' : ''}`.trim()}</span>
          ${a.industry ? `<span class="dot">·</span><span>${esc(a.industry)}</span>` : ''}
          ${a.website ? `<span class="dot">·</span><a href="${esc(a.website)}" target="_blank" rel="noopener">site ↗</a>` : ''}
        </div>
      </div>
      <button class="btn btn-ghost" id="acctClose">Close</button>
    </div>
    <div class="acct-body">
      <div class="field-row">
        <label>Stage<select class="stage-sel" id="stageSel">${stageOpts}</select></label>
        <label>GnK delivery<select class="gnk-sel" id="gnkSel">${gnkOpts}</select></label>
        <label style="flex:1;min-width:180px">Referral path<input class="stage-sel" style="width:100%" id="refPath" value="${esc(a.referral_path || '')}" placeholder="warm route in…" /></label>
      </div>

      <div class="sec">
        <h4>Hypothesis <span class="grow"></span><span class="muted" style="font-size:11px;text-transform:none;letter-spacing:0">${esc(S.hypothesis_template ? 'We believe … because … product … outcome.' : '')}</span></h4>
        <textarea id="hypBox" rows="3" placeholder="We believe ${esc(a.name)} experiences [workflow] because of [evidence]. The product is ${esc(P.product_name)} and the outcome would be [result].">${esc(a.hypothesis || '')}</textarea>
        <div style="margin-top:8px"><button class="btn small btn-primary" id="hypSave">Save hypothesis</button></div>
      </div>

      <div class="sec">
        <h4>Signals <span class="muted" style="font-size:11px;text-transform:none;letter-spacing:0">— at least one public signal is required to unlock outreach</span></h4>
        <div class="sig-list" id="sigList">${sigChips}</div>
        <div class="sig-add"><input class="stage-sel" id="sigInput" placeholder="add a public signal…" /><button class="btn small" id="sigAdd">Add</button></div>
      </div>

      <div class="sec">
        <h4>Lead score <span class="grow"></span><span class="muted" style="font-size:11px;text-transform:none;letter-spacing:0">rate each factor · 65+ to prospect</span></h4>
        <div class="score-factors">${factors}</div>
        <div class="score-total">
          <div><span class="big" id="scoreBig">${a.lead_score ?? 0}</span><span class="of"> / 100</span></div>
          <span class="gate ${(a.lead_score ?? 0) >= 65 ? 'on' : 'off'}" id="scoreGate">${(a.lead_score ?? 0) >= 65 ? 'clears the bar' : 'below 65'}</span>
          <span class="grow"></span>
          <button class="btn small btn-primary" id="scoreSave">Save score</button>
        </div>
      </div>

      <div class="sec">
        <h4>Contact map <span class="grow"></span><button class="btn xsmall" id="contactAddToggle">+ Add known contact</button></h4>
        <div class="cmap">${cmap}</div>
        <div class="quick-contact hidden" id="quickContact">
          <input id="contactName" placeholder="Full name *" />
          <input id="contactTitle" placeholder="Title" />
          <input id="contactEmail" type="email" placeholder="Email" />
          <input id="contactLinkedin" type="url" placeholder="LinkedIn URL" />
          <select id="contactRole">${ROLE_KEYS.map((r) => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}<option value="">Unassigned</option></select>
          <textarea id="contactNotes" rows="2" placeholder="What you know / prior context"></textarea>
          <button class="btn small btn-primary" id="contactSave">Save contact</button>
        </div>
      </div>

      <div class="sec outreach-ledger">
        <h4>Outreach history &amp; next action <span class="grow"></span><span class="muted" style="font-size:11px;text-transform:none;letter-spacing:0">log it once; the calendar and funnel update automatically</span></h4>
        <div class="quick-log">
          <select id="logPerson"><option value="">Account-level / unknown person</option>${personOpts}</select>
          <select id="logChannel">
            <option value="email">Email</option><option value="linkedin">LinkedIn</option>
            <option value="call">Call</option><option value="meeting">Meeting</option>
            <option value="referral">Referral</option><option value="research">Research</option>
            <option value="note">Note</option>
          </select>
          <select id="logOutcome">
            <option value="sent">Sent / attempted</option><option value="no_reply">No reply</option>
            <option value="replied">Replied</option><option value="interested">Interested</option>
            <option value="not_interested">Not interested</option><option value="referred">Referred me</option>
            <option value="meeting_booked">Meeting booked</option><option value="meeting_held">Meeting held</option>
            <option value="bounced">Bounced</option><option value="researched">Research refreshed</option>
          </select>
          <input id="logWhen" type="datetime-local" />
          <input id="logVariant" class="wide" placeholder="Message angle / test label (e.g. dispatch visibility v1)" />
          <input id="logSummary" class="wide" placeholder="What happened? *" />
          <textarea id="logNotes" class="wide" rows="2" placeholder="Reply, objection, context, or useful detail"></textarea>
          <label class="next-label">Next action date<input id="logNextDate" type="date" value="${datePlus(4)}" /></label>
          <input id="logNextTitle" placeholder="Next action (optional)" />
          <select id="logNextChannel">
            <option value="email">Email</option><option value="linkedin">LinkedIn</option>
            <option value="call">Call</option><option value="research">Research</option>
          </select>
          <button class="btn small btn-primary" id="logSave">Log &amp; schedule</button>
        </div>
        <div id="touchpointList" class="touchpoint-list"><div class="muted" style="font-size:12px">Loading history…</div></div>
      </div>

      <div class="sec">
        <h4>Discovery <span class="grow"></span><span class="muted" style="font-size:11px;text-transform:none;letter-spacing:0">answers to the qualification questions</span></h4>
        <div id="discBox"><div class="muted" style="font-size:12px">Loading…</div></div>
      </div>

      <div class="sec">
        <h4>Offers &amp; proposals</h4>
        <div class="offer-btns" id="offerBtns"></div>
        <div id="oppList"><div class="muted" style="font-size:12px">Loading…</div></div>
      </div>
    </div>`;

  wireAccountModal(a);
  loadTouchpoints(a.id);
  loadDiscovery(a.id);
  loadOpportunities(a.id);
}

function personRow(p) {
  const email = usableEmail(p.email) ? `<a href="mailto:${esc(p.email)}">email</a>` : '';
  const li = p.linkedin_url ? `<a href="${esc(p.linkedin_url)}" target="_blank" rel="noopener">in ↗</a>` : '';
  const moveOpts = [...ROLE_KEYS, 'unassigned'].map((r) => `<option value="${r}" ${((p.role_type || 'unassigned') === r) ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('');
  return `<div class="person">
    <div class="pn">${esc(p.name || '—')}</div>
    <div class="pt">${esc(p.title || '')}</div>
    <div class="plinks">${email}${li}<button class="link-btn" data-log-person="${p.id}">log</button><select class="role-move" data-person="${p.id}">${moveOpts}</select></div>
  </div>`;
}

function wireAccountModal(a) {
  const id = a.id;
  $('#acctClose').addEventListener('click', closeAccount);
  const patch = async (fields, reload = false) => {
    try { await api.patch(`/api/accounts/${id}`, fields); if (reload) await refresh(); }
    catch (e) { toast(e.message, 'err'); }
  };
  $('#stageSel').addEventListener('change', (e) => patch({ stage: e.target.value }, true));
  $('#gnkSel').addEventListener('change', (e) => patch({ gnk_status: e.target.value }));
  $('#refPath').addEventListener('change', (e) => patch({ referral_path: e.target.value }));
  $('#hypSave').addEventListener('click', async () => { await patch({ hypothesis: $('#hypBox').value }, true); toast('Hypothesis saved', 'ok'); });

  // signals
  $('#sigAdd').addEventListener('click', async () => {
    const v = $('#sigInput').value.trim(); if (!v) return;
    const next = [...(a.signals || []), v];
    await patch({ signals: next }, true);
  });
  $('#sigInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sigAdd').click(); });
  $('#sigList').querySelectorAll('[data-sig]').forEach((x) => x.addEventListener('click', async () => {
    const i = Number(x.dataset.sig); const next = (a.signals || []).filter((_, j) => j !== i);
    await patch({ signals: next }, true);
  }));

  // role moves
  $('#acctCard').querySelectorAll('[data-person]').forEach((sel) => sel.addEventListener('change', async () => {
    const rt = sel.value === 'unassigned' ? null : sel.value;
    try { await api.patch(`/api/people/${sel.dataset.person}`, { role_type: rt }); await refresh(); }
    catch (e) { toast(e.message, 'err'); }
  }));
  $('#acctCard').querySelectorAll('[data-log-person]').forEach((button) => button.addEventListener('click', () => {
    $('#logPerson').value = button.dataset.logPerson;
    $('#logSummary').focus();
    $('#logSummary').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  // Fast manual contact capture.
  $('#contactAddToggle').addEventListener('click', () => {
    const form = $('#quickContact');
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) $('#contactName').focus();
  });
  $('#contactSave').addEventListener('click', async () => {
    const name = $('#contactName').value.trim();
    if (!name) return toast('Contact name is required', 'err');
    try {
      await api.post(`/api/accounts/${id}/people`, {
        name,
        title: $('#contactTitle').value.trim() || null,
        email: $('#contactEmail').value.trim() || null,
        linkedin_url: $('#contactLinkedin').value.trim() || null,
        role_type: $('#contactRole').value || null,
        notes: $('#contactNotes').value.trim() || null,
      });
      toast('Contact saved', 'ok');
      await refresh();
    } catch (e) { toast(e.message, 'err'); }
  });

  // One fast log writes history, updates funnel state and schedules the next action.
  $('#logSave').addEventListener('click', async () => {
    const summary = $('#logSummary').value.trim();
    if (!summary) return toast('Add a short summary of what happened', 'err');
    const when = $('#logWhen').value;
    const nextDate = $('#logNextDate').value;
    try {
      await api.post(`/api/accounts/${id}/touchpoints`, {
        person_id: $('#logPerson').value ? Number($('#logPerson').value) : null,
        channel: $('#logChannel').value,
        direction: ['research', 'note'].includes($('#logChannel').value) ? 'internal' : 'outbound',
        outcome: $('#logOutcome').value,
        message_variant: $('#logVariant').value.trim() || null,
        occurred_at: when ? new Date(when).toISOString() : new Date().toISOString(),
        summary,
        notes: $('#logNotes').value.trim() || null,
        next_action_date: nextDate || null,
        next_action_title: $('#logNextTitle').value.trim() || null,
        next_action_channel: $('#logNextChannel').value,
      });
      toast(nextDate ? 'Touchpoint logged and follow-up scheduled' : 'Touchpoint logged', 'ok');
      await refresh();
      await updateTaskBadge();
    } catch (e) { toast(e.message, 'err'); }
  });

  // score sliders — live preview
  const recompute = () => {
    let total = 0;
    $('#acctCard').querySelectorAll('[data-factor]').forEach((r) => {
      const w = Number(r.dataset.weight); const pts = Math.round((Number(r.value) / 100) * w);
      $(`[data-fp="${r.dataset.factor}"]`).textContent = pts; total += pts;
    });
    $('#scoreBig').textContent = total;
    const g = $('#scoreGate'); g.className = `gate ${total >= 65 ? 'on' : 'off'}`; g.textContent = total >= 65 ? 'clears the bar' : 'below 65';
  };
  $('#acctCard').querySelectorAll('[data-factor]').forEach((r) => r.addEventListener('input', recompute));
  $('#scoreSave').addEventListener('click', async () => {
    const inputs = {};
    $('#acctCard').querySelectorAll('[data-factor]').forEach((r) => { inputs[r.dataset.factor] = Number(r.value) / 100; });
    try { await api.post(`/api/accounts/${id}/score`, { inputs }); toast('Score saved', 'ok'); await refresh(); }
    catch (e) { toast(e.message, 'err'); }
  });

  // offer buttons
  const offers = (cfg().shared.offers || []);
  $('#offerBtns').innerHTML = offers.map((o) => `<button class="btn small" data-offer="${o.key}">+ ${esc(o.label)} <span class="muted">${money(o.value_low)}–${money(o.value_high)}</span></button>`).join('');
  $('#offerBtns').querySelectorAll('[data-offer]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.post(`/api/accounts/${id}/opportunities`, { offer_key: b.dataset.offer }); await loadOpportunities(id); await refresh(); }
    catch (e) { toast(e.message, 'err'); }
  }));
}

async function loadTouchpoints(id) {
  try {
    const { touchpoints } = await api.get(`/api/touchpoints?company_id=${id}&limit=80`);
    if (!touchpoints.length) {
      $('#touchpointList').innerHTML = '<div class="muted" style="font-size:12px">No history yet. Add prior emails, calls, replies, referrals or meetings above.</div>';
      return;
    }
    $('#touchpointList').innerHTML = touchpoints.map((t) => `
      <div class="touchpoint">
        <div class="tp-mark ${esc(t.outcome || t.channel)}"></div>
        <div class="tp-main">
          <div class="tp-top">
            <span class="tq-ch ${esc(t.channel)}">${esc(t.channel)}</span>
            <strong>${esc(t.summary || t.outcome || 'Touchpoint')}</strong>
            <span class="grow"></span>
            <time>${esc(shortDate(t.occurred_at))}</time>
          </div>
          <div class="tp-sub">${t.person_name ? esc(t.person_name) : 'Account-level'}${t.outcome ? ` · ${esc(t.outcome.replaceAll('_', ' '))}` : ''}${t.message_variant ? ` · angle: ${esc(t.message_variant)}` : ''}</div>
          ${t.notes ? `<div class="tp-notes">${esc(t.notes)}</div>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    $('#touchpointList').innerHTML = `<div class="muted">${esc(e.message)}</div>`;
  }
}

async function loadDiscovery(id) {
  try {
    const { answers, questions } = await api.get(`/api/accounts/${id}/discovery`);
    $('#discBox').innerHTML = questions.map((q) => `
      <div class="disc-q">
        <div class="ql">${esc(q.q)}</div>
        <textarea data-qkey="${q.key}" rows="1" placeholder="…">${esc(answers[q.key] || '')}</textarea>
      </div>`).join('');
    $('#discBox').querySelectorAll('[data-qkey]').forEach((ta) => {
      ta.addEventListener('blur', async () => {
        try { await api.put(`/api/accounts/${id}/discovery`, { qkey: ta.dataset.qkey, answer: ta.value }); }
        catch (e) { toast(e.message, 'err'); }
      });
    });
  } catch (e) { $('#discBox').innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}

async function loadOpportunities(id) {
  try {
    const { opportunities } = await api.get(`/api/accounts/${id}/opportunities`);
    if (!opportunities.length) { $('#oppList').innerHTML = '<div class="muted" style="font-size:12px">No offers yet — add a 30/60/90 engagement above.</div>'; return; }
    const statuses = ['draft', 'proposed', 'won', 'lost'];
    $('#oppList').innerHTML = opportunities.map((o) => `
      <div class="opp" data-opp="${o.id}">
        <div class="opp-head">
          <span class="ol">${esc(o.label)}</span>
          <span class="ov">${money(o.value_low)}–${money(o.value_high)}</span>
          <span class="grow"></span>
          <select class="status-select" data-oppstatus="${o.id}">${statuses.map((s) => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <button class="btn xsmall" data-sow="${o.id}">${o.sow ? 'Regenerate' : 'Generate'} SOW</button>
          <button class="btn xsmall btn-danger" data-oppdel="${o.id}">✕</button>
        </div>
        ${o.sow ? `<div class="opp-sow"><div style="display:flex;gap:8px;margin-bottom:6px"><button class="copybtn inline" data-sowcopy="${o.id}">Copy proposal</button></div><pre data-sowtext="${o.id}">${esc(o.sow)}</pre></div>` : ''}
      </div>`).join('');
    wireOpps(id);
  } catch (e) { $('#oppList').innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}
function wireOpps(id) {
  $('#oppList').querySelectorAll('[data-oppstatus]').forEach((s) => s.addEventListener('change', async () => {
    try { await api.patch(`/api/opportunities/${s.dataset.oppstatus}`, { status: s.value }); await refresh(); } catch (e) { toast(e.message, 'err'); }
  }));
  $('#oppList').querySelectorAll('[data-sow]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Generating…';
    try { await api.post(`/api/opportunities/${b.dataset.sow}/sow`, {}); await loadOpportunities(id); }
    catch (e) { toast(e.message, 'err'); b.disabled = false; }
  }));
  $('#oppList').querySelectorAll('[data-oppdel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.del(`/api/opportunities/${b.dataset.oppdel}`); await loadOpportunities(id); await refresh(); } catch (e) { toast(e.message, 'err'); }
  }));
  $('#oppList').querySelectorAll('[data-sowcopy]').forEach((b) => b.addEventListener('click', () => {
    const pre = $(`[data-sowtext="${b.dataset.sowcopy}"]`); copyText(pre ? pre.textContent : '', b);
  }));
}

function closeAccount() {
  state.openId = null; $('#acctModal').classList.add('hidden');
  try { history.replaceState(null, '', `?product=${encodeURIComponent(state.product)}`); } catch { /* ignore */ }
}
async function refresh() { await Promise.all([loadAccounts(), loadMetrics(), loadProducts()]); }

// ---- task queue ----
async function openTasks() {
  $('#taskModal').classList.remove('hidden');
  await renderTasks();
}
async function renderTasks() {
  const [{ tasks }, { loop }] = await Promise.all([
    api.get(`/api/tasks?product=${encodeURIComponent(state.product)}`),
    api.get(`/api/sales-loop?product=${encodeURIComponent(state.product)}`),
  ]);
  renderTasks._tasks = tasks;
  const accountsOpts = state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  const peopleOpts = state.accounts.flatMap((a) => (a.people || []).map((p) => (
    `<option value="${p.id}" data-company="${a.id}">${esc(p.name || 'Unknown')} · ${esc(a.name)}</option>`
  ))).join('');
  const todo = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done').slice(-12).reverse();
  const today = new Date().toISOString().slice(0, 10);
  const item = (t) => {
    const over = t.due_date && t.due_date < today && t.status !== 'done';
    const who = [t.company_name, t.person_name].filter(Boolean).join(' · ');
    return `<div class="tq-item ${t.status === 'done' ? 'done' : ''}">
      <input type="checkbox" class="tq-check" data-done="${t.id}" ${t.status === 'done' ? 'checked' : ''} />
      <div class="tq-main">
        <div class="tq-title">${esc(t.title || '(untitled)')}</div>
        <div class="tq-sub">
          ${t.channel ? `<span class="tq-ch ${esc(t.channel)}">${esc(t.channel)}</span>` : ''}
          ${t.touch ? `<span class="rt-tag">T${t.touch}</span>` : ''}
          ${who ? `<span>${esc(who)}</span>` : ''}
          ${t.due_date ? `<span class="tq-due ${over ? 'over' : ''}">due ${esc(t.due_date)}${over ? ' · overdue' : ''}</span>` : ''}
        </div>
      </div>
      ${t.body ? `<button class="btn xsmall" data-tcopy="${t.id}">Copy</button>` : ''}
      <button class="btn xsmall btn-danger" data-tdel="${t.id}">✕</button>
    </div>`;
  };
  const group = (label, rows, cls = '') => rows.length
    ? `<section class="cal-group ${cls}"><h4>${esc(label)} <span>${rows.length}</span></h4>${rows.map(item).join('')}</section>`
    : '';
  const overdue = todo.filter((t) => t.due_date && t.due_date < today);
  const dueToday = todo.filter((t) => t.due_date === today);
  const upcoming = todo.filter((t) => t.due_date && t.due_date > today && t.due_date <= datePlus(7));
  const later = todo.filter((t) => t.due_date && t.due_date > datePlus(7));
  const unscheduled = todo.filter((t) => !t.due_date);
  const learning = loop || { tasks: {}, totals: {}, recommendations: [] };
  $('#taskBody').innerHTML = `
    <div class="loop-strip">
      <div><b>${learning.tasks?.overdue || 0}</b><span>overdue</span></div>
      <div><b>${learning.tasks?.today || 0}</b><span>today</span></div>
      <div><b>${learning.tasks?.next_seven || 0}</b><span>next 7 days</span></div>
      <div><b>${learning.totals?.attempts || 0}</b><span>touches · 30d</span></div>
      <div><b>${learning.totals?.positive_rate || 0}%</b><span>positive yield</span></div>
      <div><b>${learning.totals?.meetings || 0}</b><span>meetings</span></div>
    </div>
    <div class="loop-advice">
      <strong>What the system recommends</strong>
      ${(learning.recommendations || []).map((r) => `<p>${esc(r)}</p>`).join('')}
    </div>
    <div class="tq-new">
      <input id="tqTitle" class="full" placeholder="Next action — e.g. Send dispatch workflow example" />
      <select id="tqAccount"><option value="">— account (optional) —</option>${accountsOpts}</select>
      <select id="tqPerson"><option value="">— person (optional) —</option>${peopleOpts}</select>
      <select id="tqChannel"><option value="linkedin">LinkedIn</option><option value="email">Email</option><option value="call">Call</option><option value="research">Research</option></select>
      <input id="tqDue" type="date" value="${today}" />
      <input id="tqTouch" type="number" min="1" max="7" placeholder="touch #" />
      <textarea id="tqBody" class="full" rows="2" placeholder="Message / notes to copy when you send it (optional)"></textarea>
      <button class="btn btn-primary full" id="tqAdd">Schedule next action</button>
    </div>
    <div class="calendar-agenda">
      ${group('Overdue', overdue, 'overdue')}
      ${group('Today', dueToday, 'today')}
      ${group('Next 7 days', upcoming)}
      ${group('Later', later)}
      ${group('Unscheduled', unscheduled)}
      ${!todo.length ? '<div class="muted" style="font-size:12px;padding:8px 0">No open actions. Schedule one above.</div>' : ''}
      ${done.length ? `<section class="cal-group done-group"><h4>Recently completed <span>${done.length}</span></h4>${done.map(item).join('')}</section>` : ''}
    </div>`;
  wireTasks();
  updateTaskBadge(todo.length);
}
function wireTasks() {
  $('#tqPerson').addEventListener('change', () => {
    const selected = $('#tqPerson').selectedOptions[0];
    if (selected?.dataset.company) $('#tqAccount').value = selected.dataset.company;
  });
  $('#tqAdd').addEventListener('click', async () => {
    const title = $('#tqTitle').value.trim(); if (!title) return toast('Give the task a title', 'err');
    const body = {
      title, channel: $('#tqChannel').value, body: $('#tqBody').value || null,
      due_date: $('#tqDue').value || null, touch: $('#tqTouch').value ? Number($('#tqTouch').value) : null,
      company_id: $('#tqAccount').value ? Number($('#tqAccount').value) : null,
      person_id: $('#tqPerson').value ? Number($('#tqPerson').value) : null,
      product: state.product,
    };
    try { await api.post('/api/tasks', body); await renderTasks(); await loadAccounts(); } catch (e) { toast(e.message, 'err'); }
  });
  $('#taskBody').querySelectorAll('[data-done]').forEach((c) => c.addEventListener('change', async () => {
    const task = (renderTasks._tasks || []).find((t) => t.id === Number(c.dataset.done));
    try {
      if (c.checked) {
        const outbound = task && ['email', 'linkedin', 'call'].includes(task.channel);
        await api.post(`/api/tasks/${c.dataset.done}/complete`, {
          outcome: task?.channel === 'research' ? 'researched' : 'sent',
          ...(outbound ? {
            next_action_date: datePlus(4),
            next_action_channel: task.channel,
            next_touch: task.touch && task.touch < 7 ? task.touch + 1 : null,
            next_action_title: `Follow up with ${task.person_name || task.company_name || 'contact'}`,
          } : {}),
        });
        toast(outbound ? 'Logged complete and scheduled the next follow-up' : 'Action completed', 'ok');
      } else {
        await api.patch(`/api/tasks/${c.dataset.done}`, { status: 'todo' });
      }
      await renderTasks();
      await Promise.all([loadAccounts(), loadMetrics()]);
    } catch (e) { toast(e.message, 'err'); }
  }));
  $('#taskBody').querySelectorAll('[data-tdel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.del(`/api/tasks/${b.dataset.tdel}`); await renderTasks(); await loadAccounts(); } catch (e) { toast(e.message, 'err'); }
  }));
  $('#taskBody').querySelectorAll('[data-tcopy]').forEach((b) => b.addEventListener('click', async () => {
    const { tasks } = await api.get('/api/tasks'); const t = tasks.find((x) => x.id == b.dataset.tcopy); copyText(t ? t.body : '', b);
  }));
}
async function updateTaskBadge(n) {
  const badge = $('#taskBadge');
  const count = n != null
    ? n
    : (await api.get(`/api/tasks?status=todo&product=${encodeURIComponent(state.product)}`)).tasks.length;
  badge.textContent = count; badge.classList.toggle('hidden', !count);
}

// ---- add account ----
function openAdd() {
  $('#addProduct').innerHTML = state.products.map((p) => `<option value="${p.id}" ${p.id === state.product ? 'selected' : ''}>${esc(p.short)}</option>`).join('');
  $('#addName').value = ''; $('#addIndustry').value = ''; $('#addHypothesis').value = '';
  $('#addModal').classList.remove('hidden'); $('#addName').focus();
}
async function saveAdd() {
  const name = $('#addName').value.trim(); if (!name) return toast('Name is required', 'err');
  try {
    await api.post('/api/accounts', { name, product: $('#addProduct').value, industry: $('#addIndustry').value || null, hypothesis: $('#addHypothesis').value || null });
    $('#addModal').classList.add('hidden');
    if ($('#addProduct').value !== state.product) { await switchProduct($('#addProduct').value); } else { await refresh(); }
    toast('Account created', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ---- health ----
async function checkHealth() {
  try {
    const h = await api.get('/api/health'); const pill = $('#apolloPill');
    if (h.apollo.present) { pill.className = 'pill pill-ok'; pill.textContent = `Apollo: connected`; }
    else { pill.className = 'pill pill-muted'; pill.textContent = 'Apollo: no key'; }
  } catch { /* ignore */ }
}

// ---- wire top-level controls ----
$('#search').addEventListener('input', (e) => { state.filter = e.target.value; renderAccounts(); });
$('#stageFilter').addEventListener('change', (e) => { state.stageFilter = e.target.value; renderAccounts(); });
$('#gateOnly').addEventListener('change', (e) => { state.gateOnly = e.target.checked; renderAccounts(); });
$('#addBtn').addEventListener('click', openAdd);
$('#addCancel').addEventListener('click', () => $('#addModal').classList.add('hidden'));
$('#addSave').addEventListener('click', saveAdd);
$('#tasksBtn').addEventListener('click', openTasks);
$('#taskClose').addEventListener('click', () => $('#taskModal').classList.add('hidden'));
$('#acctModal').addEventListener('click', (e) => { if (e.target === $('#acctModal')) closeAccount(); });
$('#taskModal').addEventListener('click', (e) => { if (e.target === $('#taskModal')) $('#taskModal').classList.add('hidden'); });
$('#addModal').addEventListener('click', (e) => { if (e.target === $('#addModal')) $('#addModal').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAccount(); $('#taskModal').classList.add('hidden'); $('#addModal').classList.add('hidden'); } });

// ---- boot ----
(async function boot() {
  try {
    // Deep-link support: ?product=<id> selects a tab, #acct=<id> opens an account.
    const params = new URLSearchParams(location.search);
    const wantProduct = params.get('product');
    const wantAcct = (location.hash.match(/acct=(\d+)/) || [])[1];
    if (wantProduct) state.product = wantProduct;

    await loadProducts();
    await loadConfig(state.product);
    renderPlaybook(); populateStageFilter();
    await Promise.all([loadAccounts(), loadMetrics()]);
    checkHealth(); updateTaskBadge();
    if (wantAcct) openAccount(Number(wantAcct));
  } catch (e) { toast(`Failed to load: ${e.message}`, 'err'); }
})();
