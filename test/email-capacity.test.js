import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_DAILY_CAP,
  SCHEDULE_POLICY_VERSION,
  WEEKLY_SEND_WINDOWS,
  planCapacitySchedule,
} from '../src/email-capacity.js';

function row({
  id, personId = id, business = 'wapahki', touch = 1, day = touch,
  status = 'draft', scheduledFor = null, suggestedFor = null,
  suggestedWindow = '', suggestedTimezone = 'America/Toronto',
}) {
  return {
    id,
    person_id: personId,
    business,
    campaign: business,
    touch,
    day,
    channel: 'email',
    status,
    scheduled_for: scheduledFor,
    suggested_for: suggestedFor,
    suggested_window: suggestedWindow,
    suggested_timezone: suggestedTimezone,
  };
}

function localParts(value, timezone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`).getUTCDay(),
  };
}

test('a brand never exceeds 30 emails in one sender-local day', () => {
  const rows = Array.from({ length: 31 }, (_, index) => row({ id: index + 1 }));
  const plan = planCapacitySchedule(rows, { start: '2026-08-03' });
  const byDate = Object.groupBy(plan.assignments, (assignment) => localParts(assignment.scheduled_for).date);

  assert.equal(EMAIL_DAILY_CAP, 30);
  assert.equal(byDate['2026-08-03'].length, 30);
  assert.equal(byDate['2026-08-04'].length, 1);
  assert.ok(Object.values(byDate).every((assignments) => assignments.length <= EMAIL_DAILY_CAP));
});

test('a sustained general backlog does not use weekends as automatic overflow', () => {
  const rows = Array.from({ length: 220 }, (_, index) => row({
    id: index + 1,
    business: 'gnk',
  }));
  const plan = planCapacitySchedule(rows, { start: '2026-08-03' });
  const firstWeek = plan.assignments.filter((assignment) => {
    const date = localParts(assignment.scheduled_for).date;
    return date >= '2026-08-03' && date <= '2026-08-09';
  });
  const weekdays = new Set(firstWeek.map((assignment) => localParts(assignment.scheduled_for).weekday));
  const counts = Object.values(Object.groupBy(firstWeek, (assignment) => localParts(assignment.scheduled_for).date));

  assert.equal(firstWeek.length, 150);
  assert.deepEqual([...weekdays].sort(), [1, 2, 3, 4, 5]);
  assert.ok(counts.every((assignments) => assignments.length === 30));
});

test('a generic Sunday experiment note does not turn Sunday into routine overflow', () => {
  const rows = Array.from({ length: 185 }, (_, index) => row({
    id: index + 1,
    business: 'gnk',
    suggestedWindow: 'Tue–Thu, 7:00–9:00am recipient local; test Sun 4:30–6:30pm',
  }));
  const plan = planCapacitySchedule(rows, { start: '2026-08-03' });
  const saturday = plan.assignments.filter((assignment) => localParts(assignment.scheduled_for).date === '2026-08-08');
  const sunday = plan.assignments.filter((assignment) => localParts(assignment.scheduled_for).date === '2026-08-09');

  assert.equal(plan.weekend_policy, 'person-specific-opt-in');
  assert.equal(saturday.length, 0);
  assert.equal(sunday.length, 0);
});

test('an explicit recipient-local Sunday suggestion can opt one person into Sunday', () => {
  const suggestion = '2026-08-09T15:00:00.000Z';
  const plan = planCapacitySchedule([row({
    id: 1,
    suggestedFor: suggestion,
    suggestedTimezone: 'Europe/London',
  })], { start: '2026-08-03' });
  const assignment = plan.assignments[0];

  assert.equal(localParts(assignment.scheduled_for).date, '2026-08-09');
  assert.ok(new Date(assignment.scheduled_for) >= new Date(suggestion));
  assert.match(assignment.schedule_reason, /explicitly falls on Sunday/);
});

test('an explicit recipient-local Saturday suggestion can opt one person into Saturday', () => {
  const suggestion = '2026-08-08T15:00:00.000Z';
  const plan = planCapacitySchedule([row({
    id: 1,
    suggestedFor: suggestion,
    suggestedTimezone: 'Europe/London',
  })], { start: '2026-08-03' });
  const assignment = plan.assignments[0];

  assert.equal(localParts(assignment.scheduled_for).date, '2026-08-08');
  assert.ok(new Date(assignment.scheduled_for) >= new Date(suggestion));
  assert.match(assignment.schedule_reason, /explicitly falls on Saturday/);
});

test('sends are dispersed inside the configured working window for each day', () => {
  const rows = Array.from({ length: 210 }, (_, index) => row({
    id: index + 1,
    business: 'outagehub',
  }));
  const plan = planCapacitySchedule(rows, { start: '2026-08-03' });
  for (const assignment of plan.assignments) {
    const parts = localParts(assignment.scheduled_for);
    const window = WEEKLY_SEND_WINDOWS[parts.weekday];
    assert.ok(parts.minutes >= window.start, `${assignment.scheduled_for} starts before ${window.label}`);
    assert.ok(parts.minutes <= window.end, `${assignment.scheduled_for} ends after ${window.label}`);
  }
  const monday = plan.assignments.filter((assignment) => localParts(assignment.scheduled_for).date === '2026-08-03');
  assert.equal(new Set(monday.map((assignment) => assignment.scheduled_for)).size, 30);
});

test('send jitter is stable, non-round, and does not form one fixed cadence', () => {
  const rows = Array.from({ length: 60 }, (_, index) => row({ id: index + 1 }));
  const first = planCapacitySchedule(rows, { start: '2026-08-03' });
  const second = planCapacitySchedule(rows, { start: '2026-08-03' });
  const monday = first.assignments.filter((assignment) => localParts(assignment.scheduled_for).date === '2026-08-03');
  const gaps = monday.slice(1).map((assignment, index) => (
    new Date(assignment.scheduled_for) - new Date(monday[index].scheduled_for)
  ));

  assert.equal(first.policy, SCHEDULE_POLICY_VERSION);
  assert.deepEqual(
    first.assignments.map((assignment) => assignment.scheduled_for),
    second.assignments.map((assignment) => assignment.scheduled_for),
  );
  assert.ok(first.assignments.every((assignment) => {
    const parts = localParts(assignment.scheduled_for);
    return parts.minute % 2 === 1 && parts.minute % 5 !== 0 && parts.second !== 0;
  }));
  assert.ok(new Set(gaps).size > 1);
});

test('follow-ups keep their minimum cadence and take capacity before new touch 1 emails', () => {
  const existing = [
    row({ id: 1, personId: 1, touch: 1, day: 1 }),
    row({ id: 2, personId: 1, touch: 2, day: 4 }),
  ];
  const newLeads = Array.from({ length: 100 }, (_, index) => row({ id: index + 10, personId: index + 10 }));
  const plan = planCapacitySchedule([...existing, ...newLeads], { start: '2026-08-03' });
  const first = plan.assignments.find((assignment) => assignment.id === 1);
  const followup = plan.assignments.find((assignment) => assignment.id === 2);
  const followupDate = localParts(followup.scheduled_for).date;
  const thatDay = plan.assignments.filter((assignment) => localParts(assignment.scheduled_for).date === followupDate);

  assert.equal(localParts(first.scheduled_for).date, '2026-08-03');
  assert.equal(followupDate, '2026-08-06');
  assert.equal(thatDay.length, 12);
  assert.ok(new Date(followup.scheduled_for) > new Date(first.scheduled_for));
});

test('an owed follow-up re-anchors to the front of the week, not its stale suggestion', () => {
  // Mirrors a real record: T1/T2 already sent last week, T3 still carrying the
  // writer's original ~3-weeks-out day-N suggestion. The next touch is owed now.
  const stale = '2026-08-24T11:00:00.000Z';
  const existing = [
    row({ id: 1, personId: 1, touch: 1, day: 1, status: 'sent', scheduledFor: '2026-07-29T11:00:00.000Z' }),
    row({ id: 2, personId: 1, touch: 2, day: 4, status: 'sent', scheduledFor: '2026-07-31T11:00:00.000Z' }),
    row({ id: 3, personId: 1, touch: 3, day: 8, status: 'draft', scheduledFor: stale, suggestedFor: stale }),
  ];
  // A wall of brand-new touch-1 leads must not crowd the owed follow-up out.
  const newLeads = Array.from({ length: 100 }, (_, index) => row({ id: index + 10, personId: index + 10 }));
  const plan = planCapacitySchedule([...existing, ...newLeads], { start: '2026-08-03' });
  const followup = plan.assignments.find((assignment) => assignment.id === 3);

  assert.ok(followup, 'the owed follow-up is scheduled');
  // Lands at the very front of the week (Mon 08-03), weeks before the stale date.
  assert.equal(localParts(followup.scheduled_for).date, '2026-08-03');
  assert.ok(new Date(followup.scheduled_for) < new Date(stale));
  // ...and it beats new touch-1 outreach for that first day's capacity.
  const firstDay = plan.assignments.filter((assignment) => (
    localParts(assignment.scheduled_for).date === '2026-08-03'
  ));
  assert.ok(firstDay.some((assignment) => assignment.id === 3));
});

test('each sending brand receives its own independent 30-email budget', () => {
  const rows = ['wapahki', 'gnk', 'outagehub'].flatMap((business, businessIndex) => (
    Array.from({ length: 35 }, (_, index) => row({
      id: (businessIndex * 100) + index + 1,
      personId: (businessIndex * 100) + index + 1,
      business,
    }))
  ));
  const plan = planCapacitySchedule(rows, { start: '2026-08-03' });
  for (const business of ['wapahki', 'gnk', 'outagehub']) {
    const monday = plan.assignments.filter((assignment) => (
      assignment.business === business && localParts(assignment.scheduled_for).date === '2026-08-03'
    ));
    assert.equal(monday.length, 30);
  }
});

test('an explicit person-specific Monday alternative can fill the preceding Monday', () => {
  const suggestion = '2026-08-04T11:00:00.000Z'; // Tuesday 7:00am Toronto.
  const rows = Array.from({ length: 31 }, (_, index) => row({
    id: index + 1,
    suggestedFor: suggestion,
    suggestedTimezone: 'America/Toronto',
    suggestedWindow: 'Tue–Thu, 6:30–8:00am recipient local; test Sun ~10:00am or Mon ~7:00am',
  }));
  const plan = planCapacitySchedule(rows, { start: '2026-08-03' });
  const byDate = Object.groupBy(plan.assignments, (assignment) => localParts(assignment.scheduled_for).date);

  assert.equal(byDate['2026-08-03'].length, 30);
  assert.equal(byDate['2026-08-04'].length, 1);
  assert.ok(byDate['2026-08-03'].every((assignment) => (
    assignment.schedule_reason.includes("person's explicit Monday alternative")
  )));
  assert.ok(byDate['2026-08-04'].every((assignment) => (
    new Date(assignment.scheduled_for) >= new Date(suggestion)
  )));
});

test('the role-specific suggested send is a not-before anchor and overflow only moves later', () => {
  const suggestion = '2026-08-04T11:00:00.000Z'; // Tuesday noon London / 7:00am Toronto.
  const rows = Array.from({ length: 31 }, (_, index) => row({
    id: index + 1,
    suggestedFor: suggestion,
  }));
  const plan = planCapacitySchedule(rows, { start: '2026-08-03' });
  const byDate = Object.groupBy(plan.assignments, (assignment) => localParts(assignment.scheduled_for).date);

  assert.equal(byDate['2026-08-03'], undefined);
  assert.equal(byDate['2026-08-04'].length, 30);
  assert.equal(byDate['2026-08-05'].length, 1);
  assert.ok(plan.assignments.every((assignment) => new Date(assignment.scheduled_for) >= new Date(suggestion)));
});
