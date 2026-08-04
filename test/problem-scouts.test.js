import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROBLEM_SCOUTS,
  acceptScoutCandidate,
  allocateScoutCounts,
  isSourcedAdvertisedSignal,
} from '../src/problem-scouts.js';

test('default six-candidate run includes every scout without increasing the total', () => {
  const allocations = allocateScoutCounts(6);
  assert.equal(
    allocations.reduce((total, allocation) => total + allocation.count, 0),
    6,
  );
  assert.deepEqual(
    new Set(allocations.map(({ scout }) => scout.id)),
    new Set(PROBLEM_SCOUTS.map((scout) => scout.id)),
  );
  assert.equal(
    allocations.find(({ scout }) => scout.id === 'company-admissions').count,
    2,
  );
});

test('advertised-pain scouts reject candidates without a direct URL', () => {
  const scout = PROBLEM_SCOUTS.find((item) => item.id === 'company-admissions');
  assert.equal(acceptScoutCandidate({ advertised_signals: [] }, scout), false);
  assert.equal(
    acceptScoutCandidate({
      advertised_signals: [{
        company: 'Example Co',
        statement: 'A real disclosed bottleneck',
        observed_at: '2026-07-29',
        url: 'not-a-url',
      }],
    }, scout),
    false,
  );
});

test('sourced signals accept a dated HTTP(S) company disclosure', () => {
  const signal = {
    company: 'Example Co',
    statement: 'The company says specialist capacity is constraining delivery.',
    consequence: 'Delivery backlog; not quantified.',
    observed_at: '2026-07-29',
    url: 'https://example.com/investors/update',
    signal_type: 'talent-shortage',
    relationship: 'target-admission',
  };
  assert.equal(isSourcedAdvertisedSignal(signal), true);
  const scout = PROBLEM_SCOUTS.find((item) => item.id === 'talent-bottlenecks');
  assert.equal(acceptScoutCandidate({ advertised_signals: [signal] }, scout), true);
});
