// Apply the founder-reviewed BenchSci and Carbon Upcycling T1 corrections.
// Kept as a reproducible data migration so the reviewed copy and the improved
// account hypotheses can be restored after a database rebuild.
import { db, replaceTouch } from '../src/db.js';

const drafts = [
  {
    personId: 331,
    expectedName: 'Chad Malek',
    roleType: 'economic_buyer',
    subject: 'proving ascend value',
    body: `Hi Chad,

I found you because you lead commercial work at BenchSci, which reports that ASCEND users at its top 10 customers reduced unnecessary experimentation by 40 percent. When a customer sees that value in one project, what makes it hardest to prove the value consistently enough to support broader adoption?

My guess is that the outcome is visible, but linking product use to the scientific result is harder in a customer review. I run GnK, a small software team, and we're exploring an internal BenchSci tool that turns permitted product and outcome information into a concise value brief for commercial review.

Would you be open to a 20-minute call next week? I'll bring a one-screen sketch of that value brief, and you can tell me whether it would help an adoption or renewal conversation.

Thanks,
Andrew Gordienko
GnK`,
  },
  {
    personId: 332,
    expectedName: 'Fernando Saiz',
    roleType: 'technical',
    subject: 'comparable experiment evidence',
    body: `Hi Fernando,

I found you because you lead innovation at BenchSci, which reports that ASCEND users at its top 10 customers reduced unnecessary experimentation by 40 percent. When a scientist is planning an experiment, how do they find prior work with a comparable target and conditions that produced conflicting evidence?

My guess is that the comparison can take longer than expected, so a scientist may design a repeat before seeing why a similar attempt was inconclusive. I run GnK, a small software team, and we're exploring a customer-facing ASCEND capability that surfaces comparable prior experiments and the evidence against repeating them for scientific review, using information already available to the scientist.

Would you be open to a 20-minute call next week? I'll bring a one-screen sketch of that comparison, and you can tell me whether it would support a real experiment-design decision.

Thanks,
Andrew Gordienko
GnK`,
  },
  {
    personId: 341,
    expectedName: 'Arlette Watwood',
    roleType: 'economic_buyer',
    subject: 'transferring process know-how',
    body: `Hi Arlette,

I found you because you founded Carbon Upcycling. When you deploy the process at a new cement plant, what takes the most time to re-learn because the local feedstock and operating conditions are different?

My guess is that each site creates another trial-and-adjustment loop, keeping experienced technical people involved in decisions they have already solved elsewhere under slightly different conditions. I run GnK, a small software team, and we’re exploring a system that uses previous trials, local feedstock characteristics and plant results to recommend a starting recipe and operating range for technical review.

Would you be open to a 20-minute call next week? I’ll bring a one-screen sketch, and you can tell me whether it captures the knowledge that is hardest to transfer between sites.

Thanks,
Andrew Gordienko
GnK`,
  },
];

const countWords = (text) => (String(text || '').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’.-]*\b/gu) || []).length;
const contentOnly = (body) => body
  .replace(/^Hi [^,\n]+,\s*/i, '')
  .replace(/\s*Thanks,\s*\nAndrew Gordienko\s*\nGnK\s*$/i, '')
  .trim();

for (const draft of drafts) {
  const person = db.prepare(`
    SELECT p.name, c.campaign
    FROM people p JOIN companies c ON c.id = p.company_id
    WHERE p.id = ?
  `).get(draft.personId);
  if (!person || person.name !== draft.expectedName || person.campaign !== 'gnk') {
    throw new Error(`contact ${draft.personId} did not match ${draft.expectedName} in GnK`);
  }
  const bodyWords = countWords(contentOnly(draft.body));
  const subjectWords = countWords(draft.subject);
  if (bodyWords < 90 || bodyWords > 145) {
    throw new Error(`${draft.expectedName} body has ${bodyWords} words, expected 90-145`);
  }
  if (subjectWords < 2 || subjectWords > 5 || draft.subject !== draft.subject.toLowerCase() || /[:!?]/.test(draft.subject)) {
    throw new Error(`${draft.expectedName} subject failed the 2-5-word lowercase gate`);
  }
  if (!draft.body.startsWith(`Hi ${draft.expectedName.split(' ')[0]},`)
    || !draft.body.endsWith('Thanks,\nAndrew Gordienko\nGnK')) {
    throw new Error(`${draft.expectedName} greeting or signature failed`);
  }
}

const notesUpdates = [
  {
    company: 'BenchSci',
    mutate(notes) {
      notes.ai_project = 'Build decision support around one defined BenchSci use case, with the product boundary chosen by role instead of mixing commercial notes, product telemetry, scientific evidence, and reagent records into one vague system.';
      notes.role_hypotheses = {
        commercial: 'An internal BenchSci value-proof tool that turns information BenchSci already captures and is permitted to use into a concise adoption or renewal brief for customer success and commercial review.',
        scientific_product: 'A customer-facing ASCEND capability that surfaces comparable prior experiments and the evidence against repeating them for scientific review, using information already available to the scientist.',
      };
      notes.decision_model = {
        commercial_decision: 'Whether the evidence of value is strong enough to support wider adoption, renewal, or expansion.',
        scientific_decision: 'Whether comparable prior experiments provide evidence to change the target, antibody, conditions, or decision to repeat.',
        repeated_trigger: 'A new customer value review or a scientist planning another experiment.',
        output: 'A concise value brief for commercial review, or a comparison of prior experiments and the evidence for scientific review.',
      };
      return notes;
    },
  },
  {
    company: 'Carbon Upcycling',
    mutate(notes) {
      notes.ai_project = 'Build site-commissioning decision support that compares a new plant’s local feedstock characteristics and plant results with previous trials, then recommends a starting recipe and operating range for technical review.';
      notes.role_hypotheses = {
        founder_or_technical: 'A system for transferring prior site knowledge into the starting recipe and operating range used at the next cement plant.',
        project_delivery: 'A commissioning aid that reduces repeated trial-and-adjustment loops and the amount of senior technical involvement required at each new site.',
      };
      notes.decision_model = {
        decision: 'Which starting recipe and operating range should receive technical review at a new site.',
        repeated_trigger: 'A deployment with different local feedstock and operating conditions.',
        output: 'A recommended starting recipe and operating range backed by comparable previous trials and plant results.',
        value: 'Shorter site commissioning and less repeated involvement from scarce senior technical people.',
      };
      return notes;
    },
  },
];

db.exec('BEGIN IMMEDIATE');
try {
  for (const item of notesUpdates) {
    const row = db.prepare("SELECT id, notes FROM companies WHERE campaign = 'gnk' AND name = ?").get(item.company);
    if (!row) throw new Error(`missing GnK company ${item.company}`);
    const notes = JSON.parse(row.notes || '{}');
    db.prepare('UPDATE companies SET notes = ? WHERE id = ?').run(JSON.stringify(item.mutate(notes)), row.id);
  }
  for (const draft of drafts) {
    db.prepare('UPDATE people SET role_type = ? WHERE id = ?').run(draft.roleType, draft.personId);
    replaceTouch(draft.personId, 'gnk', {
      touch: 1,
      day: 1,
      channel: 'email',
      subject: draft.subject,
      body: draft.body,
    });
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(`Applied ${drafts.length} reviewed GnK T1 drafts and ${notesUpdates.length} decision-first account hypotheses.`);
