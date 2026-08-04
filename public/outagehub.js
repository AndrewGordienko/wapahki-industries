// OutageHub product adapter for the shared idea workspace.
const $ = (selector, root = document) => root.querySelector(selector);
const STATUSES = ['discovered', 'approved', 'in_outreach', 'won', 'shelved'];
const TARGET_STATUSES = ['drafted', 'queued', 'sent', 'replied', 'skip'];
const state = { problems: [], stats: {}, activeTarget: null };

const workspace = IdeaWorkspace.create({
  statuses: STATUSES,
  categoryLabel: 'All sectors',
  sorts: [
    { value: 'score', label: 'Sort: score' },
    { value: 'targets', label: 'Sort: buyers' },
    { value: 'newest', label: 'Sort: newest' },
  ],
  research: {
    startPath: '/api/outagehub/discover',
    statusPath: '/api/outagehub/discover/status',
    buttonLabel: 'Find ideas',
    busyButtonLabel: 'Finding ideas…',
    runningLabel: 'Research scouts finding OutageHub ideas…',
    finishedLabel: 'OutageHub idea research finished',
  },
  onFilterChange: renderBoard,
  onReload: load,
});
const { api, esc, toast } = workspace;

async function load() {
  const data = await api.get('/api/outagehub');
  state.problems = data.problems || [];
  state.stats = data.stats || {};
  render();
  workspace.syncRun(data.run);
}

function render() {
  renderStats();
  workspace.renderFilters(state.problems, { getCategory: (problem) => problem.sector || '' });
  renderBoard();
}

function renderStats() {
  const stats = state.stats;
  workspace.renderStats([
    ['Ideas', stats.problems || 0],
    ['Qualified 65+', stats.qualified || 0, 'good'],
    ['Companies', stats.companies || 0],
    ['Buyer drafts', stats.emails || 0, 'good'],
    ['Public emails', stats.emailable || 0],
  ]);
}

function visibleProblems() {
  const ui = workspace.state;
  const query = ui.search.trim().toLowerCase();
  const rows = state.problems.filter((problem) => {
    if (ui.status && problem.status !== ui.status) return false;
    if (ui.category && problem.sector !== ui.category) return false;
    if (!query) return true;
    const targets = (problem.targets || []).map((target) => (
      `${target.company} ${target.contact_name} ${target.contact_title} ${target.why_them}`
    )).join(' ');
    const signals = (problem.advertised_signals || []).map((signal) => (
      `${signal.company} ${signal.statement} ${signal.consequence}`
    )).join(' ');
    return [
      problem.title,
      problem.sector,
      problem.region,
      problem.one_liner,
      problem.workflow_today,
      problem.outagehub_solution,
      targets,
      signals,
    ].join(' ').toLowerCase().includes(query);
  });

  if (ui.sort === 'targets') {
    return rows.sort((a, b) => (b.targets?.length || 0) - (a.targets?.length || 0)
      || Number(b.score || 0) - Number(a.score || 0));
  }
  if (ui.sort === 'newest') {
    return rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
  return rows.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function renderBoard() {
  workspace.renderFilters(state.problems, { getCategory: (problem) => problem.sector || '' });
  const rows = visibleProblems();
  workspace.renderCount(rows.length, state.problems.length, 'ideas');
  $('#empty').classList.toggle('hidden', rows.length > 0);
  $('#board').innerHTML = rows.map(problemCard).join('');

  $('#board').querySelectorAll('[data-problem-status]').forEach((select) => {
    select.addEventListener('change', () => updateProblemStatus(Number(select.dataset.problemStatus), select.value));
  });
  $('#board').querySelectorAll('[data-target-status]').forEach((select) => {
    select.addEventListener('change', () => updateTargetStatus(Number(select.dataset.targetStatus), select.value));
  });
  $('#board').querySelectorAll('[data-email]').forEach((button) => {
    button.addEventListener('click', () => openEmail(Number(button.dataset.email)));
  });
}

function problemCard(problem) {
  const score = Number(problem.score || 0);
  const scoreClass = score >= 80 ? 'good' : score >= 65 ? 'mid' : '';
  const statusOptions = STATUSES.map((status) => (
    `<option value="${status}" ${problem.status === status ? 'selected' : ''}>${workspace.label(status)}</option>`
  )).join('');
  const sources = (problem.sources || []).map((source, index) => (
    `<a href="${esc(source.url)}" target="_blank" rel="noreferrer" title="${esc(source.note)}">source ${index + 1} ↗</a>`
  )).join('');
  const signals = (problem.advertised_signals || []).map((signal) => (
    `<a href="${esc(signal.url)}" target="_blank" rel="noreferrer" title="${esc(signal.statement)}">${esc(signal.company)} signal ↗</a>`
  )).join('');
  const buyers = (problem.buyer_roles || []).map((role) => `<span class="idea-chip">${esc(role)}</span>`).join('');
  const targets = (problem.targets || []).map(targetCard).join('');

  return `
    <article class="workspace-card idea-card status-${esc(problem.status)}">
      <div class="idea-card-head">
        <div class="idea-score ${scoreClass}">${score}<small>/100</small></div>
        <div class="idea-card-title">
          <h2>${esc(problem.title)}</h2>
          <div class="idea-meta">
            <span class="idea-tag">${esc(problem.sector || 'Uncategorised')}</span>
            <span>${esc(problem.region || 'Canada')}</span>
            <span>· ${esc(problem.confidence || '—')} confidence</span>
            ${problem.problem_origin ? `<span>· ${esc(workspace.label(problem.problem_origin))}</span>` : ''}
          </div>
        </div>
        <select class="idea-status" data-problem-status="${problem.id}" aria-label="Idea status">${statusOptions}</select>
      </div>
      <p class="idea-summary">${esc(problem.one_liner || 'Problem hypothesis not written yet.')}</p>
      <div class="idea-flow">
        <div><span class="workspace-label">Workflow / trigger</span>${esc(problem.workflow_today || '—')}</div>
        <div><span class="workspace-label">What OutageHub adds</span>${esc(problem.outagehub_solution || '—')}</div>
        <div><span class="workspace-label">Measure</span>${esc(problem.measurable || '—')}</div>
      </div>
      <div class="idea-details">
        <div><span class="workspace-label">Likely buyers</span><div class="idea-chips">${buyers || '—'}</div></div>
        <div><span class="workspace-label">Evidence</span><div class="idea-sources">${signals}${sources}</div></div>
      </div>
      <details class="oh-targets" ${(problem.targets || []).length && score >= 65 ? 'open' : ''}>
        <summary>${(problem.targets || []).length} researched compan${(problem.targets || []).length === 1 ? 'y' : 'ies'}
          <span>· named buyer + first touch</span>
        </summary>
        <div class="oh-target-grid">${targets || '<div class="empty-cell">No target companies yet.</div>'}</div>
      </details>
    </article>`;
}

function splitWhy(raw) {
  const text = String(raw || '');
  const marker = text.lastIndexOf(' Source: ');
  if (marker < 0) return { text, source: '' };
  return { text: text.slice(0, marker), source: text.slice(marker + 9).trim() };
}

function targetCard(target) {
  const why = splitWhy(target.why_them);
  const initials = String(target.contact_name || target.contact_title || '?')
    .split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const statusOptions = TARGET_STATUSES.map((status) => (
    `<option value="${status}" ${target.status === status ? 'selected' : ''}>${status}</option>`
  )).join('');
  return `
    <div class="oh-target">
      <div class="oh-target-top">
        <div class="oh-company">
          ${target.domain ? `<a href="https://${esc(target.domain)}" target="_blank" rel="noreferrer">${esc(target.company)} ↗</a>` : esc(target.company)}
          <div class="oh-hq">${esc(target.hq || '')} · ${esc(target.segment || '')}</div>
        </div>
      </div>
      <p>${esc(why.text)} ${why.source ? `<a class="oh-source-inline" href="${esc(why.source)}" target="_blank" rel="noreferrer">evidence ↗</a>` : ''}</p>
      <div class="oh-contact">
        <div class="oh-avatar">${esc(initials)}</div>
        <div class="oh-contact-main">
          <div class="oh-contact-name">${esc(target.contact_name || 'Role to verify')}</div>
          <div class="oh-contact-title" title="${esc(target.contact_title)}">${esc(target.contact_title || '')}</div>
        </div>
        <div class="oh-target-actions">
          <select data-target-status="${target.id}">${statusOptions}</select>
          <button class="btn xsmall" data-email="${target.id}">Email draft</button>
        </div>
      </div>
    </div>`;
}

async function updateProblemStatus(id, status) {
  try {
    await api.patch(`/api/outagehub/problems/${id}`, { status });
    await load();
    toast('Idea status saved', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function updateTargetStatus(id, status) {
  try {
    await api.patch(`/api/outagehub/targets/${id}`, { status });
    const target = findTarget(id);
    if (target) target.status = status;
    toast('Buyer status saved', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

function findTarget(id) {
  for (const problem of state.problems) {
    const target = (problem.targets || []).find((row) => row.id === id);
    if (target) return target;
  }
  return null;
}

function openEmail(id) {
  const target = findTarget(id);
  if (!target) return;
  state.activeTarget = target;
  $('#emailWho').textContent = `${target.contact_name || target.contact_title} · ${target.company}`;
  $('#emailTo').textContent = target.contact_email || 'email address not sourced';
  $('#emailSubject').textContent = target.email_subject || '';
  $('#emailBody').textContent = target.email_body || '';
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

$('#emailClose').addEventListener('click', () => $('#emailModal').classList.add('hidden'));
$('#emailModal').addEventListener('click', (event) => {
  if (event.target === $('#emailModal')) $('#emailModal').classList.add('hidden');
});
$('#copySubject').addEventListener('click', (event) => {
  copyText(state.activeTarget?.email_subject, event.currentTarget);
});
$('#copyEmail').addEventListener('click', (event) => {
  const target = state.activeTarget;
  copyText(`Subject: ${target?.email_subject || ''}\n\n${target?.email_body || ''}`, event.currentTarget);
});

load().catch((error) => toast(`Failed to load: ${error.message}`, 'err'));
