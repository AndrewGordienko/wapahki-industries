const $ = (selector, root = document) => root.querySelector(selector);
const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
const isOutageHubPage = ['/outagehub/grants', '/ohub/grants'].includes(cleanPath);
const PAGE = isOutageHubPage ? {
  applicant: 'outagehub',
  label: 'OutageHub',
  title: 'OutageHub Grant Radar',
  subtitle: 'Funding programs matched to the OutageHub product and applicant profile.',
  backHref: '/outagehub',
  backLabel: '← OutageHub workspace',
  otherHref: '/wahpaki/grants',
  otherLabel: 'Wahpaki grants',
} : {
  applicant: 'wapahki',
  label: 'Wahpaki',
  title: 'Wahpaki Grant Radar',
  subtitle: 'Funding programs matched to Wahpaki Industries and its applicant profile.',
  backHref: '/',
  backLabel: '← Wahpaki CRM',
  otherHref: '/outagehub/grants',
  otherLabel: 'OutageHub grants',
};

document.title = `${PAGE.title} — ${PAGE.label}`;
document.body.dataset.applicant = PAGE.applicant;
$('#pageTitle').textContent = PAGE.title;
$('#pageSubtitle').textContent = PAGE.subtitle;
$('#workspaceBack').href = PAGE.backHref;
$('#workspaceBack').textContent = PAGE.backLabel;
$('#otherGrantPage').href = PAGE.otherHref;
$('#otherGrantPage').textContent = PAGE.otherLabel;
$('#exportGrants').href = `/api/grants/export?applicant=${encodeURIComponent(PAGE.applicant)}`;

const grantHeader = $('.gr-top');
const syncStickyOffset = () => {
  document.documentElement.style.setProperty('--gr-header-height', `${grantHeader.getBoundingClientRect().height}px`);
};
syncStickyOffset();
new ResizeObserver(syncStickyOffset).observe(grantHeader);

const api = {
  async req(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${response.status} error`);
    return data;
  },
  get: (path) => api.req('GET', path),
  post: (path, body) => api.req('POST', path, body),
  patch: (path, body) => api.req('PATCH', path, body),
};

const state = {
  grants: [],
  stats: {},
  run: null,
  search: '',
  applicant: PAGE.applicant,
  status: '',
  intake: '',
  fundingType: '',
  sort: 'deadline',
  view: 'sheet',
  activeContact: null,
  poll: null,
};
const STATUSES = [
  'discovered', 'verify', 'eligible', 'preparing', 'applied',
  'won', 'rejected', 'not_eligible', 'watching', 'closed',
];
const CONTACT_STATUSES = ['drafted', 'verify', 'ready', 'sent', 'replied', 'skip'];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));

function toast(message, kind = '') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast ${kind}`;
  node.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => node.classList.add('hidden'), 3800);
}

function money(value, compact = false) {
  if (value == null || value === '') return 'not published';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard',
  }).format(Number(value));
}

function amountLabel(grant) {
  if (grant.amount_min != null && grant.amount_max != null && grant.amount_min !== grant.amount_max) {
    return `${money(grant.amount_min, true)}–${money(grant.amount_max, true)}`;
  }
  return money(grant.amount_max ?? grant.amount_min, true);
}

function applicantLabel(value) {
  return value === 'wapahki' ? 'Wahpaki' : 'OutageHub';
}

function daysUntil(date) {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  return Math.ceil((target - today) / 86400000);
}

function deadlineLabel(grant) {
  if (!grant.deadline) {
    if (grant.intake_status === 'rolling') return 'rolling';
    return grant.deadline_note || 'date not verified';
  }
  const days = daysUntil(grant.deadline);
  const date = new Date(`${grant.deadline}T00:00:00`).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  if (days < 0) return `${date} · passed`;
  if (days === 0) return `${date} · today`;
  return `${date} · ${days}d`;
}

async function load() {
  const data = await api.get(`/api/grants?applicant=${encodeURIComponent(PAGE.applicant)}`);
  state.grants = data.grants || [];
  state.stats = data.stats || {};
  state.run = data.run || null;
  render();
  if (state.run?.running) showRun(state.run);
}

function render() {
  renderStats();
  renderFilters();
  renderBoard();
}

function renderStats() {
  const stats = state.stats;
  const items = [
    ['Opportunities', stats.opportunities || 0, ''],
    ['Eligible', stats.eligible || 0, 'good'],
    ['Need facts', stats.conditional || 0, 'warn'],
    ['Due ≤45 days', stats.due_soon || 0, 'warn'],
    ['Potential ceiling', money(stats.potential_max || 0, true), 'good'],
    ['Email drafts', stats.email_drafts || 0, ''],
  ];
  $('#statbar').innerHTML = items.map(([label, value, className]) => (
    `<div class="gr-stat"><div class="k">${esc(label)}</div><div class="v ${className}">${esc(value)}</div></div>`
  )).join('');
}

function renderFilters() {
  const types = [...new Set(state.grants.map((grant) => grant.funding_type).filter(Boolean))].sort();
  const statusValue = $('#statusFilter').value || state.status;
  const typeValue = $('#typeFilter').value || state.fundingType;
  $('#statusFilter').innerHTML = '<option value="">All stages</option>'
    + STATUSES.map((status) => `<option value="${status}" ${status === statusValue ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`).join('');
  $('#typeFilter').innerHTML = '<option value="">All funding types</option>'
    + types.map((type) => `<option value="${esc(type)}" ${type === typeValue ? 'selected' : ''}>${esc(type)}</option>`).join('');
}

function visibleGrants() {
  const query = state.search.trim().toLowerCase();
  const rows = state.grants.filter((grant) => {
    if (state.applicant && grant.applicant !== state.applicant) return false;
    if (state.status && grant.status !== state.status) return false;
    if (state.intake && grant.intake_status !== state.intake) return false;
    if (state.fundingType && grant.funding_type !== state.fundingType) return false;
    if (!query) return true;
    const contacts = (grant.contacts || []).map((contact) => (
      `${contact.contact_name} ${contact.contact_title} ${contact.organization} ${contact.contact_email}`
    )).join(' ');
    const lists = [
      ...(grant.eligibility_gaps || []),
      ...(grant.next_steps || []),
      ...(grant.application_requirements || []),
    ].join(' ');
    return [
      grant.program_name, grant.funder, grant.stream, grant.summary, grant.project_fit,
      grant.why_fit, lists, contacts,
    ].join(' ').toLowerCase().includes(query);
  });

  if (state.sort === 'score') return rows.sort((a, b) => (b.score || 0) - (a.score || 0));
  if (state.sort === 'amount') return rows.sort((a, b) => (b.amount_max || 0) - (a.amount_max || 0) || (b.score || 0) - (a.score || 0));
  if (state.sort === 'newest') return rows.sort((a, b) => String(b.last_verified_at).localeCompare(String(a.last_verified_at)));
  return rows.sort((a, b) => {
    const aAction = ['open', 'rolling'].includes(a.intake_status) && !['applied', 'closed', 'not_eligible'].includes(a.status);
    const bAction = ['open', 'rolling'].includes(b.intake_status) && !['applied', 'closed', 'not_eligible'].includes(b.status);
    if (aAction !== bAction) return Number(bAction) - Number(aAction);
    const aDate = a.deadline || '9999-12-31';
    const bDate = b.deadline || '9999-12-31';
    return aDate.localeCompare(bDate) || (b.score || 0) - (a.score || 0);
  });
}

function list(items, className = '') {
  if (!items?.length) return '<span class="gr-none">None recorded</span>';
  return `<ul class="${className}">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function grantCard(grant) {
  const score = Number(grant.score || 0);
  const scoreClass = score >= 75 ? 'good' : score >= 60 ? 'mid' : 'low';
  const deadlineDays = daysUntil(grant.deadline);
  const urgent = deadlineDays != null && deadlineDays >= 0 && deadlineDays <= 45;
  const statuses = STATUSES.map((status) => (
    `<option value="${status}" ${grant.status === status ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`
  )).join('');
  const sourceLinks = (grant.sources || []).map((source, index) => (
    `<a href="${esc(source.url)}" target="_blank" rel="noreferrer" title="${esc(source.supports)}">${source.source_type === 'official' ? 'official' : 'source'} ${index + 1} ↗</a>`
  )).join('');
  const contacts = (grant.contacts || []).map(contactCard).join('');
  const coverage = grant.coverage_percent != null ? ` · ${grant.coverage_percent}% coverage` : '';
  return `
    <article class="gr-card status-${esc(grant.status)}">
      <div class="gr-card-head">
        <div class="gr-score ${scoreClass}">${score}<small>/100</small></div>
        <div class="gr-card-title">
          <div class="gr-badges">
            <span class="gr-applicant ${esc(grant.applicant)}">${esc(applicantLabel(grant.applicant))}</span>
            <span class="gr-eligibility ${esc(grant.eligibility_result)}">${esc(grant.eligibility_result || 'unknown')}</span>
            <span class="gr-intake ${esc(grant.intake_status)}">${esc(grant.intake_status || 'unknown')}</span>
          </div>
          <h2><a href="${esc(grant.official_url)}" target="_blank" rel="noreferrer">${esc(grant.program_name)} ↗</a></h2>
          <div class="gr-meta">${esc(grant.funder)}${grant.stream ? ` · ${esc(grant.stream)}` : ''} · ${esc(grant.jurisdiction || 'Canada')}</div>
        </div>
        <div class="gr-money">
          <strong>${esc(amountLabel(grant))}</strong>
          <span>${esc(grant.funding_type || '')}${esc(coverage)}</span>
        </div>
        <select class="gr-status" data-grant-status="${grant.id}">${statuses}</select>
      </div>

      <div class="gr-deadline ${urgent ? 'urgent' : ''}">
        <span class="gr-lbl">Deadline</span>
        <strong>${esc(deadlineLabel(grant))}</strong>
        <span>${esc(grant.deadline_note || '')}</span>
      </div>

      <p class="gr-summary">${esc(grant.summary || '')}</p>
      <div class="gr-flow">
        <div><span class="gr-lbl">Fundable project</span>${esc(grant.project_fit || '—')}</div>
        <div><span class="gr-lbl">Why it may fit</span>${esc(grant.why_fit || '—')}</div>
        <div><span class="gr-lbl">Eligibility call</span>${esc(grant.eligibility_reason || '—')}</div>
      </div>

      <details class="gr-detail" ${['eligible', 'verify', 'preparing'].includes(grant.status) ? 'open' : ''}>
        <summary>Application brief <span>· gaps, requirements, sources and next actions</span></summary>
        <div class="gr-detail-grid">
          <section><span class="gr-lbl">Facts to confirm</span>${list(grant.eligibility_gaps, 'gr-gaps')}</section>
          <section><span class="gr-lbl">Application requirements</span>${list(grant.application_requirements)}</section>
          <section><span class="gr-lbl">Next actions</span>${list(grant.next_steps, 'gr-actions-list')}</section>
          <section>
            <span class="gr-lbl">Eligible applicants / costs</span>
            <p>${esc(grant.eligible_applicants || '—')}</p>
            <p>${esc(grant.eligible_costs || '—')}</p>
            <div class="gr-sources">${sourceLinks}</div>
            <div class="gr-verified">Verified ${esc(grant.last_verified_at || '—')} · ${esc(grant.confidence || '—')} confidence</div>
          </section>
        </div>
      </details>

      <details class="gr-contacts" ${(grant.contacts || []).length && ['eligible', 'verify'].includes(grant.status) ? 'open' : ''}>
        <summary>${(grant.contacts || []).length} program contact${(grant.contacts || []).length === 1 ? '' : 's'}
          <span>· published route + drafted question</span>
        </summary>
        <div class="gr-contact-grid">${contacts || '<div class="empty-cell">No public program contact found yet.</div>'}</div>
      </details>
    </article>`;
}

function contactCard(contact) {
  const statuses = CONTACT_STATUSES.map((status) => (
    `<option value="${status}" ${contact.status === status ? 'selected' : ''}>${status}</option>`
  )).join('');
  const name = contact.contact_name || contact.contact_title || 'Program team';
  return `
    <div class="gr-contact">
      <div class="gr-contact-top">
        <div>
          <strong>${esc(name)}</strong>
          <div>${esc(contact.organization || '')}${contact.contact_name ? ` · ${esc(contact.contact_title || '')}` : ''}</div>
        </div>
        <a href="${esc(contact.contact_url)}" target="_blank" rel="noreferrer">source ↗</a>
      </div>
      <p>${esc(contact.why_contact || '')}</p>
      <div class="gr-contact-route">
        <span>${contact.contact_email ? esc(contact.contact_email) : 'official form / contact page'}</span>
        <select data-contact-status="${contact.id}">${statuses}</select>
        <button class="btn xsmall" data-email="${contact.id}">Email draft</button>
      </div>
    </div>`;
}

function renderBoard() {
  const rows = visibleGrants();
  $('#visibleCount').textContent = `${rows.length} of ${state.grants.length} opportunities`;
  $('#empty').classList.toggle('hidden', rows.length > 0);
  $('#board').className = state.view === 'sheet' ? 'gr-sheet-wrap' : 'gr-board';
  $('#board').innerHTML = state.view === 'sheet' ? grantTable(rows) : rows.map(grantCard).join('');
  $('#board').querySelectorAll('[data-grant-status]').forEach((node) => {
    node.addEventListener('change', () => updateGrantStatus(Number(node.dataset.grantStatus), node.value));
  });
  $('#board').querySelectorAll('[data-contact-status]').forEach((node) => {
    node.addEventListener('change', () => updateContactStatus(Number(node.dataset.contactStatus), node.value));
  });
  $('#board').querySelectorAll('[data-email]').forEach((node) => {
    node.addEventListener('click', () => openEmail(Number(node.dataset.email)));
  });
}

function grantTable(grants) {
  if (!grants.length) return '';
  return `
    <table class="grid gr-sheet">
      <colgroup>
        <col class="gr-col-applicant" />
        <col class="gr-col-program" />
        <col class="gr-col-funding" />
        <col class="gr-col-deadline" />
        <col class="gr-col-fit" />
        <col class="gr-col-project" />
        <col class="gr-col-next" />
        <col class="gr-col-contact" />
        <col class="gr-col-route" />
        <col class="gr-col-draft" />
        <col class="gr-col-stage" />
        <col class="gr-col-stage" />
      </colgroup>
      <tbody>${grants.map(grantTableRows).join('')}</tbody>
    </table>`;
}

function grantTableRows(grant) {
  const contactRows = grant.contacts?.length ? grant.contacts : [{}];
  const rowspan = contactRows.length;
  const score = Number(grant.score || 0);
  const scoreClass = score >= 75 ? 'good' : score >= 60 ? 'mid' : 'low';
  const grantStatuses = STATUSES.map((status) => (
    `<option value="${status}" ${grant.status === status ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`
  )).join('');
  const commonCells = `
    <td rowspan="${rowspan}" class="gr-sheet-applicant">
      <span class="gr-applicant ${esc(grant.applicant)}">${esc(applicantLabel(grant.applicant))}</span>
    </td>
    <td rowspan="${rowspan}" class="gr-sheet-program">
      <a href="${esc(grant.official_url)}" target="_blank" rel="noreferrer">${esc(grant.program_name)} ↗</a>
      <span>${esc(grant.funder)}${grant.stream ? ` · ${esc(grant.stream)}` : ''}</span>
      ${grant.application_url ? `<a class="gr-sheet-small" href="${esc(grant.application_url)}" target="_blank" rel="noreferrer">application ↗</a>` : ''}
    </td>
    <td rowspan="${rowspan}">
      <strong class="gr-sheet-money">${esc(amountLabel(grant))}</strong>
      <span class="gr-sheet-sub">${esc(grant.funding_type || '')}${grant.coverage_percent != null ? ` · ${grant.coverage_percent}%` : ''}</span>
    </td>
    <td rowspan="${rowspan}" class="${daysUntil(grant.deadline) != null && daysUntil(grant.deadline) >= 0 && daysUntil(grant.deadline) <= 45 ? 'gr-sheet-urgent' : ''}">
      <strong>${esc(deadlineLabel(grant))}</strong>
      <span class="gr-sheet-sub">${esc(grant.intake_status || '')}</span>
    </td>
    <td rowspan="${rowspan}">
      <span class="gr-sheet-score ${scoreClass}">${score}</span>
      <span class="gr-eligibility ${esc(grant.eligibility_result)}">${esc(grant.eligibility_result || 'unknown')}</span>
      ${(grant.eligibility_gaps || []).length ? `<span class="gr-sheet-sub" title="${esc(grant.eligibility_gaps.join(' · '))}">${grant.eligibility_gaps.length} fact${grant.eligibility_gaps.length === 1 ? '' : 's'} to confirm</span>` : ''}
    </td>
    <td rowspan="${rowspan}" class="gr-sheet-copy">${esc(grant.project_fit || '—')}</td>
    <td rowspan="${rowspan}" class="gr-sheet-copy">${esc((grant.next_steps || [])[0] || '—')}</td>`;

  return contactRows.map((contact, index) => {
    const contactStatuses = CONTACT_STATUSES.map((status) => (
      `<option value="${status}" ${contact.status === status ? 'selected' : ''}>${status}</option>`
    )).join('');
    const name = contact.contact_name || contact.contact_title || 'Program team';
    const route = contact.contact_email
      ? `<a href="mailto:${esc(contact.contact_email)}">${esc(contact.contact_email)}</a>`
      : 'official form / contact page';
    return `
      <tr class="${index === 0 ? 'company-start' : ''}">
        ${index === 0 ? commonCells : ''}
        <td>
          <strong>${esc(name)}</strong>
          <span class="gr-sheet-sub">${esc(contact.contact_name ? contact.contact_title : contact.organization || '')}</span>
        </td>
        <td class="gr-sheet-route">
          <span>${route}</span>
          ${contact.contact_url ? `<a class="gr-sheet-small" href="${esc(contact.contact_url)}" target="_blank" rel="noreferrer">contact source ↗</a>` : ''}
        </td>
        <td>${contact.id ? `<button class="btn xsmall" data-email="${contact.id}">Open draft</button>` : '—'}</td>
        ${index === 0 ? `<td rowspan="${rowspan}"><select class="gr-status" data-grant-status="${grant.id}">${grantStatuses}</select></td>` : ''}
        <td>
          ${contact.id ? `<select class="gr-contact-status" data-contact-status="${contact.id}">${contactStatuses}</select>` : '—'}
        </td>
      </tr>`;
  }).join('');
}

async function updateGrantStatus(id, status) {
  try {
    await api.patch(`/api/grants/${id}`, { status });
    const grant = state.grants.find((item) => item.id === id);
    if (grant) grant.status = status;
    toast('Application stage saved', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

function findContact(id) {
  for (const grant of state.grants) {
    const contact = (grant.contacts || []).find((item) => item.id === id);
    if (contact) return { grant, contact };
  }
  return null;
}

async function updateContactStatus(id, status) {
  try {
    await api.patch(`/api/grant-contacts/${id}`, { status });
    const found = findContact(id);
    if (found) found.contact.status = status;
    toast('Contact stage saved', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

function openEmail(id) {
  const found = findContact(id);
  if (!found) return;
  state.activeContact = found.contact;
  $('#emailWho').textContent = `${found.contact.contact_name || found.contact.contact_title || 'Program team'} · ${found.grant.program_name}`;
  $('#emailTo').textContent = found.contact.contact_email || 'use official form / contact page';
  $('#emailSubject').textContent = found.contact.email_subject || '';
  $('#emailBody').textContent = found.contact.email_body || '';
  $('#emailModal').classList.remove('hidden');
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text || '');
    const original = button.textContent;
    button.textContent = 'Copied ✓';
    setTimeout(() => { button.textContent = original; }, 1200);
  } catch {
    toast('Copy failed', 'err');
  }
}

function showRun(run) {
  state.run = run;
  $('#runPanel').classList.remove('hidden');
  $('#runSpin').classList.toggle('spin', Boolean(run.running));
  $('#runTitle').textContent = run.running
    ? 'Funding agents running…'
    : `Funding research finished${run.exitCode === 0 ? '' : ` (exit ${run.exitCode})`}`;
  $('#runLog').textContent = (run.log || []).join('\n');
  $('#runLog').scrollTop = $('#runLog').scrollHeight;
  $('#researchBtn').disabled = Boolean(run.running);
  $('#refreshBtn').disabled = Boolean(run.running);
}

async function pollRun() {
  try {
    const run = await api.get('/api/grants/discover/status');
    showRun(run);
    if (!run.running) {
      clearInterval(state.poll);
      state.poll = null;
      await load();
    }
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function startResearch(refresh = false) {
  try {
    const count = Math.min(Math.max(Number($('#researchCount').value) || 16, 1), 60);
    const venture = PAGE.applicant;
    await api.post('/api/grants/discover', { count, venture, refresh });
    showRun({ running: true, log: [refresh ? 'Re-verification agents starting…' : 'Funding sweep agents starting…'] });
    clearInterval(state.poll);
    state.poll = setInterval(pollRun, 1800);
  } catch (error) {
    toast(error.message, 'err');
  }
}

$('#search').addEventListener('input', (event) => { state.search = event.target.value; renderBoard(); });
$('#statusFilter').addEventListener('change', (event) => { state.status = event.target.value; renderBoard(); });
$('#intakeFilter').addEventListener('change', (event) => { state.intake = event.target.value; renderBoard(); });
$('#typeFilter').addEventListener('change', (event) => { state.fundingType = event.target.value; renderBoard(); });
$('#sortBy').addEventListener('change', (event) => { state.sort = event.target.value; renderBoard(); });
$('#viewMode').addEventListener('change', (event) => { state.view = event.target.value; renderBoard(); });
$('#researchBtn').addEventListener('click', () => startResearch(false));
$('#refreshBtn').addEventListener('click', () => startResearch(true));
$('#runHide').addEventListener('click', () => $('#runPanel').classList.add('hidden'));
$('#emailClose').addEventListener('click', () => $('#emailModal').classList.add('hidden'));
$('#emailModal').addEventListener('click', (event) => {
  if (event.target === $('#emailModal')) $('#emailModal').classList.add('hidden');
});
$('#copySubject').addEventListener('click', (event) => copyText(state.activeContact?.email_subject, event.currentTarget));
$('#copyEmail').addEventListener('click', (event) => {
  copyText(`Subject: ${state.activeContact?.email_subject || ''}\n\n${state.activeContact?.email_body || ''}`, event.currentTarget);
});

load().then(() => {
  if (state.run?.running) state.poll = setInterval(pollRun, 1800);
}).catch((error) => toast(`Failed to load: ${error.message}`, 'err'));
