// Fix the BROKEN "why they'd reply" on OutageHub contacts — the ones still running
// the Wapahki robotics scorer (src/relevance.js), e.g. "Not a first-touch target
// for Wapahki … changeover pain … plant tour". Replace only those (leave the good
// hand-written ones), scoring by function-relevance + cold-reply-ability and
// grounding the reason in the account's OutageHub problem. Manager-first.
//   node scripts/fix-outagehub-why.js
//   node scripts/fix-outagehub-why.js --all
import { db } from '../src/db.js';

// Matches the broken Wapahki-scorer text AND this script's own template output
// (so a re-run re-fixes earlier passes), but NOT the hand-written good reasons.
const BAD = /Wapahki|plant tour|changeover|verify it in Apollo|automation decision|pilot budget|move a deal|Floor-level|most likely to reply|senior enough to act|cold note may get forwarded|route you to whoever owns|junior to sponsor|reasonable first contact|keep as a fallback|fine way in at a smaller|N\s*\+\s*1|colocation risk|before (?:the first )?(?:customer )?ticket|before customers|early signal|detect(?:s|ed|ing)? (?:an? )?outage|SLA credits? stack/i;
const ALL = process.argv.includes('--all');

const EXEC = /(\bchief[\w\s,&/-]*officer\b|\bc[efimort]o\b|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|\bcio\b|\bcro\b|\bcmo\b|\bpresident\b|\bowner\b|\bfounder\b|\bproprietor\b)/i; // true C-suite only (not "Chief Estimator" / "Emergency Chief")
const VP = /\b(vp|vice[- ]?president|svp|evp)\b/i;
const DIR = /(\bdirector\b|\bhead of\b|^head\s|\bdir\.)/i;
const MGR = /\b(manager|team lead|supervisor|superintendent|principal|foreman|controller)\b/i;
const IC = /\b(analyst|coordinator|specialist|officer|scheduler|administrator|planner|consultant|associate|dispatcher|technician)\b/i;
const OFF = /\b(human resources|\bhr\b|talent|recruit\w*|marketing|\bbrand\b|communications|public relations|\bpr\b|\bsales\b|account executive|business development)\b/i;
const GENERIC = new Set(['vice', 'president', 'director', 'head', 'chief', 'officer', 'manager', 'lead', 'senior', 'general', 'group', 'corporate', 'executive', 'services', 'service', 'business', 'company', 'team', 'canadian', 'canada', 'national', 'regional']);
const OUTAGE_DOMAIN = ['outage', 'operations', 'operational', 'dispatch', 'reliability', 'facilities', 'facility', 'network', 'service', 'emergency', 'field', 'infrastructure', 'continuity', 'maintenance', 'resilience', 'response', 'transit', 'fleet', 'power', 'energy', 'claims', 'supply', 'logistics'];

const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !GENERIC.has(w));
function kindOf(t) {
  t = t || '';
  if (EXEC.test(t)) return 'exec';   // check chief/president/CxO BEFORE "officer"→ic
  if (VP.test(t)) return 'vp';
  if (DIR.test(t)) return 'dir';
  if (MGR.test(t) || /\blead\b/i.test(t)) return 'mgr';
  if (IC.test(t)) return 'ic';
  return 'other';
}
const BASE = { mgr: 6, dir: 5, ic: 3, vp: 3, exec: 2, other: 3 };
const problemOf = (notes) => (String(notes || '').match(/OutageHub problems?:\s*([^\n]+?)(?:\s*Why this company:|$)/i) || [])[1] || 'turning outage data into a prioritized operational response';

function reason(first, title, comp, prob, kind, onFn, offFn) {
  const p = prob.replace(/\.$/, '');
  let frame;
  if (offFn) frame = `the role is outside the likely operational decision, so use only a routing question about who owns ${p}`;
  else if (onFn) frame = `the role can test whether public utility information changes the existing decision behind ${p}, or whether ${comp}'s current telemetry and operating systems are already enough`;
  else if (['mgr', 'dir', 'vp', 'exec'].includes(kind)) frame = `the role may be able to route the narrow question about ${p} to the operational owner without assuming a current need`;
  else frame = `the role is only a tentative route to the team that owns ${p}, so do not ask this person to validate technical details or buy the API`;
  return `${first} is ${title || 'a contact'} at ${comp}; ${frame}.`;
}

const people = db.prepare(`
  SELECT p.id, p.name, p.first_name, p.title, p.relevance_reason, c.name AS comp, c.notes, c.target_titles
  FROM people p JOIN companies c ON c.id = p.company_id
  WHERE c.campaign = 'outagehub'
`).all();

let fixed = 0, kept = 0;
for (const p of people) {
  if (!ALL && String(p.relevance_reason || '').trim() && !BAD.test(p.relevance_reason || '')) { kept++; continue; }
  let tt = []; try { tt = JSON.parse(p.target_titles || '[]'); } catch { tt = []; }
  const domain = new Set([...tt.flatMap(tokens), ...OUTAGE_DOMAIN]);
  const prob = problemOf(p.notes);
  const kind = kindOf(p.title);
  const onFn = tokens(p.title).some((w) => domain.has(w));
  const offFn = OFF.test(p.title || '') && !onFn;
  const score = offFn ? 1 : onFn ? BASE[kind] + 3 : BASE[kind];
  const first = p.first_name || String(p.name || '').split(/\s+/)[0] || 'They';
  db.prepare('UPDATE people SET relevance_reason = ?, relevance_score = ? WHERE id = ?')
    .run(reason(first, p.title, p.comp, prob, kind, onFn, offFn), score, p.id);
  fixed++;
}
console.log(`Fixed ${fixed} broken OutageHub "why they'd reply" (function-relevance, manager-first); left ${kept} good ones untouched.`);
