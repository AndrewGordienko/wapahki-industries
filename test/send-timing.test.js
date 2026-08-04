import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSequenceSchedule,
  recommendSendTiming,
  resolveRecipientTimeZone,
} from '../src/send-timing.js';

test('Wapahki warehouse roles get an early local floor window', () => {
  const result = recommendSendTiming({
    campaign: 'wapahki',
    title: 'Warehouse Supervisor',
    channel: 'email',
  });
  assert.match(result.window, /6:00–7:00am recipient local/);
  assert.doesNotMatch(result.window, /Sun/);
});

test('GnK executives get a week-planning experiment as a secondary window', () => {
  const result = recommendSendTiming({
    campaign: 'gnk',
    title: 'Vice President of Operations',
    channel: 'email',
  });
  assert.match(result.window, /Tue–Thu, 7:00–9:00am/);
  assert.match(result.window, /Sun 4:30–6:30pm or Mon ~7:00am/);
});

test('OutageHub operations timing excludes active-outage opportunism', () => {
  const result = recommendSendTiming({
    campaign: 'outagehub',
    title: 'Dispatch Manager',
    channel: 'linkedin',
  });
  assert.match(result.window, /6:30–8:00am recipient local/);
  assert.match(result.window, /steady state only/);
  assert.match(result.reason, /never send opportunistically during an active outage/);
});

test('location resolver distinguishes London Ontario from London UK', () => {
  assert.equal(resolveRecipientTimeZone({ city: 'London, ON', location: 'Canada' }).timezone, 'America/Toronto');
  assert.equal(resolveRecipientTimeZone({ city: 'London', location: 'United Kingdom' }).timezone, 'Europe/London');
});

test('seven-touch schedule returns actual local dates and avoids weekends', () => {
  const touches = [
    [1, 1, 'email'], [2, 4, 'email'], [3, 6, 'linkedin'], [4, 9, 'email'],
    [5, 11, 'linkedin'], [6, 15, 'email'], [7, 18, 'email'],
  ].map(([touch, day, channel]) => ({ touch, day, channel }));
  const schedule = buildSequenceSchedule({
    campaign: 'wapahki',
    title: 'Production Manager',
    city: 'Toronto, Ontario',
    location: 'Canada',
    touches,
    now: new Date('2026-08-01T12:00:00.000Z'),
  });
  assert.equal(schedule.length, 7);
  assert.match(schedule[0].scheduled_local, /Tue, 4 Aug 2026/);
  assert.match(schedule[0].scheduled_local, /America\/Toronto/);
  assert.ok(schedule.every((item) => item.scheduled_for && item.send_timezone === 'America/Toronto'));
  for (let index = 1; index < schedule.length; index++) {
    assert.ok(new Date(schedule[index].scheduled_for) > new Date(schedule[index - 1].scheduled_for));
  }
  assert.ok(schedule.every((item) => !/(?:Sat|Sun),/.test(item.scheduled_local)));
});

test('unknown location is visibly marked for timezone verification', () => {
  const [timing] = buildSequenceSchedule({
    campaign: 'gnk', title: 'COO', touches: [{ touch: 1, day: 1, channel: 'email' }],
    now: new Date('2026-08-01T12:00:00.000Z'),
  });
  assert.match(timing.scheduled_local, /verify timezone/);
  assert.match(timing.timing_reason, /review-required default/);
});
