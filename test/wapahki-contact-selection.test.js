import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWapahkiContacts, wapahkiRoleKey } from '../src/wapahki-contact-selection.js';

const person = (id, name, title, score = 10) => ({ id, name, title, relevance_score: score });

test('same-title contacts are alternatives rather than parallel recipients', () => {
  const result = selectWapahkiContacts({ name: 'Example Foods' }, [
    person(1, 'A', 'Plant Manager'),
    person(2, 'B', 'Plant Manager'),
    person(3, 'C', 'Maintenance Manager'),
    person(4, 'D', 'Quality Manager'),
  ]);
  assert.deepEqual(result.selected.map((item) => item.id), [1, 3, 4]);
  assert.ok(result.alternates.some((item) => item.id === 2));
});

test('Aurora uses Renato and keeps Rob out of the active three', () => {
  const result = selectWapahkiContacts({ name: 'Aurora Importing & Distributing' }, [
    person(969, 'Rob Mete', 'Warehouse Manager'),
    person(970, 'Renato Pasquale', 'Warehouse Manager'),
    person(2915, 'Jasmeet Singh', 'Customer Service and Logistic Coordinator', 7),
    person(2916, 'Paola Goncalves', 'Logistics Coordinator', 7),
    person(2917, 'Krystal Ordonez', 'Sales and Marketing Coordinator', 5),
  ]);
  assert.deepEqual(result.selected.map((item) => item.name), [
    'Renato Pasquale', 'Jasmeet Singh', 'Krystal Ordonez',
  ]);
  assert.ok(result.alternates.some((item) => item.name === 'Rob Mete'));
});

test('Biowell includes Purvi and does not run a parallel QA/QC route to Foram', () => {
  const result = selectWapahkiContacts({ name: 'Biowell Laboratories' }, [
    person(2815, 'Sunil Patel', 'Supply Chain Manager', 7),
    person(2885, 'Dhrumil Patel', 'Regulatory Compliance Associate', 7),
    person(2886, 'Foram Patel', 'QA/ QC Associate', 7),
    person(2887, 'Purvi Adhvaryu', 'QA/QC Associate', 7),
  ]);
  assert.deepEqual(result.selected.map((item) => item.name), [
    'Sunil Patel', 'Dhrumil Patel', 'Purvi Adhvaryu',
  ]);
  assert.equal(wapahkiRoleKey('QA/ QC Associate'), wapahkiRoleKey('QA/QC Associate'));
});
