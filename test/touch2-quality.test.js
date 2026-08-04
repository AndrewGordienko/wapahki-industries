import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTouch2Body,
  validateTouch2,
} from '../src/touch2-quality.js';

const t1 = [
  'Hi Ava,',
  '',
  'When the packaging line changes box sizes, who decides which stacking pattern the robot should use and which checks an operator can safely make after a stop?',
  '',
  'I am designing a robot arm for repetitive packing work. The screen would keep the box size and stacking pattern visible while leaving maintenance decisions with the plant team.',
  '',
  'Would you be open to a 20-minute call?',
  '',
  'Thanks,',
  'Andrew Gordienko',
  'Founder, Wapahki Industries',
].join('\n');

test('normalizes a T2 greeting and campaign signature', () => {
  const body = normalizeTouch2Body(
    'Hi Someone,\n\nA useful note.\n\nWould the box size help your team decide?\n\nThanks,\nAndrew\nWapahki Industries',
    { campaign: 'wapahki', firstName: 'Ava' },
  );
  assert.ok(body.startsWith('Hi Ava,\n\n'));
  assert.ok(body.endsWith('Thanks,\nAndrew Gordienko\nFounder, Wapahki Industries'));
});

test('accepts a concise same-thread T2 that advances T1', () => {
  const body = [
    'Hi Ava,',
    '',
    'I am trying to distinguish the normal packing step from a downstream transfer that repeats after packing.',
    '',
    'Does your line have any step like that, or are the two usually part of the same process?',
    '',
    'Thanks,',
    'Andrew Gordienko',
    'Founder, Wapahki Industries',
  ].join('\n');
  assert.deepEqual(validateTouch2({
    campaign: 'wapahki',
    firstName: 'Ava',
    t1Subject: 'box change resets',
    t1Body: t1,
    t2Subject: 'box change resets',
    t2Body: body,
  }), []);
});

test('rejects a new subject, legacy signature, and reminder language', () => {
  const body = [
    'Hi Ava,',
    '',
    'Just following up on my previous email about the packaging line and box sizes. I wanted to check in because the robot screen could show the stacking pattern and the operator change after a stop.',
    '',
    'Would a quick call help?',
    '',
    'Thanks,',
    'Andrew',
    'Wapahki Industries',
  ].join('\n');
  const errors = validateTouch2({
    campaign: 'wapahki',
    firstName: 'Ava',
    t1Subject: 'box change resets',
    t1Body: t1,
    t2Subject: 'robot follow up',
    t2Body: body,
  });
  assert.ok(errors.includes('subject does not exactly match T1'));
  assert.ok(errors.includes('signature is wrong'));
  assert.ok(errors.some((error) => error.includes('just following up')));
  assert.ok(errors.some((error) => error.includes('previous email')));
});

test('rejects invented recent conversations outside the approved Wapahki source pack', () => {
  const body = [
    'Hi Ava,',
    '',
    'Since I wrote, I spoke with a production manager who said every box change creates a new problem on the packaging line. That made me think about the stacking pattern and what an operator can safely change after a stop without involving maintenance.',
    '',
    'Which box change causes the most trouble for your team?',
    '',
    'Thanks,',
    'Andrew Gordienko',
    'GnK',
  ].join('\n');
  const errors = validateTouch2({
    campaign: 'gnk',
    firstName: 'Ava',
    t1Subject: 'box change resets',
    t1Body: t1,
    t2Subject: 'box change resets',
    t2Body: body,
  });
  assert.ok(errors.some((error) => error.includes('unsupported recent-contact claim')));
  assert.ok(errors.some((error) => error.includes('silence-timeline framing')));
  assert.ok(errors.some((error) => error.includes('canned model transition')));
});

test('rejects anonymous call and third-party anecdotes outside Wapahki', () => {
  const body = [
    'Hi Ava,',
    '',
    'On a recent call, a manufacturing manager described a packaging line where every box change created a new problem. The operator still had to recover the stacking pattern after a stop while keeping the maintenance rules visible.',
    '',
    'Which box change creates the most trouble for your team?',
    '',
    'Thanks,',
    'Andrew Gordienko',
    'OutageHub',
  ].join('\n');
  const errors = validateTouch2({
    campaign: 'outagehub',
    firstName: 'Ava',
    t1Subject: 'box change resets',
    t1Body: t1,
    t2Subject: 'box change resets',
    t2Body: body,
  });
  assert.ok(errors.some((error) => error.includes('unsupported call anecdote')));
  assert.ok(errors.some((error) => error.includes('unsupported third-party anecdote')));
});

test('rejects premature screening language in Wapahki T2', () => {
  const body = [
    'Hi Ava,',
    '',
    'The technical screen would separate a repeatable packing move from the exceptions that still need a person to make a safe decision.',
    '',
    'Which material change most often breaks the repeatable pattern on your packaging line and sends the issue to maintenance?',
    '',
    'Thanks,',
    'Andrew Gordienko',
    'Founder, Wapahki Industries',
  ].join('\n');
  const errors = validateTouch2({
    campaign: 'wapahki',
    firstName: 'Ava',
    t1Subject: 'box change resets',
    t1Body: t1,
    t2Subject: 'box change resets',
    t2Body: body,
  });
  assert.ok(errors.some((error) => error.includes('premature sales or screening language')));
});

test('rejects an interview anecdote in Wapahki T2', () => {
  const body = [
    'Hi Ava,',
    '',
    'On a recent call, a manufacturing manager described a packing operation where sealed-case palletizing was more reusable than product case packing because the robot handled finished cases. Case size and pallet pattern still created exceptions.',
    '',
    'For the packaging line you oversee, is palletizing the more stable task or does another finished-case move stay more consistent?',
    '',
    'Thanks,',
    'Andrew Gordienko',
    'Founder, Wapahki Industries',
  ].join('\n');
  const errors = validateTouch2({
    campaign: 'wapahki',
    firstName: 'Ava',
    t1Subject: 'box change resets',
    t1Body: t1,
    t2Subject: 'box change resets',
    t2Body: body,
  });
  assert.ok(errors.some((error) => error.includes('unsupported call anecdote')));
  assert.ok(errors.some((error) => error.includes('unsupported third-party anecdote')));
});

test('does not confuse schedule and meeting-minute evidence with a meeting request', () => {
  const body = [
    'Hi Nasir,',
    '',
    'One review card could put a disputed delay window beside the schedule change, related RFI, change order, and meeting-minute evidence. Each conclusion would stay linked to its source record, while the claims reviewer decides what belongs in the evidence chain and what still needs investigation.',
    '',
    'For the project reviews you oversee, would that card be more useful if it starts from the disputed event or from the conclusion the team needs to substantiate?',
    '',
    'Thanks,',
    'Andrew Gordienko',
    'GnK',
  ].join('\n');
  assert.deepEqual(validateTouch2({
    campaign: 'gnk',
    firstName: 'Nasir',
    t1Subject: 'delay evidence reconstruction',
    t1Body: [
      'Hi Nasir,',
      '',
      'How does the claims team reconstruct a disputed delay window from schedules, RFIs, change orders, and meeting minutes?',
      '',
      'Thanks,',
      'Andrew Gordienko',
      'GnK',
    ].join('\n'),
    t2Subject: 'delay evidence reconstruction',
    t2Body: body,
  }), []);
});

test('accepts an Aecon-style assumption-led cost calibration', () => {
  const body = [
    'Hi Nataliya,',
    '',
    'If four project-controls staff each spend 10 hours a week for eight weeks rebuilding the delay history, that is roughly 320 hours. At a blended cost of $125 an hour, the reconstruction alone costs about $40,000.',
    '',
    'Aecon\'s numbers may be very different. Is this the right order of magnitude, or does most of the effort happen elsewhere in the project-controls process?',
    '',
    'Thanks,',
    'Andrew Gordienko',
    'GnK',
  ].join('\n');
  assert.deepEqual(validateTouch2({
    campaign: 'gnk',
    firstName: 'Nataliya',
    t1Subject: 'delay evidence reconstruction',
    t1Body: [
      'Hi Nataliya,',
      '',
      'When a major project falls behind, how difficult is it to turn the schedule history into a defensible account of what caused the delay? The project record may contain the supporting evidence, but reconstructing it can take experienced project-controls staff weeks.',
      '',
      'Thanks,',
      'Andrew Gordienko',
      'GnK',
    ].join('\n'),
    t2Subject: 'delay evidence reconstruction',
    t2Body: body,
  }), []);
});

test('rejects quantified T2 economics that read like company facts', () => {
  const body = [
    'Hi Nataliya,',
    '',
    'Four project-controls staff spend 10 hours a week rebuilding the delay history. The reconstruction costs $40,000 and a new tool would save $20,000 on every claim.',
    '',
    'Would you be open to a 20-minute conversation next week?',
    '',
    'Thanks,',
    'Andrew Gordienko',
    'GnK',
  ].join('\n');
  const errors = validateTouch2({
    campaign: 'gnk',
    firstName: 'Nataliya',
    t1Subject: 'delay evidence reconstruction',
    t1Body: 'Hi Nataliya,\n\nProject controls reconstruct delay evidence.\n\nThanks,\nAndrew Gordienko\nGnK',
    t2Subject: 'delay evidence reconstruction',
    t2Body: body,
  });
  assert.ok(errors.includes('cost analysis does not label its assumptions'));
  assert.ok(errors.includes('cost analysis does not ask for an order-of-magnitude calibration'));
});
