import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasQuantifiedEconomics,
  looksLikeIllustrativeCostAnalysis,
  validateIllustrativeCostAnalysis,
} from '../src/cost-analysis.js';

const transparentModel = [
  'If four project-controls staff each spend 10 hours a week for eight weeks rebuilding the delay history, that is roughly 320 hours.',
  'At a blended cost of $125 an hour, the reconstruction costs about $40,000.',
  'Is this the right order of magnitude, or does most of the effort happen elsewhere?',
].join(' ');

test('accepts transparent assumption math with a calibration question', () => {
  assert.equal(hasQuantifiedEconomics(transparentModel), true);
  assert.equal(looksLikeIllustrativeCostAnalysis(transparentModel), true);
  assert.deepEqual(validateIllustrativeCostAnalysis(transparentModel), []);
});

test('does not mistake a public funding fact or sample transaction for a cost model', () => {
  assert.equal(looksLikeIllustrativeCostAnalysis(
    'Kardium announced US$250M in 2025 to support commercial launch and manufacturing expansion.',
  ), false);
  assert.equal(looksLikeIllustrativeCostAnalysis(
    'A worked example would show a $12,000 transaction and the two reports it triggers.',
  ), false);
  assert.equal(looksLikeIllustrativeCostAnalysis(
    'The backlog is projected to grow from $1.75B to $2.54B by 2034 despite annual budgets of $380M.',
  ), false);
});

test('rejects an unsupported total without assumptions, arithmetic, or calibration', () => {
  const unsupported = 'The reconstruction costs $40,000 and our software would save $20,000. Would you be open to a call?';
  assert.equal(looksLikeIllustrativeCostAnalysis(unsupported), true);
  const errors = validateIllustrativeCostAnalysis(unsupported);
  assert.ok(errors.includes('cost analysis does not show enough numeric inputs and output'));
  assert.ok(errors.includes('cost analysis does not label its assumptions'));
  assert.ok(errors.includes('cost analysis does not show the arithmetic bridge'));
  assert.ok(errors.includes('cost analysis does not ask for an order-of-magnitude calibration'));
});

test('recognizes a portfolio time model without a dollar figure', () => {
  const model = 'If each of 30 residences spends 20 minutes checking, that is more than 10 management-hours. Is that order of magnitude close?';
  assert.equal(hasQuantifiedEconomics(model), true);
  assert.deepEqual(validateIllustrativeCostAnalysis(model), []);
});

test('accepts a transparent conversion model in a first touch', () => {
  const model = 'At 40 million monthly sessions, if 1% of shoppers stall before acting, that represents roughly 400,000 missed high-intent actions. Recovering 5% would produce approximately 20,000 additional basket actions.';
  assert.equal(hasQuantifiedEconomics(model), true);
  assert.deepEqual(validateIllustrativeCostAnalysis(model, {
    requireCalibration: false,
  }), []);
});
