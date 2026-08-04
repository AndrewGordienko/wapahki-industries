// Apply the explicit 3PL Links and Young-Davidson corrections from the
// hypothesis-led GnK playbook. Sent history is immutable; only draft copy and
// private account/contact planning fields change.
import { db, updatePerson } from '../src/db.js';
import { buildSequenceSchedule } from '../src/send-timing.js';

const NANCY_ID = 1802;
const NICOLE_ID = 1866;
const MARCELO_ID = 1865;
const JAMES_ID = 1867;
const MITTHOO_ID = 1868;
const LINKS_ID = 608;
const YOUNG_DAVIDSON_ID = 623;

function assertPerson(personId, companyId, expectedName) {
  const person = db.prepare('SELECT id,company_id,name,title FROM people WHERE id=?').get(personId);
  if (!person || person.company_id !== companyId || person.name !== expectedName) {
    throw new Error(`Expected ${expectedName} (${personId}) at company ${companyId}.`);
  }
  return person;
}

assertPerson(NANCY_ID, LINKS_ID, 'Nancy Liguori');
assertPerson(MARCELO_ID, YOUNG_DAVIDSON_ID, 'Marcelo Martinez');
assertPerson(NICOLE_ID, YOUNG_DAVIDSON_ID, 'Nicole Msw');
assertPerson(JAMES_ID, YOUNG_DAVIDSON_ID, 'James Clark');
assertPerson(MITTHOO_ID, YOUNG_DAVIDSON_ID, 'Mitthoo Sharma');

const nancySent = db.prepare("SELECT touch,status FROM sequences WHERE person_id=? AND status='sent' ORDER BY touch").all(NANCY_ID);
if (nancySent.length !== 2 || nancySent[0].touch !== 1 || nancySent[1].touch !== 2) {
  throw new Error('Nancy’s two historical sent messages must be present and immutable.');
}

const nancyCorrection = {
  touch: 3,
  day: 6,
  channel: 'email',
  subject: 'Chargeback records owner',
  body: `Hi Nancy,

I realized my earlier note got into recovery estimates before I knew whether 3PL Links owns any part of the process. One routing question: when a retailer issues a compliance deduction, who at 3PL Links handles requests for the supporting shipment records, or does that remain entirely with the client? A job title is enough.

Thanks,
Andrew Gordienko
GnK`,
};

const nancyContext = db.prepare(`
  SELECT p.title,c.industry,c.city,c.location,c.campaign
  FROM people p JOIN companies c ON c.id=p.company_id WHERE p.id=?
`).get(NANCY_ID);
const [nancyTiming] = buildSequenceSchedule({
  campaign: nancyContext.campaign,
  title: nancyContext.title,
  industry: nancyContext.industry,
  city: nancyContext.city,
  location: nancyContext.location,
  touches: [nancyCorrection],
});

db.exec('BEGIN IMMEDIATE');
try {
  db.prepare("DELETE FROM sequences WHERE person_id=? AND status='draft'").run(NANCY_ID);
  db.prepare(`
    INSERT INTO sequences(person_id,campaign,touch,day,channel,subject,body,
      send_window,timing_reason,scheduled_for,scheduled_local,send_timezone,
      suggested_window,suggested_reason,suggested_for,suggested_local,suggested_timezone)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    NANCY_ID, 'gnk', nancyCorrection.touch, nancyCorrection.day,
    nancyCorrection.channel, nancyCorrection.subject, nancyCorrection.body,
    nancyTiming.send_window, nancyTiming.timing_reason, nancyTiming.scheduled_for,
    nancyTiming.scheduled_local, nancyTiming.send_timezone,
    nancyTiming.send_window, nancyTiming.timing_reason, nancyTiming.scheduled_for,
    nancyTiming.scheduled_local, nancyTiming.send_timezone,
  );
  // Nicole is a router and Mitthoo is known. Stop the seven-touch HR thread.
  db.prepare("DELETE FROM sequences WHERE person_id=? AND status='draft'").run(NICOLE_ID);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

updatePerson(NANCY_ID, {
  role_type: 'router',
  relevance_score: 1,
  relevance_reason: 'Router only. Send the single correction about ownership of supporting shipment records, then stop.',
  sales_brief: JSON.stringify({
    outreach_route: 'routing',
    sequence_status: 'one_correction_then_stop',
    observed_fact: '3PL Links says it ships to Walmart, Sam’s Club, Costco and Sobeys daily.',
    hypothesis_not_fact: '3PL Links may receive requests for shipment records when a client faces a retailer compliance deduction.',
    proof_boundary: 'The public source does not show that 3PL Links owns, absorbs, reviews or disputes chargebacks.',
    next_step: 'Send the one routing correction. Then stop Nancy’s thread and contact Charlotte Fernandes or the owner Nancy names.',
  }),
});
updatePerson(NICOLE_ID, {
  role_type: 'router',
  relevance_score: 1,
  relevance_reason: 'Do not run a sequence. Procurement contact Mitthoo Sharma is already available; contact him directly only after the problem is stronger than generic bid comparison.',
  sales_brief: JSON.stringify({
    outreach_route: 'routing',
    sequence_status: 'stopped_known_owner_available',
    next_step: 'No further outreach to Nicole. Use Mitthoo Sharma as the procurement route.',
  }),
});
updatePerson(MITTHOO_ID, {
  role_type: 'process_owner',
  relevance_score: 9,
  relevance_reason: 'Direct procurement route who can test whether changing technical requirements, incomplete submissions, technical-commercial reconciliation, approval delays or auditability create a recurring review burden.',
});
updatePerson(JAMES_ID, {
  role_type: 'economic_buyer',
  relevance_score: 7,
  relevance_reason: 'Canadian operations executive who can confirm the operational approver and economic owner for a complex procurement-review problem at Young-Davidson.',
});
updatePerson(MARCELO_ID, {
  role_type: 'router',
  relevance_score: 1,
  relevance_reason: 'Pause for Young-Davidson outreach. The title covers Mexico operations and is not a defensible direct route to this Canadian mine procurement hypothesis.',
});

const completeScreen = JSON.stringify({
  frequent: false,
  expensive_when_poor: false,
  measurable: true,
  records_exist: true,
  identifiable_owner: true,
  testable_30_45_days: true,
  supports_40k_90k_engagement: false,
});
const incompleteQualification = JSON.stringify({
  recurring_workflow: false,
  measurable_consequence: false,
  named_owner: false,
  accessible_data: false,
  credible_champion: false,
  defined_pilot_outcome: false,
});

db.prepare(`UPDATE pursuits SET
  hypothesis_key='exception_case_evidence_reconstruction',
  observed_fact='3PL Links publicly says it ships to Walmart, Sam’s Club, Costco and Sobeys daily.',
  problem='Hypothesis to validate: when a retailer issues a compliance deduction, 3PL Links may need to locate supporting shipment records for its client before the client can decide whether to dispute it.',
  workflow_owner='Likely operations or finance owner; Nancy is only a router. Charlotte Fernandes is the first direct operational route to test.',
  consequence='Unknown until discovery. Measure record-retrieval time, dispute abandonment and recoverable dollars only if 3PL Links confirms it participates in the process.',
  records='Potential records to confirm, not assumed access: retailer deduction notice, remittance, WMS shipment record, ASN, bill of lading, appointment and label evidence.',
  offer='If the workflow is confirmed, review 50–100 historical deductions, compare the prepared evidence with completed or abandoned disputes, and measure analyst time plus recoverable dollars over 30–45 days while the customer keeps every filing decision.',
  kill_condition='Stop if chargeback work remains entirely with the client, 3PL Links is not asked for supporting records, the records cannot be accessed, or the historical volume and consequence cannot support a $40k–$75k test.',
  workflow_scorecard=?,
  qualification=?,
  primary_person_id=?,
  cost_model=NULL,
  cost_confidence='illustrative',
  commercial_path='Owner validation → recent-case discovery → quantified case → $40k–$75k historical-data pilot → expansion only from measured results.',
  narrative='Test whether the supporting-record workflow exists and who owns it. Do not sell software or quantify recovery before that is confirmed.',
  next_goal='Send Nancy one correction and stop. Ask Charlotte or the named owner how the last real retailer-deduction record request was handled.',
  approval_status='needs_review',status='draft',phase='research',updated_at=datetime('now')
  WHERE company_id=?`).run(completeScreen, incompleteQualification, 1803, LINKS_ID);

db.prepare(`UPDATE pursuits SET
  hypothesis_key='requirements_approval_evidence_reconciliation',
  observed_fact='Alamos says drilling at Young-Davidson will continue in 2026 to expand high-grade mineralization.',
  problem='Hypothesis to validate: as underground work requirements change, procurement may have to reconcile revised technical requirements, incomplete vendor submissions, clarifications and commercial terms before an approval can proceed.',
  workflow_owner='Mitthoo Sharma, Senior Director of Procurement, is the direct route; the operational and technical approver still needs to be identified.',
  consequence='Unknown until discovery. Test approval lead time, procurement rework, late clarification cycles, incomplete comparisons and audit effort rather than assuming generic bid-comparison pain.',
  records='Potential records to confirm: request package and revisions, technical requirements, vendor submissions, clarification log, commercial comparison, technical evaluation and approval record.',
  offer='If the workflow is confirmed, use a bounded historical set of complex procurement packages to compare requirement changes, missing submissions, technical-commercial reconciliation and approval traceability over 30–45 days.',
  kill_condition='Stop if requirements and submissions are consistently complete, existing procurement tooling already preserves a reviewable comparison and approval trail, the work is not recurring, or the consequence cannot support a $40k–$90k engagement.',
  workflow_scorecard=?,
  qualification=?,
  primary_person_id=?,
  cost_model=NULL,
  cost_confidence='illustrative',
  commercial_path='Mitthoo workflow question → one recent-case discovery → quantified case → bounded historical-data pilot only if all qualification conditions are confirmed.',
  narrative='Start with the drilling fact but test the harder procurement workflow. Do not claim drilling proves bid-review pain and do not pitch generic side-by-side comparison software.',
  next_goal='Contact Mitthoo directly with one question about the last package whose technical requirements changed after vendor submissions began.',
  approval_status='needs_review',status='draft',phase='research',updated_at=datetime('now')
  WHERE company_id=?`).run(completeScreen, incompleteQualification, MITTHOO_ID, YOUNG_DAVIDSON_ID);

const linksPursuit = db.prepare('SELECT id FROM pursuits WHERE company_id=?').get(LINKS_ID);
if (linksPursuit) {
  db.prepare(`UPDATE pursuit_contacts SET role=CASE person_id
    WHEN 1802 THEN 'router' WHEN 1803 THEN 'process_owner'
    WHEN 1806 THEN 'operator' WHEN 1805 THEN 'technical_security_owner' ELSE role END,
    state=CASE WHEN person_id=1802 THEN 'paused' ELSE state END,
    updated_at=datetime('now') WHERE pursuit_id=?`).run(linksPursuit.id);
}

const ydPursuit = db.prepare('SELECT id FROM pursuits WHERE company_id=?').get(YOUNG_DAVIDSON_ID);
if (ydPursuit) {
  db.prepare(`
    INSERT INTO pursuit_contacts(pursuit_id,person_id,role,priority,state,reason,updated_at)
    VALUES(?,?, 'process_owner',1,'selected',?,datetime('now'))
    ON CONFLICT(pursuit_id,person_id) DO UPDATE SET
      role='process_owner',priority=1,state='selected',reason=excluded.reason,updated_at=datetime('now')
  `).run(ydPursuit.id, MITTHOO_ID, 'Direct procurement route for the strengthened changing-requirements hypothesis.');
  db.prepare(`UPDATE pursuit_contacts SET priority=9,state='paused',
    reason='Mexico operations is not a defensible direct route to the Young-Davidson procurement hypothesis.',
    updated_at=datetime('now') WHERE pursuit_id=? AND person_id=?`).run(ydPursuit.id, MARCELO_ID);
}

console.log('Applied GnK hypothesis-led corrections: Nancy one correction then stop; Nicole stopped; Mitthoo promoted with a strengthened procurement hypothesis.');
