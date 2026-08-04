// LEGACY, EXPLICIT OPT-IN ONLY. The active workflow uses src/codex.js and the
// user's ChatGPT/Codex login. Direct API calls are usage billed, so this module
// refuses to send unless ALLOW_USAGE_BILLED_OPENAI_API=1 is deliberately set.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

let cached = null;
export function openaiKey() {
  if (cached) return cached;
  if (process.env.OPENAI_API_KEY) return (cached = process.env.OPENAI_API_KEY.trim());
  try {
    const out = execFileSync(join(homedir(), '.openclaw', 'bin', 'fetch-openai-key.sh'), { encoding: 'utf8' });
    const j = JSON.parse(out);
    if (j.values && j.values.OPENAI_API_KEY) return (cached = j.values.OPENAI_API_KEY.trim());
  } catch { /* fall through */ }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One chat completion, with retry/backoff on rate limits (429) and 5xx — needed
// once we fire many in parallel. Throws with .code on non-retryable errors.
export async function chat({ messages, model = 'gpt-5.6-terra', timeoutMs = 180000, retries = 5 }) {
  if (process.env.ALLOW_USAGE_BILLED_OPENAI_API !== '1') {
    const error = new Error('Usage-billed OpenAI API is disabled. Use src/codex.js or set ALLOW_USAGE_BILLED_OPENAI_API=1 explicitly.');
    error.code = 'API_DISABLED';
    throw error;
  }
  const key = openaiKey();
  if (!key) { const e = new Error('No OpenAI API key found (env or fetch-openai-key.sh)'); e.code = 'NO_KEY'; throw e; }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res, j;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      j = await res.json().catch(() => ({}));
    } catch (err) { lastErr = err; await sleep(1200 * (attempt + 1)); continue; }

    if (j.error) {
      const code = j.error.code || '';
      if (res.status === 429 || res.status >= 500 || code === 'rate_limit_exceeded') {
        lastErr = Object.assign(new Error(j.error.message || 'rate limited'), { code });
        await sleep(1500 * (attempt + 1) + Math.floor(Math.random() * 700));
        continue;
      }
      const e = new Error(j.error.message || 'OpenAI error'); e.code = code || 'API_ERROR'; throw e;
    }
    return j.choices?.[0]?.message?.content || '';
  }
  throw lastErr || new Error('OpenAI failed after retries');
}
