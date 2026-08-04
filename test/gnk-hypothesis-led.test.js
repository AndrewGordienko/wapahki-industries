import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceBatchSchemaForCampaign } from '../src/codex.js';
import {
  GNK_PILOT_CUSTOMER_MOTION,
  evaluateGnkHypothesis,
  getPursuitMotion,
} from '../src/pursuit-policy.js';
import { classifyGnkContact, rankGnkContacts, selectGnkBuyingGroup } from '../src/gnk-sales.js';
import { GNK_SEQUENCE_JOBS, validateSequence } from '../src/outreach-quality.js';

const email = (touch, day, subject, content) => ({
  touch,
  day,
  channel: 'email',
  subject,
  body: `Hi Maya,\n\n${content}\n\nThanks,\nAndrew Gordienko\nGnK`,
});

function validLearningSequence() {
  return [
    email(1, 1, 'Inspection follow-up work', 'BCTS road procedure covers bridge and major-culvert inspections, including reviewing relevant earlier assessments. When an inspection identifies a condition that may require action, is the completed report enough to move the work forward, or does someone separately compare the finding with earlier assessments and decide the follow-up?\n\nI run GnK, a small software and AI team in Toronto. I am trying to establish whether that handoff creates real work before assuming another tool is needed, and an email answer is useful even if one existing system already handles it end to end.'),
    email(2, 4, 'Inspection follow-up work', 'BCTS guidance already allows inspection reports to be completed on paper, in Word or through a handheld application, so capturing the report may not be the hard part. On the last finding that required action, who compared it with the earlier assessment, decided what needed to happen, and recorded that it was complete?'),
    { touch: 3, day: 6, channel: 'linkedin', subject: null, body: 'Hi Maya, I am looking at what happens after a BCTS bridge or major-culvert inspection identifies a condition requiring action, and whether the follow-up stays within the business area.' },
    email(4, 9, 'Reconciling inspection findings', 'On another question like this, the difficulty was less about the inspection itself and more about reconciling a new finding with earlier assessments before deciding what to do. Does that match how it works in your area, or does the follow-up sit somewhere else entirely?'),
    { touch: 5, day: 11, channel: 'linkedin', subject: null, body: 'If that reconciliation happens, does one existing system already carry it end to end, or do people move between the report, the earlier assessment, and their own notes?' },
    email(6, 15, 'One recent case', 'If it would help, I would value walking through one recent completed case to understand where the real effort sat, purely to learn the process rather than to propose anything. Even a short note on how the last one went would be useful.'),
    email(7, 18, 'Follow-up decision owner', 'I will close the loop on this. I am trying to identify who owns the decision after an inspection identifies a condition requiring attention. Is that corporate operations, engineering, or road staff within each business area? A job title is enough.'),
  ];
}

test('GnK uses the seven qualify-first learning jobs', () => {
  const schema = sequenceBatchSchemaForCampaign('gnk');
  assert.deepEqual(
    schema.properties.sequences.items.properties.spoken_brief.properties.touch_plan.items.properties.job.enum,
    [...GNK_SEQUENCE_JOBS.values()],
  );
});

test('GnK pilot customers use the evidence-to-expansion ladder', () => {
  const motion = getPursuitMotion('pilot_customer', 'gnk');
  assert.equal(motion, GNK_PILOT_CUSTOMER_MOTION);
  assert.deepEqual(motion.steps.map((step) => step.step_key), [
    'research', 'open', 'correct_owner', 'discovery', 'quantified_case', 'paid_pilot', 'expansion',
  ]);
});

test('GnK account thesis requires all seven fields and the complete screen', () => {
  const scorecard = {
    frequent: true,
    expensive_when_poor: true,
    measurable: true,
    records_exist: true,
    identifiable_owner: true,
    testable_30_45_days: true,
    supports_40k_90k_engagement: true,
  };
  const result = evaluateGnkHypothesis({
    observed_fact: 'The company publicly reports the operating event.',
    problem: 'The recurring reconstruction may delay a decision.',
    workflow_owner: 'Director of Operations',
    consequence: 'Time and recoverable dollars to measure.',
    records: 'Historical notices and shipment records.',
    offer: 'Review historical cases over 30 days.',
    kill_condition: 'Stop if the company does not perform the work.',
    workflow_scorecard: scorecard,
    qualification: {},
  });
  assert.equal(result.ready, true);
  assert.equal(result.errors.length, 0);
  assert.match(result.warnings[0], /Pause after discovery/);

  const incomplete = evaluateGnkHypothesis({ workflow_scorecard: {} });
  assert.equal(incomplete.ready, false);
  assert.ok(incomplete.errors.some((error) => error.startsWith('Workflow screen incomplete:')));
});

test('role-led ranking keeps routers behind people close to the work', () => {
  const people = [
    { id: 1, title: 'Vice President Human Resources', relevance_score: 10 },
    { id: 2, title: 'Operations Supervisor', relevance_score: 7 },
    { id: 3, title: 'Director of Information Security', relevance_score: 6 },
  ];
  assert.equal(classifyGnkContact(people[0]), 'router');
  assert.deepEqual(rankGnkContacts(people).map((person) => person.id), [2, 3, 1]);
});

test('the first three routes reserve a seat for a technical or economic owner', () => {
  const people = [
    { id: 1, title: 'Operations Director', relevance_score: 10 },
    { id: 2, title: 'Procurement Director', relevance_score: 9 },
    { id: 3, title: 'Operations Manager', relevance_score: 8 },
    { id: 4, title: 'Chief Information Officer', relevance_score: 7 },
    { id: 5, title: 'Vice President Human Resources', relevance_score: 10 },
  ];
  assert.deepEqual(selectGnkBuyingGroup(people, 3).map((person) => person.id), [1, 2, 4]);
});

test('accepts a seven-stage GnK learning sequence without premature economics or pilot copy', () => {
  assert.deepEqual(validateSequence({
    contact: { first_name: 'Maya', outreach_route: 'owner_or_evaluator' },
    campaign: 'gnk',
    touches: validLearningSequence(),
  }), []);
});

test('rejects a pilot pitch after silence', () => {
  const touches = validLearningSequence();
  touches[3].body = touches[3].body.replace(
    'somewhere else entirely?',
    'somewhere else entirely? We could scope a fixed-fee paid pilot to find out.',
  );
  const errors = validateSequence({
    contact: { first_name: 'Maya', outreach_route: 'owner_or_evaluator' },
    campaign: 'gnk',
    touches,
  });
  assert.ok(errors.includes('GnK no-reply sequence must not pitch a pilot before discovery confirms the task'));
});

test('rejects internal qualification and proof-boundary language in buyer copy', () => {
  const touches = validLearningSequence();
  touches[0].body = touches[0].body.replace(
    'an email answer is useful even if one existing system already handles it end to end.',
    'The source does not prove the internal operating task. I am not assuming this sits with you.',
  );
  const errors = validateSequence({
    contact: { first_name: 'Maya', outreach_route: 'owner_or_evaluator' },
    campaign: 'gnk',
    touches,
  });
  assert.ok(errors.some((error) => error.includes('leaks proof-boundary language')));
  assert.ok(errors.some((error) => error.includes('leaks visible hedging')));
});

test('a draft touch 2 may inherit an immutable legacy thread subject', () => {
  const touches = validLearningSequence();
  touches[0].subject = 'Legacy Retail Chargeback Recovery Thread';
  touches[0].status = 'sent';
  touches[1].subject = touches[0].subject;
  assert.deepEqual(validateSequence({
    contact: { first_name: 'Maya', outreach_route: 'owner_or_evaluator' },
    campaign: 'gnk',
    touches,
  }), []);
});
