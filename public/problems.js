// Problem Radar front-end. Talks to the /api/problems endpoints. No framework.
'use strict';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUS_LABELS = {
  discovered: 'Discovered', approved: 'Approved', building: 'Building MVP',
  demo_ready: 'Demo ready', in_outreach: 'In outreach', won: 'Won', killed: 'Killed',
};

let state = { problems: [], stats: null, q: '', status: '', sort: 'score' };
let pollTimer = null;

// ---- helpers ----
function money(n) {
  if (n == null || n === '' || isNaN(n)) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${v}`;
}
const range = (lo, hi) => (lo == null && hi == null ? '—' : lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`);
function scoreClass(s) { return s >= 80 ? 'best' : s >= 65 ? 'strong' : s >= 50 ? 'ok' : 'weak'; }

function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind || ''}`;
  setTimeout(() => t.classList.add('hidden'), 3200);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

// ---- rendering ----
function renderStats(stats) {
  if (!stats) return;
  const bs = stats.byStatus || {};
  const cards = [
    { k: 'Problems', v: stats.total || 0, sub: `${bs.discovered || 0} new` },
    { k: 'Qualified (65+)', v: stats.qualified || 0, sub: 'worth a build' },
    { k: 'Building', v: bs.building || 0, sub: 'MVPs in flight' },
    { k: 'In outreach', v: (bs.in_outreach || 0) + (bs.won || 0), sub: `${bs.won || 0} won` },
    { k: 'Pipeline fee', v: range(stats.pipeline_cut_low, stats.pipeline_cut_high), sub: 'our cut, all problems', save: true },
  ];
  $('#statbar').innerHTML = cards
    .map((c) => `<div class="workspace-stat"><div class="k">${c.k}</div><div class="v ${c.save ? 'good' : ''}">${esc(c.v)}</div><div class="sub2">${esc(c.sub)}</div></div>`)
    .join('');
}

function renderStatusFilter(stats) {
  const sel = $('#statusFilter');
  if (sel.options.length > 1) return; // build once
  (stats?.statuses || Object.keys(STATUS_LABELS)).forEach((s) => {
    const o = el('option'); o.value = s; o.textContent = STATUS_LABELS[s] || s; sel.appendChild(o);
  });
}

function matches(p) {
  if (state.status && p.status !== state.status) return false;
  if (!state.q) return true;
  const hay = [p.title, p.sector, p.region, p.one_liner, p.proposed_solution,
    ...(p.target_companies || []).map((c) => c.name),
    ...(p.advertised_signals || []).flatMap((signal) => [
      signal.company, signal.statement, signal.consequence,
    ])].join(' ').toLowerCase();
  return hay.includes(state.q);
}

function sortProblems(list) {
  const key = state.sort;
  return [...list].sort((a, b) => {
    if (key === 'updated_at') return String(b.updated_at).localeCompare(String(a.updated_at));
    return (b[key] || 0) - (a[key] || 0);
  });
}

function card(p) {
  const c = el('article', `pcard ${p.status === 'killed' ? 'killed' : ''}`);
  c.dataset.id = p.id;
  const companies = (p.target_companies || []).slice(0, 6)
    .map((co) => `<span class="chip co"><b>${esc(co.name)}</b> <span>${esc(co.region || '')}</span></span>`).join('');
  const roles = (p.buyer_roles || []).map((r) => `<span class="chip role">${esc(r)}</span>`).join('');
  const bars = (p.score_breakdown || []).map((b) => {
    const pct = b.of ? Math.round((b.points / b.of) * 100) : 0;
    return `<div class="bar"><span class="bl">${esc(b.factor)}</span><span class="bt">${b.points}/${b.of}</span>
      <span class="track"><span class="fill" style="width:${pct}%"></span></span></div>`;
  }).join('');
  const srcs = (p.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>${s.note ? ` <span class="note">— ${esc(s.note)}</span>` : ''}`)
    .map((h) => `<div>${h}</div>`).join('');
  const advertisedSignals = (p.advertised_signals || []).map((signal) => `
    <div>
      <a href="${esc(signal.url)}" target="_blank" rel="noopener"><b>${esc(signal.company)}</b> ↗</a>
      <span class="note">— ${esc(signal.statement)} ${signal.consequence ? `(${esc(signal.consequence)})` : ''} · ${esc(signal.observed_at)} · ${esc(signal.relationship)}</span>
    </div>`).join('');

  // Status is set by the research/discovery pipeline; the card shows it read-only.

  c.innerHTML = `
    <div class="pc-top">
      <div class="pc-score ${scoreClass(p.score || 0)}">${p.score ?? '–'}<small>/100</small></div>
      <div class="pc-headings">
        <div class="pc-title">${esc(p.title)}</div>
        <div class="pc-meta">
          <span>${esc(p.sector || '')}</span><span class="dot">•</span><span>${esc(p.region || '')}</span>
          ${p.confidence ? `<span class="dot">•</span><span class="conf ${esc(p.confidence)}">${esc(p.confidence)} confidence</span>` : ''}
          ${p.recurrence ? `<span class="dot">•</span><span>${esc(p.recurrence)}</span>` : ''}
          ${p.problem_origin ? `<span class="dot">•</span><span>${esc(p.problem_origin.replaceAll('-', ' '))}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="pc-pitch">
      They lose <span class="money cost">${range(p.annual_cost_low, p.annual_cost_high)}</span>/yr.
      We build it and save them <span class="money save">${range(p.savings_low, p.savings_high)}</span>/yr for a
      <span class="money fee">${range(p.our_cut_low, p.our_cut_high)}</span> fee.
      ${p.pricing_basis ? `<div class="basis">${esc(p.pricing_basis)}</div>` : ''}
    </div>

    <div class="pc-oneliner">${esc(p.one_liner || '')}</div>

    ${companies ? `<div class="pc-section"><div class="pc-label">Target companies</div><div class="chips">${companies}</div></div>` : ''}
    ${roles ? `<div class="pc-section"><div class="pc-label">Who buys</div><div class="chips">${roles}</div></div>` : ''}

    <div class="details" data-details>
      ${bars ? `<div class="kv"><div class="pc-label">Why this score</div><div class="bars">${bars}</div></div>` : ''}
      ${kv('The workflow today', p.workflow_today)}
      ${kv('Why it is expensive', p.why_expensive)}
      ${kv('Why software hasn’t fixed it', p.why_unsolved)}
      ${kv('What we’d build', p.proposed_solution)}
      ${kv('Data an MVP needs', p.data_availability)}
      ${kv('Metric we move', p.measurable)}
      ${kv('Cost basis', p.cost_basis)}
      ${kv('The 2-minute demo', p.demo_idea)}
      ${advertisedSignals ? `<div class="kv"><div class="pc-label">Companies advertising this pain</div><div class="srcs">${advertisedSignals}</div></div>` : ''}
      ${srcs ? `<div class="kv"><div class="pc-label">Sources</div><div class="srcs">${srcs}</div></div>` : ''}
    </div>

    <div class="pc-foot">
      <span class="status-badge" data-s="${esc(p.status)}" title="Status is set by the research pipeline">${STATUS_LABELS[p.status] || esc(p.status)}</span>
      <button class="expandbtn" data-act="expand">Details ▾</button>
      <span class="grow"></span>
      ${p.mvp_path ? `<a class="btn small btn-ghost" href="${esc(p.mvp_path)}" target="_blank">Open demo</a>` : ''}
      <button class="btn small btn-primary" data-act="build" ${['building', 'demo_ready', 'in_outreach', 'won'].includes(p.status) ? 'disabled' : ''}>⚙ Build MVP</button>
      <button class="linkbtn" data-act="delete">delete</button>
    </div>`;
  return c;
}

function kv(label, val) {
  if (!val) return '';
  return `<div class="kv"><div class="pc-label">${esc(label)}</div><p>${esc(val)}</p></div>`;
}

function render() {
  const list = sortProblems(state.problems.filter(matches));
  const board = $('#board');
  board.innerHTML = '';
  list.forEach((p) => board.appendChild(card(p)));
  $('#empty').classList.toggle('hidden', state.problems.length !== 0);
  $('#runCount').textContent = state.problems.length
    ? `${list.length} shown / ${state.problems.length} total` : '';
}

async function load() {
  try {
    const { problems, stats } = await api('GET', '/api/problems');
    state.problems = problems;
    state.stats = stats;
    renderStats(stats);
    renderStatusFilter(stats);
    render();
  } catch (e) { toast(`Load failed: ${e.message}`, 'err'); }
}

// ---- actions ----
$('#board').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const cardEl = ev.target.closest('.pcard');
  const id = Number(cardEl.dataset.id);
  const act = btn.dataset.act;

  if (act === 'expand') {
    const d = cardEl.querySelector('[data-details]');
    const open = d.classList.toggle('open');
    btn.textContent = open ? 'Details ▴' : 'Details ▾';
    return;
  }
  if (act === 'build') {
    btn.disabled = true; btn.textContent = '⚙ Queuing…';
    try {
      await api('POST', `/api/problems/${id}/build`);
      toast('Queued for the autonomous MVP factory.', 'ok');
      await load();
    } catch (e) { toast(`Build failed: ${e.message}`, 'err'); btn.disabled = false; btn.textContent = '⚙ Build MVP'; }
    return;
  }
  if (act === 'delete') {
    if (!confirm('Delete this problem from the backlog?')) return;
    try { await api('DELETE', `/api/problems/${id}`); await load(); } catch (e) { toast(e.message, 'err'); }
  }
});

// Problem status is set by the research/discovery pipeline and is read-only in the UI.

// ---- discovery run ----
$('#discoverBtn').addEventListener('click', async () => {
  const count = Math.min(Math.max(Number($('#discoverCount').value) || 6, 1), 12);
  $('#discoverBtn').disabled = true;
  try {
    await api('POST', '/api/problems/discover', { count });
    $('#runPanel').classList.remove('hidden');
    $('#runLog').textContent = '';
    startPolling();
    toast(`Research scouts hunting for ${count} problems…`, 'ok');
  } catch (e) {
    toast(e.message, 'err');
    $('#discoverBtn').disabled = false;
  }
});
$('#runHide').addEventListener('click', () => $('#runPanel').classList.add('hidden'));

function paintLog(run) {
  const lines = (run.log || []).map((l) => {
    const cls = /done\.|auto-approved|→ \d+\/100/.test(l) ? 'ok' : /failed|error|fatal/i.test(l) ? 'warn' : '';
    return cls ? `<span class="${cls}">${esc(l)}</span>` : esc(l);
  });
  const logEl = $('#runLog');
  logEl.innerHTML = lines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
  $('#runTitle').textContent = run.running ? 'Research scouts running…' : `Research scouts finished (exit ${run.exitCode ?? '—'})`;
  $('#runSpin').style.visibility = run.running ? 'visible' : 'hidden';
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const run = await api('GET', '/api/problems/discover/status');
      paintLog(run);
      if (!run.running) {
        clearInterval(pollTimer);
        $('#discoverBtn').disabled = false;
        await load();
      }
    } catch { /* transient */ }
  }, 1500);
}

// ---- filters ----
$('#search').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
$('#statusFilter').addEventListener('change', (e) => { state.status = e.target.value; render(); });
$('#sortBy').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

// If a run is already in progress when the page loads, resume streaming.
(async () => {
  await load();
  try {
    const run = await api('GET', '/api/problems/discover/status');
    if (run.running) { $('#runPanel').classList.remove('hidden'); $('#discoverBtn').disabled = true; paintLog(run); startPolling(); }
  } catch { /* ignore */ }
})();
