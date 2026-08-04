// Outreach spreadsheet: company -> people -> campaign-specific touch columns.
// Reuses the intact backend: /api/campaigns, /api/companies?campaign=,
// /api/people/:id/sequence, /api/sequences/:id (mark sent). No build step.

const $ = (s, r = document) => r.querySelector(s);
const api = {
  async req(m, p, b) {
    const res = await fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `${res.status} error`);
    return d;
  },
  get: (p) => api.req('GET', p),
  patch: (p, b) => api.req('PATCH', p, b),
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usableEmail = (e) => e && e.includes('@') && !/not_unlocked|not available/i.test(e);
function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = `toast ${kind}`;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 3500); t.classList.remove('hidden');
}

// Outreach CRM shows Wapahki + the unified GnK and OutageHub funnels.
const ONLY = ['wapahki', 'gnk', 'outagehub'];
const state = { campaign: new URLSearchParams(location.search).get('c') || 'wapahki', campaigns: [], companies: [], filter: '' };

async function loadTabs() {
  const { campaigns } = await api.get('/api/campaigns');
  state.campaigns = campaigns.filter((c) => ONLY.includes(c.id));
  if (!state.campaigns.some((c) => c.id === state.campaign)) state.campaign = (state.campaigns[0] || {}).id;
  $('#tabs').innerHTML = state.campaigns.map((c) => `
    <div class="ob-tab ${c.id === state.campaign ? 'active' : ''}" data-c="${esc(c.id)}">
      ${esc(c.short || c.label || c.id)}<span class="cnt">${c.companies || 0}co · ${c.contacts || 0}ppl</span>
    </div>`).join('');
  $('#tabs').querySelectorAll('[data-c]').forEach((el) => el.addEventListener('click', () => { state.campaign = el.dataset.c; loadTabs(); load(); }));
}

async function load() {
  const { companies } = await api.get(`/api/companies?campaign=${encodeURIComponent(state.campaign)}`);
  state.companies = companies;
  render();
}

function render() {
  const touchCount = state.campaign === 'outagehub' ? 4 : 7;
  const f = state.filter.trim().toLowerCase();
  const view = state.companies.map((c) => ({
    c,
    people: (c.people || []).filter((p) => !f || `${c.name} ${p.name} ${p.title}`.toLowerCase().includes(f)),
  })).filter((x) => !f || x.people.length);

  const totalPeople = state.companies.reduce((n, c) => n + (c.people || []).length, 0);
  const withT1 = state.companies.reduce((n, c) => n + (c.people || []).filter((p) => (p.sequence || []).some((t) => t.touch === 1)).length, 0);
  const withT2 = state.companies.reduce((n, c) => n + (c.people || []).filter((p) => (p.sequence || []).some((t) => t.touch === 2)).length, 0);
  const waitingForT1 = totalPeople - withT1;
  $('#stats').innerHTML = `<b>${state.companies.length}</b> companies · <b>${totalPeople}</b> contacts · <b>${withT1}</b> T1 · <b>${withT2}</b> personalized T2${waitingForT1 ? ` · <b>${waitingForT1}</b> awaiting T1` : ''} — click any touch cell for the full email`;

  const host = $('#host');
  if (!view.length) { host.innerHTML = '<div class="ob-note">No contacts yet for this campaign.</div>'; return; }
  const body = view.map(({ c, people }, i) => renderCompanyRows(c, people, i, touchCount)).join('');
  host.innerHTML = `
    <table class="grid">
      <colgroup>
        <col class="th-company" /><col class="th-problem" /><col class="th-person" /><col class="th-role" />
        <col class="th-email" /><col class="th-linkedin" /><col class="th-why" /><col class="th-status" />
        ${Array.from({ length: touchCount }, () => '<col class="th-touch" />').join('')}
      </colgroup>
      <thead><tr>
        <th>Company</th><th>Problem / solution</th><th>Person</th><th>Role</th><th>Email</th><th>LinkedIn</th><th>Why they'd reply</th><th>Status</th>
        ${Array.from({ length: touchCount }, (_, index) => `<th>T${index + 1}</th>`).join('')}
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  host.querySelectorAll('[data-seq]').forEach((el) => el.addEventListener('click', () => showSequence(Number(el.dataset.seq))));
  host.querySelectorAll('[data-status]').forEach((sel) => sel.addEventListener('change', () => setStatus(Number(sel.dataset.status), sel.value, sel)));
}

function renderCompanyRows(c, people, idx, touchCount) {
  const parity = idx % 2 ? 'alt' : '';
  const n = Math.max(people.length, 1);
  const domain = c.domain ? `<a class="cc-domain" href="https://${esc(c.domain)}" target="_blank" rel="noopener">${esc(c.domain)}</a>` : '';
  const companyCell = `<td class="c-company ${parity}" rowspan="${n}"><div class="cc-name">${esc(c.name)}</div><div class="cc-meta">${esc(c.industry || '')}${c.city ? ' · ' + esc(c.city) : ''}</div>${domain}</td>`;
  const problemCell = renderProblemCell(c, n, parity);
  if (!people.length) return `<tr class="company-start ${parity}">${companyCell}${problemCell}<td class="empty-cell" colspan="${6 + touchCount}">No contacts.</td></tr>`;
  return people.map((p, i) => `<tr class="${i === 0 ? 'company-start' : ''} ${parity}" data-pid="${p.id}">${i === 0 ? companyCell + problemCell : ''}${renderPersonCells(p, touchCount)}</tr>`).join('');
}

// The problem / solution we're selling this company — parsed from the account notes.
function renderProblemCell(c, n, parity) {
  const notes = c.notes || '';
  const f = (k) => (notes.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '';
  const idea = f('Idea');
  if (!idea) {
    const raw = notes.trim();
    return `<td class="c-problem ${parity}" rowspan="${n}">${raw ? esc(raw.slice(0, 140)) : '<span class="li-none">—</span>'}</td>`;
  }
  const problem = f('Problem'); const build = f("What we'd build"); const fee = f('Fee');
  return `<td class="c-problem ${parity}" rowspan="${n}"><div class="pp-idea">${esc(idea)}</div>${problem ? `<div class="pp-prob">${esc(problem)}</div>` : ''}${build ? `<div class="pp-sol"><b>Build:</b> ${esc(build)}</div>` : ''}${fee ? `<div class="pp-fee">${esc(fee)}</div>` : ''}</td>`;
}

function renderPersonCells(p, touchCount) {
  const emailCell = usableEmail(p.email) ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : `<span class="locked">—</span>`;
  const linkedinCell = p.linkedin_url ? `<a class="li" href="${esc(p.linkedin_url)}" target="_blank" rel="noopener">in ↗</a>` : '<span class="li-none">—</span>';
  return `
    <td class="c-person"><span class="pname">${esc(p.name || '—')}</span></td>
    <td class="c-role">${esc(p.title || '')}</td>
    <td class="c-email">${emailCell}</td>
    <td class="c-linkedin">${linkedinCell}</td>
    <td class="c-why">${esc(p.relevance_reason || '')}</td>
    <td class="c-status">${statusSelect(p)}</td>
    ${renderTouchCells(p, touchCount)}`;
}

// Clickable status dropdown — same options as the original Wapahki CRM; persists via PATCH.
const STATUS_OPTS = ['new', 'queued', 'emailed', 'replied', 'not_interested'];
function statusSelect(p) {
  const cur = p.status || 'new';
  return `<select class="status status-${esc(cur)}" data-status="${p.id}">${STATUS_OPTS.map((s) => `<option value="${s}" ${s === cur ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select>`;
}
async function setStatus(id, status, el) {
  try { await api.patch(`/api/people/${id}`, { status }); if (el) el.className = `status status-${status}`; }
  catch (e) { toast(e.message, 'err'); }
}

function renderTouchCells(p, touchCount) {
  const map = {};
  (p.sequence || []).forEach((t) => { map[t.touch] = t; });
  return Array.from({ length: touchCount }, (_, index) => index + 1).map((n) => {
    const t = map[n];
    if (!t) return `<td class="c-touch"><span class="t-tag pending">T${n}</span></td>`;
    const li = t.channel === 'linkedin';
    const sent = t.status === 'sent';
    const raw = (t.subject ? t.subject + ' — ' : '') + (t.body || '');
    return `<td class="c-touch ${li ? 'li' : 'em'} ${sent ? 'sent' : ''}" data-seq="${p.id}" title="click for the full sequence"><span class="t-tag">${li ? 'in' : '✉'} T${n}${sent ? ' ✓' : ''}</span>${esc(raw.slice(0, 150))}</td>`;
  }).join('');
}

// ---- Gmail-style sequence modal ----
const seqCache = {};
function findPerson(id) { for (const c of state.companies) for (const p of (c.people || [])) if (p.id === id) return { p, c }; return { p: null, c: null }; }

async function showSequence(personId) {
  try {
    const { sequence } = await api.get(`/api/people/${personId}/sequence`);
    const { p, c } = findPerson(personId);
    $('#seqContact').innerHTML = p ? `<b>${esc(p.name || '')}</b>${p.title ? ` <span class="sc-role">${esc(p.title)}</span>` : ''}${c ? ` <span class="sc-co">${esc(c.name)}</span>` : ''}` : '';
    const body = $('#seqBody');
    if (!sequence.length) { body.innerHTML = '<p class="empty-cell">No messages written yet for this contact.</p>'; $('#seqModal').classList.remove('hidden'); return; }
    body.innerHTML = sequence.map((t) => renderMail(t, p)).join('');
    body.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => { const c2 = seqCache[b.dataset.id]; copyText(c2 ? c2[b.dataset.copy] : '', b); }));
    body.querySelectorAll('[data-sent]').forEach((b) => b.addEventListener('click', () => markSent(b)));
    $('#seqModal').classList.remove('hidden');
  } catch (e) { toast(e.message, 'err'); }
}

function renderMail(t, p) {
  const li = t.channel === 'linkedin';
  const sent = t.status === 'sent';
  const to = li ? (p?.linkedin_url || '') : (p?.email || '');
  const full = li ? (t.body || '') : `To: ${to}\nSubject: ${t.subject || ''}\n\n${t.body || ''}`;
  seqCache[t.id] = { to, subject: t.subject || '', body: t.body || '', full };
  const chLabel = li ? `in&nbsp;LinkedIn ${t.day <= 6 ? 'connect' : 'message'}` : '✉&nbsp;Email';
  const toRow = li
    ? (to ? `<div class="mail-row"><span class="mail-lbl">To</span><a class="mail-to" href="${esc(to)}" target="_blank" rel="noopener">${esc(p?.name || 'LinkedIn profile')} ↗</a></div>` : '')
    : `<div class="mail-row"><span class="mail-lbl">To</span><span class="mail-to">${esc(to || '—')}</span><button class="copybtn" data-copy="to" data-id="${t.id}">copy</button></div>
       <div class="mail-row"><span class="mail-lbl">Subject</span><span class="mail-subj">${esc(t.subject || '')}</span><button class="copybtn" data-copy="subject" data-id="${t.id}">copy</button></div>`;
  return `
    <div class="mail ${sent ? 'sent' : ''}">
      <div class="mail-head">
        <span class="mail-ch ${li ? 'li' : 'em'}">${chLabel}</span>
        <span class="mail-meta">Touch ${t.touch} · day ${t.day}</span>
        <span class="mail-flag ${sent ? 'on' : ''}">${sent ? 'sent ✓' : 'draft'}</span>
      </div>
      ${(t.scheduled_local || t.send_window) ? `<div class="mail-row"><span class="mail-lbl">Suggested send</span><span class="mail-to" title="${esc(t.timing_reason || '')}">${esc(t.scheduled_local || t.send_window)}${t.scheduled_local && t.send_window ? ` · ${esc(t.send_window)}` : ''}</span></div>` : ''}
      ${toRow}
      <pre class="mail-body">${esc(t.body || '')}</pre>
      <div class="mail-actions">
        <button class="btn btn-sm" data-copy="full" data-id="${t.id}">Copy ${li ? 'message' : 'email'}</button>
        ${sent ? '' : `<button class="btn btn-sm btn-primary" data-sent="${t.id}" data-state="draft">Mark sent</button>`}
      </div>
    </div>`;
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text || '').then(() => { if (btn) { const o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = o; }, 1100); } }, () => toast('Copy failed', 'err'));
}

async function markSent(btn) {
  const id = btn.dataset.sent;
  const next = btn.dataset.state === 'sent' ? 'draft' : 'sent';
  try {
    await api.patch(`/api/sequences/${id}`, { status: next });
    const card = btn.closest('.mail'); const on = next === 'sent';
    card.classList.toggle('sent', on);
    const flag = card.querySelector('.mail-flag'); flag.textContent = on ? 'sent ✓' : 'draft'; flag.classList.toggle('on', on);
    btn.dataset.state = next; btn.textContent = on ? 'Sent ✓ (undo)' : 'Mark sent';
    btn.classList.toggle('btn-primary', !on); btn.classList.toggle('btn-sent', on);
  } catch (e) { toast(e.message, 'err'); }
}

$('#search').addEventListener('input', (e) => { state.filter = e.target.value; render(); });
$('#seqClose').addEventListener('click', () => $('#seqModal').classList.add('hidden'));
$('#seqModal').addEventListener('click', (e) => { if (e.target === $('#seqModal')) $('#seqModal').classList.add('hidden'); });

// Live trickle: refresh so new sequences appear as the writer runs.
setInterval(() => { if (!$('#seqModal').classList.contains('hidden')) return; if (document.activeElement === $('#search')) return; load().catch(() => {}); }, 5000);

loadTabs().then(load).catch((e) => toast(`Failed to load: ${e.message}`, 'err'));
