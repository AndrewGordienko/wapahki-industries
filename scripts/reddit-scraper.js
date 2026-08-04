// Reddit scraper — mines cold-outreach wisdom from a set of subreddits.
// Read-only, polite (rate-limited, resumable). Zero npm install (uses Node fetch).
//
// SETUP (one time): create a Reddit app at https://www.reddit.com/prefs/apps
//   -> "create app" -> type "script" -> note the client id (under the name) + secret.
// Then set these as system env vars (per your key preference):
//   export REDDIT_CLIENT_ID="..."      # required
//   export REDDIT_CLIENT_SECRET="..."  # required for a script/web app
//   export REDDIT_USERNAME="..."       # optional (enables the password grant)
//   export REDDIT_PASSWORD="..."       # optional
// RUN:
//   zsh -ic 'node scripts/reddit-scraper.js'            # scrape all subs
//   zsh -ic 'node scripts/reddit-scraper.js sales'      # just one sub
// Output: data/reddit/corpus.json  (array of {subreddit, id, title, url, ups, text})
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'data', 'reddit');
const CORPUS = join(OUT_DIR, 'corpus.json');
mkdirSync(OUT_DIR, { recursive: true });

const UA = 'wahpaki-crm:reddit-scraper:0.1 (outreach research; by /u/andrew)';
const SUBREDDITS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const SUBS = SUBREDDITS.length ? SUBREDDITS
  : ['sales', 'salestechniques', 'Entrepreneur', 'freelancing', 'LeadGeneration', 'ideavalidation', 'PromptEngineering', 'ChatGPTPro', 'SideProject'];
const QUERIES = ['cold email', 'cold outreach', 'cold email template', 'cold email reply rate', 'sales email', 'cold email prompt', 'follow up sequence', 'email deliverability'];
const POSTS_PER_QUERY = 15;
const COMMENTS_PER_POST = 60;
const MIN_TEXT = 40; // skip trivially short comments/posts

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken() {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET || '';
  if (!id) { const e = new Error('REDDIT_CLIENT_ID is not set. Create a Reddit "script" app and export the id/secret. See the header of this file.'); e.code = 'NO_KEY'; throw e; }
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const body = new URLSearchParams();
  if (process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD) {
    body.set('grant_type', 'password');
    body.set('username', process.env.REDDIT_USERNAME);
    body.set('password', process.env.REDDIT_PASSWORD);
  } else if (secret) {
    body.set('grant_type', 'client_credentials');
  } else {
    body.set('grant_type', 'https://oauth.reddit.com/grants/installed_client');
    body.set('device_id', 'DO_NOT_TRACK_THIS_DEVICE');
  }
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Reddit auth failed (${res.status}): ${j.error || JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

let ACCESS = null;
async function token() { if (!ACCESS) ACCESS = await getToken(); return ACCESS; }

async function api(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`https://oauth.reddit.com${path}`, { headers: { Authorization: `bearer ${await token()}`, 'User-Agent': UA } });
    if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
    if (res.status === 401) { ACCESS = null; continue; } // token expired mid-run, refresh + retry
    // stay under Reddit's ~100 req/min: pace off the remaining-header when present
    const remain = Number(res.headers.get('x-ratelimit-remaining'));
    if (!Number.isNaN(remain) && remain < 3) await sleep(3000);
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json();
  }
  throw new Error(`GET ${path} failed after ${tries} tries`);
}

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function run() {
  await token(); // validate creds up front so auth errors surface immediately
  const corpus = existsSync(CORPUS) ? JSON.parse(readFileSync(CORPUS, 'utf8')) : [];
  const seen = new Set(corpus.map((c) => c.id));
  let added = 0;

  for (const sub of SUBS) {
    const postIds = new Set();
    for (const q of QUERIES) {
      let listing;
      try { listing = await api(`/r/${sub}/search?q=${encodeURIComponent(q)}&restrict_sr=1&sort=top&t=all&limit=${POSTS_PER_QUERY}`); }
      catch (e) { console.log(`  ${sub} "${q}": ${e.message}`); continue; }
      for (const ch of listing?.data?.children || []) postIds.add(ch.data.id);
      await sleep(1200);
    }
    console.log(`r/${sub}: ${postIds.size} unique posts across ${QUERIES.length} queries`);

    for (const pid of postIds) {
      if (seen.has(pid)) continue;
      let thread;
      try { thread = await api(`/r/${sub}/comments/${pid}?limit=${COMMENTS_PER_POST}&depth=3&sort=top`); }
      catch (e) { console.log(`    post ${pid}: ${e.message}`); await sleep(1200); continue; }
      const post = thread?.[0]?.data?.children?.[0]?.data;
      if (!post) { await sleep(1000); continue; }
      const comments = [];
      const walk = (nodes) => { for (const n of nodes || []) { if (n.kind === 't1' && n.data?.body) { const b = clean(n.data.body); if (b.length >= MIN_TEXT && b !== '[deleted]' && b !== '[removed]') comments.push(b); } if (n.data?.replies?.data?.children) walk(n.data.replies.data.children); } };
      walk(thread?.[1]?.data?.children);
      const text = [clean(post.title), clean(post.selftext), ...comments].filter((t) => t.length >= MIN_TEXT).join('\n\n');
      corpus.push({ subreddit: sub, id: pid, title: clean(post.title), url: `https://reddit.com${post.permalink}`, ups: post.ups, num_comments: post.num_comments, text });
      seen.add(pid); added++;
      writeFileSync(CORPUS, JSON.stringify(corpus, null, 2)); // trickle-save so it's resumable
      process.stdout.write(`\r    saved ${added} new threads…`);
      await sleep(1400);
    }
    process.stdout.write('\n');
  }
  const bySub = {};
  for (const c of corpus) bySub[c.subreddit] = (bySub[c.subreddit] || 0) + 1;
  console.log('Per subreddit:', Object.entries(bySub).map(([s, n]) => `${s}:${n}`).join('  '));
  console.log(`\nDone. ${corpus.length} threads in ${CORPUS} (${added} new this run).`);
}

run().catch((e) => { console.error(e.message); process.exit(1); });
