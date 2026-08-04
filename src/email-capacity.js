// Global email-capacity planner. The per-contact writer decides message order
// and desired cadence; this planner decides when those emails can safely leave
// each sending brand without exceeding its daily mailbox/domain budget.

export const EMAIL_DAILY_CAP = 30;
export const SCHEDULE_POLICY_VERSION = 'brand-capacity-v5-followup-reanchor';
export const SENDER_CAPACITY_TIMEZONE = 'Europe/London';
export const WEEKEND_SCHEDULE_POLICY = 'person-specific-opt-in';

// Once a touch is actually sent, the next touch is "owed" and becomes due this
// many days after that real send — never pinned to the writer's original
// absolute suggestion (which was dated from sequence-creation time). Overdue
// follow-ups clamp to the schedule start, so a T2 after a sent T1 (or a T3
// after a sent T2) lands at the front of the coming week rather than weeks out.
export const FOLLOWUP_MIN_GAP_DAYS = 2;

export const BUSINESS_SEND_TIMEZONES = Object.freeze({
  wapahki: SENDER_CAPACITY_TIMEZONE,
  gnk: SENDER_CAPACITY_TIMEZONE,
  outagehub: SENDER_CAPACITY_TIMEZONE,
});

// These are available sender-local windows, not seven automatic sending days.
// Weekend use is opt-in per person through their original timing suggestion.
export const WEEKLY_SEND_WINDOWS = Object.freeze({
  // London clock, shifted later to overlap North American working hours.
  0: { label: 'Sunday', start: 15 * 60, end: 23 * 60 },             // 3:00–11:00pm
  1: { label: 'Monday', start: 11 * 60 + 30, end: 21 * 60 },       // 11:30am–9:00pm
  2: { label: 'Tuesday', start: 11 * 60, end: 21 * 60 + 30 },      // 11:00am–9:30pm
  3: { label: 'Wednesday', start: 11 * 60, end: 21 * 60 + 30 },
  4: { label: 'Thursday', start: 11 * 60, end: 21 * 60 + 30 },
  5: { label: 'Friday', start: 11 * 60, end: 18 * 60 + 30 },       // 11:00am–6:30pm
  6: { label: 'Saturday', start: 14 * 60 + 30, end: 18 * 60 + 30 }, // 2:30–6:30pm
});

export function capacityBusinessForCampaign(campaign) {
  const key = String(campaign || '').toLowerCase();
  if (['gnk', 'delay', 'football', 'row'].includes(key)) return 'gnk';
  if (['outagehub', 'outage', 'outagehub-grants'].includes(key)) return 'outagehub';
  return 'wapahki';
}

function partsInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  };
}

function ordinalFromParts(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function partsFromOrdinal(ordinal) {
  const date = new Date(ordinal * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function weekdayForOrdinal(ordinal) {
  return new Date(ordinal * 86_400_000).getUTCDay();
}

function zonedLocalToDate(parts, timezone) {
  let instant = new Date(Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0,
  ));
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = partsInZone(instant, timezone);
    const wantedUtc = Date.UTC(
      parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0,
    );
    const seenUtc = Date.UTC(
      seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second || 0,
    );
    instant = new Date(instant.getTime() + (wantedUtc - seenUtc));
  }
  return instant;
}

function startOrdinal(value, timezone) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return ordinalFromParts({ year, month, day });
  }
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('invalid capacity schedule start date');
  return ordinalFromParts(partsInZone(date, timezone));
}

function localOrdinalForInstant(value, timezone) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return ordinalFromParts(partsInZone(date, timezone));
}

function minuteLabel(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')}${suffix}`;
}

function evenlySpacedMinutes(window, count) {
  if (!count) return [];
  const span = window.end - window.start;
  return Array.from({ length: count }, (_, index) => (
    Math.round(window.start + (((index + 0.5) * span) / count))
  ));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isIrregularMinute(totalMinutes) {
  const minute = ((totalMinutes % 60) + 60) % 60;
  return minute % 2 === 1 && minute % 5 !== 0;
}

function irregularSecond(hash) {
  const choices = [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59];
  return choices[hash % choices.length];
}

function timingAnchor(task, fallbackTimezone) {
  const source = task.message.suggested_for || task.message.scheduled_for;
  if (!source) return { date: null, mondayAlternative: false };
  const primary = new Date(source);
  if (Number.isNaN(primary.getTime())) return { date: null, mondayAlternative: false };
  const suggestedTimezone = task.message.suggested_timezone || fallbackTimezone;
  const suggestedParts = partsInZone(primary, suggestedTimezone);
  const suggestedOrdinal = ordinalFromParts(suggestedParts);
  const suggestedWeekday = weekdayForOrdinal(suggestedOrdinal);
  const window = String(task.message.suggested_window || task.message.send_window || '');
  if (suggestedWeekday === 2 && /\bmon(?:day)?\b/i.test(window)) {
    const monday = partsFromOrdinal(suggestedOrdinal - 1);
    return {
      date: zonedLocalToDate({
        ...monday,
        hour: suggestedParts.hour,
        minute: suggestedParts.minute,
        second: suggestedParts.second,
      }, suggestedTimezone),
      mondayAlternative: true,
    };
  }
  return { date: primary, mondayAlternative: false };
}

function preferredMinute(task, timezone, ordinal, window) {
  const anchor = timingAnchor(task, timezone);
  let source = anchor.date;
  const primarySource = task.message.suggested_for || task.message.scheduled_for;
  if (anchor.mondayAlternative && primarySource) {
    const primary = new Date(primarySource);
    const primaryOrdinal = localOrdinalForInstant(primary, timezone);
    if (!Number.isNaN(primary.getTime()) && primaryOrdinal != null && ordinal >= primaryOrdinal) {
      source = primary;
    }
  }
  if (!source) return window.start;
  const parts = partsInZone(source, timezone);
  const suggestedOrdinal = ordinalFromParts(parts);
  if (suggestedOrdinal < ordinal) return window.start;
  const minute = (parts.hour * 60) + parts.minute + (parts.second > 0 ? 1 : 0);
  return Math.min(window.end, Math.max(window.start, minute));
}

function suggestedWeekday(task, fallbackTimezone) {
  const source = task.message.suggested_for || task.message.scheduled_for;
  if (!source) return null;
  const timezone = task.message.suggested_timezone || fallbackTimezone;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return null;
  return weekdayForOrdinal(ordinalFromParts(partsInZone(date, timezone)));
}

function weekendEligibility(task, weekday, timezone) {
  if (![0, 6].includes(weekday)) return { eligible: true, reason: '' };
  const suggestedDay = suggestedWeekday(task, timezone);
  if (suggestedDay === weekday) {
    return { eligible: true, reason: `the person's original suggested send explicitly falls on ${WEEKLY_SEND_WINDOWS[weekday].label}` };
  }
  return { eligible: false, reason: '' };
}

function capacityMinutes(window, tasks, timezone, ordinal) {
  if (!tasks.length) return new Map();
  const ordered = [...tasks].sort((left, right) => (
    preferredMinute(left, timezone, ordinal, window) - preferredMinute(right, timezone, ordinal, window)
      || taskOrder(left, right)
  ));
  const preferences = ordered.map((task) => preferredMinute(task, timezone, ordinal, window));
  const minutes = evenlySpacedMinutes({ start: Math.min(...preferences), end: window.end }, ordered.length);
  const scheduled = new Map();
  let previous = window.start - 1;
  ordered.forEach((task, index) => {
    const hash = stableHash(`${task.message.id}|${ordinal}|${task.message.person_id}`);
    const minimum = Math.max(preferences[index], previous + 2);
    let minute = Math.max(minimum, minutes[index] + ((hash % 7) - 3));
    while (minute <= window.end && !isIrregularMinute(minute)) minute += 1;
    if (minute > window.end) {
      minute = window.end;
      while (minute >= minimum && !isIrregularMinute(minute)) minute -= 1;
    }
    if (minute > window.end) return;
    if (minute < minimum) return;
    scheduled.set(task, { minute, second: irregularSecond(hash >>> 8) });
    previous = minute;
  });
  return scheduled;
}

function formatScheduledLocal(date, timezone) {
  const value = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date);
  return `${value} · ${timezone}`;
}

function messageOrder(left, right) {
  return Number(left.day || left.touch || 0) - Number(right.day || right.touch || 0)
    || Number(left.touch || 0) - Number(right.touch || 0)
    || Number(left.id || 0) - Number(right.id || 0);
}

function creationOrder(left, right) {
  return String(left.message.created_at || '').localeCompare(String(right.message.created_at || ''))
    || Number(left.message.id || 0) - Number(right.message.id || 0)
    || Number(left.message.person_id || 0) - Number(right.message.person_id || 0);
}

function taskOrder(left, right) {
  return left.due - right.due
    || Number(right.message.touch || 0) - Number(left.message.touch || 0)
    || Number(left.message.person_id || 0) - Number(right.message.person_id || 0);
}

function seedTasks(rows, business, timezone, firstOrdinal) {
  const byPerson = new Map();
  for (const row of rows) {
    if ((row.business || capacityBusinessForCampaign(row.campaign)) !== business) continue;
    if (String(row.channel || '').toLowerCase() !== 'email') continue;
    if (!byPerson.has(row.person_id)) byPerson.set(row.person_id, []);
    byPerson.get(row.person_id).push(row);
  }
  const newTasks = [];
  const activeTasks = [];
  for (const messages of byPerson.values()) {
    messages.sort(messageOrder);
    const firstPendingIndex = messages.findIndex((message) => message.status !== 'sent');
    if (firstPendingIndex < 0) continue;
    const pending = messages.slice(firstPendingIndex).filter((message) => message.status !== 'sent');
    if (!pending.length) continue;
    const first = pending[0];
    const previous = [...messages.slice(0, firstPendingIndex)].reverse().find((message) => message.status === 'sent');
    const task = { messages: pending, index: 0, message: first, due: firstOrdinal };
    if (Number(first.touch) === 1 && !previous) {
      // Brand-new outreach still honors the writer's suggested first-send day.
      const suggestedDay = localOrdinalForInstant(timingAnchor(task, timezone).date, timezone);
      task.due = Math.max(firstOrdinal, suggestedDay == null ? firstOrdinal : suggestedDay);
      newTasks.push(task);
    } else {
      // Owed follow-up: a prior touch already went out, so re-anchor the next
      // touch to that real send + a short breather instead of the stale absolute
      // suggestion. A sent touch went out no later than the schedule start, even
      // when its planned scheduled_for is in the future (operator sent ahead), so
      // cap the anchor at firstOrdinal. Overdue follow-ups then clamp to
      // firstOrdinal and pack into the earliest send days ahead of new touch 1s.
      const priorScheduled = previous?.scheduled_for
        ? localOrdinalForInstant(previous.scheduled_for, timezone)
        : null;
      const priorDay = priorScheduled == null ? null : Math.min(priorScheduled, firstOrdinal);
      task.due = Math.max(
        firstOrdinal,
        priorDay == null ? firstOrdinal : priorDay + FOLLOWUP_MIN_GAP_DAYS,
      );
      activeTasks.push(task);
    }
  }
  // Creation order makes new writer output append to the existing queue instead
  // of reshuffling thousands of already visible calendar assignments.
  newTasks.sort(creationOrder);
  activeTasks.sort(taskOrder);
  return { newTasks, activeTasks };
}

// Follow-ups always consume capacity before a new touch 1. That prevents the
// funnel from opening more conversations than the 30/day budget can sustain.
// The planner never changes copy or status and never marks anything sent.
export function planCapacitySchedule(rows, {
  start = new Date(),
  dailyCap = EMAIL_DAILY_CAP,
  timezoneByBusiness = BUSINESS_SEND_TIMEZONES,
} = {}) {
  const cap = Math.max(1, Math.floor(Number(dailyCap) || EMAIL_DAILY_CAP));
  const assignments = [];
  const days = [];
  const businesses = [...new Set(rows
    .filter((row) => String(row.channel || '').toLowerCase() === 'email' && row.status !== 'sent')
    .map((row) => row.business || capacityBusinessForCampaign(row.campaign)))].sort();

  for (const business of businesses) {
    const timezone = timezoneByBusiness[business] || SENDER_CAPACITY_TIMEZONE;
    const firstOrdinal = startOrdinal(start, timezone);
    const { newTasks, activeTasks } = seedTasks(rows, business, timezone, firstOrdinal);
    let ordinal = firstOrdinal;
    let guard = 0;
    while ((newTasks.length || activeTasks.length) && guard < 10_000) {
      guard += 1;
      const weekday = weekdayForOrdinal(ordinal);
      const due = activeTasks.filter((task) => (
        task.due <= ordinal && weekendEligibility(task, weekday, timezone).eligible
      )).sort(taskOrder);
      const availableNew = newTasks.filter((task) => (
        task.due <= ordinal && weekendEligibility(task, weekday, timezone).eligible
      ));
      const selected = due.slice(0, cap);
      if (selected.length < cap && availableNew.length) {
        selected.push(...availableNew.slice(0, cap - selected.length));
      }
      if (!selected.length) {
        const allTasks = [...activeTasks, ...newTasks];
        const waiting = allTasks.some((task) => task.due <= ordinal);
        const futureDue = allTasks.filter((task) => task.due > ordinal).map((task) => task.due);
        ordinal = waiting ? ordinal + 1 : Math.min(...futureDue);
        continue;
      }

      const window = WEEKLY_SEND_WINDOWS[weekday];
      const minutes = capacityMinutes(window, selected, timezone, ordinal);
      const scheduledTasks = selected.filter((task) => minutes.has(task));
      const calendar = partsFromOrdinal(ordinal);
      scheduledTasks.forEach((task) => {
        const timing = minutes.get(task);
        const totalMinutes = timing.minute;
        const instant = zonedLocalToDate({
          ...calendar,
          hour: Math.floor(totalMinutes / 60),
          minute: totalMinutes % 60,
          second: timing.second,
        }, timezone);
        const weekend = weekendEligibility(task, weekday, timezone);
        const primarySuggestion = task.message.suggested_for || task.message.scheduled_for;
        const mondayAlternative = timingAnchor(task, timezone).mondayAlternative
          && weekday === 1
          && primarySuggestion
          && instant < new Date(primarySuggestion);
        const weekendReason = weekend.reason
          ? ` This weekend slot is allowed because ${weekend.reason}; weekends are never used as general overflow.`
          : '';
        const mondayReason = mondayAlternative
          ? ` This Monday slot uses the person's explicit Monday alternative at the same recipient-local time as their primary Tuesday suggestion.`
          : '';
        assignments.push({
          id: task.message.id,
          person_id: task.message.person_id,
          business,
          touch: Number(task.message.touch),
          scheduled_for: instant.toISOString(),
          scheduled_local: formatScheduledLocal(instant, timezone),
          send_timezone: timezone,
          capacity_window: `${window.label} · ${minuteLabel(window.start)}–${minuteLabel(window.end)} ${timezone} · North America overlap · irregular pacing · max ${cap}/day${[0, 6].includes(weekday) ? ' · person-specific weekend opt-in' : ''}`,
          schedule_reason: `Capacity plan ${SCHEDULE_POLICY_VERSION}: London is the sender-capacity clock and the North American recipient-local suggestion is the primary timing anchor; an explicitly documented Monday alternative may be used one day earlier. ${business} is capped at ${cap} emails per London day; overflow moves later, follow-ups precede new touch 1 emails, and stable non-round minute/second jitter prevents bursts without changing on restart.${mondayReason}${weekendReason}`,
        });
        const activeIndex = activeTasks.indexOf(task);
        if (activeIndex >= 0) activeTasks.splice(activeIndex, 1);
        const newIndex = newTasks.indexOf(task);
        if (newIndex >= 0) newTasks.splice(newIndex, 1);
        task.index += 1;
        task.message = task.messages[task.index];
        if (task.message) {
          const previous = task.messages[task.index - 1];
          // Space each subsequent touch relative to the touch we just scheduled,
          // not the writer's stale absolute suggestion, so a re-anchored follow-up
          // chain stays tight instead of springing back to its original dates.
          task.due = ordinal + Math.max(
            1,
            Number(task.message.day || task.message.touch || 1)
              - Number(previous.day || previous.touch || 0),
          );
          activeTasks.push(task);
        }
      });
      days.push({ business, date: `${calendar.year}-${String(calendar.month).padStart(2, '0')}-${String(calendar.day).padStart(2, '0')}`, count: scheduledTasks.length });
      ordinal += 1;
    }
    if (guard >= 10_000) throw new Error(`capacity schedule guard exceeded for ${business}`);
  }

  return {
    policy: SCHEDULE_POLICY_VERSION,
    weekend_policy: WEEKEND_SCHEDULE_POLICY,
    daily_cap: cap,
    assignments: assignments.sort((left, right) => (
      new Date(left.scheduled_for) - new Date(right.scheduled_for) || left.id - right.id
    )),
    days,
  };
}
