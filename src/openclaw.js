// LEGACY, EXPLICIT OPT-IN ONLY. Project model work now runs through src/codex.js
// and the user's ChatGPT/Codex login. The configured OpenClaw providers may be
// usage billed, so accidental calls are blocked.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BIN = '/opt/homebrew/bin/openclaw';

// Run one agent turn. Returns the agent's reply text (payloads joined).
export async function runAgent({ message, model = 'openai/gpt-5.5', agent = 'main', sessionKey, timeout = 300 }) {
  if (process.env.ALLOW_OPENCLAW_LLM !== '1') {
    throw new Error('OpenClaw LLM calls are disabled. Use src/codex.js or set ALLOW_OPENCLAW_LLM=1 explicitly.');
  }
  const args = ['agent', '--agent', agent];
  if (sessionKey) args.push('--session-key', sessionKey);
  args.push('--model', model, '--json', '--timeout', String(timeout), '--message', message);
  const { stdout } = await execFileAsync(BIN, args, { maxBuffer: 40 * 1024 * 1024 });
  let j;
  try { j = JSON.parse(stdout); } catch { return stdout; }
  const payloads = (j.result && j.result.payloads) || j.payloads || [];
  return payloads.map((p) => p.text || '').join('\n').trim();
}

// Pull the first JSON array out of an agent reply (handles ```-fenced or prose-wrapped output).
export function extractJsonArray(text) {
  if (!text) return null;
  const s = text.indexOf('['), e = text.lastIndexOf(']');
  if (s >= 0 && e > s) {
    try { const a = JSON.parse(text.slice(s, e + 1)); if (Array.isArray(a)) return a; } catch { /* fall through */ }
  }
  return null;
}
