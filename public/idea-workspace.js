// Shared controller for product idea workspaces.
// Each product supplies its data model and card renderer; this owns the common
// research, filtering, stats, run-log and feedback interface.
(function attachIdeaWorkspace(global) {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ));
  const label = (value) => String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

  const api = {
    async request(method, path, body) {
      const response = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.reason || `${response.status} error`);
      return data;
    },
    get(path) { return api.request('GET', path); },
    post(path, body) { return api.request('POST', path, body); },
    patch(path, body) { return api.request('PATCH', path, body); },
    delete(path) { return api.request('DELETE', path); },
  };

  function create(options) {
    const statuses = (options.statuses || []).map((status) => (
      typeof status === 'string' ? { value: status, label: label(status) } : status
    ));
    const state = {
      search: '',
      status: '',
      category: '',
      sort: options.sorts?.[0]?.value || '',
      run: null,
      poll: null,
      runHidden: false,
    };

    function toast(message, kind = '') {
      const node = $('#toast');
      if (!node) return;
      node.textContent = message;
      node.className = `toast ${kind}`;
      node.classList.remove('hidden');
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => node.classList.add('hidden'), 3600);
    }

    function renderStats(items) {
      const node = $('#statbar');
      if (!node) return;
      node.innerHTML = items.map((item) => {
        const [key, value, className = '', sub = ''] = item;
        return `<div class="workspace-stat">
          <div class="k">${esc(key)}</div>
          <div class="v ${esc(className)}">${esc(value)}</div>
          ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
        </div>`;
      }).join('');
    }

    function renderFilters(items, {
      getCategory = () => '',
      getStatus = (item) => item.status,
    } = {}) {
      const segments = $('#statusSeg');
      if (segments) {
        const all = [{ value: '', label: 'All' }, ...statuses];
        segments.innerHTML = all.map((status) => {
          const count = status.value
            ? items.filter((item) => getStatus(item) === status.value).length
            : items.length;
          return `<button type="button" class="${state.status === status.value ? 'on' : ''}" data-status-filter="${esc(status.value)}">
            ${esc(status.label)} <span>${count}</span>
          </button>`;
        }).join('');
      }

      const categorySelect = $('#categoryFilter');
      if (categorySelect) {
        const categories = [...new Set(items.map(getCategory).filter(Boolean))].sort((a, b) => (
          String(a).localeCompare(String(b))
        ));
        if (state.category && !categories.includes(state.category)) state.category = '';
        categorySelect.innerHTML = `<option value="">${esc(options.categoryLabel || 'All categories')}</option>`
          + categories.map((category) => (
            `<option value="${esc(category)}" ${state.category === category ? 'selected' : ''}>${esc(category)}</option>`
          )).join('');
      }

      const sortSelect = $('#sortBy');
      if (sortSelect && options.sorts) {
        sortSelect.innerHTML = options.sorts.map((sort) => (
          `<option value="${esc(sort.value)}" ${state.sort === sort.value ? 'selected' : ''}>${esc(sort.label)}</option>`
        )).join('');
      }
    }

    function renderCount(visible, total, noun = 'ideas') {
      const node = $('#visibleCount');
      if (node) node.textContent = `${visible} of ${total} ${noun}`;
    }

    function showRun(run, { reveal = false } = {}) {
      state.run = run;
      if (reveal) state.runHidden = false;
      const panel = $('#runPanel');
      if (!panel) return;
      const hasHistory = run?.running || run?.startedAt || run?.finishedAt || run?.log?.length;
      panel.classList.toggle('hidden', !hasHistory || state.runHidden);
      if (!hasHistory) return;

      $('#runSpin')?.classList.toggle('spin', !!run.running);
      const titleNode = $('#runTitle');
      if (titleNode) {
        titleNode.textContent = run.running
          ? options.research?.runningLabel || 'Research scouts finding ideas…'
          : `${options.research?.finishedLabel || 'Idea research finished'}${run.exitCode === 0 ? '' : ` (exit ${run.exitCode})`}`;
      }
      const log = $('#runLog');
      if (log) {
        log.textContent = (run.log || []).join('\n');
        log.scrollTop = log.scrollHeight;
      }
      const button = $('#discoverBtn');
      if (button) {
        button.disabled = !!run.running;
        button.textContent = run.running
          ? options.research?.busyButtonLabel || 'Finding ideas…'
          : options.research?.buttonLabel || 'Find ideas';
      }
    }

    function stopPolling() {
      clearInterval(state.poll);
      state.poll = null;
    }

    async function pollRun() {
      try {
        const run = await api.get(options.research.statusPath);
        showRun(run);
        if (!run.running) {
          stopPolling();
          await options.onReload();
        }
      } catch (error) {
        stopPolling();
        toast(error.message, 'err');
      }
    }

    function startPolling() {
      stopPolling();
      state.poll = setInterval(pollRun, options.research.pollMs || 1800);
    }

    async function startResearch() {
      try {
        const countInput = $('#discoverCount');
        const count = Math.min(Math.max(Number(countInput?.value) || 6, 1), 12);
        await api.post(options.research.startPath, { count });
        showRun({
          running: true,
          startedAt: new Date().toISOString(),
          log: ['Research scouts starting…'],
        }, { reveal: true });
        startPolling();
      } catch (error) {
        toast(error.message, 'err');
      }
    }

    function syncRun(run) {
      state.run = run || {};
      if (run?.running) {
        showRun(run);
        if (!state.poll) startPolling();
      }
    }

    $('#search')?.addEventListener('input', (event) => {
      state.search = event.target.value;
      options.onFilterChange();
    });
    $('#statusSeg')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-status-filter]');
      if (!button) return;
      state.status = button.dataset.statusFilter;
      options.onFilterChange();
    });
    $('#categoryFilter')?.addEventListener('change', (event) => {
      state.category = event.target.value;
      options.onFilterChange();
    });
    $('#sortBy')?.addEventListener('change', (event) => {
      state.sort = event.target.value;
      options.onFilterChange();
    });
    $('#discoverBtn')?.addEventListener('click', startResearch);
    $('#runHide')?.addEventListener('click', () => {
      state.runHidden = true;
      $('#runPanel')?.classList.add('hidden');
    });
    global.addEventListener('beforeunload', stopPolling);

    return {
      state,
      api,
      esc,
      label,
      toast,
      renderStats,
      renderFilters,
      renderCount,
      syncRun,
    };
  }

  global.IdeaWorkspace = { create };
}(window));
