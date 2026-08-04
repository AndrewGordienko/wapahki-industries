// Seed/update the source-backed OutageHub problem → buyer → touch-one board.
// Safe to rerun: problems match on slug and targets match on company per problem.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, upsertProblem, upsertTarget } from '../src/outagehub.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plays = JSON.parse(readFileSync(join(root, 'data', 'outagehub-plays.json'), 'utf8'));
const prospects = JSON.parse(readFileSync(join(root, 'data', 'outagehub-prospects.json'), 'utf8'));

const bySlug = new Map();
for (const play of plays) {
  const score = Math.min(100,
    (Number(play.pain) * 5)
    + (Number(play.data_fit) * 5)
    + (Number(play.priority) * 4)
    + 30,
  );
  const problem = upsertProblem({
    slug: play.slug || slugify(play.title),
    title: play.title,
    sector: play.segment,
    region: 'Canada',
    one_liner: play.problem,
    who_has_it: `${play.segment} organizations operating multiple sites, assets or customer locations in Canada.`,
    workflow_today: play.workflow,
    why_expensive: play.problem,
    outagehub_solution: play.offer,
    data_signal: `A public utility outage, update or restoration event matched to an address or operating area and delivered through ${(play.channels || []).join(', ')}.`,
    demo_idea: 'Compare one real public outage record from an area the organization serves with the way its team saw and handled the same event.',
    measurable: 'Time from the public outage report to the first correct operational action.',
    buyer_roles: play.buyer_roles || [],
    score,
    score_breakdown: [
      { factor: 'Operational pain', points: Number(play.pain) * 5, of: 25, note: play.problem },
      { factor: 'Outage data fit', points: Number(play.data_fit) * 5, of: 25, note: play.offer },
      { factor: 'Buyer and repeatability', points: Number(play.priority) * 4, of: 20, note: (play.buyer_roles || []).join(', ') },
      { factor: 'Evidence and testability', points: 15, of: 15, note: 'One real outage record supports a concrete workflow comparison.' },
      { factor: 'SMS/email action layer', points: 15, of: 15, note: (play.channels || []).join(', ') },
    ],
    confidence: Number(play.data_fit) >= 5 ? 'high' : 'medium',
    sources: play.sources || [],
    status: play.status === 'testing' ? 'approved' : play.status === 'parked' ? 'shelved' : 'discovered',
    notes: play.notes || null,
    run_id: 'seed-research-2026-07-29',
  });
  bySlug.set(play.slug, problem);
}

let targetCount = 0;
for (const prospect of prospects) {
  const problem = bySlug.get(prospect.play_slug);
  if (!problem) throw new Error(`Unknown play_slug ${prospect.play_slug} for ${prospect.company}`);
  const first = prospect.contact_name ? prospect.contact_name.split(/\s+/)[0] : '';
  const greeting = first ? `Hi ${first},` : 'Hello,';
  const body = [
    greeting,
    '',
    prospect.opener,
    '',
    `I’m building OutageHub, which collects public outage updates from Canadian utilities and can trigger an SMS, email or API event for an affected site. The idea would be to complement ${prospect.existing_view}, not replace it.`,
    '',
    `Would you be open to a 20-minute conversation about how ${prospect.workflow_owner} handles that workflow today? I’ll bring one real outage record from a relevant area so you can compare it with what the team already sees and tell me where the signal is—or is not—useful.`,
    '',
    'Thanks,',
    'Andrew',
    'OutageHub',
  ].join('\n');
  upsertTarget({
    problem_id: problem.id,
    company: prospect.company,
    domain: prospect.domain || null,
    hq: prospect.hq || 'Canada',
    segment: prospect.segment,
    why_them: `${prospect.why_fit} Source: ${prospect.source_url}`,
    contact_name: prospect.contact_name || null,
    contact_title: prospect.contact_title,
    contact_email: prospect.contact_email || null,
    email_subject: prospect.subject,
    email_body: body,
    status: 'drafted',
  });
  targetCount++;
}

console.log(`Seeded/updated ${bySlug.size} OutageHub problems and ${targetCount} researched buyer drafts.`);
