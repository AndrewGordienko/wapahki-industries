// Distill sampled public Reddit threads into:
//   1) a source-ID-cited practitioner guide;
//   2) a managed handbook block; and
//   3) a compact managed delta in the shared email-writer brain.
//
// Every model call must succeed before any target is replaced. Writes are
// atomic and managed blocks are idempotent.
//   node scripts/reddit-learn.js
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCodex, textSchema } from '../src/codex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CORPUS = join(root, 'data', 'reddit', 'corpus.json');
const WISDOM = join(root, 'docs', 'cold-email-writing', 'reddit-wisdom.md');
const HANDBOOK = join(root, 'docs', 'HANDBOOK.md');
const SHARED = join(root, 'playbooks', '_shared.md');
const MODEL = process.env.REDDIT_LEARN_MODEL || 'gpt-5.6-terra';
const CHUNK = 60000; // ~15k input tokens
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

function readCorpus() {
  if (!existsSync(CORPUS)) {
    console.error('No corpus yet. Run `npm run reddit:scrape` first.');
    process.exit(1);
  }
  const value = JSON.parse(readFileSync(CORPUS, 'utf8'));
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Corpus is empty or invalid. Scrape at least one thread before learning.');
  }
  return value.filter(
    (item) => item && item.id && String(item.text || '').trim().length >= 160,
  );
}

const corpus = readCorpus().map((item, index) => ({
  ...item,
  sid: `R${String(index + 1).padStart(3, '0')}`,
}));
if (!corpus.length) throw new Error('Corpus has no substantive threads.');
const subreddits = [...new Set(corpus.map((item) => `r/${item.subreddit}`))];
console.log(`Corpus: ${corpus.length} threads across ${subreddits.length} subreddits. Distilling…`);

// Pack whole threads into chunks and retain the only source IDs each extraction
// call is allowed to use.
const chunks = [];
let buffer = '';
let ids = [];
for (const item of corpus) {
  const block = [
    `[${item.sid}]`,
    `subreddit=r/${item.subreddit}`,
    `title=${String(item.title || item.id).replace(/\s+/g, ' ')}`,
    `url=${item.url || ''}`,
    `upvotes=${item.ups ?? 'unknown'}`,
    `comments=${item.num_comments ?? 'unknown'}`,
    String(item.text || ''),
    '',
  ].join('\n');
  if (buffer && buffer.length + block.length > CHUNK) {
    chunks.push({ text: buffer, ids });
    buffer = '';
    ids = [];
  }
  // Preserve a stable ID if an unusually large thread must be split.
  if (block.length > CHUNK) {
    for (let offset = 0; offset < block.length; offset += CHUNK) {
      chunks.push({ text: block.slice(offset, offset + CHUNK), ids: [item.sid] });
    }
  } else {
    buffer += block;
    ids.push(item.sid);
  }
}
if (buffer) chunks.push({ text: buffer, ids });

const notes = [];
for (let index = 0; index < chunks.length; index++) {
  const allowedIds = chunks[index].ids.join(', ');
  const prompt = `Extract practical cold-outreach lessons from this sample of public Reddit threads.

Return tight markdown notes with every substantive claim followed by one or more exact source IDs such as [R004]. Cover targeting and why-now signals, message craft, subjects, CTAs, follow-ups, multichannel cadence, deliverability, measurement, and responsible AI use.

Evidence rules:
- Paraphrase. Do not quote the source text.
- Reddit posts and comments are practitioner anecdotes, not verified facts.
- Label self-reported results, promotional claims, disputed tactics, and numeric benchmarks as anecdotes or hypotheses to test.
- Preserve meaningful disagreement instead of manufacturing consensus.
- Never invent a client, result, example, statistic, or source ID.
- Reject spam, deception, and self-promotion.
- Use only IDs present in this chunk: ${allowedIds}.
- No preamble.

THREADS:
${chunks[index].text}`;
  try {
    const output = await textCall(prompt);
    if (!output.trim()) throw new Error('agent returned an empty response');
    notes.push(output.trim());
    console.log(`  extracted ${index + 1}/${chunks.length}`);
  } catch (error) {
    console.log(`  chunk ${index + 1} failed: ${error.message.split('\n')[0]}`);
  }
}
if (!notes.length) {
  throw new Error('All extraction calls failed; existing wisdom files remain unchanged.');
}

const guide = await textCall(`Synthesize the source-ID-cited extraction notes below into a rigorous, practical guide to what this sampled Reddit corpus suggests about cold outreach.

Requirements:
- Markdown only, no preamble, and no direct quotations.
- Cover copy/message craft and outreach operations/deliverability.
- Cite every substantive claim with the exact [R###] IDs already present.
- Never invent a source ID, client, example, result, or numeric benchmark.
- Separate recurring advice from one-person anecdotes, promotional claims, and hypotheses to test.
- Preserve meaningful disagreements and explain plausible context differences.
- Do not turn source frequency, upvotes, or confidence of tone into proof.
- Use placeholders such as {verified proof} in example messages; never fabricate proof or percentages.
- End with "What to test" and "What not to automate".
- Keep the guide under 4,000 words.

EXTRACTION NOTES:
${notes.join('\n\n---\n\n')}`, { reasoning: 'high' });
if (!guide.trim()) {
  throw new Error('Guide synthesis was empty; existing wisdom files remain unchanged.');
}
const guideBody = guide.trim().replace(/^#{1,6}\s+[^\n]+\n+/, '');

const existingBrain = readFileSync(SHARED, 'utf8').replace(
  /<!-- REDDIT-WISDOM:START -->[\s\S]*?<!-- REDDIT-WISDOM:END -->/g,
  '',
);
const writerRules = await textCall(`Create a compact "Reddit practitioner refinements" block for an AI cold-email writer.

Below are (1) a source-ID-cited Reddit practitioner guide and (2) the writer's existing doctrine. Return ONLY markdown additions or corrections that materially improve the existing doctrine. Do not restate rules it already contains.

Rules:
- Keep exact [R###] citations and never invent one.
- Treat anecdotes and unsupported metrics as tests, not laws.
- Never add fabricated proof, client results, or numeric examples.
- Focus on instructions the writing agent can apply: truthful relevance, message/CTA choices, follow-up logic, deliverability-safe copy, and disagreements worth testing.
- Maximum 1,500 words.

=== REDDIT PRACTITIONER GUIDE ===
${guideBody}

=== EXISTING WRITER DOCTRINE ===
${existingBrain}`, { reasoning: 'high' });
if (!writerRules.trim()) {
  throw new Error('Writer-rule synthesis was empty; existing wisdom files remain unchanged.');
}
const writerRulesBody = writerRules.trim().replace(/^#{1,6}\s+[^\n]+\n+/, '');

function writeAtomic(file, content) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
}

const registry = corpus.map((item) => {
  const title = String(item.title || item.id).replace(/\s+/g, ' ').trim();
  return `- [${item.sid}] [${title}](${item.url}) — r/${item.subreddit}`;
}).join('\n');
function demoteHeadings(markdown) {
  return markdown.replace(/^(#{1,5})(?= )/gm, '$1#');
}
function normalizeGuideHeadings(markdown) {
  return markdown.replace(/^#(?= )/gm, '##');
}
const nestedGuide = normalizeGuideHeadings(guideBody);
writeAtomic(
  WISDOM,
  `# Practitioner signals from sampled Reddit threads\n\nAuto-distilled by \`scripts/reddit-learn.js\` from \`data/reddit/corpus.json\` (${corpus.length} threads across ${subreddits.join(', ')}). These are public practitioner discussions, not independently verified evidence.\n\n${nestedGuide}\n\n## Source registry\n\n${registry}\n`,
);
console.log(`Wrote ${WISDOM}`);

function spliceBlock(file, title, content) {
  if (!existsSync(file)) throw new Error(`Managed-block target is missing: ${file}`);
  const START = '<!-- REDDIT-WISDOM:START -->';
  const END = '<!-- REDDIT-WISDOM:END -->';
  const block = `${START}\n## ${title}\n\n${content.trim()}\n\nSource registry: \`docs/cold-email-writing/reddit-wisdom.md\`.\n${END}`;
  let text = readFileSync(file, 'utf8');
  text = text.includes(START) && text.includes(END)
    ? text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : `${text.trimEnd()}\n\n${block}\n`;
  writeAtomic(file, text);
  console.log(`Updated ${file}`);
}

spliceBlock(HANDBOOK, 'Practitioner signals from Reddit', demoteHeadings(nestedGuide));
spliceBlock(SHARED, 'Reddit practitioner refinements', writerRulesBody);
console.log('Done. Review the REDDIT-WISDOM blocks before regenerating sequences.');
