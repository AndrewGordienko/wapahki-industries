// Preserve Nancy Liguori's two real sent emails and complete the requested
// seven-stage sequence on the same chargeback-recovery product. Future touches
// are routing-only; owner-level discovery and pilot work belong with Charlotte.
import { db, updatePerson } from '../src/db.js';
import { buildSequenceSchedule } from '../src/send-timing.js';

const PERSON_ID = 1802;
const COMPANY_ID = 608;
const existing = db.prepare('SELECT * FROM sequences WHERE person_id=? ORDER BY touch').all(PERSON_ID);
for (const touch of [1, 2]) {
  const row = existing.find((item) => Number(item.touch) === touch);
  if (!row || row.status !== 'sent') throw new Error(`Expected Nancy touch ${touch} to be preserved as sent.`);
}

const futureTouches = [
  {
    touch: 3, day: 6, channel: 'linkedin', subject: null,
    body: 'Hi Nancy, I’m looking into how 3PLs assemble shipment records for retailer chargeback disputes. Since you work with retail customers at 3PL Links, I’d be glad to connect.',
  },
  {
    touch: 4, day: 9, channel: 'email', subject: 'How disputes get reviewed',
    body: `Hi Nancy,

One hypothesis I could send the owner is that a retailer deduction has to be matched to the right shipment records before someone decides whether a dispute is worth preparing.

I don’t know whether 3PL Links handles that work. Would Charlotte Fernandes be the right person to ask, or would it sit with finance?

Thanks,
Andrew Gordienko
GnK`,
  },
  {
    touch: 5, day: 11, channel: 'linkedin', subject: null,
    body: 'If Charlotte does not own retailer deduction reviews, would finance or another operations role be the better route at 3PL Links?',
  },
  {
    touch: 6, day: 15, channel: 'email', subject: 'One-screen evidence example',
    body: `Hi Nancy,

I can prepare a one-screen example showing a retailer deduction reason beside a checklist of shipment records that might support a dispute. It would use sample information and would not assume which records 3PL Links keeps.

Would it be useful if I sent that as a forwardable example for Charlotte or the actual owner?

Thanks,
Andrew Gordienko
GnK`,
  },
  {
    touch: 7, day: 18, channel: 'email', subject: 'Closing the routing question',
    body: `Hi Nancy,

I’ll close the loop on retailer chargeback reviews. If Charlotte is not the right person, could you point me to the name or job title that owns them?

Thanks,
Andrew Gordienko
GnK`,
  },
];
if (futureTouches[0].body.length > 200) throw new Error('Nancy touch 3 exceeds 200 characters.');
if (futureTouches.some((touch) => /\b(?:paid|fixed[- ]fee) pilot\b|\b20[- ]minute\b/i.test(touch.body))) {
  throw new Error('Nancy future routing touches must not contain a pilot or meeting ask.');
}

const brief = {
  single_thread: 'Route the existing retailer-chargeback evidence-recovery question to the person who owns it at 3PL Links.',
  role_route: 'Nancy is a routing contact. Touches 1 and 2 are immutable sent history. Touches 3 through 7 ask only for ownership guidance or offer an example she can forward.',
  what_andrew_does: 'GnK could build an internal tool that links a retailer deduction to the relevant shipment records and prepares an evidence checklist for human review.',
  why_reply: 'Nancy works with retail customers and can plausibly confirm whether Charlotte Fernandes, finance or another operations role owns retailer deduction reviews.',
  one_question: 'Would Charlotte Fernandes own retailer chargeback reviews, or who should Andrew speak with?',
  offer_connection: 'A one-screen sample can show the proposed evidence checklist without internal records or a request for Nancy to assess it.',
  call_payoff: 'No further call is requested from Nancy. A future conversation is reserved for the actual operational or finance owner.',
  skeptical_question: 'Why keep contacting business development? Only to identify the owner after two earlier messages reached Nancy before ownership was established.',
  proof_boundary: '3PL Links publicly says it ships to Walmart, Sam’s Club, Costco and Sobeys daily. That does not prove it receives, absorbs or disputes retailer chargebacks, which records are available, or who owns the work.',
  next_step: 'After a routing answer, stop contacting Nancy and approach Charlotte or the named owner with an owner-level validation sequence.',
  research_used: [{ fact: '3PL Links lists Walmart, Sam’s Club, Costco and Sobeys as retailers it ships to daily.', source_url: 'https://www.3pllinks.com/retail' }],
  touch_plan: [
    { touch: 1, job: 'open_problem', personalization_anchor: 'Immutable sent history from July 29.', new_information: 'Opened the chargeback evidence-recovery question.', cta: 'Historical call or reply request.' },
    { touch: 2, job: 'add_value', personalization_anchor: 'Immutable sent history from July 31.', new_information: 'Added the already-sent illustrative recovery model.', cta: 'Historical ownership question.' },
    { touch: 3, job: 'connect', personalization_anchor: 'Nancy’s retail-customer-facing role.', new_information: 'Names the single chargeback evidence topic in a connection request.', cta: 'Accept the connection request.' },
    { touch: 4, job: 'new_angle', personalization_anchor: 'The decision to prepare a dispute after matching a deduction to shipment records.', new_information: 'Shares one explicitly hypothetical owner-level process description.', cta: 'Confirm Charlotte or finance as the route.' },
    { touch: 5, job: 'role_question', personalization_anchor: 'Charlotte’s known Operations Manager role.', new_information: 'Offers finance or another operations role as an ownership correction.', cta: 'Name the owning function.' },
    { touch: 6, job: 'offer_artifact', personalization_anchor: 'A sample one-screen evidence checklist.', new_information: 'Offers a forwardable example without internal data or a pilot ask.', cta: 'Route the example to Charlotte or the actual owner.' },
    { touch: 7, job: 'close_loop', personalization_anchor: 'The existing retailer-chargeback review question.', new_information: 'Closes the route and reduces the answer to a name or title.', cta: 'Provide the owner’s name or title.' },
  ],
};

const context = db.prepare(`
  SELECT p.title,c.industry,c.city,c.location,c.campaign
  FROM people p JOIN companies c ON c.id=p.company_id WHERE p.id=?
`).get(PERSON_ID);
const schedule = buildSequenceSchedule({
  campaign: context.campaign,
  title: context.title,
  industry: context.industry,
  city: context.city,
  location: context.location,
  touches: futureTouches,
});
const timingByTouch = new Map(schedule.map((item) => [Number(item.touch), item]));

db.exec('BEGIN IMMEDIATE');
try {
  db.prepare("DELETE FROM sequences WHERE person_id=? AND status='draft'").run(PERSON_ID);
  const insert = db.prepare(`
    INSERT INTO sequences(person_id,campaign,touch,day,channel,subject,body,
      send_window,timing_reason,scheduled_for,scheduled_local,send_timezone,
      suggested_window,suggested_reason,suggested_for,suggested_local,suggested_timezone)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const touch of futureTouches) {
    const timing = timingByTouch.get(touch.touch);
    insert.run(PERSON_ID, 'gnk', touch.touch, touch.day, touch.channel, touch.subject, touch.body,
      timing.send_window, timing.timing_reason, timing.scheduled_for, timing.scheduled_local, timing.send_timezone,
      timing.send_window, timing.timing_reason, timing.scheduled_for, timing.scheduled_local, timing.send_timezone);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
updatePerson(PERSON_ID, { sales_brief: JSON.stringify(brief) });

db.prepare(`UPDATE pursuits SET primary_person_id=1803,
  narrative='Validate one retailer-chargeback evidence-recovery process with Charlotte Fernandes or the actual finance or operations owner.',
  next_goal='Ask Nancy only for the owner, then validate the existing chargeback evidence-recovery problem with Charlotte Fernandes or the person Nancy names.',
  commercial_path='Nancy routes to Charlotte or the actual owner → 20-minute chargeback-workflow validation → one-screen evidence example → fixed-fee pilot only if the workflow and economics are confirmed.',
  updated_at=datetime('now') WHERE company_id=?`).run(COMPANY_ID);

console.log('Preserved Nancy’s two sent emails and completed seven chargeback-routing stages.');
