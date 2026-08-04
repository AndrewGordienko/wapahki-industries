import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areDistinctSubjectThreads,
  isGenericSubject,
  normalizeSubject,
  sourcePhraseIsGrounded,
  validatePersonalizedSubject,
} from '../src/subject-lines.js';

const context = {
  contactName: 'Arlette Watwood',
  company: 'Carbon Upcycling',
  sourceText: 'new cement plant local feedstock starting recipe operating range commissioning',
};

test('normalizes subject casing and salesy punctuation', () => {
  assert.equal(normalizeSubject('  starting recipe?  '), 'Starting recipe');
});

test('preserves deliberate acronyms and product capitalization', () => {
  assert.equal(normalizeSubject('  API coverage at OutageHub  '), 'API coverage at OutageHub');
});

test('accepts a grounded work topic', () => {
  assert.deepEqual(validatePersonalizedSubject('New plant starting recipes', context), []);
});

test('requires natural sentence capitalization without forced Title Case', () => {
  assert.match(
    validatePersonalizedSubject('new plant starting recipes', context).join(' '),
    /sentence (?:case|capitalization)/,
  );
  assert.match(
    validatePersonalizedSubject('New Plant Starting Recipes', context).join(' '),
    /forced Title Case/,
  );
  assert.deepEqual(validatePersonalizedSubject('API starting recipe', context), []);
});

test('rejects generic curiosity bait', () => {
  assert.equal(isGenericSubject('quick question'), true);
  assert.match(validatePersonalizedSubject('quick question', context).join(' '), /generic/);
});

test('rejects fake personalization by company name', () => {
  assert.match(validatePersonalizedSubject('Carbon upcycling idea', context).join(' '), /company name/);
});

test('allows an operational term that happens to overlap part of a company name', () => {
  const errors = validatePersonalizedSubject('Commercial credit data flow', {
    contactName: 'Pat Example',
    company: 'Commercial Credit Adjustors',
    sourceText: 'commercial credit data flow and reporting',
  });
  assert.deepEqual(errors, []);
});

test('allows opportunity when it names the actual workflow', () => {
  const errors = validatePersonalizedSubject('Creator opportunity ranking', {
    contactName: 'Pat Example',
    company: 'Media Company',
    sourceText: 'rank creator opportunities for editorial review',
  });
  assert.deepEqual(errors, []);
});

test('rejects a topic disconnected from the evidence and email', () => {
  assert.match(validatePersonalizedSubject('Renewal pricing review', context).join(' '), /not grounded/);
});

test('requires a materially different T4 thread rather than cosmetic wording', () => {
  assert.equal(areDistinctSubjectThreads('Packing change', 'Packing changes'), false);
  assert.equal(areDistinctSubjectThreads('Packing changes', 'Scheduled inspection boundary'), true);
});

test('supports distinct Wapahki T1, T4, and T7 subject jobs', () => {
  const subjects = [
    'Repeating packing movements',
    'One-area packing hypothesis',
    'Closing the packing question',
  ];
  for (let left = 0; left < subjects.length; left += 1) {
    for (let right = left + 1; right < subjects.length; right += 1) {
      assert.equal(areDistinctSubjectThreads(subjects[left], subjects[right]), true);
    }
  }
  assert.equal(areDistinctSubjectThreads('Packing movement hypothesis', 'Packing movements hypothesis'), false);
});

test('accepts only a short verbatim source phrase', () => {
  const source = 'The operator resets the line after a box change.';
  assert.equal(sourcePhraseIsGrounded('resets the line', source), true);
  assert.equal(sourcePhraseIsGrounded('line reset burden', source), false);
  assert.equal(sourcePhraseIsGrounded('line', source), false);
});

test('requires both message and recipient grounding when requested', () => {
  assert.deepEqual(validatePersonalizedSubject('Packing reset ownership', {
    sourceText: 'production manager packing reset ownership after a line stop',
    messageText: 'The email asks who owns a packing reset after a line stop.',
    recipientText: 'production manager owns packing reset decisions',
    requireRecipientGrounding: true,
  }), []);
  assert.match(validatePersonalizedSubject('Packing material exceptions', {
    sourceText: 'maintenance manager packing material exceptions',
    messageText: 'The email discusses packing material exceptions.',
    recipientText: 'maintenance manager reset ownership',
    requireRecipientGrounding: true,
  }).join(' '), /not specific to this recipient/);
});
