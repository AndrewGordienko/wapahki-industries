// Distill the unified sales-research corpus (plus Reddit) into:
//   1) a cited research guide; and
//   2) a cross-source synthesis in the handbook; and
//   3) a compatible active-guidance block in the shared writer playbook.
//
// The pipeline is resumable at the corpus layer and safe at the output layer:
// target files are only atomically replaced after every model stage succeeds.
// It paraphrases sources, preserves source IDs, and treats disagreements as
// experiments/segment differences instead of manufacturing false consensus.
//
//   node scripts/research-learn.js --dry-run
//   zsh -ic 'node scripts/research-learn.js'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex, textSchema } from '../src/codex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CORPUS = join(root, 'data', 'research', 'corpus.json');
const REDDIT = join(root, 'data', 'reddit', 'corpus.json');
const OUT_DIR = join(root, 'docs', 'sales-research');
const GUIDE = join(OUT_DIR, 'research-wisdom.md');
const HANDBOOK = join(root, 'docs', 'HANDBOOK.md');
const SHARED = join(root, 'playbooks', '_shared.md');
const MODEL = process.env.RESEARCH_LEARN_MODEL || 'gpt-5.6-terra';
const CHUNK_CHARS = Number(process.env.RESEARCH_LEARN_CHUNK_CHARS || 100000);
const MAX_ITEM_CHARS = Number(process.env.RESEARCH_LEARN_MAX_ITEM_CHARS || 90000);
const LIMIT = Number(process.env.RESEARCH_LEARN_LIMIT || 0);
const dryRun = process.argv.includes('--dry-run');

async function textCall(prompt, { reasoning = 'medium', timeoutMs = 600_000 } = {}) {
  const result = await runCodex({
    prompt,
    schema: textSchema,
    model: MODEL,
    reasoning,
    timeoutMs,
    cwd: root,
  });
  return result.text || '';
}

function readArray(file) {
  if (!existsSync(file)) return [];
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${file} must contain a JSON array`);
  return value.filter((item) => item && typeof item === 'object');
}

const research = readArray(CORPUS);
const reddit = readArray(REDDIT).map((item) => ({
  source_type: 'reddit',
  title: `${item.subreddit ? `r/${item.subreddit}: ` : ''}${item.title || item.id}`,
  url: item.url || '',
  publisher: item.subreddit ? `r/${item.subreddit}` : 'Reddit',
  published_at: '',
  rights: 'public practitioner discussion',
  text: item.text || '',
}));
let items = [...research, ...reddit].filter((item) => String(item.text || '').trim().length >= 160);
if (LIMIT) items = items.slice(0, LIMIT);
if (!items.length) {
  console.error('No research corpus found. Run `npm run research:scrape` first.');
  process.exit(1);
}

const sourceRows = items.map((item, index) => ({
  ...item,
  sid: `S${String(index + 1).padStart(3, '0')}`,
}));
const typeCounts = {};
for (const item of sourceRows) typeCounts[item.source_type || 'unknown'] = (typeCounts[item.source_type || 'unknown'] || 0) + 1;

function sourceBlock(item) {
  const meta = [
    `[${item.sid}]`,
    `type=${item.source_type || 'unknown'}`,
    `title=${String(item.title || 'Untitled').replace(/\s+/g, ' ')}`,
    item.publisher ? `publisher=${String(item.publisher).replace(/\s+/g, ' ')}` : '',
    item.published_at ? `published=${item.published_at}` : '',
    item.url ? `url=${item.url}` : '',
    item.rights ? `access=${item.rights}` : '',
  ].filter(Boolean).join(' | ');
  return `${meta}\n${String(item.text || '').slice(0, MAX_ITEM_CHARS)}\n`;
}

const chunks = [];
let buffer = '';
let ids = [];
for (const item of sourceRows) {
  const block = sourceBlock(item);
  if (buffer && buffer.length + block.length > CHUNK_CHARS) {
    chunks.push({ text: buffer, ids });
    buffer = '';
    ids = [];
  }
  // A single long source is split without losing its stable source ID.
  if (block.length > CHUNK_CHARS) {
    for (let offset = 0; offset < block.length; offset += CHUNK_CHARS) {
      chunks.push({ text: block.slice(offset, offset + CHUNK_CHARS), ids: [item.sid] });
    }
  } else {
    buffer += block;
    ids.push(item.sid);
  }
}
if (buffer) chunks.push({ text: buffer, ids });

console.log(
  `Research: ${sourceRows.length} sources (${Object.entries(typeCounts).map(([key, value]) => `${key}:${value}`).join('  ')}), ${chunks.length} extraction chunks, model ${MODEL}.`,
);
if (dryRun) {
  console.log(`Would write ${GUIDE}, then sync the handbook synthesis and active SALES-RESEARCH writer block.`);
  process.exit(0);
}

const notes = [];
for (let index = 0; index < chunks.length; index++) {
  const prompt = `You are extracting sales doctrine from a mixed research corpus.

Return concise markdown notes, with every substantive claim followed by one or more exact source IDs such as [S004]. PARAPHRASE; do not quote source prose. Extract concrete, reusable lessons in:
- ICP/account selection, contact selection, buying signals, timing, and research;
- founder-led sales, prospecting, copy, subjects, CTAs, follow-ups, and multichannel cadence;
- discovery, qualification, demos, objection handling, negotiation, closing, and next steps;
- deliverability, sending operations, experimentation, metrics, and responsible AI use.

Source handling rules:
- A marketing claim, one person's anecdote, Reddit consensus, book description, and measured result are not equivalent. Label weak or promotional evidence.
- If sources disagree, preserve the disagreement and identify plausible segment/context differences. Never vote claims into truth.
- Prefer specific operating guidance over slogans. Reject self-promotion, fabricated certainty, spam, and unsupported benchmark numbers.
- Never introduce a source ID that is absent from this chunk (${chunks[index].ids.join(', ')}).
- No preamble and no direct quotations.

CORPUS CHUNK:
${chunks[index].text}`;
  try {
    const output = await textCall(prompt);
    if (!output.trim()) throw new Error('empty extraction');
    notes.push(output.trim());
    console.log(`  extracted ${index + 1}/${chunks.length}`);
  } catch (error) {
    console.log(`  chunk ${index + 1} failed: ${error.message.split('\n')[0]}`);
  }
}
if (!notes.length) throw new Error('All extraction calls failed; existing knowledge files remain unchanged.');

async function reduceNotes(input) {
  let current = input;
  let round = 1;
  while (current.join('\n\n').length > 130000) {
    const groups = [];
    let group = '';
    for (const note of current) {
      if (group && group.length + note.length > 60000) {
        groups.push(group);
        group = '';
      }
      group += `${note}\n\n`;
    }
    if (group) groups.push(group);
    const reduced = [];
    for (let i = 0; i < groups.length; i++) {
      const output = await textCall(
        `Deduplicate these source-ID-cited sales research notes into tighter markdown. Preserve important conflicts, evidence caveats, concrete examples, and all source IDs attached to surviving claims. Paraphrase only; no direct quotations and no preamble.\n\n${groups[i]}`,
      );
      if (output.trim()) reduced.push(output.trim());
      console.log(`  reduction ${round}.${i + 1}/${groups.length}`);
    }
    if (!reduced.length) throw new Error('Research reduction failed; existing knowledge files remain unchanged.');
    current = reduced;
    round++;
  }
  return current;
}

const reducedNotes = await reduceNotes(notes);
const existingBrain = readFileSync(SHARED, 'utf8').replace(
  /<!-- SALES-RESEARCH:START -->[\s\S]*?<!-- SALES-RESEARCH:END -->/g,
  '',
);

const guide = await textCall(`Synthesize the source-ID-cited research notes below into a rigorous, practical B2B sales field guide.

Requirements:
- Markdown only, no preamble. Paraphrase; never quote source wording.
- Cover targeting/timing, founder-led sales, outreach copy/cadence, discovery/qualification, demos, objections, negotiation/closing, deliverability/ops, measurement, and AI.
- Cite every substantive claim with the exact [S###] IDs already attached to the notes. Never invent an ID.
- Separate strong cross-source guidance from anecdotes, promotional claims, and hypotheses to test.
- Preserve meaningful contradictions as context-dependent experiments; do not manufacture consensus.
- Never repeat unverified benchmark numbers as facts.
- End with "What to test" and "What not to automate".
- Keep it under 8,000 words.

NOTES:
${reducedNotes.join('\n\n---\n\n')}`, { reasoning: 'high' });
if (!guide.trim()) throw new Error('Guide synthesis was empty; existing knowledge files remain unchanged.');

const agentRules = await textCall(`Create a compact "active research-backed refinements" block for an AI cold-email writer.

Below are (1) a comprehensive cited sales research guide and (2) the writer's existing doctrine. Return ONLY compatible additions that materially improve the existing doctrine. Do not restate rules it already has and OMIT research suggestions that conflict with the existing doctrine.

These project house standards are fixed and must not be challenged in the active block: seven touches; a 20-minute duration whenever a call is requested; the current first-touch word range; no buyer-facing links; evidence and role-fit fail closed; separate native-English review.

Focus on who/why-now evidence, truthful relevance, message/CTA choices, follow-up logic, proof scope, and human judgment. Keep exact [S###] citations and never invent one. Paraphrase only. Treat unsupported metrics and one-person anecdotes as tests, not laws. Maximum 1,500 words.

=== RESEARCH GUIDE ===
${guide}

=== EXISTING WRITER DOCTRINE ===
${existingBrain}`, { reasoning: 'high' });
if (!agentRules.trim()) throw new Error('Agent-rule synthesis was empty; existing knowledge files remain unchanged.');

function atomicWrite(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
}

const sourceRegistry = sourceRows.map((item) => {
  const title = String(item.title || 'Untitled').replace(/\s+/g, ' ').trim();
  const publisher = item.publisher ? ` — ${String(item.publisher).replace(/\s+/g, ' ').trim()}` : '';
  const type = item.source_type || 'unknown';
  return item.url
    ? `- [${item.sid}] [${title}](${item.url})${publisher} (${type})`
    : `- [${item.sid}] ${title}${publisher} (${type})`;
}).join('\n');

atomicWrite(
  GUIDE,
  `# Sales research field guide\n\nGenerated from ${sourceRows.length} local, public, and metadata-only sources on ${new Date().toISOString().slice(0, 10)}. Claims retain source IDs; source quantity is not treated as proof.\n\n${guide.trim()}\n\n## Source registry\n\n${sourceRegistry}\n`,
);

function spliceBlock(file, title, content) {
  const START = '<!-- SALES-RESEARCH:START -->';
  const END = '<!-- SALES-RESEARCH:END -->';
  const block = `${START}\n## ${title}\n\n${content.trim()}\n\nSource registry: \`docs/sales-research/research-wisdom.md\`.\n${END}`;
  let text = readFileSync(file, 'utf8');
  text = text.includes(START) && text.includes(END)
    ? text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : `${text.trimEnd()}\n\n${block}\n`;
  atomicWrite(file, text);
  console.log(`Updated ${file}`);
}

spliceBlock(
  HANDBOOK,
  'Active YouTube, course, and book refinements',
  `These compatible research refinements are active in the email writer. Sections 1–4 and the campaign playbooks still win.\n\n${agentRules}`,
);
spliceBlock(SHARED, 'Active YouTube, course, and book refinements', agentRules);
console.log(`Wrote ${GUIDE}`);
console.log('Done. The managed SALES-RESEARCH block is active in the handbook and shared writer brain.');
