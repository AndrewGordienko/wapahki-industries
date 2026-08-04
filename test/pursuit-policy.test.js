import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDealArchitecture,
  evaluateDraft,
  evaluatePursuitReadiness,
  PURSUIT_MOTIONS,
  PURSUIT_TYPES,
  stepsForPursuitType,
} from '../src/pursuit-policy.js';

test('every pursuit type has a unique commitment ladder with research, outreach, and a signed finish', () => {
  assert.deepEqual(Object.keys(PURSUIT_MOTIONS), PURSUIT_TYPES);
  for (const type of PURSUIT_TYPES) {
    const steps = stepsForPursuitType(type);
    assert.equal(steps[0].step_key, 'research');
    assert.equal(steps[1].step_key, 'open');
    assert.equal(steps.at(-1).phase, 'close');
    assert.match(steps.at(-1).step_key, /signed/);
    assert.equal(new Set(steps.map((step) => step.step_key)).size, steps.length);
  }
});

test('a strategic partnership requires a concrete commitment and mutual give/get', () => {
  const architecture = evaluateDealArchitecture({
    pursuit_type: 'strategic_partner',
    contacts: [],
  });
  assert.equal(architecture.ready_for_approval, false);
  assert.ok(architecture.errors.includes('Define the concrete commitment this pursuit is meant to win.'));
  assert.ok(architecture.errors.includes('Define the value the other company receives.'));
  assert.ok(architecture.errors.includes('Define what Wapahki receives in return.'));
  assert.deepEqual(
    architecture.missing_roles,
    PURSUIT_MOTIONS.strategic_partner.required_roles,
  );
});

test('a fully mapped pilot architecture reports complete', () => {
  const motion = PURSUIT_MOTIONS.pilot_customer;
  const pursuit = {
    pursuit_type: 'pilot_customer',
    desired_commitment: 'Signed CAD $25,000 pilot on line three with an October 1 start.',
    value_to_partner: 'A measured reduction in manual packing labour and ergonomic exposure.',
    value_to_us: 'Pilot revenue, line access, a referenceable result, and a deployment option.',
    decision_process: 'Plant manager recommends; engineering and safety approve; operations VP signs.',
    commercial_path: 'Pilot SOW, vendor onboarding, purchase order, and 40% deposit.',
    proof_assets: [{ name: 'Packing-cell demo', status: 'ready' }],
    success_metrics: [{ metric: 'Operator minutes per batch', target: '30% reduction' }],
    joint_action_plan: [{ milestone: 'Site walk', owner: 'Plant manager', status: 'planned' }],
    contacts: motion.required_roles.map((role, index) => ({
      role,
      state: index ? 'candidate' : 'selected',
      lifecycle_status: 'active',
    })),
  };
  const architecture = evaluateDealArchitecture(pursuit);
  assert.equal(architecture.ready_for_approval, true);
  assert.equal(architecture.completeness, 100);
  assert.deepEqual(architecture.missing_roles, []);
});

test('outreach readiness remains human-approved and contact-gated', () => {
  const pursuit = {
    pursuit_type: 'pilot_customer',
    approval_status: 'approved',
    problem: 'Frequent product changes leave one repeatable packing move manual.',
    consequence: 'Operators lose time and absorb avoidable ergonomic exposure on every batch.',
    narrative: 'Validate one stable move, inspect the line, and return a bounded paid pilot.',
    desired_commitment: 'A signed paid pilot on one packing line.',
    value_to_partner: 'A safer, measurable packing workflow with a human exception path.',
    value_to_us: 'Paid pilot revenue and evidence for a wider deployment.',
    evidence: [{ claim: 'The company publicly describes high-mix packaged products.', url: 'https://example.com/operations' }],
    contacts: [],
  };
  const primaryPerson = {
    id: 4,
    company_id: 9,
    lifecycle_status: 'active',
    status: 'new',
    email: 'owner@example.com',
    last_verified_at: '2026-07-30',
  };
  const result = evaluatePursuitReadiness({
    pursuit,
    company: { id: 9 },
    primaryPerson,
    settings: { require_human_approval: 'true' },
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.startsWith('Stakeholder gaps:')));
  assert.ok(result.warnings.some((warning) => warning.startsWith('No cost model is recorded')));
});

test('draft quality rejects illustrative economics that hide the model', () => {
  const quality = evaluateDraft({
    draft: {
      channel: 'email',
      subject: 'delay reconstruction cost',
      body: [
        'Hi Grant,',
        '',
        'The commercial team spends 320 hours rebuilding each project history, which costs $40,000 before outside review. A better evidence tool would save $20,000 on every claim while protecting another $100,000 of claim value. The records already exist across the schedule and project files, so the issue is assembling them quickly enough for review.',
        '',
        'Would you be open to a 20-minute conversation next week?',
        '',
        'Thanks,',
        'Andrew Gordienko',
        'GnK',
      ].join('\n'),
    },
    step: { step_key: 'open', channel: 'email' },
    campaign: 'gnk',
    costConfidence: 'illustrative',
  });
  assert.equal(quality.pass, false);
  assert.ok(quality.errors.some((error) => error.includes('does not label its assumptions')));
});
