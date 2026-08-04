// GNK product adapter for the shared idea workspace.
const $ = (selector, root = document) => root.querySelector(selector);
const STATUSES = ['idea', 'scoping', 'building', 'shelved'];
const state = { projects: [], editingId: null };

const workspace = IdeaWorkspace.create({
  statuses: STATUSES,
  categoryLabel: 'All sectors',
  sorts: [
    { value: 'fit', label: 'Sort: fit' },
    { value: 'newest', label: 'Sort: newest' },
    { value: 'interest', label: 'Sort: interest' },
  ],
  research: {
    startPath: '/api/gnk/discover',
    statusPath: '/api/gnk/discover/status',
    buttonLabel: 'Find ideas',
    busyButtonLabel: 'Finding ideas…',
    runningLabel: 'Research scouts finding GNK ideas…',
    finishedLabel: 'GNK idea research finished',
  },
  onFilterChange: render,
  onReload: load,
});
const { api, esc, toast } = workspace;

async function load() {
  const data = await api.get('/api/gnk');
  state.projects = data.projects || [];
  render();
  workspace.syncRun(data.run);
}

function fit(project) {
  return Math.max(0, Math.min(10, Number(project.interest || 0) + Number(project.feasibility || 0)));
}

function renderStats() {
  workspace.renderStats([
    ['Ideas', state.projects.length],
    ['High fit', state.projects.filter((project) => fit(project) >= 8).length, 'good'],
    ['Scoping', state.projects.filter((project) => project.status === 'scoping').length, 'good'],
    ['Building', state.projects.filter((project) => project.status === 'building').length, 'good'],
    ['With evidence', state.projects.filter((project) => /https?:\/\//.test(project.links || '')).length],
  ]);
}

function visibleProjects() {
  const ui = workspace.state;
  const query = ui.search.trim().toLowerCase();
  const rows = state.projects.filter((project) => {
    if (ui.status && project.status !== ui.status) return false;
    if (ui.category && project.domain !== ui.category) return false;
    if (!query) return true;
    return [
      project.title,
      project.problem,
      project.domain,
      project.who_affected,
      project.why_it_matters,
      project.what_we_build,
      project.links,
    ].join(' ').toLowerCase().includes(query);
  });

  if (ui.sort === 'newest') {
    return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  if (ui.sort === 'interest') {
    return rows.sort((a, b) => Number(b.interest || 0) - Number(a.interest || 0) || fit(b) - fit(a));
  }
  return rows.sort((a, b) => fit(b) - fit(a) || Number(b.interest || 0) - Number(a.interest || 0));
}

function render() {
  renderStats();
  workspace.renderFilters(state.projects, { getCategory: (project) => project.domain || '' });
  const rows = visibleProjects();
  workspace.renderCount(rows.length, state.projects.length, 'ideas');
  $('#empty').classList.toggle('hidden', rows.length > 0);
  $('#board').innerHTML = rows.map(projectCard).join('');
  $('#board').querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => openModal(Number(button.dataset.edit)));
  });
  $('#board').querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteProject(Number(button.dataset.delete)));
  });
  $('#board').querySelectorAll('[data-project-status]').forEach((select) => {
    select.addEventListener('change', () => updateStatus(Number(select.dataset.projectStatus), select.value));
  });
}

const stars = (number) => {
  const value = Math.round(Math.max(0, Math.min(5, Number(number) || 0)));
  return '★'.repeat(value) + '☆'.repeat(5 - value);
};

function sourceLinks(raw) {
  const links = String(raw || '').match(/https?:\/\/[^\s,]+/g) || [];
  return links.map((url, index) => (
    `<a href="${esc(url)}" target="_blank" rel="noreferrer">source ${index + 1} ↗</a>`
  )).join('');
}

function projectCard(project) {
  const statusOptions = STATUSES.map((status) => (
    `<option value="${status}" ${project.status === status ? 'selected' : ''}>${workspace.label(status)}</option>`
  )).join('');
  const sources = sourceLinks(project.links);
  return `
    <article class="workspace-card idea-card status-${esc(project.status)}">
      <div class="idea-card-head">
        <div class="idea-score ${fit(project) >= 8 ? 'good' : fit(project) >= 6 ? 'mid' : ''}">
          ${fit(project)}<small>/10 fit</small>
        </div>
        <div class="idea-card-title">
          <h2>${esc(project.title)}</h2>
          <div class="idea-meta">
            <span class="idea-tag">${esc(project.domain || 'Uncategorised')}</span>
            <span>GNK idea</span>
            ${project.created_at ? `<span>· added ${esc(String(project.created_at).slice(0, 10))}</span>` : ''}
          </div>
        </div>
        <select class="idea-status" data-project-status="${project.id}" aria-label="Idea status">${statusOptions}</select>
      </div>
      <p class="idea-summary">${esc(project.problem || 'Problem hypothesis not written yet.')}</p>
      <div class="idea-flow">
        <div><span class="workspace-label">Who feels it</span>${esc(project.who_affected || '—')}</div>
        <div><span class="workspace-label">What GNK could build</span>${esc(project.what_we_build || '—')}</div>
        <div><span class="workspace-label">Why it matters</span>${esc(project.why_it_matters || '—')}</div>
      </div>
      <div class="idea-details">
        <div>
          <span class="workspace-label">Human assessment</span>
          <div class="gnk-ratings">
            <span class="idea-chip">Interest <b>${stars(project.interest)}</b></span>
            <span class="idea-chip">Feasibility <b>${stars(project.feasibility)}</b></span>
          </div>
        </div>
        <div>
          <span class="workspace-label">Evidence</span>
          <div class="idea-sources">${sources || '<span class="idea-chip">Source to verify</span>'}</div>
        </div>
      </div>
      <div class="idea-card-actions">
        <button class="idea-link" data-edit="${project.id}">Edit idea</button>
        <button class="idea-link danger" data-delete="${project.id}">Delete</button>
      </div>
    </article>`;
}

function openModal(id) {
  state.editingId = id || null;
  const project = id ? state.projects.find((item) => item.id === id) || {} : {};
  $('#projTitle').textContent = id ? 'Edit idea' : 'New idea';
  $('#f_title').value = project.title || '';
  $('#f_domain').value = project.domain || '';
  $('#f_problem').value = project.problem || '';
  $('#f_who').value = project.who_affected || '';
  $('#f_why').value = project.why_it_matters || '';
  $('#f_build').value = project.what_we_build || '';
  $('#f_interest').value = project.interest ?? 3;
  $('#f_feas').value = project.feasibility ?? 3;
  $('#f_status').value = project.status || 'idea';
  $('#f_links').value = project.links || '';
  $('#projModal').classList.remove('hidden');
}

async function save() {
  const body = {
    title: $('#f_title').value.trim() || 'Untitled',
    domain: $('#f_domain').value.trim(),
    problem: $('#f_problem').value.trim(),
    who_affected: $('#f_who').value.trim(),
    why_it_matters: $('#f_why').value.trim(),
    what_we_build: $('#f_build').value.trim(),
    interest: Number($('#f_interest').value) || 3,
    feasibility: Number($('#f_feas').value) || 3,
    status: $('#f_status').value,
    links: $('#f_links').value.trim(),
  };
  try {
    if (state.editingId) await api.patch(`/api/gnk/${state.editingId}`, body);
    else await api.post('/api/gnk', body);
    $('#projModal').classList.add('hidden');
    await load();
    toast('Idea saved', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function updateStatus(id, status) {
  try {
    await api.patch(`/api/gnk/${id}`, { status });
    await load();
    toast('Idea status saved', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function deleteProject(id) {
  if (!confirm('Delete this idea?')) return;
  try {
    await api.delete(`/api/gnk/${id}`);
    await load();
    toast('Idea deleted', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

$('#addBtn').addEventListener('click', () => openModal(null));
$('#projClose').addEventListener('click', () => $('#projModal').classList.add('hidden'));
$('#projCancel').addEventListener('click', () => $('#projModal').classList.add('hidden'));
$('#projSave').addEventListener('click', save);
$('#projModal').addEventListener('click', (event) => {
  if (event.target === $('#projModal')) $('#projModal').classList.add('hidden');
});

load().catch((error) => toast(`Failed to load: ${error.message}`, 'err'));
