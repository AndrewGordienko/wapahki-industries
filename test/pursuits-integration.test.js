import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDirectory = mkdtempSync(join(tmpdir(), 'wapahki-pursuits-'));
process.env.CRM_DB_PATH = join(testDirectory, 'crm.db');

const {
  db,
  insertCompany,
  updateCompany,
  upsertPerson,
  updatePerson,
} = await import('../src/db.js');
const {
  createOutreachDraft,
  ensurePursuit,
  markOutreachDraftSent,
  reviewOutreachDraft,
  setPursuitContact,
  setSystemSetting,
  updatePursuit,
  updatePursuitStep,
} = await import('../src/pursuits.js');

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test('a pursuit safely changes motion, earns approval, and advances only through a reviewed manual send', () => {
  const company = insertCompany({
    name: 'Test Bakery',
    campaign: 'wapahki',
    source: 'test',
    target_titles: [],
  });
  updateCompany(company.id, {
    product: 'wapahki',
    hypothesis: 'High-mix packing appears to leave one repetitive transfer manual.',
  });
  const person = upsertPerson({
    company_id: company.id,
    name: 'Maya Chen',
    first_name: 'Maya',
    last_name: 'Chen',
    title: 'Production Manager',
    email: 'maya@testbakery.example',
    email_status: 'test',
  });
  updatePerson(person.id, {
    lifecycle_status: 'active',
    last_verified_at: '2026-07-30',
  });

  let pursuit = ensurePursuit(company.id);
  assert.equal(pursuit.pursuit_type, 'pilot_customer');
  assert.equal(pursuit.steps.length, 9);
  assert.equal(pursuit.steps.at(-1).step_key, 'pilot_signed');

  pursuit = updatePursuit(pursuit.id, { pursuit_type: 'strategic_partner' });
  assert.equal(pursuit.steps.at(-1).step_key, 'agreement_signed');
  assert.ok(!pursuit.steps.some((step) => step.step_key === 'pilot_signed'));

  pursuit = updatePursuit(pursuit.id, { pursuit_type: 'pilot_customer' });
  assert.equal(pursuit.steps.at(-1).step_key, 'pilot_signed');
  assert.ok(!pursuit.steps.some((step) => step.step_key === 'agreement_signed'));
  assert.equal(pursuit.steps.find((step) => step.step_key === 'problem_validation').status, 'planned');

  pursuit = setPursuitContact(pursuit.id, person.id, {
    role: 'operator_champion',
    state: 'selected',
    primary: true,
  });
  pursuit = updatePursuit(pursuit.id, {
    problem: 'Frequent product changes leave one stable packing transfer manual.',
    consequence: 'Operators lose productive time and absorb avoidable ergonomic exposure on every batch.',
    narrative: 'Validate the transfer on site and return a bounded paid pilot with explicit safety and exception handling.',
    desired_commitment: 'A signed CAD $25,000 pilot for one packing line with a named October start date.',
    value_to_partner: 'A measured reduction in manual handling with a safe human exception path.',
    value_to_us: 'Pilot revenue, operating-line proof, and an option to expand after acceptance.',
    evidence: [{
      claim: 'The company publicly describes a high-mix packaged product operation.',
      url: 'https://example.com/test-bakery-operations',
    }],
  });
  pursuit = updatePursuit(pursuit.id, { approval_status: 'approved' });
  assert.equal(pursuit.approval_status, 'approved');
  assert.equal(pursuit.next_step.step_key, 'open');
  assert.equal(pursuit.steps.find((step) => step.step_key === 'research').status, 'complete');

  assert.throws(
    () => updatePursuitStep(pursuit.id, pursuit.next_step.id, { status: 'complete', outcome: 'bypassed' }),
    /approved draft is manually sent and recorded/i,
  );

  const body = [
    'Hi Maya,',
    '',
    'Test Bakery describes a broad mix of packaged products, which usually makes the handoff between product changes and stable packing work more important than the robot itself. I am exploring one bounded cell that handles a repeatable transfer, stops when an item falls outside the expected position, and leaves exceptions with the operator.',
    '',
    'Before drawing that boundary, would you be willing to tell me which packing move stays most consistent when the product or protective material changes?',
    '',
    'Andrew Gordienko',
    'Founder, Wapahki Industries',
  ].join('\n');
  const draft = createOutreachDraft({
    pursuitId: pursuit.id,
    stepId: pursuit.next_step.id,
    personId: person.id,
    channel: 'email',
    subject: 'packing line changes',
    body,
    source: 'test',
    rationale: 'Tests the stable transfer before proposing equipment.',
  });
  assert.equal(draft.status, 'pending_review');
  assert.equal(draft.quality_report.pass, true);

  const approvedDraft = reviewOutreachDraft(draft.id, {
    status: 'approved',
    rationale: 'Reviewed in integration test.',
  });
  assert.equal(approvedDraft.status, 'approved');
  const sent = markOutreachDraftSent(draft.id);
  assert.equal(sent.draft.status, 'sent');
  assert.equal(sent.pursuit.next_step.step_key, 'problem_validation');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM touchpoints WHERE outreach_draft_id=? AND outcome='sent'").get(draft.id).n,
    1,
  );

  pursuit = updatePursuit(pursuit.id, {
    problem: 'Updated material problem that now requires another human review.',
  });
  assert.equal(pursuit.approval_status, 'needs_review');
  assert.equal(pursuit.status, 'draft');

  // System settings are operator-owned and freely editable (no hard approval gates).
  const settings = setSystemSetting('require_human_approval', false);
  assert.equal(settings.require_human_approval, 'false');
});
