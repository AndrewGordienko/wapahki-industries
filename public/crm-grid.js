// Wahpaki CRM: one system with two spreadsheet views.
// Contacts is the execution surface for messages. Deals is the account-level
// strategy sheet that gives those messages a commercial job to do.

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
));
const trunc = (value, length) => (
  value && value.length > length ? `${value.slice(0, length - 1)}…` : (value || '')
);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const num = (value) => (value || 0).toLocaleString('en-US');
const DAY_MS = 86_400_000;
const CALENDAR_BUSINESSES = ['wapahki', 'gnk', 'outagehub'];
const CALENDAR_LABELS = { wapahki: 'Wapahki', gnk: 'GnK', outagehub: 'OHUB' };
const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';

const CONTACT_FILTERS = [
  { value: '', label: 'All' },
  { value: 'complete', label: 'Reviewed' },
  { value: 'incomplete', label: 'Needs work' },
  { value: 'ready', label: 'Next send ready' },
  { value: 'sent', label: 'Sent' },
  { value: 'replied', label: 'Replied' },
];
const DEAL_FILTERS = [
  { value: '', label: 'All deals' },
  { value: 'needs_context', label: 'Missing context' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'active', label: 'Active' },
];
const PERSON_STATUS = ['new', 'queued', 'emailed', 'replied', 'not_interested'];
const PURSUIT_TYPES = [
  ['pilot_customer', 'Pilot customer'],
  ['technology_partner', 'Technology partner'],
  ['channel_partner', 'Channel partner'],
  ['strategic_partner', 'Strategic partner'],
];
const SUPPORTED_GEN = new Set(['wapahki', 'gnk', 'outagehub']);
const expectedTouchCount = (row) => Number(
  row?.expected_touch_count || 7,
);

const pageUrl = new URL(location.href);
function startOfWeek(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}
function initialCalendarWeek() {
  const now = new Date();
  const week = startOfWeek(now);
  if ([0, 6].includes(now.getDay())) week.setDate(week.getDate() + 7);
  return week;
}
function localDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function calendarDate(value, options = {}) {
  return new Intl.DateTimeFormat('en-GB', options).format(new Date(value));
}
function calendarTime(value) {
  return calendarDate(value, { hour: 'numeric', minute: '2-digit', hour12: true });
}

const state = {
  view: pageUrl.searchParams.get('view') === 'deals' ? 'deals' : 'contacts',
  business: pageUrl.searchParams.get('business') === 'calendar'
    ? ''
    : (pageUrl.searchParams.get('business') || 'wapahki'),
  search: pageUrl.searchParams.get('search') || '',
  status: '',
  businesses: [],
  rows: [],
  calendarWeek: initialCalendarWeek(),
  calendarEvents: [],
  calendarSummary: null,
  calendarAutomation: null,
  calendarSlots: new Map(),
  calendarBusinesses: new Set(CALENDAR_BUSINESSES),
  openCalendarSlot: null,
  openCalendarEvent: null,
  openCalendarDay: null,
  openPerson: null,
  generating: new Set(),
};

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

let toastTimer;
function toast(message, kind = 'ok') {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.add('hidden'), 3000);
}

function syncUrl() {
  const url = new URL(location.href);
  if (state.view === 'deals') url.searchParams.set('view', 'deals');
  else url.searchParams.delete('view');
  if (state.business) url.searchParams.set('business', state.business);
  else url.searchParams.set('business', 'calendar');
  if (state.search) url.searchParams.set('search', state.search);
  else url.searchParams.delete('search');
  history.replaceState(null, '', url);
}

// ---- Data ---------------------------------------------------------------
async function load({ silent = false } = {}) {
  if (!silent) $('#host').innerHTML = '<div class="sheet-loading">Loading…</div>';
  try {
    let data;
    if (!state.business) {
      const start = new Date(state.calendarWeek);
      const end = new Date(start.getTime() + (7 * DAY_MS));
      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
        search: state.search,
      });
      data = await api(`/api/crm/calendar?${params}`);
      state.calendarEvents = data.events;
      state.calendarSummary = data.summary;
      state.calendarAutomation = data.automation;
      state.rows = [];
    } else {
      const params = new URLSearchParams({
        business: state.business,
        search: state.search,
        status: state.status,
      });
      const endpoint = state.view === 'deals' ? '/api/crm/deals' : '/api/crm';
      data = await api(`${endpoint}?${params}`);
      state.rows = data.rows;
    }
    state.businesses = data.businesses;
    renderViewSwitch();
    renderTabs();
    renderHeader();
    renderFilters();
    renderSheet();
  } catch (error) {
    $('#host').innerHTML = `<div class="sheet-loading">${esc(error.message)}</div>`;
  }
}

// ---- Header / tabs / filters -------------------------------------------
function renderViewSwitch() {
  if (!state.business) {
    $('#viewSwitch').innerHTML = '<span class="calendar-mode">Email schedule</span>';
    return;
  }
  $('#viewSwitch').innerHTML = [
    ['contacts', 'Contacts'],
    ['deals', 'Deals'],
  ].map(([value, label]) => (
    `<button class="view-button ${state.view === value ? 'active' : ''}" data-view="${value}">${label}</button>`
  )).join('');
  $$('#viewSwitch [data-view]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.view === state.view) return;
    state.view = button.dataset.view;
    state.status = '';
    state.openPerson = null;
    syncUrl();
    load();
  }));
}

function renderTabs() {
  const tabs = [...state.businesses, { key: '', label: 'Calendar', calendar: true }];
  $('#bizTabs').innerHTML = tabs.map((business) => {
    const key = state.view === 'deals' ? 'accounts' : 'contacts';
    const count = business.key
      ? business[key]
      : (state.calendarSummary?.total || 0);
    const countHtml = business.calendar && !state.calendarSummary ? '' : `<span class="count">${num(count)}</span>`;
    return `<button class="biz-tab ${business.key === state.business ? 'active' : ''}" data-biz="${esc(business.key)}">
      ${business.calendar ? '<span class="cal-tab-dot"></span>' : ''}${esc(business.label)}${countHtml}
    </button>`;
  }).join('');
  $$('#bizTabs .biz-tab').forEach((button) => button.addEventListener('click', () => {
    state.business = button.dataset.biz;
    state.status = '';
    syncUrl();
    load();
  }));
}

function renderHeader() {
  if (!state.business) {
    const events = visibleCalendarEvents();
    const counts = calendarCounts(events);
    $('#bizTitle').textContent = 'Email calendar';
    $('#bizTagline').textContent = `Every scheduled email across the three businesses. Times shown in ${viewerTimeZone}.`;
    $('#bizStats').innerHTML = statBlocks([
      ['scheduled', counts.total],
      ['Wapahki', counts.by_business.wapahki, true],
      ['GnK', counts.by_business.gnk, true],
      ['OHUB', counts.by_business.outagehub, true],
      ['approved', counts.approved, true],
    ]);
    $('#search').placeholder = 'Search scheduled emails, people, companies…';
    $('#search').value = state.search;
    return;
  }
  const business = state.businesses.find((item) => item.key === state.business);
  if (business) {
    $('#bizTitle').textContent = state.view === 'deals' ? `${business.full} deals` : business.full;
    $('#bizTagline').textContent = state.view === 'deals'
      ? 'Deal strategy, primary route and live message activity in one account sheet.'
      : business.tagline;
    $('#bizStats').innerHTML = statBlocks(state.view === 'deals' ? [
      ['accounts', business.accounts], ['contacts', business.contacts], ['messages', business.messages],
      ['sent', business.sent, true], ['replied', business.replied, true],
    ] : [
      ['accounts', business.accounts], ['contacts', business.contacts],
      [`${business.sequence_size}/${business.sequence_size} reviewed`, business.complete_sequences, true], ['need work', business.incomplete_contacts],
      ['replied', business.replied, true],
    ]);
  } else {
    const sum = (key) => state.businesses.reduce((total, item) => total + (item[key] || 0), 0);
    $('#bizTitle').textContent = state.view === 'deals' ? 'All deals' : 'All businesses';
    $('#bizTagline').textContent = state.view === 'deals'
      ? 'Every account strategy cross-referenced with the contacts and messages already in the CRM.'
      : 'Wapahki, GnK and OutageHub: three books of business, one sheet.';
    $('#bizStats').innerHTML = statBlocks(state.view === 'deals' ? [
      ['accounts', sum('accounts')], ['contacts', sum('contacts')], ['messages', sum('messages')],
      ['sent', sum('sent'), true], ['replied', sum('replied'), true],
    ] : [
      ['accounts', sum('accounts')], ['contacts', sum('contacts')],
      ['reviewed', sum('complete_sequences'), true], ['need work', sum('incomplete_contacts')],
      ['replied', sum('replied'), true],
    ]);
  }
  $('#search').placeholder = state.view === 'deals'
    ? 'Search accounts, problems, commitments…'
    : 'Search accounts, people, titles…';
  $('#search').value = state.search;
}

function statBlocks(items) {
  return items.map(([label, value, accent]) => `
    <div class="stat"><div class="n ${accent ? 'accent' : ''}">${num(value)}</div><div class="l">${label}</div></div>`).join('');
}

function renderFilters() {
  if (!state.business) {
    renderCalendarFilters();
    return;
  }
  $('#statusFilters').className = 'segmented';
  const filters = state.view === 'deals' ? DEAL_FILTERS : CONTACT_FILTERS;
  $('#statusFilters').innerHTML = filters.map((filter) => (
    `<button class="seg ${filter.value === state.status ? 'active' : ''}" data-status="${filter.value}">${filter.label}</button>`
  )).join('');
  $$('#statusFilters .seg').forEach((button) => button.addEventListener('click', () => {
    state.status = button.dataset.status;
    load();
  }));
  const exportButton = $('#exportSheet');
  exportButton.classList.toggle('hidden', state.view === 'deals');
  const exportParams = new URLSearchParams({
    business: state.business,
    search: state.search,
    status: state.status,
  });
  exportButton.href = `/api/crm/export.csv?${exportParams}`;
}

// ---- All-business email calendar --------------------------------------
function visibleCalendarEvents() {
  return state.calendarEvents.filter((event) => state.calendarBusinesses.has(event.business));
}

function calendarCounts(events = visibleCalendarEvents()) {
  const counts = {
    total: events.length,
    draft: 0,
    approved: 0,
    sent: 0,
    blocked: 0,
    by_business: { wapahki: 0, gnk: 0, outagehub: 0 },
  };
  for (const event of events) {
    if (counts[event.delivery_status] != null) counts[event.delivery_status] += 1;
    if (counts.by_business[event.business] != null) counts.by_business[event.business] += 1;
  }
  return counts;
}

function renderCalendarFilters() {
  const start = new Date(state.calendarWeek);
  const end = new Date(start.getTime() + (6 * DAY_MS));
  const label = `${calendarDate(start, { day: 'numeric', month: 'short' })} – ${calendarDate(end, {
    day: 'numeric', month: 'short', year: 'numeric',
  })}`;
  const host = $('#statusFilters');
  host.className = 'calendar-controls';
  host.innerHTML = `
    <div class="week-nav" aria-label="Calendar week">
      <button class="cal-nav-btn" data-week-prev aria-label="Previous week">‹</button>
      <button class="cal-today" data-week-today>Today</button>
      <button class="cal-nav-btn" data-week-next aria-label="Next week">›</button>
      <span class="week-label">${esc(label)}</span>
    </div>
    <div class="calendar-legend" aria-label="Businesses shown">
      ${CALENDAR_BUSINESSES.map((business) => `
        <button class="legend-filter biz-${business} ${state.calendarBusinesses.has(business) ? 'active' : ''}"
          data-calendar-business="${business}" aria-pressed="${state.calendarBusinesses.has(business)}">
          <span></span>${CALENDAR_LABELS[business]}
        </button>`).join('')}
    </div>`;
  $('[data-week-prev]', host).addEventListener('click', () => changeCalendarWeek(-7));
  $('[data-week-next]', host).addEventListener('click', () => changeCalendarWeek(7));
  $('[data-week-today]', host).addEventListener('click', () => {
    state.calendarWeek = initialCalendarWeek();
    load();
  });
  $$('[data-calendar-business]', host).forEach((button) => button.addEventListener('click', () => {
    const business = button.dataset.calendarBusiness;
    if (state.calendarBusinesses.has(business)) state.calendarBusinesses.delete(business);
    else state.calendarBusinesses.add(business);
    renderHeader();
    renderCalendarFilters();
    renderCalendar();
  }));
  $('#exportSheet').classList.add('hidden');
  const counts = calendarCounts();
  $('#rowMeta').textContent = `${num(counts.total)} emails · ${viewerTimeZone}`;
}

function changeCalendarWeek(days) {
  state.calendarWeek = new Date(state.calendarWeek.getTime() + (days * DAY_MS));
  load();
}

function calendarSlots(events) {
  const slots = new Map();
  for (const event of events) {
    const instant = new Date(event.scheduled_for);
    const id = `${event.business}|${instant.toISOString()}`;
    if (!slots.has(id)) slots.set(id, {
      id,
      business: event.business,
      scheduled_for: instant.toISOString(),
      events: [],
    });
    slots.get(id).events.push(event);
  }
  return [...slots.values()].sort((left, right) => (
    new Date(left.scheduled_for) - new Date(right.scheduled_for)
      || CALENDAR_BUSINESSES.indexOf(left.business) - CALENDAR_BUSINESSES.indexOf(right.business)
  ));
}

function slotMeta(slot) {
  const counts = calendarCounts(slot.events);
  const companies = new Set(slot.events.map((event) => event.company_id)).size;
  const touches = [...new Set(slot.events.map((event) => Number(event.touch)))].sort((a, b) => a - b);
  return { counts, companies, touches };
}

function calendarBatch(slot) {
  const { counts, companies, touches } = slotMeta(slot);
  const status = [
    counts.approved ? `${num(counts.approved)} approved` : '',
    counts.draft ? `${num(counts.draft)} drafts` : '',
    counts.sent ? `${num(counts.sent)} sent` : '',
    counts.blocked ? `${num(counts.blocked)} blocked` : '',
  ].filter(Boolean).join(' · ');
  const touchLabel = touches.length === 1 ? `T${touches[0]}` : `${touches.length} touches`;
  return `<button class="calendar-batch biz-${esc(slot.business)}" data-calendar-slot="${esc(slot.id)}">
    <div class="batch-top"><span class="batch-time">${esc(calendarTime(slot.scheduled_for))}</span><span class="batch-brand">${CALENDAR_LABELS[slot.business]}</span></div>
    <div class="batch-count">${num(slot.events.length)} <span>email${slot.events.length === 1 ? '' : 's'}</span></div>
    <div class="batch-meta">${touchLabel} · ${num(companies)} compan${companies === 1 ? 'y' : 'ies'}</div>
    <div class="batch-status">${esc(status || 'Scheduled')}</div>
  </button>`;
}

function renderCalendar() {
  $('#emptyState').classList.add('hidden');
  const events = visibleCalendarEvents();
  const counts = calendarCounts(events);
  const slots = calendarSlots(events);
  state.calendarSlots = new Map(slots.map((slot) => [slot.id, slot]));
  const days = Array.from({ length: 7 }, (_, index) => new Date(state.calendarWeek.getTime() + (index * DAY_MS)));
  const slotsByDay = new Map(days.map((day) => [localDateKey(day), []]));
  for (const slot of slots) {
    const key = localDateKey(slot.scheduled_for);
    if (slotsByDay.has(key)) slotsByDay.get(key).push(slot);
  }
  const today = localDateKey(new Date());
  const automation = state.calendarAutomation || {};
  $('#host').innerHTML = `
    <section class="automation-banner">
      <div class="automation-state"><span class="automation-pulse"></span><strong>Draft schedule</strong></div>
      <p>Nothing sends automatically yet. Emails stay in review until a sender service is connected and each item is approved.</p>
      <div class="automation-badges">
        <span>${num(automation.daily_cap_per_business || 30)} max / brand / day</span>
        <span>Weekends: explicit person suggestion only</span>
        <span>${num(counts.draft)} in review</span>
        <span>${num(counts.approved)} approved</span>
        ${counts.blocked ? `<span class="warn">${num(counts.blocked)} blocked</span>` : ''}
        <span class="muted">${automation.sender_connected ? 'Sender connected' : 'Sender not connected'}</span>
      </div>
    </section>
    <div class="calendar-week" role="grid" aria-label="Scheduled email week">
      ${days.map((day) => {
        const key = localDateKey(day);
        const daySlots = slotsByDay.get(key) || [];
        const dayTotal = daySlots.reduce((sum, slot) => sum + slot.events.length, 0);
        const dayCompanies = new Set(daySlots.flatMap((slot) => slot.events.map((event) => event.company_id))).size;
        const head = dayTotal
          ? `<button class="calendar-day-head is-open" data-calendar-day="${key}" title="Open the full send list for this day">
            <span class="day-name">${calendarDate(day, { weekday: 'short' })}</span>
            <span class="day-number">${day.getDate()}</span>
            <span class="day-total">${num(dayTotal)} emails · ${num(dayCompanies)} compan${dayCompanies === 1 ? 'y' : 'ies'} <span class="day-open-hint">view list →</span></span>
          </button>`
          : `<header class="calendar-day-head">
            <span class="day-name">${calendarDate(day, { weekday: 'short' })}</span>
            <span class="day-number">${day.getDate()}</span>
            <span class="day-total">No sends</span>
          </header>`;
        return `<section class="calendar-day ${key === today ? 'today' : ''} ${[0, 6].includes(day.getDay()) ? 'weekend' : ''}" role="gridcell">
          ${head}
          <div class="calendar-day-body">${daySlots.length
    ? daySlots.map(calendarBatch).join('')
    : '<div class="no-sends"><span>—</span><p>Nothing scheduled</p></div>'}</div>
        </section>`;
      }).join('')}
    </div>`;
  $$('#host [data-calendar-day]').forEach((button) => button.addEventListener('click', () => {
    openCalendarDay(button.dataset.calendarDay);
  }));
  $$('#host [data-calendar-slot]').forEach((button) => button.addEventListener('click', () => {
    openCalendarSlot(button.dataset.calendarSlot);
  }));
  $('#rowMeta').textContent = `${num(counts.total)} emails · ${num(slots.length)} send windows · ${viewerTimeZone}`;
}

// ---- Spreadsheets -------------------------------------------------------
function renderSheet() {
  if (!state.business) {
    renderCalendar();
    return;
  }
  if (!state.rows.length) {
    $('#host').innerHTML = '';
    $('#emptyState').classList.remove('hidden');
    $('#emptyState').innerHTML = state.view === 'deals'
      ? '<h2>No deals here</h2><p>Try another business, clear the filter, or widen your search.</p>'
      : '<h2>No contacts here</h2><p>Try another business, clear the filter, or widen your search.</p>';
    $('#rowMeta').textContent = '';
    return;
  }
  $('#emptyState').classList.add('hidden');
  if (state.view === 'deals') renderDealSheet();
  else renderContactSheet();
}

function renderContactSheet() {
  const groups = [];
  const byId = new Map();
  for (const row of state.rows) {
    let group = byId.get(row.company_id);
    if (!group) {
      group = { company: row, people: [] };
      byId.set(row.company_id, group);
      groups.push(group);
    }
    group.people.push(row);
  }
  const complete = state.rows.filter((row) => row.sequence_complete).length;
  const sequenceSize = Number(
    state.businesses.find((business) => business.key === state.business)?.sequence_size || 7,
  );
  const touchNumbers = Array.from({ length: sequenceSize }, (_, index) => index + 1);
  $('#rowMeta').textContent = `${num(groups.length)} account${groups.length === 1 ? '' : 's'} · ${num(state.rows.length)} contacts · ${num(complete)} reviewed`;
  $('#host').innerHTML = `
    <table class="sheet contact-sheet">
      <colgroup>
        <col class="c-company" /><col class="c-problem" /><col class="c-person" /><col class="c-title" />
        <col class="c-email" /><col class="c-linkedin" /><col class="c-why" /><col class="c-status" />
        ${touchNumbers.map(() => '<col class="c-touch" />').join('')}
      </colgroup>
      <thead><tr>
        <th class="pin">Company</th><th>Problem / hypothesis</th><th>Person</th><th>Title</th>
        <th>Email</th><th>in</th><th>Why they might reply</th><th>Status</th>
        ${touchNumbers.map((touch) => `<th>T${touch}</th>`).join('')}
      </tr></thead>
      <tbody>${groups.map((group, index) => companyRows(group, index)).join('')}</tbody>
    </table>`;
  wireContactSheet();
}

function companyRows(group, index) {
  const parity = index % 2 ? 'alt' : '';
  const company = group.company;
  const count = group.people.length;
  const sub = [company.industry, company.city || company.location].filter(Boolean).join(' · ');
  let hostname = '';
  try { hostname = company.website ? new URL(company.website).host.replace(/^www\./, '') : ''; } catch { hostname = ''; }
  const domain = hostname
    ? `<a class="s-domain" href="${esc(company.website)}" target="_blank" rel="noopener">${esc(hostname)} ↗</a>`
    : '';
  const companyCell = `<td class="s-company pin ${parity}" rowspan="${count}">
    <div class="s-co-name">${esc(company.company_name)}</div>
    ${sub ? `<div class="s-sub">${esc(sub)}</div>` : ''}${domain}</td>`;
  const problem = company.pursuit_problem || company.hypothesis;
  const problemContent = company.commercial_problem
    ? commercialProblemHtml(company.commercial_problem)
    : problem ? esc(trunc(problem, 220)) : '<span class="dim">Add in Deals</span>';
  const problemCell = `<td class="s-problem ${parity}" rowspan="${count}">${problemContent}</td>`;
  return group.people.map((person, personIndex) => (
    `<tr class="${personIndex === 0 ? 'co-start' : ''} ${parity}" data-pid="${person.person_id}">
      ${personIndex === 0 ? companyCell + problemCell : ''}${personCells(person)}</tr>`
  )).join('');
}

function commercialProblemHtml(problem) {
  const section = (label, value, className = '') => value
    ? `<div class="cp-section ${className}"><span>${esc(label)}</span><p>${esc(value)}</p></div>`
    : '';
  return `<div class="commercial-problem">
    <div class="cp-title">${esc(problem.title || 'Software problem to validate')}</div>
    ${section('Costly problem', problem.problem)}
    ${section('Economic case', problem.economic_case, 'economics')}
    ${section('Cost basis', problem.cost_basis)}
    ${section('Potential upside', problem.potential_savings)}
    ${section(problem.solution_label || 'What would change', problem.what_we_build, 'solution')}
    ${section('Commercial entry', problem.commercial_entry)}
    ${section('Evidence / fit', problem.observed, 'evidence')}
  </div>`;
}

function personCells(person) {
  const status = person.status || 'new';
  const emailStatus = (person.email_status || '').toLowerCase();
  const email = person.email
    ? `<a href="mailto:${esc(person.email)}" title="${esc(person.email)}"><span class="dot ${esc(emailStatus)}"></span>${esc(person.email)}</a>`
    : '<span class="dim">—</span>';
  const linkedin = person.linkedin_url
    ? `<a class="s-li" href="${esc(person.linkedin_url)}" target="_blank" rel="noopener">in ↗</a>`
    : '<span class="dim">—</span>';
  return `
    <td class="s-person"><button class="person-link" data-seq="${person.person_id}">${esc(person.name || '—')}</button></td>
    <td class="s-title">${esc(person.title || '')}</td>
    <td class="s-email">${email}</td>
    <td class="s-linkedin">${linkedin}</td>
    <td class="s-why">${esc(trunc(person.relevance_reason || '', 180))}</td>
    <td class="s-statuscell">
      <select class="s-status status-${esc(status)}" data-person-status="${person.person_id}">
        ${PERSON_STATUS.map((value) => `<option value="${value}" ${value === status ? 'selected' : ''}>${value.replace('_', ' ')}</option>`).join('')}
      </select>
    </td>
    ${touchCells(person)}`;
}

function touchCells(person) {
  const byTouch = {};
  person.messages.forEach((message) => { byTouch[message.touch] = message; });
  return Array.from({ length: expectedTouchCount(person) }, (_, index) => index + 1).map((touch) => {
    const message = byTouch[touch];
    if (!message) {
      return `<td class="s-touch empty-touch" ${touch === 1 ? `data-seq="${person.person_id}" title="Write messages"` : ''}>
        <span class="ttag pending">${touch === 1 && canWrite(person) ? `+ write ${expectedTouchCount(person)}` : `T${touch}`}</span></td>`;
    }
    const linkedin = message.channel === 'linkedin';
    const sent = message.status === 'sent';
    const raw = (message.subject ? `${message.subject} — ` : '') + (message.body || '').replace(/\s+/g, ' ').trim();
    const timing = message.scheduled_local || message.send_window || '';
    return `<td class="s-touch ${linkedin ? 'li' : 'em'} ${sent ? 'sent' : ''}" data-seq="${person.person_id}" title="${esc(timing || 'Open, edit or copy the full message')}">
      <span class="ttag">${linkedin ? 'in' : '✉'} T${touch}${sent ? ' ✓' : ''}</span>${timing ? `<span class="touch-time">${esc(timing)}</span>` : ''}${esc(trunc(raw, 150))}</td>`;
  }).join('');
}

function wireContactSheet() {
  $$('#host [data-seq]').forEach((element) => element.addEventListener('click', () => {
    showSequence(Number(element.dataset.seq));
  }));
  $$('#host [data-person-status]').forEach((select) => select.addEventListener('change', () => {
    setPersonStatus(Number(select.dataset.personStatus), select.value, select);
  }));
}

function renderDealSheet() {
  $('#rowMeta').textContent = `${num(state.rows.length)} deal${state.rows.length === 1 ? '' : 's'} · edit cells directly`; 
  $('#host').innerHTML = `
    <table class="sheet deal-sheet">
      <colgroup>
        <col class="d-account" /><col class="d-motion" /><col class="d-problem" />
        <col class="d-route" /><col class="d-win" /><col class="d-next" />
        <col class="d-activity" /><col class="d-state" />
      </colgroup>
      <thead><tr>
        <th class="pin">Account</th><th>Deal motion</th><th>Account thesis / problem</th>
        <th>Primary route</th><th>Commitment to win</th><th>Next move</th>
        <th>CRM messages</th><th>State</th>
      </tr></thead>
      <tbody>${state.rows.map((row, index) => dealRow(row, index)).join('')}</tbody>
    </table>`;
  wireDealSheet();
}

function dealRow(row, index) {
  const parity = index % 2 ? 'alt' : '';
  const sub = [row.industry, row.city || row.location].filter(Boolean).join(' · ');
  const contacts = row.contacts || [];
  const suggested = !row.primary_person_id && row.suggested_name
    ? `<div class="deal-hint">Suggested: ${esc(row.suggested_name)}${row.suggested_title ? ` · ${esc(row.suggested_title)}` : ''}</div>`
    : '';
  const activity = row.replied_count
    ? `<strong>${num(row.replied_count)} replied</strong>`
    : `<strong>${num(row.sent_count)} sent</strong> · ${num(row.message_count)} drafted`;
  const isGnk = ['gnk', 'delay', 'football', 'row'].includes(String(row.product || row.campaign || '').toLowerCase());
  const thesis = isGnk ? [
    ['Observed fact', 'observed_fact', row.observed_fact, 'What the direct public source actually says'],
    ['Hypothesis', 'problem', row.problem, 'The recurring operating problem that may exist'],
    ['Owner', 'workflow_owner', row.workflow_owner, 'Likely role or department; confirm it'],
    ['Consequence', 'consequence', row.consequence, 'Time, money, errors, or risk to measure'],
    ['Records', 'records', row.records, 'Documents or systems that could contain the answer'],
    ['Historical pilot', 'offer', row.offer, 'A 30–45 day historical-data test'],
    ['Kill condition', 'kill_condition', row.kill_condition, 'What finding ends the pursuit'],
  ].map(([label, field, value, placeholder]) => `
    <label class="deal-thesis-field"><span>${esc(label)}</span><textarea class="deal-input" rows="2" data-deal-field="${field}" data-original="${esc(value || '')}" placeholder="${esc(placeholder)}">${esc(value || '')}</textarea></label>
  `).join('') : `<textarea class="deal-input" rows="2" data-deal-field="problem" data-original="${esc(row.problem || '')}" placeholder="What expensive problem is credible here?">${esc(row.problem || '')}</textarea>`;
  const workflowScreen = isGnk ? [
    ['frequent', 'Repeated frequently'],
    ['expensive_when_poor', 'Expensive when handled poorly'],
    ['measurable', 'Measurable consequence'],
    ['records_exist', 'Existing records support the test'],
    ['identifiable_owner', 'Identifiable department owner'],
    ['testable_30_45_days', 'Testable in 30–45 days'],
    ['supports_40k_90k_engagement', 'Supports a $40k–$90k first engagement'],
  ].map(([key, label]) => `<label class="deal-check"><input type="checkbox" data-deal-json-field="workflow_scorecard" data-deal-json-key="${key}" ${row.workflow_scorecard?.[key] === true ? 'checked' : ''} /><span>${esc(label)}</span></label>`).join('') : '';
  const qualification = isGnk ? [
    ['recurring_workflow', 'Recurring workflow confirmed'],
    ['measurable_consequence', 'Measurable consequence confirmed'],
    ['named_owner', 'Named owner'],
    ['accessible_data', 'Accessible data'],
    ['credible_champion', 'Credible champion'],
    ['defined_pilot_outcome', 'Defined pilot outcome'],
  ].map(([key, label]) => `<label class="deal-check"><input type="checkbox" data-deal-json-field="qualification" data-deal-json-key="${key}" ${row.qualification?.[key] === true ? 'checked' : ''} /><span>${esc(label)}</span></label>`).join('') : '';
  const thesisCell = isGnk
    ? `<details class="deal-thesis"><summary>${row.observed_fact && row.kill_condition ? 'Thesis and qualification' : 'Complete account thesis'}</summary>
        ${thesis}
        <fieldset class="deal-gate"><legend>Pursuit screen · all 7 required</legend>${workflowScreen}</fieldset>
        <fieldset class="deal-gate"><legend>Discovery qualification · pause if 2+ missing</legend>${qualification}</fieldset>
      </details>`
    : thesis;
  return `
    <tr class="deal-row ${parity}" data-deal="${row.pursuit_id}">
      <td class="deal-account pin ${parity}">
        <div class="s-co-name">${esc(row.company_name)}</div>
        ${sub ? `<div class="s-sub">${esc(sub)}</div>` : ''}
        <div class="deal-account-meta">${num(row.emailable_count)} emailable · lead ${row.lead_score ?? '—'}</div>
      </td>
      <td><select class="deal-select" data-deal-field="pursuit_type" data-original="${esc(row.pursuit_type || '')}">
        ${PURSUIT_TYPES.map(([value, label]) => `<option value="${value}" ${value === row.pursuit_type ? 'selected' : ''}>${label}</option>`).join('')}
      </select></td>
      <td>${thesisCell}</td>
      <td><select class="deal-select" data-deal-field="primary_person_id" data-original="${esc(row.primary_person_id || '')}">
        <option value="">Choose a route…</option>
        ${contacts.map((person) => `<option value="${person.id}" ${person.id === row.primary_person_id ? 'selected' : ''}>${esc(person.name || 'Unknown')}${person.title ? ` · ${esc(person.title)}` : ''}</option>`).join('')}
      </select>${suggested}</td>
      <td><textarea class="deal-input" rows="2" data-deal-field="desired_commitment" data-original="${esc(row.desired_commitment || '')}" placeholder="Specific paid pilot, agreement or referral">${esc(row.desired_commitment || '')}</textarea></td>
      <td><textarea class="deal-input" rows="2" data-deal-field="next_goal" data-original="${esc(row.next_goal || '')}" placeholder="What must happen next?">${esc(row.next_goal || '')}</textarea>
        ${row.next_step_label ? `<div class="deal-hint">System step: ${esc(row.next_step_label)}</div>` : ''}</td>
      <td class="deal-activity"><div>${activity}</div><div>${num(row.contact_count)} contacts</div>
        <button class="btn sm primary deal-messages" data-open-messages="${row.company_id}" data-person="${row.primary_person_id || row.suggested_person_id || ''}">Work messages →</button></td>
      <td class="deal-state-cell">${dealState(row)}</td>
    </tr>`;
}

function dealState(row) {
  if (!row.has_context) return '<span class="deal-state missing">Missing context</span>';
  if (row.approval_status === 'approved') return `<span class="deal-state approved">${esc(row.pursuit_status === 'active' ? 'Active' : 'Approved')}</span>`;
  if (row.approval_status === 'rejected') return '<span class="deal-state rejected">Rejected</span>';
  return '<span class="deal-state review">Needs review</span>';
}

function wireDealSheet() {
  $$('#host [data-deal-field]').forEach((field) => {
    const eventName = field.tagName === 'TEXTAREA' ? 'blur' : 'change';
    field.addEventListener(eventName, () => saveDealField(field));
  });
  $$('#host [data-deal-json-field]').forEach((field) => {
    field.addEventListener('change', () => saveDealJsonField(field));
  });
  $$('#host [data-open-messages]').forEach((button) => button.addEventListener('click', () => {
    openDealMessages(Number(button.dataset.openMessages), Number(button.dataset.person) || null);
  }));
}

async function saveDealJsonField(field) {
  const rowElement = field.closest('[data-deal]');
  const pursuitId = Number(rowElement?.dataset.deal);
  const jsonField = field.dataset.dealJsonField;
  if (!pursuitId || !jsonField) return;
  const value = {};
  $$(`[data-deal-json-field="${jsonField}"]`, rowElement).forEach((input) => {
    value[input.dataset.dealJsonKey] = input.checked;
  });
  field.classList.add('saving');
  try {
    const { pursuit } = await api(`/api/pursuits/${pursuitId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [jsonField]: value }),
    });
    const row = state.rows.find((item) => item.pursuit_id === pursuitId);
    if (row) Object.assign(row, pursuit);
    const stateCell = $('.deal-state-cell', rowElement);
    if (stateCell && row) stateCell.innerHTML = dealState(row);
    toast('Qualification gate saved.');
  } catch (error) {
    field.checked = !field.checked;
    toast(error.message, 'err');
  } finally {
    field.classList.remove('saving');
  }
}

async function saveDealField(field) {
  const rowElement = field.closest('[data-deal]');
  const pursuitId = Number(rowElement?.dataset.deal);
  if (!pursuitId || field.value === field.dataset.original) return;
  field.classList.add('saving');
  try {
    const { pursuit } = await api(`/api/pursuits/${pursuitId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [field.dataset.dealField]: field.value }),
    });
    field.dataset.original = field.value;
    const row = state.rows.find((item) => item.pursuit_id === pursuitId);
    if (row) {
      Object.assign(row, pursuit);
      row.problem = pursuit.problem || row.hypothesis || '';
      row.has_context = Boolean(row.problem && row.desired_commitment && row.primary_person_id);
      const stateCell = $('.deal-state-cell', rowElement);
      if (stateCell) stateCell.innerHTML = dealState(row);
    }
    toast('Deal sheet saved. CRM message context is updated.');
  } catch (error) {
    field.value = field.dataset.original;
    toast(error.message, 'err');
  } finally {
    field.classList.remove('saving');
  }
}

async function openDealMessages(companyId, personId) {
  const row = state.rows.find((item) => item.company_id === companyId);
  state.view = 'contacts';
  state.search = row?.company_name || '';
  state.status = '';
  syncUrl();
  await load();
  const contact = state.rows.find((item) => item.person_id === personId) || state.rows[0];
  if (contact) showSequence(contact.person_id);
  else toast('This account does not have a contact to message yet.', 'err');
}

async function setPersonStatus(personId, status, element) {
  const row = state.rows.find((item) => item.person_id === personId);
  try {
    await api(`/api/people/${personId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (row) row.status = status;
    if (element) element.className = `s-status status-${status}`;
    toast('Status updated.');
  } catch (error) { toast(error.message, 'err'); }
}

// ---- Message pane -------------------------------------------------------
function deliveryLabel(status) {
  return ({ draft: 'In review', approved: 'Approved', sent: 'Sent', blocked: 'Blocked' })[status] || status;
}

function openCalendarSlot(slotId) {
  const slot = state.calendarSlots.get(slotId);
  if (!slot) return;
  state.openPerson = null;
  state.openCalendarSlot = slotId;
  state.openCalendarEvent = null;
  state.openCalendarDay = null;
  renderCalendarSlotDrawer(slot);
  $('#seqModal').classList.remove('hidden');
}

function renderCalendarSlotDrawer(slot, filter = '') {
  const { counts, companies, touches } = slotMeta(slot);
  const needle = filter.trim().toLowerCase();
  const events = slot.events.filter((event) => !needle || `${event.recipient_name} ${event.recipient_email} ${event.company_name} ${event.subject}`.toLowerCase().includes(needle));
  $('#seqContact').innerHTML = `
    <div class="seq-name">${CALENDAR_LABELS[slot.business]} · ${calendarDate(slot.scheduled_for, {
    weekday: 'short', day: 'numeric', month: 'short',
  })} at ${calendarTime(slot.scheduled_for)}</div>
    <div class="seq-meta">${num(slot.events.length)} emails · ${num(companies)} companies · ${touches.map((touch) => `T${touch}`).join(', ')}</div>`;
  $('#seqActions').innerHTML = `
    <div class="batch-summary biz-${slot.business}">
      <div><span>In review</span><strong>${num(counts.draft)}</strong></div>
      <div><span>Approved</span><strong>${num(counts.approved)}</strong></div>
      <div><span>Sent</span><strong>${num(counts.sent)}</strong></div>
      <div><span>Blocked</span><strong>${num(counts.blocked)}</strong></div>
    </div>
    <div class="batch-search"><input id="calendarBatchSearch" type="search" value="${esc(filter)}" placeholder="Filter this send window…" /></div>`;
  $('#seqBody').innerHTML = `<div class="calendar-email-list">
    ${events.length ? events.map((event) => `
      <button class="calendar-email-row" data-calendar-email="${event.id}">
        <span class="delivery-dot ${esc(event.delivery_status)}"></span>
        <span class="calendar-recipient"><strong>${esc(event.recipient_name || event.recipient_email || 'Unknown recipient')}</strong><small>${esc(event.recipient_title || '')}${event.recipient_title ? ' · ' : ''}${esc(event.company_name)}</small></span>
        <span class="calendar-subject"><strong>${esc(event.subject || '(no subject)')}</strong><small>${esc(event.recipient_email || 'No valid email')} · T${event.touch}</small></span>
        <span class="delivery-pill ${esc(event.delivery_status)}">${esc(deliveryLabel(event.delivery_status))}</span>
      </button>`).join('') : '<div class="seq-empty">No emails match this filter.</div>'}
  </div>`;
  $('#calendarBatchSearch').addEventListener('input', (event) => {
    const value = event.target.value;
    renderCalendarSlotDrawer(slot, value);
    const input = $('#calendarBatchSearch');
    input.focus();
    input.setSelectionRange(value.length, value.length);
  });
  $$('#seqBody [data-calendar-email]').forEach((button) => button.addEventListener('click', () => {
    openCalendarEmail(Number(button.dataset.calendarEmail));
  }));
}

// The whole day, grouped by company — "click Monday, the full send list is
// right there." Companies are ordered by business then name; each shows every
// email queued for that day so it is obvious what needs to go out per account.
function openCalendarDay(dateKey) {
  const events = visibleCalendarEvents().filter((event) => localDateKey(event.scheduled_for) === dateKey);
  if (!events.length) return;
  state.openPerson = null;
  state.openCalendarSlot = null;
  state.openCalendarEvent = null;
  state.openCalendarDay = dateKey;
  renderCalendarDayDrawer(dateKey, '');
  $('#seqModal').classList.remove('hidden');
}

function renderCalendarDayDrawer(dateKey, filter = '') {
  const dayEvents = visibleCalendarEvents().filter((event) => localDateKey(event.scheduled_for) === dateKey);
  const needle = filter.trim().toLowerCase();
  const events = dayEvents.filter((event) => !needle
    || `${event.recipient_name} ${event.recipient_email} ${event.company_name} ${event.subject}`.toLowerCase().includes(needle));
  const counts = calendarCounts(dayEvents);
  const companies = new Set(dayEvents.map((event) => event.company_id)).size;
  const label = calendarDate(`${dateKey}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'long' });

  $('#seqContact').innerHTML = `
    <div class="seq-name">${esc(label)}</div>
    <div class="seq-meta">${num(dayEvents.length)} emails · ${num(companies)} compan${companies === 1 ? 'y' : 'ies'} · ${viewerTimeZone}</div>`;
  $('#seqActions').innerHTML = `
    <div class="batch-summary">
      <div><span>In review</span><strong>${num(counts.draft)}</strong></div>
      <div><span>Approved</span><strong>${num(counts.approved)}</strong></div>
      <div><span>Sent</span><strong>${num(counts.sent)}</strong></div>
      <div><span>Blocked</span><strong>${num(counts.blocked)}</strong></div>
    </div>
    <div class="batch-search"><input id="calendarDaySearch" type="search" value="${esc(filter)}" placeholder="Filter this day…" /></div>`;

  // Group by company, keeping business + company order stable and readable.
  const groups = new Map();
  for (const event of events) {
    if (!groups.has(event.company_id)) groups.set(event.company_id, []);
    groups.get(event.company_id).push(event);
  }
  const ordered = [...groups.values()].sort((left, right) => (
    CALENDAR_BUSINESSES.indexOf(left[0].business) - CALENDAR_BUSINESSES.indexOf(right[0].business)
      || String(left[0].company_name || '').localeCompare(String(right[0].company_name || ''))
  ));

  $('#seqBody').innerHTML = ordered.length ? `<div class="calendar-day-groups">
    ${ordered.map((group) => {
    const company = group[0];
    const touches = [...new Set(group.map((event) => Number(event.touch)))].sort((a, b) => a - b);
    const rows = [...group].sort((left, right) => new Date(left.scheduled_for) - new Date(right.scheduled_for));
    return `<section class="day-company">
      <header class="day-company-head">
        <span class="business-pill biz-${esc(company.business)}">${CALENDAR_LABELS[company.business]}</span>
        <strong>${esc(company.company_name || 'Unknown company')}</strong>
        <span class="day-company-meta">${num(group.length)} email${group.length === 1 ? '' : 's'} · ${touches.map((touch) => `T${touch}`).join(', ')}</span>
      </header>
      ${rows.map((event) => `
        <button class="calendar-email-row" data-calendar-email="${event.id}">
          <span class="delivery-dot ${esc(event.delivery_status)}"></span>
          <span class="calendar-recipient"><strong>${esc(event.recipient_name || event.recipient_email || 'Unknown recipient')}</strong><small>${esc(event.recipient_title || '')}${event.recipient_title ? ' · ' : ''}T${event.touch} · ${esc(calendarTime(event.scheduled_for))}</small></span>
          <span class="calendar-subject"><strong>${esc(event.subject || '(no subject)')}</strong><small>${esc(event.recipient_email || 'No valid email')}</small></span>
          <span class="delivery-pill ${esc(event.delivery_status)}">${esc(deliveryLabel(event.delivery_status))}</span>
        </button>`).join('')}
    </section>`;
  }).join('')}
  </div>` : '<div class="seq-empty">No emails match this filter.</div>';

  $('#calendarDaySearch').addEventListener('input', (event) => {
    const value = event.target.value;
    renderCalendarDayDrawer(dateKey, value);
    const input = $('#calendarDaySearch');
    input.focus();
    input.setSelectionRange(value.length, value.length);
  });
  $$('#seqBody [data-calendar-email]').forEach((button) => button.addEventListener('click', () => {
    openCalendarEmail(Number(button.dataset.calendarEmail));
  }));
}

function findCalendarEvent(id) {
  return state.calendarEvents.find((event) => event.id === id);
}

async function openCalendarEmail(id) {
  const event = findCalendarEvent(id);
  if (!event) return;
  if (event.body === undefined) {
    try {
      const { sequence } = await api(`/api/people/${event.person_id}/sequence`);
      const message = sequence.find((item) => item.id === event.id);
      if (message) Object.assign(event, message, { delivery_status: event.delivery_status, blockers: event.blockers });
      else event.body = '';
    } catch (error) {
      toast(`Could not load email: ${error.message}`, 'err');
      return;
    }
  }
  state.openCalendarEvent = id;
  const backLabel = state.openCalendarDay ? '← Day list' : '← Send window';
  $('#seqContact').innerHTML = `
    <button class="calendar-back" data-calendar-back>${backLabel}</button>
    <div class="seq-name">${esc(event.recipient_name || event.recipient_email || 'Unknown recipient')}</div>
    <div class="seq-meta">${esc(event.recipient_title || '')}${event.recipient_title ? ' · ' : ''}${esc(event.company_name)}</div>`;
  $('#seqActions').innerHTML = `
    <div class="calendar-message-meta">
      <span class="business-pill biz-${esc(event.business)}">${CALENDAR_LABELS[event.business]}</span>
      <span class="delivery-pill ${esc(event.delivery_status)}">${esc(deliveryLabel(event.delivery_status))}</span>
      <span>Touch ${event.touch} · day ${event.day}</span>
      <span>${calendarDate(event.scheduled_for, { weekday: 'short', day: 'numeric', month: 'short' })} · ${calendarTime(event.scheduled_for)} ${esc(viewerTimeZone)}</span>
    </div>
    ${event.blockers.length ? `<div class="calendar-blocker"><strong>Will not be eligible to send</strong>${event.blockers.map((blocker) => `<span>${esc(blocker)}</span>`).join('')}</div>` : ''}`;
  $('#seqBody').innerHTML = `
    <article class="mail calendar-mail">
      <div class="mail-timing" title="${esc(event.schedule_reason || '')}">
        <span>Capacity-adjusted send</span><strong>${esc(event.scheduled_local || 'Not set')}</strong>
        <small>30/day brand cap · overflow only moves later</small>
      </div>
      <div class="mail-timing suggestion" title="${esc(event.suggested_reason || event.timing_reason || '')}">
        <span>Original suggested send</span><strong>${esc(event.suggested_local || event.suggested_window || event.send_window || 'Not set')}</strong>
        ${(event.suggested_window || event.send_window) ? `<small>${esc(event.suggested_window || event.send_window)}</small>` : ''}
      </div>
      <div class="calendar-mail-to"><span>To</span><strong>${esc(event.recipient_email || 'No valid email')}</strong></div>
      <div class="mail-subj">${esc(event.subject || '(no subject)')}</div>
      <div class="mail-body">${esc(event.body || '')}</div>
      <div class="mail-actions">
        <button class="btn sm" data-calendar-copy="${event.id}">Copy email</button>
        <button class="btn sm primary" data-calendar-open-contact="${event.id}">Open full sequence</button>
      </div>
    </article>`;
  $('[data-calendar-back]').addEventListener('click', () => {
    if (state.openCalendarDay) openCalendarDay(state.openCalendarDay);
    else openCalendarSlot(state.openCalendarSlot);
  });
  $('[data-calendar-copy]').addEventListener('click', () => copyCalendarEmail(event));
  $('[data-calendar-open-contact]').addEventListener('click', () => openCalendarContact(event));
}

async function copyCalendarEmail(event) {
  const text = [`To: ${event.recipient_email || ''}`, `Subject: ${event.subject || ''}`, event.body || ''].join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Email copied to clipboard.');
  } catch { toast('Copy failed. Select and copy it manually.', 'err'); }
}

async function openCalendarContact(event) {
  closeSequence();
  state.business = event.business;
  state.view = 'contacts';
  state.status = '';
  state.search = event.recipient_email || event.recipient_name || '';
  syncUrl();
  await load();
  if (findRow(event.person_id)) showSequence(event.person_id);
}

function findRow(personId) { return state.rows.find((row) => row.person_id === personId); }

function showSequence(personId) {
  state.openPerson = personId;
  renderSequence();
  $('#seqModal').classList.remove('hidden');
}

function closeSequence() {
  state.openPerson = null;
  state.openCalendarSlot = null;
  state.openCalendarEvent = null;
  state.openCalendarDay = null;
  $('#seqModal').classList.add('hidden');
}

function contextValue(label, value) {
  if (!value) return '';
  return `<div class="context-item"><span>${esc(label)}</span><p>${esc(value)}</p></div>`;
}

function dealContextHtml(row) {
  const brief = row.sales_brief || {};
  const items = [
    contextValue('Observed fact', row.observed_fact),
    contextValue('Problem hypothesis', row.pursuit_problem || row.hypothesis),
    contextValue('Likely owner', row.workflow_owner),
    contextValue('Consequence to measure', row.pursuit_consequence),
    contextValue('Records to confirm', row.records),
    contextValue('Historical pilot after discovery', row.pursuit_offer),
    contextValue('Kill condition', row.kill_condition),
    contextValue('Commitment to win', row.desired_commitment),
    contextValue('Next deal move', row.next_goal),
    contextValue('Why this route', brief.role_route || row.pursuit_role),
    contextValue('Hard buyer question', brief.skeptical_question),
    contextValue('Proof boundary', brief.proof_boundary),
  ].filter(Boolean).join('');
  if (!items) {
    return `<div class="context-empty">No deal strategy is written for this account yet.
      <button class="text-button" data-open-deal>Open the Deals sheet</button></div>`;
  }
  return `<div class="deal-context"><div class="context-title">Deal context used by the message writer</div><div class="context-grid">${items}</div></div>`;
}

function renderSequence() {
  const row = findRow(state.openPerson);
  if (!row) return;
  const touchCount = expectedTouchCount(row);
  $('#seqContact').innerHTML = `
    <div class="seq-name">${esc(row.name || 'Unknown')}</div>
    <div class="seq-meta">${esc(row.title || '')}${row.title && row.company_name ? ' · ' : ''}${esc(row.company_name || '')}</div>`;
  const generating = state.generating.has(row.person_id);
  const writeButton = canWrite(row)
    ? `<button class="btn primary sm" data-regen="${row.person_id}" ${generating ? 'disabled' : ''}>
        ${row.msg_count ? `↻ Rewrite full ${touchCount}` : `+ Write full ${touchCount}`}</button>`
    : '';
  $('#seqActions').innerHTML = `
    ${dealContextHtml(row)}
    ${row.relevance_reason ? `<div class="seq-why"><b>Why they might reply:</b> ${esc(row.relevance_reason)}</div>` : ''}
    ${generating ? `<div class="gen-banner"><span class="spinner"></span><span>The writer is researching this account, planning ${touchCount} distinct touches, and running the copy through review.</span></div>` : ''}
    <div class="seq-toolbar"><span class="seq-count">${row.sequence_complete
    ? `${touchCount}/${touchCount} reviewed`
    : row.sequence_present ? `${touchCount}/${touchCount} needs rewrite` : `${row.msg_count}/${touchCount} incomplete`}</span>${writeButton}</div>`;
  $('#seqBody').innerHTML = row.messages.length
    ? row.messages.map((message) => mailCard(message)).join('')
    : `<div class="seq-empty">No messages yet. The writer will research the account and create the complete ${touchCount}-touch sequence here.</div>`;
  wireSequence();
}

function mailCard(message) {
  const linkedin = message.channel === 'linkedin';
  const sent = message.status === 'sent';
  return `
    <div class="mail ${sent ? 'sent' : ''}" data-msg="${message.id}">
      <div class="mail-head">
        <span class="mail-step">${linkedin ? 'LinkedIn' : 'Email'} · Touch ${message.touch}</span>
        <span class="mail-day">day ${message.day ?? '—'}</span>
        <span class="mail-flag ${sent ? 'on' : ''}">${sent ? 'sent ✓' : 'draft'}</span>
      </div>
      <div class="mail-view">
        ${(message.scheduled_local || message.send_window) ? `<div class="mail-timing" title="${esc(message.schedule_reason || message.timing_reason || '')}">
          <span>Capacity-adjusted send</span><strong>${esc(message.scheduled_local || message.send_window)}</strong>
          ${(message.suggested_local || message.suggested_window || message.send_window) ? `<small>Suggested: ${esc(message.suggested_local || message.suggested_window || message.send_window)}</small>` : ''}
        </div>` : ''}
        ${message.subject ? `<div class="mail-subj">${esc(message.subject)}</div>` : ''}
        <div class="mail-body">${esc(message.body || '')}</div>
        <div class="mail-actions">
          <button class="btn sm" data-copy="${message.id}">Copy</button>
          ${sent ? '' : `<button class="btn sm" data-edit="${message.id}">Edit</button>`}
          ${sent ? '' : `<button class="btn sm primary" data-send="${message.id}">Mark sent</button>`}
        </div>
      </div>
    </div>`;
}

function wireSequence() {
  $$('#seqBody [data-copy]').forEach((button) => button.addEventListener('click', () => copyMessage(Number(button.dataset.copy))));
  $$('#seqBody [data-send]').forEach((button) => button.addEventListener('click', () => setSent(Number(button.dataset.send), true)));
  $$('#seqBody [data-edit]').forEach((button) => button.addEventListener('click', () => beginEdit(Number(button.dataset.edit))));
  const writer = $('#seqActions [data-regen]');
  if (writer) writer.addEventListener('click', () => regenerate(Number(writer.dataset.regen)));
  const openDeal = $('#seqActions [data-open-deal]');
  if (openDeal) openDeal.addEventListener('click', () => {
    const row = findRow(state.openPerson);
    closeSequence();
    state.view = 'deals';
    state.search = row?.company_name || '';
    state.status = '';
    syncUrl();
    load();
  });
}

// ---- Message actions ----------------------------------------------------
function findMessage(id) {
  for (const row of state.rows) {
    const message = row.messages.find((item) => item.id === id);
    if (message) return { row, message };
  }
  return {};
}

function recomputeRow(row) {
  row.msg_count = row.messages.length;
  row.sent_count = row.messages.filter((message) => message.status === 'sent').length;
  row.next_touch = row.messages.find((message) => message.status !== 'sent') || null;
  const touchCount = expectedTouchCount(row);
  const ids = new Set(row.messages.map((message) => Number(message.touch)));
  row.sequence_present = row.messages.length === touchCount
    && Array.from({ length: touchCount }, (_, index) => index + 1).every((touch) => ids.has(touch));
  row.sequence_complete = row.sequence_present
    && !(row.sequence_errors || []).length
    && !(row.brief_errors || []).length;
}

function refresh() {
  renderSheet();
  if (state.openPerson) renderSequence();
}

async function copyMessage(id) {
  const { message } = findMessage(id);
  if (!message) return;
  const text = [message.subject ? `Subject: ${message.subject}` : '', message.body || ''].filter(Boolean).join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Message copied to clipboard.');
  } catch { toast('Copy failed. Select and copy it manually.', 'err'); }
}

async function setSent(id, sent) {
  const { row, message } = findMessage(id);
  if (!message) return;
  try {
    const { sequence } = await api(`/api/sequences/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: sent ? 'sent' : 'draft' }),
    });
    message.status = sequence.status;
    recomputeRow(row);
    const business = state.businesses.find((item) => item.key === row.business);
    if (business) business.sent += sent ? 1 : -1;
    renderHeader();
    refresh();
    toast(sent ? 'Marked sent and logged to CRM history.' : 'Marked unsent.');
  } catch (error) { toast(error.message, 'err'); }
}

function beginEdit(id) {
  const card = $(`#seqBody .mail[data-msg="${id}"]`);
  const { message } = findMessage(id);
  if (!card || !message) return;
  $('.mail-view', card).innerHTML = `
    ${message.subject != null ? `<input class="mail-subj-edit" value="${esc(message.subject)}" placeholder="Subject" />` : ''}
    <textarea rows="12">${esc(message.body || '')}</textarea>
    <div class="mail-actions">
      <button class="btn sm primary" data-save="${id}">Save</button>
      <button class="btn sm" data-cancel="${id}">Cancel</button>
    </div>`;
  $(`[data-save="${id}"]`, card).addEventListener('click', () => saveEdit(id, card));
  $(`[data-cancel="${id}"]`, card).addEventListener('click', renderSequence);
}

async function saveEdit(id, card) {
  const { row, message } = findMessage(id);
  if (!message) return;
  const subject = $('.mail-subj-edit', card);
  const body = $('textarea', card);
  const payload = { body: body.value };
  if (subject) payload.subject = subject.value;
  try {
    const { sequence } = await api(`/api/sequences/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    message.subject = sequence.subject;
    message.body = sequence.body;
    row.sequence_errors = ['Message changed since the last full-series review.'];
    recomputeRow(row);
    refresh();
    toast('Message saved in the CRM.');
  } catch (error) { toast(error.message, 'err'); }
}

// ---- Source-backed campaign-sequence writer ----------------------------
function canWrite(row) {
  if (!SUPPORTED_GEN.has(row.business) || !row.email) return false;
  return row.messages.every((message) => message.status === 'draft');
}

async function regenerate(personId) {
  if (state.generating.has(personId)) return;
  state.generating.add(personId);
  refresh();
  try {
    await api(`/api/crm/contacts/${personId}/generate`, { method: 'POST' });
    const row = findRow(personId);
    toast(`${expectedTouchCount(row)}-touch writer started. It is researching before it drafts.`);
    await pollGeneration(personId);
  } catch (error) {
    state.generating.delete(personId);
    refresh();
    toast(error.message, 'err');
  }
}

async function pollGeneration(personId) {
  const row = findRow(personId);
  for (let attempt = 0; attempt < 800; attempt += 1) {
    await sleep(3000);
    let job;
    try { ({ job } = await api(`/api/crm/contacts/${personId}/generate`)); } catch { continue; }
    if (!job || job.status === 'running') continue;
    state.generating.delete(personId);
    if (job.status === 'done' && job.messages) {
      if (row) {
        row.messages = job.messages;
        if (job.sales_brief) row.sales_brief = job.sales_brief;
        row.sequence_errors = [];
        row.brief_errors = [];
        recomputeRow(row);
      }
      renderHeader();
      refresh();
      toast(`All ${expectedTouchCount(row)} reviewed messages are ready. Review before sending.`);
    } else {
      refresh();
      toast(job.error || 'The message writer did not complete.', 'err');
    }
    return;
  }
  state.generating.delete(personId);
  refresh();
  toast('Still writing. Refresh shortly to see the result.', 'err');
}

// ---- Wiring -------------------------------------------------------------
let searchTimer;
$('#search').value = state.search;
$('#search').addEventListener('input', (event) => {
  state.search = event.target.value.trim();
  syncUrl();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 220);
});
$('#seqClose').addEventListener('click', closeSequence);
$('#seqModal').addEventListener('click', (event) => {
  if (event.target === $('#seqModal')) closeSequence();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSequence();
});

load();

// Batch writers commit one complete contact sequence at a time. Quietly poll
// while the grid is idle so each reviewed sequence appears without a manual
// browser refresh or a disruptive loading state.
setInterval(() => {
  if (document.hidden || state.openPerson || state.openCalendarSlot || state.openCalendarEvent || state.openCalendarDay) return;
  load({ silent: true });
}, 15_000);
