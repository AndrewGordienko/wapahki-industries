import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceBatchSchema, sequenceBatchSchemaForCampaign } from '../src/codex.js';
import {
  SEQUENCE_JOBS,
  OUTAGEHUB_SEQUENCE_JOBS,
  WAPAHKI_SEQUENCE_JOBS,
  validateSpokenBrief,
} from '../src/outreach-quality.js';

test('requires deal-specific rehearsal and a seven-stage plan in every GnK sequence brief', () => {
  const brief = sequenceBatchSchema
    .properties.sequences.items.properties.spoken_brief;

  for (const field of ['skeptical_question', 'proof_boundary', 'next_step']) {
    assert.ok(brief.required.includes(field), `${field} must be required`);
    assert.equal(brief.properties[field].type, 'string');
  }
  assert.ok(brief.required.includes('research_used'));
  assert.ok(brief.required.includes('touch_plan'));
  assert.equal(brief.properties.touch_plan.minItems, 7);
  assert.equal(brief.properties.touch_plan.maxItems, 7);
});

test('rejects a seven-touch brief whose jobs drift from the canonical series', () => {
  const touchPlan = Array.from({ length: 7 }, (_, index) => {
    const touch = index + 1;
    return {
      touch,
      job: SEQUENCE_JOBS.get(touch),
      personalization_anchor: `verified account fact ${touch}`,
      new_information: `distinct useful detail ${touch}`,
      cta: `stage-appropriate request ${touch}`,
    };
  });
  touchPlan[3].job = 'add_value';

  const errors = validateSpokenBrief({
    research_used: [{ fact: 'A current role-relevant fact', source_url: 'https://example.com/source' }],
    touch_plan: touchPlan,
  });

  assert.ok(errors.includes(`spoken brief touch 4 must use job ${SEQUENCE_JOBS.get(4)}`));
});

test('uses a seven-touch schema and early-discovery jobs for Wapahki', () => {
  const schema = sequenceBatchSchemaForCampaign('wapahki');
  const sequence = schema.properties.sequences.items.properties;
  assert.equal(sequence.touches.minItems, 7);
  assert.equal(sequence.touches.maxItems, 7);
  assert.equal(sequence.spoken_brief.properties.touch_plan.minItems, 7);
  assert.deepEqual(
    sequence.spoken_brief.properties.touch_plan.items.properties.job.enum,
    [...WAPAHKI_SEQUENCE_JOBS.values()],
  );

  const touchPlan = [...WAPAHKI_SEQUENCE_JOBS].map(([touch, job]) => ({
    touch,
    job,
    personalization_anchor: `verified operating fact ${touch}`,
    new_information: `distinct commercial information ${touch}`,
    cta: `stage-appropriate request ${touch}`,
  }));
  assert.deepEqual(validateSpokenBrief({
    research_used: [{ fact: 'Current company fact', source_url: 'https://example.com/source' }],
    touch_plan: touchPlan,
  }, 'wapahki'), []);
});

test('uses a four-touch schema and ownership-first jobs for OutageHub', () => {
  const schema = sequenceBatchSchemaForCampaign('outagehub');
  const sequence = schema.properties.sequences.items.properties;
  assert.equal(sequence.touches.minItems, 4);
  assert.equal(sequence.touches.maxItems, 4);
  assert.equal(sequence.spoken_brief.properties.touch_plan.minItems, 4);
  assert.deepEqual(
    sequence.spoken_brief.properties.touch_plan.items.properties.job.enum,
    [...OUTAGEHUB_SEQUENCE_JOBS.values()],
  );

  const touchPlan = [...OUTAGEHUB_SEQUENCE_JOBS].map(([touch, job]) => ({
    touch,
    job,
    personalization_anchor: `verified operating fact ${touch}`,
    new_information: `distinct decision information ${touch}`,
    cta: `stage-appropriate request ${touch}`,
  }));
  assert.deepEqual(validateSpokenBrief({
    research_used: [{ fact: 'Current company fact', source_url: 'https://example.com/source' }],
    touch_plan: touchPlan,
  }, 'outagehub'), []);
});
