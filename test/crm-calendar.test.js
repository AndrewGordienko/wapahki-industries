import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDirectory = mkdtempSync(join(tmpdir(), 'wapahki-crm-calendar-'));
process.env.CRM_DB_PATH = join(testDirectory, 'crm.db');

const { db, insertCompany, upsertPerson } = await import('../src/db.js');
const { crmCalendar } = await import('../src/crm.js');

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

function accountAndPerson({ company, campaign, person, email }) {
  const account = insertCompany({
    name: company,
    campaign,
    source: 'calendar-test',
    target_titles: [],
  });
  const contact = upsertPerson({
    company_id: account.id,
    name: person,
    title: 'Operations Director',
    email,
    lifecycle_status: 'active',
  });
  return { account, contact };
}

function schedule(contact, campaign, {
  at, status = 'draft', channel = 'email', subject = 'scheduled message', touch = 1,
} = {}) {
  return db.prepare(`
    INSERT INTO sequences (
      person_id, campaign, touch, day, channel, subject, body, status,
      scheduled_for, scheduled_local, send_timezone
    ) VALUES (?, ?, ?, ?, ?, ?, 'Hello from the calendar', ?, ?, ?, 'America/Toronto')
  `).run(
    contact.id, campaign, touch, touch, channel, subject, status, at,
    `Tue, 4 Aug 2026, 8:00 am · America/Toronto`,
  );
}

test('calendar collates email sends across Wapahki, GnK and OHUB', () => {
  const wapahki = accountAndPerson({
    company: 'Calendar Fabrication', campaign: 'wapahki', person: 'Wendy Park', email: 'wendy@fabrication.example',
  });
  const gnk = accountAndPerson({
    company: 'Calendar FC', campaign: 'football', person: 'Gareth North', email: 'gareth@football.example',
  });
  const ohub = accountAndPerson({
    company: 'Calendar Utility', campaign: 'outage', person: 'Omar Hill', email: 'omar@utility.example',
  });
  const replied = accountAndPerson({
    company: 'Replied Account', campaign: 'gnk', person: 'Rina Bell', email: 'rina@replied.example',
  });
  db.prepare("UPDATE people SET replied_at='2026-08-01T10:00:00.000Z' WHERE id=?").run(replied.contact.id);

  schedule(wapahki.contact, 'wapahki', { at: '2026-08-04T11:00:00.000Z' });
  schedule(gnk.contact, 'football', { at: '2026-08-04T12:00:00.000Z', status: 'approved', subject: 'fixture workflow' });
  schedule(ohub.contact, 'outage', { at: '2026-08-04T13:00:00.000Z', status: 'sent' });
  schedule(replied.contact, 'gnk', { at: '2026-08-05T12:00:00.000Z' });
  schedule(wapahki.contact, 'wapahki', { at: '2026-08-04T14:00:00.000Z', channel: 'linkedin', touch: 2 });
  schedule(wapahki.contact, 'wapahki', { at: '2026-08-10T00:00:00.000Z', subject: 'range boundary', touch: 3 });

  const calendar = crmCalendar({
    start: '2026-08-03T00:00:00.000Z',
    end: '2026-08-10T00:00:00.000Z',
  });

  assert.equal(calendar.events.length, 4);
  assert.deepEqual(calendar.events.map((event) => event.business), ['wapahki', 'gnk', 'outagehub', 'gnk']);
  assert.deepEqual(calendar.events.map((event) => event.delivery_status), ['draft', 'approved', 'sent', 'blocked']);
  assert.match(calendar.events.at(-1).blockers.join(' '), /already replied/);
  assert.deepEqual(calendar.summary.by_business, { wapahki: 1, gnk: 2, outagehub: 1 });
  assert.equal(calendar.summary.draft, 1);
  assert.equal(calendar.summary.approved, 1);
  assert.equal(calendar.summary.sent, 1);
  assert.equal(calendar.summary.blocked, 1);
  assert.equal(calendar.automation.sender_connected, false);
  assert.equal(calendar.automation.sendable_status, 'approved');
  assert.equal(calendar.automation.source_of_truth, 'sequences.scheduled_for');
});

test('calendar search covers account, recipient and subject without leaking LinkedIn tasks', () => {
  const result = crmCalendar({
    start: '2026-08-03T00:00:00.000Z',
    end: '2026-08-10T00:00:00.000Z',
    search: 'fixture workflow',
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].company_name, 'Calendar FC');
  assert.equal(result.events[0].channel, 'email');
});

test('calendar rejects inverted and overly broad ranges', () => {
  assert.throws(() => crmCalendar({
    start: '2026-08-10T00:00:00.000Z', end: '2026-08-03T00:00:00.000Z',
  }), /end must be after start/);
  assert.throws(() => crmCalendar({
    start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z',
  }), /cannot exceed 93 days/);
});
