// Score + explain every GnK contact by (1) FUNCTION-relevance to the idea and
// (2) cold-reply-ability. The on-function manager who runs the workflow leads;
// an off-function person (HR for a compliance product) drops to a routing/fallback
// contact; the C-suite stays a fallback (or the owner at a small company).
// Domain signal = the idea's buyer roles (stored as the company's target_titles)
// + idea title + industry.  node scripts/fix-gnk-why.js
import { db } from '../src/db.js';

const GENERIC = new Set(['vice', 'president', 'director', 'head', 'chief', 'officer', 'manager', 'lead', 'senior', 'general', 'group', 'corporate', 'executive', 'services', 'service', 'business', 'company', 'team', 'canadian', 'canada', 'national', 'global', 'regional', 'first', 'limited']);
const OFF = /\b(human resources|\bhr\b|talent|recruit\w*|marketing|\bbrand\b|communications|public relations|\bpr\b|\bsales\b|account executive|business development|help ?desk|it support|desktop support|receptionist|reception)\b/i;

const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !GENERIC.has(w));
const field = (notes, key) => (String(notes || '').match(new RegExp('^' + key + ':\\s*(.+)$', 'm')) || [])[1] || '';

function kindOf(t) {
  t = t || '';
  if (/(\bchief[\w\s,&/-]*officer\b|\bc[efimort]o\b|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|\bcio\b|\bcro\b|\bcmo\b|\bpresident\b|\bowner\b|\bfounder\b|\bproprietor\b)/i.test(t)) return 'exec'; // true C-suite only (not "Chief Estimator")
  if (/\b(vp|vice[- ]?president|svp|evp)\b/i.test(t)) return 'vp';
  if (/(\bdirector\b|\bhead of\b|^head\s|\bdir\.)/i.test(t)) return 'dir';
  if (/\b(manager|team lead|supervisor|superintendent|principal|foreman|controller)\b/i.test(t) || /\blead\b/i.test(t)) return 'mgr';
  if (/\b(analyst|coordinator|specialist|officer|scheduler|administrator|planner|consultant|associate|adjuster|examiner)\b/i.test(t)) return 'ic';
  return 'other';
}
const BASE = { mgr: 6, dir: 5, ic: 3, vp: 3, exec: 2, other: 3 };

function reason(first, title, comp, idea, problem, kind, onFn, offFn) {
  let frame;
  if (offFn) frame = `does not own ${idea} — their remit is elsewhere, so treat them as a routing contact and ask who owns it. That's a fine way in at a small company.`;
  else if (onFn && kind === 'mgr') frame = `the manager who runs the ${idea} workflow day to day — on point and the most likely to reply. Start here.`;
  else if (onFn && kind === 'dir') frame = `leads the function that owns ${idea} — on point, senior enough to act and close enough to reply. Strong first target.`;
  else if (onFn && kind === 'ic') frame = `does the ${idea} work hands on — on point for the real detail, though junior to sponsor a build.`;
  else if (onFn) frame = `owns ${idea} at a senior level — relevant, but a cold note may get forwarded; best via a reply or a warm intro.`;
  else if (kind === 'mgr') frame = `a manager at ${comp} — close to how the work gets done and a reasonable first contact who can route you to the owner.`;
  else if (kind === 'dir') frame = `a director at ${comp} — senior enough to act; a fair first target who can point to the workflow owner.`;
  else if (kind === 'vp' || kind === 'exec') frame = `senior at ${comp} — likely to forward a cold note; keep as a fallback, or the owner directly if this is a small company.`;
  else frame = `a contact at ${comp} who can help route you to whoever owns ${idea}.`;
  return `${first} is ${title || 'a contact'} at ${comp} — ${frame}` + (problem ? ` ${problem}` : '');
}

const companies = db.prepare("SELECT id, name, notes, target_titles, industry FROM companies WHERE campaign='gnk'").all();
let n = 0;
for (const c of companies) {
  let tt = []; try { tt = JSON.parse(c.target_titles || '[]'); } catch { tt = []; }
  const idea = field(c.notes, 'Idea') || 'this workflow';
  const problem = field(c.notes, 'Problem');
  const domain = new Set([...tt.flatMap(tokens), ...tokens(idea), ...tokens(c.industry)]);
  for (const p of db.prepare('SELECT id, name, first_name, title FROM people WHERE company_id = ?').all(c.id)) {
    const kind = kindOf(p.title);
    const onFn = tokens(p.title).some((w) => domain.has(w));
    const offFn = OFF.test(p.title || '') && !onFn;
    const score = offFn ? 1 : onFn ? BASE[kind] + 3 : BASE[kind];
    const first = p.first_name || String(p.name || '').split(/\s+/)[0] || 'They';
    db.prepare('UPDATE people SET relevance_reason = ?, relevance_score = ? WHERE id = ?')
      .run(reason(first, p.title, c.name, idea, problem, kind, onFn, offFn), score, p.id);
    n++;
  }
}
console.log(`Re-scored ${n} GnK contacts by function-relevance + reply-ability (on-function manager leads).`);
