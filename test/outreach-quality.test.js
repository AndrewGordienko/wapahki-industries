import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSequence } from '../src/outreach-quality.js';

const email = (touch, day, subject, content) => ({
  touch,
  day,
  channel: 'email',
  subject,
  body: `Hi Maya,\n\n${content}\n\nThanks,\nAndrew Gordienko\nFounder, Wapahki Industries`,
});

function validWapahkiSequence() {
  return [
    email(
      1,
      1,
      'Repeating case handoffs',
      'I am Andrew, founder of Wapahki, an early-stage robotics company in Toronto. We are building a flexible robotic cell that picks up and places one product the same way every cycle, and we are trying to find one case-handling or palletizing task that genuinely repeats before we build too far.\n\nAcross two recent production runs, was there a finished-case transfer or palletizing step that stayed essentially the same even though the product and the quality checks changed?\n\nWould you be open to a 20-minute call? Even one recent example by email would help.',
    ),
    email(
      2,
      5,
      'Repeating case handoffs',
      'To make that concrete, I mean sealed cases from several runs leaving the same conveyor point and being transferred or palletized in the same way. Does that movement actually repeat, or do case size, weight, and rate make it different every time?',
    ),
    {
      touch: 3,
      day: 9,
      channel: 'linkedin',
      subject: null,
      body: 'Hi Maya, I am learning where finished-case handoffs stay consistent across production runs. Your view from the floor would help, and I would be glad to connect.',
    },
    email(
      4,
      15,
      'One conveyor point',
      'A narrower version of the same question. At one conveyor point, how often does a person still step in to handle an exception during that transfer, and what usually triggers it, a jam, a mixed pallet, or a label check?',
    ),
    email(
      5,
      20,
      'One conveyor point',
      'You know that floor better than I do. Are you the right person to ask about that finished-case transfer, or would someone in production or engineering be closer to how it actually runs?',
    ),
    {
      touch: 6,
      day: 26,
      channel: 'linkedin',
      subject: null,
      body: 'If one repeated handoff does exist, I could sketch that single task, what arrives, what movement repeats, and which exceptions still need a person. Would that be worth putting on paper?',
    },
    email(
      7,
      32,
      'Closing the handoff note',
      'I will close the thread here on whether one finished-case handoff repeats often enough, with little enough variation, to be worth investigating. If a concrete example comes to mind later, I would be glad to hear it.',
    ),
  ];
}

function validSevenTouchSequence() {
  return [
    email(
      1,
      1,
      'Packing changes',
      'I’m writing because your team packs several different product formats at the same facility. When the product changes, which part still needs the most operator attention? Is it positioning the product, changing the protective material, or dealing with pieces that do not arrive consistently?\n\nI am the founder of Wapahki in Toronto. I am speaking with production teams about robot arms for repetitive packing jobs that change between products.\n\nWould you be open to a 20-minute call? I will bring a rough sketch of the packing move so we can see which step I missed.',
    ),
    email(
      2,
      4,
      'Packing changes',
      'Since I wrote, I spoke with a manufacturing manager whose packing team switched among bubble wrap, board, paper, and boxes for brittle parts. The robot was not the hard part. The material exceptions were.\n\nWhich material change creates the most manual judgment on your line?',
    ),
    {
      touch: 3,
      day: 6,
      channel: 'linkedin',
      subject: null,
      body: 'Hi Maya, I am speaking with production teams about where product variety keeps packing manual, and I thought it would be useful to connect.',
    },
    email(
      4,
      9,
      'Standardizing packing work',
      'On another call, a maintenance leader described starting with scheduled inspections because they repeated more reliably than emergency repairs. That made me wonder whether the same boundary applies on your floor.\n\nWould one scheduled packing job be a better first target than trying to cover every product?',
    ),
    {
      touch: 5,
      day: 11,
      channel: 'linkedin',
      subject: null,
      body: 'I have narrowed the idea to one predictable packing move with a person handling exceptions. Does production or engineering usually choose that kind of first project?',
    },
    email(
      6,
      15,
      'One packing job',
      'The first version would handle one repeatable move and stop safely when the product falls outside the expected position. An operator would decide what happens next rather than the machine guessing.\n\nIs there one move on your line that fits that boundary?',
    ),
    email(
      7,
      18,
      'Closing the packing note',
      'I will leave the packing question here for now. If someone else owns automation trials on your floor, a pointer to the right person would help. If the timing is simply wrong, that is useful for me to know too, and I am glad to try again later when it fits how your team plans work.',
    ),
  ];
}

test('accepts Wapahki’s seven-touch early-discovery progression', () => {
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches: validWapahkiSequence(),
  });
  assert.deepEqual(errors, []);
});

test('rejects a Wapahki touch 1 that stays vague about what Wapahki builds', () => {
  const touches = validWapahkiSequence();
  touches[0] = email(
    1,
    1,
    'Repeating production movements',
    'I am reaching out because, as Production Manager, you would know which product movements genuinely repeat across shifts and which only look repetitive from outside.\n\nI am Andrew, the founder of Wapahki, an early-stage robotics company in Toronto. We are not selling equipment yet. We are speaking with production teams to understand where robotics could genuinely help and which problems are not worth pursuing.\n\nIs there one handling task that still relies on people even though it repeats regularly?\n\nWould you be open to a 20-minute call? An email reply would also be genuinely helpful.',
  );
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki touch 1 must concretely name what Wapahki builds (a robot that performs one repeated pick-and-place or transfer motion)'));
});

test('rejects a touch 3 connection request that asks for a meeting', () => {
  const touches = validWapahkiSequence();
  touches[2].body = 'Hi Maya, would you connect and have a 20-minute call about packing automation?';
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('touch 3 connection request must not ask for a call or meeting'));
});

test('rejects an incomplete six-touch Wapahki sequence', () => {
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches: validWapahkiSequence().slice(0, 6),
  });
  assert.ok(errors.includes('expected 7 touches, got 6'));
});

test('rejects an economic-track Wapahki touch 1 that asks an operational floor question instead of economics', () => {
  const touches = validWapahkiSequence();
  const errors = validateSequence({
    contact: { first_name: 'Maya', title: 'Controller' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki economic touch 1 must ask who determines whether the task repeats across enough programs to justify the investment'));
});

test('rejects a touch 4 that reuses the opening email subject', () => {
  const touches = validWapahkiSequence();
  touches[3].subject = touches[0].subject;
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('touch 4 must open a new email thread with a different subject'));
});

test('rejects a Wapahki closing subject that recycles the hypothesis thread', () => {
  const touches = validWapahkiSequence();
  touches[6].subject = touches[3].subject;
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki touch 7 must use a distinct closing subject'));
});

test('rejects premature Wapahki screening and qualification language', () => {
  const touches = validWapahkiSequence();
  touches[3] = email(
    4,
    15,
    'One conveyor point',
    'Before I run a technical screen to qualify the transfer, could you tell me which conveyor point sees the most consistent case handling?',
  );
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki sequence uses premature technical or fit screen'));
  assert.ok(errors.includes('Wapahki sequence uses premature qualification language'));
});

test('rejects a Wapahki route touch that does not check the right person or function', () => {
  const touches = validWapahkiSequence();
  touches[4].body = email(
    5,
    20,
    'One-area handling hypothesis',
    'I am still learning about repeated production movements and wanted to add one more note about the topic before I finish this thread.',
  ).body;
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki touch 5 must check the route without assuming ownership'));
});

test('rejects a Wapahki opening that claims accountability', () => {
  const touches = validWapahkiSequence();
  touches[0].body = touches[0].body.replace('was there a finished-case transfer', 'since you are accountable for the finished-case transfer, was there a step');
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki sequence must not claim the recipient owns or is accountable for the process'));
});

test('requires a routing Wapahki touch 1 to ask who owns the physical process', () => {
  const touches = validWapahkiSequence();
  // A routing contact still runs the seven stages, but touch 1 must ask who owns
  // the physical process rather than recall a floor example.
  const errors = validateSequence({
    contact: { first_name: 'Maya', title: 'Graphic Designer, Junior Designer' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki routing touch 1 must ask who owns the physical process'));
});

test('rejects a Wapahki touch 1 that presents a product instead of early discovery', () => {
  const touches = validWapahkiSequence();
  touches[0] = email(
    1,
    1,
    'Repeating production movements',
    'I am reaching out because your production title looks relevant to automation. We have equipment ready for deployment and want to identify a task to qualify.\n\nWhich production movement should we automate first?\n\nWould you be open to a 20-minute call? An email reply would also be genuinely helpful.',
  );
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki sequence uses premature qualification language'));
  assert.ok(errors.includes('Wapahki sequence uses premature deployment or pilot language'));
  assert.ok(errors.includes('Wapahki touch 1 must concretely name what Wapahki builds (a robot that performs one repeated pick-and-place or transfer motion)'));
});

test('rejects deployment language in Wapahki follow-ups', () => {
  const touches = validWapahkiSequence();
  touches[1].body = touches[1].body.replace(
    'To make that concrete',
    'Before deployment, to make that concrete',
  );
  const errors = validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  });
  assert.ok(errors.includes('Wapahki sequence uses premature deployment or pilot language'));
});

test('judges only the writable continuation when Wapahki opening emails are immutable', () => {
  const touches = validWapahkiSequence();
  touches[0].status = 'sent';
  touches[0].body = 'Historical sales language that would fail the current early-discovery standard.';
  touches[1].status = 'sent';
  touches[1].body = 'Historical follow-up language that would also fail the current standard.';
  assert.deepEqual(validateSequence({
    contact: { first_name: 'Maya' },
    campaign: 'wapahki',
    touches,
  }), []);
});

test('applies the GnK signature policy to legacy GnK campaign aliases', () => {
  const gnkEmail = (touch, day, subject, content) => ({
    touch,
    day,
    channel: 'email',
    subject,
    body: `Hi Maya,\n\n${content}\n\nThanks,\nAndrew Gordienko\nGnK`,
  });
  const touches = [
    gnkEmail(1, 1, 'Approval evidence question', 'When a requirement changes late in a project, who decides which drawings and approval records need to be reconciled, and how long does that usually take?\n\nI run GnK, a small software and AI team in Toronto. We are exploring a tool that keeps each change beside the approval evidence behind the sign off, for human review.\n\nDoes that reflect a real, recurring task at your company, or is it already handled well today?'),
    gnkEmail(2, 4, 'Approval evidence question', 'A sharper version of what I am testing. In most operations the requirement changes and approval records already exist, and the hard part is reconciling the right ones the moment a change lands.\n\nIs that where the real effort sits at your company, or does it land somewhere else entirely?'),
    { touch: 3, day: 9, channel: 'linkedin', subject: null, body: 'Hi Maya, I am looking at how teams reconcile changed requirements with approval evidence and would be glad to connect.' },
    gnkEmail(4, 18, 'Right person to ask', 'I will close the loop on this. Are you the right person to ask about reconciling changed requirements at your company, or would someone in operations be closer to it? A name or job title is all I need, and I will leave it there.'),
  ];
  const errors = validateSequence({
    contact: { first_name: 'Maya', outreach_route: 'owner_or_evaluator' },
    campaign: 'delay',
    touches,
  });
  assert.ok(!errors.some((error) => error.includes('signature is wrong')));
});

function outageEmail(touch, day, subject, content) {
  return {
    touch,
    day,
    channel: 'email',
    subject,
    body: `Hi Maya,\n\n${content}\n\nThanks,\nAndrew Gordienko\nOutageHub`,
  };
}

function validOutageHubSequence() {
  return [
    outageEmail(
      1,
      1,
      'Power inside site tickets',
      'Beanfield’s network team maintains the site power and monitoring behind its Toronto fibre network. When a storm drives power-related alarms across several sites, does your team still determine the likely cause and dispatch priority, or does the carrier send those already classified?\n\nI run OutageHub, which matches public Canadian utility outage reports to site locations. I am trying to learn whether that would remove a real manual check or simply duplicate the telemetry and tickets Beanfield already receives.\n\nWould you be open to a 20-minute call about one recent incident? I would bring one worked example, and you could tell me whether it removes a step or merely duplicates the network view.',
    ),
    outageEmail(
      2,
      6,
      'Power inside site tickets',
      'The key question is where Beanfield’s responsibility begins. If your NOC receives a trouble ticket with the cause and priority already set, public utility data probably adds little. If your team still checks utility maps or gathers outside context before assigning a crew, there may be something worth testing. If your SLA requires dispatch regardless of the cause, it likely changes nothing.\n\nWhich is closest to how it works today?',
    ),
    outageEmail(
      3,
      13,
      'Past storm check',
      'If Beanfield owns any part of that triage step, the simplest test would use closed tickets from a past storm. We would match public utility events to the relevant site locations and timestamps, then compare the time taken and the dispatch decisions against your existing record. The utility match stays supporting context, not proof a site lost power.\n\nWould Beanfield hold those historical tickets, or does the carrier keep them?',
    ),
    outageEmail(
      4,
      21,
      'Alarm dispatch handoff',
      'I will close the loop. I am trying to find who owns the handoff between a power-related site alarm and field dispatch during a regional outage.\n\nIs that your team, another Beanfield operations group, or entirely on the carrier side? A name or job title is all I need.',
    ),
  ];
}

test('accepts OutageHub’s four-touch ownership-first progression', () => {
  const errors = validateSequence({
    contact: { first_name: 'Maya', title: 'Vice President of Network Operations' },
    campaign: 'outagehub',
    touches: validOutageHubSequence(),
  });
  assert.deepEqual(errors, []);
});

test('rejects an incomplete OutageHub sequence and unsupported claims', () => {
  let errors = validateSequence({
    contact: { first_name: 'Maya', title: 'Vice President of Network Operations' },
    campaign: 'outagehub',
    touches: validOutageHubSequence().slice(0, 3),
  });
  assert.ok(errors.includes('expected 4 touches, got 3'));

  const touches = validOutageHubSequence();
  touches[1].body += '\n\nThis detects outages before tickets arrive and exposes N+1 diesels and colocation risk.';
  errors = validateSequence({
    contact: { first_name: 'Maya', title: 'Vice President of Network Operations' },
    campaign: 'outagehub',
    touches,
  });
  assert.ok(errors.includes('OutageHub sequence uses unsupported claim: N+1 diesels'));
  assert.ok(errors.includes('OutageHub sequence uses unsupported claim: colocation risk'));
  assert.ok(errors.includes('OutageHub sequence uses unsupported claim: detection before tickets arrive'));
});

test('rejects an OutageHub pilot pitch or permission-to-send follow-up', () => {
  const touches = validOutageHubSequence();
  touches[1].body = touches[1].body.replace(
    'The key question is where Beanfield’s responsibility begins.',
    'Would you like me to send a sample for a paid API pilot?',
  );
  const errors = validateSequence({
    contact: { first_name: 'Maya', title: 'Vice President of Network Operations' },
    campaign: 'outagehub',
    touches,
  });
  assert.ok(errors.includes('OutageHub touch 2 must not ask permission to send anything'));
  assert.ok(errors.includes('OutageHub cold sequence must not pitch or price a pilot, deployment, or annual contract'));
});

test('rejects an OutageHub touch 2 that stages an imagined replay instead of the ownership fork', () => {
  const touches = validOutageHubSequence();
  touches[3].body = touches[3].body.replace(
    'A name or job title is all I need.',
    'Would service assurance own the incident-system integration for that context?',
  );
  const errors = validateSequence({
    contact: { first_name: 'Maya', title: 'Vice President of Network Operations' },
    campaign: 'outagehub',
    touches,
  });
  assert.ok(errors.includes('OutageHub touch 4 must not ask about an integration owner before a manual check is confirmed'));
});
