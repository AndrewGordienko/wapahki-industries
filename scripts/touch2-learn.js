// Distill the second-touchpoint (first follow-up) research corpus into:
//   1) a cited "how to do the second touchpoint" field guide; and
//   2) a dedicated managed TOUCH2-WISDOM section in the handbook; and
//   3) a compatible active-guidance block in the shared writer playbook.
//
// This is the touch-2 twin of scripts/research-learn.js. It reads its OWN
// corpora (data/research/touch2-corpus.json + data/reddit/touch2-corpus.json)
// and writes its OWN outputs, so it never overwrites the first-touch guide.
// Every model stage must succeed before any target file is atomically replaced;
// it paraphrases sources, keeps source IDs, and preserves disagreement instead
// of manufacturing consensus.
//
//   node scripts/touch2-learn.js --dry-run
//   zsh -ic 'node scripts/touch2-learn.js'
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
const CORPUS = join(root, process.env.TOUCH2_CORPUS || 'data/research/touch2-corpus.json');
const REDDIT = join(root, process.env.TOUCH2_REDDIT || 'data/reddit/touch2-corpus.json');
const CONFIG = join(root, process.env.TOUCH2_CONFIG || 'config/touch2-sources.json');
const OUT_DIR = join(root, 'docs', 'second-touchpoint');
const GUIDE = join(OUT_DIR, 'touch2-wisdom.md');
const HANDBOOK = join(root, 'docs', 'HANDBOOK.md');
const SHARED = join(root, 'playbooks', '_shared.md');
const MODEL = process.env.TOUCH2_LEARN_MODEL || process.env.RESEARCH_LEARN_MODEL || 'gpt-5.6-terra';
const CHUNK_CHARS = Number(process.env.TOUCH2_LEARN_CHUNK_CHARS || 100000);
const MAX_ITEM_CHARS = Number(process.env.TOUCH2_LEARN_MAX_ITEM_CHARS || 90000);
const LIMIT = Number(process.env.TOUCH2_LEARN_LIMIT || 0);
const dryRun = process.argv.includes('--dry-run');

async function textCall(prompt, { reasoning = 'medium', timeoutMs = 600_000 } = {}) {
  const result = await runCodex({ prompt, schema: textSchema, model: MODEL, reasoning, timeoutMs, cwd: root });
  return result.text || '';
}

function readArray(file) {
  if (!existsSync(file)) return [];
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${file} must contain a JSON array`);
  return value.filter((item) => item && typeof item === 'object');
}

function readObject(file) {
  if (!existsSync(file)) return {};
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${file} must contain a JSON object`);
  }
  return value;
}

const config = readObject(CONFIG);
const research = readArray(CORPUS);
const redditCorpus = readArray(REDDIT);
if (config.reddit_include_ids != null && !Array.isArray(config.reddit_include_ids)) {
  throw new Error(`${CONFIG} reddit_include_ids must be an array`);
}
const redditIncludeIds = new Set(
  (config.reddit_include_ids || []).map((value) => String(value).trim()).filter(Boolean),
);
const redditById = new Map(redditCorpus.map((item) => [String(item.id || ''), item]));
const missingRedditIds = [...redditIncludeIds].filter((id) => !redditById.has(id));
if (missingRedditIds.length) {
  throw new Error(
    `Curated Reddit IDs are missing from ${REDDIT}: ${missingRedditIds.join(', ')}`,
  );
}
const selectedReddit = redditIncludeIds.size
  ? redditCorpus.filter((item) => redditIncludeIds.has(String(item.id || '')))
  : redditCorpus;
if (redditIncludeIds.size) {
  console.log(
    `Reddit curation: using ${selectedReddit.length}/${redditCorpus.length} threads from ${CONFIG}.`,
  );
}
const reddit = selectedReddit.map((item) => ({
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
  console.error(
    'No second-touchpoint corpus found. Collect follow-up transcripts into docs/second-touchpoint/,\n' +
      'then run `npm run touch2:research:scrape` (and optionally `npm run touch2:reddit:scrape`) first.',
  );
  process.exit(1);
}

const sourceRows = items.map((item, index) => ({ ...item, sid: `T${String(index + 1).padStart(3, '0')}` }));
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
  `Touch-2 research: ${sourceRows.length} sources (${Object.entries(typeCounts).map(([k, v]) => `${k}:${v}`).join('  ')}), ${chunks.length} extraction chunks, model ${MODEL}.`,
);
if (dryRun) {
  console.log(`Would write ${GUIDE}, then sync the handbook TOUCH2-WISDOM synthesis and the shared TOUCH2 writer block.`);
  process.exit(0);
}

const notes = [];
for (let index = 0; index < chunks.length; index++) {
  const prompt = `You are extracting doctrine about ONE narrow thing: the SECOND touchpoint of a cold B2B outreach sequence — the first follow-up email sent after an initial cold email got no reply. Ignore advice that is only about the first cold email, the discovery call, or closing, except where it directly shapes what the second touch should do.

Return concise markdown notes, with every substantive claim followed by one or more exact source IDs such as [T004]. PARAPHRASE; do not quote source prose. Extract concrete, reusable lessons about the second touch specifically:
- what a follow-up should CONTAIN (new value/angle/artifact vs. a bare reminder), and what makes "just checking in" fail;
- timing and spacing between touch 1 and touch 2, and how many follow-ups are worth sending;
- same-thread reply vs. a fresh thread; subject-line handling for a follow-up;
- how to reference the first email without guilt, fake deadlines, or pressure;
- multichannel bumps (e.g. email then LinkedIn) as the second touch;
- reply-rate or booking lift attributed to follow-ups, and when to stop / break up;
- deliverability and formatting specific to follow-ups.

Source handling rules:
- A marketing claim, one person's anecdote, Reddit consensus, book description, and measured result are not equivalent. Label weak or promotional evidence.
- If sources disagree (e.g. on cadence or number of touches), preserve the disagreement and note plausible segment/context differences. Never vote claims into truth.
- Prefer specific operating guidance over slogans. Reject self-promotion, fabricated certainty, spam tactics, and unsupported benchmark numbers.
- Never introduce a source ID absent from this chunk (${chunks[index].ids.join(', ')}).
- No preamble and no direct quotations.

CORPUS CHUNK:
${chunks[index].text}`;
  try {
    const output = await textCall(prompt);
    if (!output.trim()) throw new Error('empty extraction');
    notes.push(output.trim());
    console.log(`  extracted ${index + 1}/${chunks.length}`);
  } catch (error) {
    throw new Error(
      `Extraction chunk ${index + 1}/${chunks.length} failed; existing knowledge files remain unchanged: ${error.message.split('\n')[0]}`,
      { cause: error },
    );
  }
}

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
        `Deduplicate these source-ID-cited notes about the SECOND touchpoint (first follow-up) into tighter markdown. Preserve important conflicts (especially about cadence and number of follow-ups), evidence caveats, concrete examples, and all source IDs attached to surviving claims. Paraphrase only; no direct quotations and no preamble.\n\n${groups[i]}`,
      );
      if (!output.trim()) {
        throw new Error(
          `Reduction ${round}.${i + 1}/${groups.length} was empty; existing knowledge files remain unchanged.`,
        );
      }
      reduced.push(output.trim());
      console.log(`  reduction ${round}.${i + 1}/${groups.length}`);
    }
    current = reduced;
    round++;
  }
  return current;
}

const reducedNotes = await reduceNotes(notes);
const existingBrain = readFileSync(SHARED, 'utf8').replace(
  /<!-- TOUCH2-WISDOM:START -->[\s\S]*?<!-- TOUCH2-WISDOM:END -->/g,
  '',
);

const guide = await textCall(`Synthesize the source-ID-cited notes below into a rigorous, practical field guide titled to the question: "How should we write the SECOND touchpoint — the first follow-up after a cold email goes unanswered?"

Requirements:
- Markdown only, no preamble. Paraphrase; never quote source wording.
- Organize around the second touch: purpose of the follow-up, what it should contain (value/new angle/artifact vs. reminder), timing and spacing after touch 1, how many follow-ups are worthwhile, same-thread vs. fresh thread, subject lines, referencing touch 1 without pressure, multichannel bumps, when to stop / break up, and follow-up deliverability.
- Cite every substantive claim with the exact [T###] IDs already attached to the notes. Never invent an ID.
- Separate strong cross-source guidance from anecdotes, promotional claims, and hypotheses to test.
- Preserve meaningful contradictions (cadence, attempt count, thread choice) as context-dependent experiments; do not manufacture consensus.
- Never repeat an unverified benchmark number as fact.
- End with "What to test" and "What not to automate".
- Keep it under 5,000 words.

NOTES:
${reducedNotes.join('\n\n---\n\n')}`, { reasoning: 'high' });
if (!guide.trim()) throw new Error('Guide synthesis was empty; existing knowledge files remain unchanged.');

function assertKnownCitations(label, text) {
  const known = new Set(sourceRows.map((item) => item.sid));
  const cited = [...text.matchAll(/\[(T\d{3})\]/g)].map((match) => match[1]);
  const unknown = [...new Set(cited.filter((sid) => !known.has(sid)))];
  if (unknown.length) {
    throw new Error(`${label} invented unknown source IDs: ${unknown.join(', ')}`);
  }
}

assertKnownCitations('Guide synthesis', guide);

const agentRules = await textCall(`Create a compact "active second-touchpoint (T2) refinements" block for an AI cold-email writer.

Below are (1) a cited field guide on the second touchpoint and (2) the writer's existing doctrine, which ALREADY contains a founder-approved "Endorsed follow-up pattern (T2-T4)". Return ONLY compatible additions that materially improve the existing follow-up doctrine. Do not restate rules it already has, and OMIT research suggestions that conflict with the existing doctrine.

These project house standards are fixed and must not be challenged in the active block: seven touches; alternating email/LinkedIn; a 20-minute duration whenever a call is requested; no buyer-facing links in cold touches; evidence and role-fit fail closed; each follow-up must do one new job and be able to stand on its own; assumption-led cost models are an approved T2 job only when they show rounded inputs and arithmetic, label unpublished inputs as hypothetical, and ask for order-of-magnitude calibration; the banned "just following up / circling back / bumping / touch base" phrasing.

Focus on what sharpens the SECOND touch specifically: choosing the T2 job (cost model vs. artifact vs. new observation vs. lower-bar question), timing after T1, subject/thread handling, referencing T1 without pressure, and disagreements worth testing. Keep exact [T###] citations and never invent one. Paraphrase only. Treat unsupported metrics and one-person anecdotes as tests, not laws. Maximum 1,200 words.

=== SECOND-TOUCHPOINT FIELD GUIDE ===
${guide}

=== EXISTING WRITER DOCTRINE ===
${existingBrain}`, { reasoning: 'high' });
if (!agentRules.trim()) throw new Error('Agent-rule synthesis was empty; existing knowledge files remain unchanged.');
assertKnownCitations('Writer-rule synthesis', agentRules);
// Drop any leading heading the model echoed (e.g. the block title) so it does
// not duplicate the managed-block title added by spliceBlock().
const agentRulesBody = agentRules.trim().replace(
  /^#{1,6}\s+active second-touchpoint \(T2\) refinements\s*\n+/i,
  '',
);

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
  `# Second touchpoint field guide (first follow-up)\n\nGenerated by \`scripts/touch2-learn.js\` from ${sourceRows.length} follow-up-focused sources on ${new Date().toISOString().slice(0, 10)}. Claims retain source IDs; source quantity is not treated as proof. This is the touch-2 twin of \`docs/sales-research/research-wisdom.md\`.\n\n${guide.trim()}\n\n## Source registry\n\n${sourceRegistry}\n`,
);

function spliceBlock(file, title, content) {
  const START = '<!-- TOUCH2-WISDOM:START -->';
  const END = '<!-- TOUCH2-WISDOM:END -->';
  const block = `${START}\n## ${title}\n\n${content.trim()}\n\nSource registry: \`docs/second-touchpoint/touch2-wisdom.md\`.\n${END}`;
  let text = readFileSync(file, 'utf8');
  const startCount = text.split(START).length - 1;
  const endCount = text.split(END).length - 1;
  if (startCount !== endCount || startCount > 1) {
    throw new Error(
      `Refusing to update malformed TOUCH2-WISDOM markers in ${file} (start:${startCount}, end:${endCount})`,
    );
  }
  text = text.includes(START) && text.includes(END)
    ? text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : `${text.trimEnd()}\n\n${block}\n`;
  atomicWrite(file, text);
  console.log(`Updated ${file}`);
}

spliceBlock(
  HANDBOOK,
  'Second touchpoint (first follow-up) — cross-source research',
  `How to do the second touchpoint, distilled from follow-up-focused YouTube transcripts, web/course/book sources, and Reddit. This corroborates, challenges, or extends the founder-approved "Endorsed follow-up pattern (T2-T4)" in \`playbooks/_shared.md\`; the founder pattern and campaign rules still win on conflict.\n\n${agentRulesBody}`,
);
spliceBlock(SHARED, 'Active second-touchpoint (T2) refinements', agentRulesBody);
console.log(`Wrote ${GUIDE}`);
console.log('Done. The managed TOUCH2-WISDOM block is active in the handbook and shared writer brain.');
