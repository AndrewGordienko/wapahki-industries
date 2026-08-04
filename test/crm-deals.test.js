import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDirectory = mkdtempSync(join(tmpdir(), 'wapahki-crm-deals-'));
process.env.CRM_DB_PATH = join(testDirectory, 'crm.db');

const {
  db,
  insertCompany,
  updatePerson,
  upsertPerson,
} = await import('../src/db.js');
await import('../src/problems.js');
const { ensurePursuit, updatePursuit } = await import('../src/pursuits.js');
const {
  buildCrmCsv, crmBusinesses, crmDealRows, crmRows,
} = await import('../src/crm.js');

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test('the deal sheet cross-references pursuit strategy with live CRM messages', () => {
  const company = insertCompany({
    name: 'Joined Up Operations',
    campaign: 'gnk',
    industry: 'Field services',
    source: 'test',
    target_titles: [],
  });
  const person = upsertPerson({
    company_id: company.id,
    name: 'Rina Shah',
    title: 'VP Operations',
    email: 'rina@joinedup.example',
    email_status: 'verified',
    relevance_score: 9,
  });
  updatePerson(person.id, {
    sales_brief: JSON.stringify({
      role_route: 'Operations owner',
      skeptical_question: 'Who owns the decision?',
      proof_boundary: 'No internal workflow has been verified.',
      next_step: 'Validate one workflow.',
    }),
  });
  db.prepare(`
    INSERT INTO sequences (person_id, campaign, touch, day, channel, subject, body, status)
    VALUES (?, 'gnk', 1, 1, 'email', 'dispatch exceptions', 'Hi Rina', 'draft')
  `).run(person.id);

  let pursuit = ensurePursuit(company.id);
  pursuit = updatePursuit(pursuit.id, {
    problem: 'Dispatch exceptions are reconciled manually.',
    desired_commitment: 'A paid 30-day workflow diagnostic.',
    next_goal: 'Confirm the owner and one sample workflow.',
    primary_person_id: person.id,
  });

  const deals = crmDealRows({ business: 'gnk' });
  assert.equal(deals.length, 1);
  assert.equal(deals[0].pursuit_id, pursuit.id);
  assert.equal(deals[0].primary_name, 'Rina Shah');
  assert.equal(deals[0].message_count, 1);
  assert.equal(deals[0].emailable_count, 1);
  assert.equal(deals[0].has_context, true);
  assert.deepEqual(deals[0].contacts.map((contact) => contact.id), [person.id]);

  const contacts = crmRows({ business: 'gnk' });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].pursuit_problem, 'Dispatch exceptions are reconciled manually.');
  assert.equal(contacts[0].desired_commitment, 'A paid 30-day workflow diagnostic.');
  assert.equal(contacts[0].pursuit_role, 'reserve');
  assert.equal(contacts[0].sales_brief.skeptical_question, 'Who owns the decision?');
});

test('deal filters identify shells that still lack useful commercial context', () => {
  const company = insertCompany({
    name: 'Empty Pursuit Shell',
    campaign: 'gnk',
    source: 'test',
    target_titles: [],
  });
  ensurePursuit(company.id);

  const missing = crmDealRows({ business: 'gnk', status: 'needs_context' });
  assert.ok(missing.some((row) => row.company_name === 'Empty Pursuit Shell'));
});

test('GnK contact rows expose the full costly problem, economics and proposed build', () => {
  db.prepare(`
    INSERT INTO problems (
      slug, title, workflow_today, proposed_solution, annual_cost_low, annual_cost_high,
      cost_basis, savings_low, savings_high, our_cut_low, our_cut_high
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'test-shrink-engine',
    'Test Shrink Engine',
    'Managers inspect short-dated stock manually and often mark it down after recoverable margin is already lost.',
    'Build a SKU-by-store action list recommending markdown, transfer, donation or continued display.',
    300_000,
    800_000,
    'Illustrative store sales × shrink rate plus checking and disposal labour.',
    120_000,
    350_000,
    50_000,
    90_000,
  );
  const company = insertCompany({
    name: 'Full Problem Grocery',
    campaign: 'gnk',
    source: 'test',
    target_titles: [],
    notes: [
      'Idea: Test Shrink Engine',
      'Workflow today: Managers inspect short-dated stock manually.',
      "What we'd build: Build a SKU-by-store action list.",
    ].join('\n'),
  });
  upsertPerson({
    company_id: company.id,
    name: 'Sam Rivera',
    title: 'Fresh Food Director',
    email: 'sam@full-problem.example',
  });

  const [row] = crmRows({ business: 'gnk', search: 'Full Problem Grocery' });
  assert.match(row.commercial_problem.problem, /mark it down after recoverable margin/);
  assert.match(row.commercial_problem.economic_case, /CAD \$300k–\$800k per year/);
  assert.match(row.commercial_problem.economic_case, /illustrative category model/);
  assert.match(row.commercial_problem.what_we_build, /SKU-by-store action list/);
  assert.match(row.commercial_problem.commercial_entry, /CAD \$50k–\$90k/);
});

test('OutageHub contact rows expose the commercial hypothesis and delivery entry', () => {
  const company = insertCompany({
    name: 'External Context Telecom',
    campaign: 'outagehub',
    product: 'outage',
    source: 'test',
    target_titles: [],
    notes: 'OutageHub problem: Network incident classification\nWhy this company: The company operates a multi-site network.',
  });
  upsertPerson({
    company_id: company.id,
    name: 'Morgan Lee',
    title: 'Director of Network Operations',
    email: 'morgan@external-context.example',
  });
  const pursuit = ensurePursuit(company.id);
  updatePursuit(pursuit.id, {
    problem: 'The question is whether separate public utility reports could leave staff manually classifying several coincident network alarms without one external-cause view.',
    evidence: [{ claim: 'The company operates a multi-site network.', url: 'https://example.com/network', observed_at: '2026' }],
    consequence: 'CAD $60k–$140k potential measured annual upside to validate.',
    cost_model: 'Economic case: CAD $125k–$300k per year — illustrative category model, not a verified cost at External Context Telecom.\nCost basis: Assume 20 events x 3 people x 8 hours x CAD $150 per hour plus avoidable incident handling, or about CAD $72k of recurring labour before contingent exposure.',
    cost_confidence: 'illustrative',
    offer: 'The OutageHub API would match one public utility event to a small site set so network operations can judge whether several alarms may share one external cause.',
    desired_commitment: 'CAD $40k–$75k paid API pilot / first-production planning range.',
    commercial_path: '20-minute validation, paid API pilot, then annual production.',
  });

  const [row] = crmRows({ business: 'outagehub', search: 'External Context Telecom' });
  assert.match(row.commercial_problem.problem, /public utility reports/);
  assert.match(row.commercial_problem.economic_case, /CAD \$125k–\$300k per year/);
  assert.match(row.commercial_problem.cost_basis, /20 events x 3 people/);
  assert.match(row.commercial_problem.potential_savings, /CAD \$60k–\$140k/);
  assert.match(row.commercial_problem.what_we_build, /several alarms may share one external cause/);
  assert.equal(row.commercial_problem.solution_label, 'What OutageHub changes');
  assert.match(row.commercial_problem.commercial_entry, /CAD \$40k–\$75k/);
  assert.match(row.commercial_problem.observed, /multi-site network/);
});

test('contact export places all seven touchpoints across one spreadsheet row', () => {
  const csv = buildCrmCsv({ business: 'gnk', search: 'Joined Up Operations' });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"T1 · day 1 · email"/);
  assert.match(csv, /"T7 · day 18 · closing email"/);
  assert.match(csv, /Capacity-adjusted send: Tue, 4 Aug 2026/);
  assert.match(csv, /Subject: dispatch exceptions\n\nHi Rina/);
  assert.match(csv, /"1\/7 incomplete"/);

  const gnk = crmBusinesses().find((business) => business.key === 'gnk');
  assert.equal(gnk.complete_sequences, 0);
  assert.equal(gnk.incomplete_contacts, 2);
});

test('sequence status is filtered before the requested row limit', () => {
  const company = insertCompany({
    name: 'Complete Sequence Co',
    campaign: 'gnk',
    source: 'test',
    target_titles: [],
  });
  const person = upsertPerson({
    company_id: company.id,
    name: 'Lee Morgan',
    title: 'COO',
    email: 'lee@complete.example',
  });
  updatePerson(person.id, {
    sales_brief: JSON.stringify({
      research_used: [{ fact: 'A current role-relevant fact', source_url: 'https://example.com/source' }],
      touch_plan: [
        [1, 'handoff_question'], [2, 'recent_case'], [3, 'connect'], [4, 'sharper_hypothesis'],
        [5, 'existing_system_check'], [6, 'discovery_invitation'], [7, 'close_or_route'],
      ].map(([touch, job]) => ({
        touch,
        job,
        personalization_anchor: `verified account fact ${touch}`,
        new_information: `distinct useful detail ${touch}`,
        cta: `stage-appropriate request ${touch}`,
      })),
    }),
  });
  const validTouches = [
    {
      touch: 1, day: 1, channel: 'email', subject: 'Course review handoff',
      body: "Hi Lee,\n\nSAIT expects every academic program to bring AI into its curriculum, and reviews it against relevant prior evaluations. When a faculty team proposes using AI in a course, is the proposal itself enough to move a decision forward, or does someone separately compare it with earlier evaluations and decide the next step?\n\nI run GnK, a small software and AI team in Toronto. I am trying to establish whether that review creates real work before assuming another tool is needed, and an email answer is useful even if one existing system already handles it end to end.\n\nThanks,\nAndrew Gordienko\nGnK",
    },
    {
      touch: 2, day: 4, channel: 'email', subject: 'Course review handoff',
      body: "Hi Lee,\n\nSAIT already gathers course goals, results, and prior evaluations, so capturing them may not be the hard part. On the last AI course proposal that needed a decision, who compared it with earlier evaluations, decided what should happen, and recorded the outcome?\n\nThanks,\nAndrew Gordienko\nGnK",
    },
    {
      touch: 3, day: 6, channel: 'linkedin', subject: null,
      body: "Lee, I am looking at what happens after a faculty team proposes an AI teaching approach at SAIT, and whether the review stays within one program.",
    },
    {
      touch: 4, day: 9, channel: 'email', subject: 'Reconciling course evidence',
      body: "Hi Lee,\n\nOn another question like this, the difficulty was less about the proposal itself and more about reconciling a new result with earlier evaluations before deciding what to do. Does that match how it works at SAIT, or does the review sit somewhere else entirely?\n\nThanks,\nAndrew Gordienko\nGnK",
    },
    {
      touch: 5, day: 11, channel: 'linkedin', subject: null,
      body: "If that reconciliation happens, does one existing system already carry it end to end, or do people move between the proposal, the earlier evaluations, and their own notes?",
    },
    {
      touch: 6, day: 15, channel: 'email', subject: 'One recent proposal',
      body: "Hi Lee,\n\nIf it would help, I would value walking through one recent completed proposal to understand where the real effort sat, purely to learn the process rather than to propose anything. Even a short note on how the last one went would be useful.\n\nThanks,\nAndrew Gordienko\nGnK",
    },
    {
      touch: 7, day: 18, channel: 'email', subject: 'Course review owner',
      body: "Hi Lee,\n\nI will close the loop on this. I am trying to identify who owns the decision after a faculty team proposes an AI teaching approach. Is that a program chair, the Teaching and Learning Commons, or another group? A job title is enough.\n\nThanks,\nAndrew Gordienko\nGnK",
    },
  ];
  const insert = db.prepare(`
    INSERT INTO sequences (person_id, campaign, touch, day, channel, subject, body)
    VALUES (?, 'gnk', ?, ?, ?, ?, ?)
  `);
  for (const touch of validTouches) {
    insert.run(person.id, touch.touch, touch.day, touch.channel, touch.subject, touch.body);
  }

  const rows = crmRows({ business: 'gnk', status: 'complete', limit: 1 });
  assert.equal(
    rows.length,
    1,
    JSON.stringify(crmRows({ business: 'gnk', search: 'Complete Sequence Co' }).map((row) => ({
      sequence_errors: row.sequence_errors,
      brief_errors: row.brief_errors,
    }))),
  );
  assert.equal(rows[0].person_id, person.id);
  assert.equal(rows[0].sequence_complete, true);
});

test('Wapahki rows and CSV treat seven discovery touches as a complete sequence', () => {
  const company = insertCompany({
    name: 'Five Touch Co-Packer',
    campaign: 'wapahki',
    industry: 'Co-packing',
    source: 'test',
    target_titles: [],
  });
  const person = upsertPerson({
    company_id: company.id,
    name: 'Maya Chen',
    title: 'Operations Director',
    email: 'maya@five-touch.example',
  });
  updatePerson(person.id, {
    sales_brief: JSON.stringify({
      research_used: [{ fact: 'The company provides co-packing services.', source_url: 'https://example.com/source' }],
      touch_plan: [
        [1, 'last_example_question'], [2, 'concrete_motion_test'], [3, 'connect'],
        [4, 'sharper_example'], [5, 'route_owner'],
        [6, 'offer_task_sketch'], [7, 'close_loop'],
      ].map(([touch, job]) => ({
        touch,
        job,
        personalization_anchor: `verified operating fact ${touch}`,
        new_information: `distinct commercial information ${touch}`,
        cta: `stage-appropriate request ${touch}`,
      })),
    }),
  });
  const touches = [
    {
      touch: 1, day: 1, channel: 'email', subject: 'Repeating case handoffs',
      body: 'Hi Maya,\n\nI am Andrew, founder of Wapahki, an early-stage robotics company in Toronto. We are building a flexible robotic cell that picks up and places one product the same way every cycle, and we are trying to find one case-handling or palletizing task that genuinely repeats before we build too far.\n\nAcross two recent packing runs, was there a finished-case transfer or palletizing step that stayed essentially the same even though the customer program and the package changed?\n\nWould you be open to a 20-minute call? Even one recent example by email would help.\n\nThanks,\nAndrew Gordienko\nFounder, Wapahki Industries',
    },
    {
      touch: 2, day: 5, channel: 'email', subject: 'Repeating case handoffs',
      body: 'Hi Maya,\n\nTo make that concrete, I mean sealed cases from several customer programs leaving the same conveyor point and being transferred or palletized in the same way. Does that movement actually repeat, or do case size, weight, and rate make it different every time?\n\nThanks,\nAndrew Gordienko\nFounder, Wapahki Industries',
    },
    {
      touch: 3, day: 9, channel: 'linkedin', subject: null,
      body: 'Hi Maya, I am learning where finished-case handoffs stay consistent across co-packing programs. Your operations view from the floor would help, and I would be glad to connect.',
    },
    {
      touch: 4, day: 15, channel: 'email', subject: 'One conveyor point',
      body: 'Hi Maya,\n\nA narrower version of the same question. At one conveyor point, how often does a person still step in to handle an exception during that transfer, and what usually triggers it, a jam, a mixed pallet, or a label check?\n\nThanks,\nAndrew Gordienko\nFounder, Wapahki Industries',
    },
    {
      touch: 5, day: 20, channel: 'email', subject: 'One conveyor point',
      body: 'Hi Maya,\n\nYou know that floor better than I do. Are you the right person to ask about that finished-case transfer, or would someone in production or engineering be closer to how it actually runs?\n\nThanks,\nAndrew Gordienko\nFounder, Wapahki Industries',
    },
    {
      touch: 6, day: 26, channel: 'linkedin', subject: null,
      body: 'If one repeated handoff does exist, I could sketch that single task, what arrives, what movement repeats, and which exceptions still need a person. Would that be worth putting on paper?',
    },
    {
      touch: 7, day: 32, channel: 'email', subject: 'Closing the packing note',
      body: 'Hi Maya,\n\nI will close the thread here on whether one finished-case handoff repeats often enough, with little enough variation, to be worth investigating. If a concrete example comes to mind later, I would be glad to hear it.\n\nThanks,\nAndrew Gordienko\nFounder, Wapahki Industries',
    },
  ];
  const insert = db.prepare(`
    INSERT INTO sequences (person_id, campaign, touch, day, channel, subject, body)
    VALUES (?, 'wapahki', ?, ?, ?, ?, ?)
  `);
  for (const touch of touches) {
    insert.run(person.id, touch.touch, touch.day, touch.channel, touch.subject, touch.body);
  }

  const [row] = crmRows({ business: 'wapahki', search: 'Five Touch Co-Packer' });
  assert.equal(row.expected_touch_count, 7);
  assert.equal(row.sequence_present, true);
  assert.equal(row.sequence_complete, true);

  const csv = buildCrmCsv({ business: 'wapahki', search: 'Five Touch Co-Packer' });
  assert.match(csv, /"T4 · day 15 · email"/);
  assert.match(csv, /"T7 · day 32 · closing email"/);
  assert.match(csv, /"7\/7 reviewed"/);
});
