import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDirectory = mkdtempSync(join(tmpdir(), 'wahpaki-sequence-storage-'));
process.env.CRM_DB_PATH = join(testDirectory, 'crm.db');
process.env.ALLOW_LEGACY_SEQUENCE_WRITE = '1';

const {
  db,
  insertCompany,
  listSequencesByPerson,
  rebalanceEmailSchedule,
  replaceSequence,
  upsertPerson,
} = await import('../src/db.js');
const { editSequence } = await import('../src/crm.js');

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test('full-sequence replacement is atomic and refuses to overwrite protected copy', () => {
  const company = insertCompany({
    name: 'Sequence Storage Test',
    campaign: 'gnk',
    source: 'test',
    target_titles: [],
  });
  const person = upsertPerson({
    company_id: company.id,
    name: 'Alex Morgan',
    first_name: 'Alex',
    email: 'alex@sequence-storage.example',
  });
  db.prepare("UPDATE system_settings SET value='true' WHERE key='legacy_writers_enabled'").run();

  const touches = Array.from({ length: 7 }, (_, index) => ({
    touch: index + 1,
    day: [1, 4, 6, 9, 11, 15, 18][index],
    channel: [1, 2, 4, 6].includes(index + 1) ? 'email' : 'linkedin',
    subject: [1, 2, 4, 6].includes(index + 1) ? `subject ${index + 1}` : null,
    body: `Touch ${index + 1}`,
  }));

  assert.equal(replaceSequence(person.id, 'gnk', touches).length, 7);
  const first = listSequencesByPerson(person.id)[0];
  db.prepare("UPDATE sequences SET status='sent' WHERE id=?").run(first.id);

  assert.throws(
    () => replaceSequence(person.id, 'gnk', touches),
    /approved or sent messages cannot be replaced/i,
  );
  assert.equal(listSequencesByPerson(person.id).length, 7);
  assert.equal(listSequencesByPerson(person.id)[0].status, 'sent');
});

test('sent messages cannot be edited or marked unsent', () => {
  const company = insertCompany({
    name: 'Sent Sequence Immutability Test',
    campaign: 'gnk',
    source: 'test',
    target_titles: [],
  });
  const person = upsertPerson({
    company_id: company.id,
    name: 'Taylor Morgan',
    first_name: 'Taylor',
    email: 'taylor@sent-sequence.example',
  });
  db.prepare("UPDATE system_settings SET value='true' WHERE key='legacy_writers_enabled'").run();
  const touches = Array.from({ length: 7 }, (_, index) => ({
    touch: index + 1,
    day: [1, 4, 6, 9, 11, 15, 18][index],
    channel: [1, 2, 4, 6].includes(index + 1) ? 'email' : 'linkedin',
    subject: [1, 2, 4, 6].includes(index + 1) ? `subject ${index + 1}` : null,
    body: `Touch ${index + 1}`,
  }));
  replaceSequence(person.id, 'gnk', touches);
  const first = listSequencesByPerson(person.id)[0];
  editSequence(first.id, { status: 'sent' });

  assert.throws(
    () => editSequence(first.id, { subject: 'rewritten history' }),
    /sent messages are immutable/i,
  );
  assert.throws(
    () => editSequence(first.id, { status: 'draft' }),
    /sent messages are immutable/i,
  );
  assert.equal(editSequence(first.id, { status: 'sent' }).status, 'sent');
});

test('recovery-held and task-gated drafts stay out of automatic scheduling', () => {
  const company = insertCompany({
    name: 'Recovery Schedule Hold Test',
    campaign: 'gnk',
    source: 'test',
    target_titles: [],
  });
  const person = upsertPerson({
    company_id: company.id,
    name: 'Jordan Lee',
    first_name: 'Jordan',
    email: 'jordan@recovery-hold.example',
  });
  db.prepare("UPDATE system_settings SET value='true' WHERE key='legacy_writers_enabled'").run();
  const touches = Array.from({ length: 7 }, (_, index) => ({
    touch: index + 1,
    day: [1, 4, 6, 9, 11, 15, 18][index],
    channel: [1, 2, 4, 6].includes(index + 1) ? 'email' : 'linkedin',
    subject: [1, 2, 4, 6].includes(index + 1) ? `subject ${index + 1}` : null,
    body: `Touch ${index + 1}`,
  }));
  replaceSequence(person.id, 'gnk', touches);
  const [first, second] = listSequencesByPerson(person.id);
  db.prepare(`
    UPDATE sequences SET scheduled_for=NULL, scheduled_local=NULL,
      schedule_policy='gnk_recovery_hold_v1' WHERE id=?
  `).run(first.id);
  db.prepare(`
    UPDATE sequences SET scheduled_for=NULL, scheduled_local=NULL,
      schedule_policy='gnk_recovery_draft_v1' WHERE id=?
  `).run(second.id);

  const plan = rebalanceEmailSchedule({ start: '2026-08-03' });
  assert.ok(!plan.assignments.some((assignment) => [first.id, second.id].includes(assignment.id)));
  const held = listSequencesByPerson(person.id).slice(0, 2);
  assert.deepEqual(held.map((message) => message.scheduled_for), [null, null]);
});
