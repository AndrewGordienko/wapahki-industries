// Run a structured, non-interactive Codex turn using the user's existing
// ChatGPT/Codex login. This does not read OPENAI_API_KEY and does not call the
// usage-billed OpenAI API.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BIN = process.env.CODEX_BIN || 'codex';
const activeProcessGroups = new Set();

function killProcessGroup(pid, signal) {
  try {
    if (process.platform !== 'win32') process.kill(-pid, signal);
    else process.kill(pid, signal);
  } catch (error) {
    if (!['ESRCH', 'EPERM'].includes(error.code)) throw error;
  }
}

function killActiveProcessGroups(signal) {
  for (const pid of activeProcessGroups) killProcessGroup(pid, signal);
}

process.once('exit', () => killActiveProcessGroups('SIGTERM'));
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    killActiveProcessGroups('SIGTERM');
    setTimeout(() => {
      killActiveProcessGroups('SIGKILL');
      process.exit(exitCode);
    }, 2_000);
  });
}

const GNK_SEVEN_STAGE_JOBS = [
  'handoff_question',
  'recent_case',
  'connect',
  'sharper_hypothesis',
  'existing_system_check',
  'discovery_invitation',
  'close_or_route',
];

const WAPAHKI_SEVEN_TOUCH_JOBS = [
  'last_example_question',
  'concrete_motion_test',
  'connect',
  'sharper_example',
  'route_owner',
  'offer_task_sketch',
  'close_loop',
];

const OUTAGEHUB_SEVEN_TOUCH_JOBS = [
  'establish_ownership',
  'examine_handoff',
  'connect',
  'retrospective_replay',
  'consequence_question',
  'sharpen_angle',
  'classification_close',
];

function buildSequenceBatchSchema({ touchCount, jobs }) {
  return {
  type: 'object',
  additionalProperties: false,
  required: ['dispositions', 'sequences'],
  properties: {
    dispositions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contact_id', 'verdict', 'reason'],
        properties: {
          contact_id: { type: 'integer' },
          verdict: { type: 'string', enum: ['write', 'do_not_contact'] },
          reason: { type: 'string' },
        },
      },
    },
    sequences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contact_id', 'spoken_brief', 'touches'],
        properties: {
          contact_id: { type: 'integer' },
          spoken_brief: {
            type: 'object',
            additionalProperties: false,
            required: [
              'single_thread',
              'role_route',
              'what_andrew_does',
              'why_reply',
              'one_question',
              'offer_connection',
              'call_payoff',
              'skeptical_question',
              'proof_boundary',
              'next_step',
              'research_used',
              'touch_plan',
            ],
            properties: {
              single_thread: { type: 'string' },
              role_route: { type: 'string' },
              what_andrew_does: { type: 'string' },
              why_reply: { type: 'string' },
              one_question: { type: 'string' },
              offer_connection: { type: 'string' },
              call_payoff: { type: 'string' },
              skeptical_question: { type: 'string' },
              proof_boundary: { type: 'string' },
              next_step: { type: 'string' },
              research_used: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['fact', 'source_url'],
                  properties: {
                    fact: { type: 'string' },
                    source_url: { type: 'string' },
                  },
                },
              },
              touch_plan: {
                type: 'array',
                minItems: touchCount,
                maxItems: touchCount,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['touch', 'job', 'personalization_anchor', 'new_information', 'cta'],
                  properties: {
                    touch: { type: 'integer', minimum: 1, maximum: touchCount },
                    job: {
                      type: 'string',
                      enum: jobs,
                    },
                    personalization_anchor: { type: 'string' },
                    new_information: { type: 'string' },
                    cta: { type: 'string' },
                  },
                },
              },
            },
          },
          touches: {
            type: 'array',
            minItems: touchCount,
            maxItems: touchCount,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['touch', 'day', 'channel', 'subject', 'body'],
              properties: {
                touch: { type: 'integer', minimum: 1, maximum: touchCount },
                day: { type: 'integer' },
                channel: { type: 'string', enum: ['email', 'linkedin'] },
                subject: { type: ['string', 'null'] },
                body: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  };
}

export const sequenceBatchSchema = buildSequenceBatchSchema({
  touchCount: 7,
  jobs: GNK_SEVEN_STAGE_JOBS,
});

export function sequenceBatchSchemaForCampaign(campaign) {
  const key = String(campaign || '').toLowerCase();
  if (key === 'wapahki') {
    // Every Wapahki contact runs the same seven-stage sequence; role changes the
    // framing, not the length.
    return buildSequenceBatchSchema({ touchCount: 7, jobs: WAPAHKI_SEVEN_TOUCH_JOBS });
  }
  if (['outagehub', 'outage'].includes(key)) {
    return buildSequenceBatchSchema({ touchCount: 7, jobs: OUTAGEHUB_SEVEN_TOUCH_JOBS });
  }
  return sequenceBatchSchema;
}

export const critiqueBatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reviews'],
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contact_id', 'verdict', 'evidence', 'role_fit', 'clarity', 'reply_value', 'required_changes'],
        properties: {
          contact_id: { type: 'integer' },
          verdict: { type: 'string', enum: ['pass', 'revise', 'do_not_contact'] },
          evidence: { type: 'string' },
          role_fit: { type: 'string' },
          clarity: { type: 'string' },
          reply_value: { type: 'string' },
          required_changes: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
};

export const languageBatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reviews'],
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contact_id', 'verdict', 'plain_meaning', 'unnatural_lines', 'flow_notes'],
        properties: {
          contact_id: { type: 'integer' },
          verdict: { type: 'string', enum: ['pass', 'revise'] },
          plain_meaning: { type: 'string' },
          unnatural_lines: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['line', 'why_it_is_unnatural', 'say_this_instead'],
              properties: {
                line: { type: 'string' },
                why_it_is_unnatural: { type: 'string' },
                say_this_instead: { type: 'string' },
              },
            },
          },
          flow_notes: { type: 'string' },
        },
      },
    },
  },
};

export const textSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' } },
};

async function runCodexCli({
  prompt,
  schema,
  model = process.env.CODEX_MODEL || 'gpt-5.6-sol',
  reasoning = process.env.CODEX_REASONING || 'high',
  webSearch = false,
  timeoutMs = Number(process.env.CODEX_TIMEOUT_MS) || 600_000,
  cwd = process.cwd(),
}) {
  const dir = await mkdtemp(join(tmpdir(), 'wahpaki-codex-'));
  const schemaPath = join(dir, 'schema.json');
  const outputPath = join(dir, 'last-message.json');

  try {
    await writeFile(schemaPath, JSON.stringify(schema), 'utf8');
    const args = [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '--model', model,
      '--config', `model_reasoning_effort="${reasoning}"`,
      ...(webSearch ? ['--config', 'tools.web_search=true'] : []),
      '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      '--color', 'never',
      '-',
    ];
    await new Promise((resolve, reject) => {
      const grouped = process.platform !== 'win32';
      const child = spawn(BIN, args, {
        cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: grouped,
      });
      if (grouped) activeProcessGroups.add(child.pid);
      let stdout = '';
      let stderr = '';
      let failure = null;
      let settled = false;
      let forceTimer = null;
      let failSafeTimer = null;
      const killTree = (signal) => {
        try {
          if (grouped) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch (error) {
          if (error.code === 'EPERM' && grouped) {
            try {
              child.kill(signal);
            } catch (fallbackError) {
              if (!['ESRCH', 'EPERM'].includes(fallbackError.code)) throw fallbackError;
            }
            return;
          }
          if (error.code !== 'ESRCH') throw error;
        }
      };
      const terminate = (error) => {
        if (failure || settled) return;
        failure = error;
        killTree('SIGTERM');
        forceTimer = setTimeout(() => killTree('SIGKILL'), 2_000);
        failSafeTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(failure);
        }, 5_000);
      };
      const timer = setTimeout(() => {
        terminate(new Error(`timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > 40 * 1024 * 1024) {
          terminate(new Error('stdout exceeded 40 MiB'));
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.length > 40 * 1024 * 1024) {
          terminate(new Error('stderr exceeded 40 MiB'));
        }
      });
      child.on('error', (error) => {
        activeProcessGroups.delete(child.pid);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        clearTimeout(failSafeTimer);
        reject(error);
      });
      child.on('close', (code, signal) => {
        activeProcessGroups.delete(child.pid);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        clearTimeout(failSafeTimer);
        if (failure) reject(failure);
        else if (code === 0) resolve();
        else reject(new Error(`exit ${code ?? signal}: ${stderr || stdout}`));
      });
      child.stdin.end(prompt);
    });

    const raw = await readFile(outputPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const detail = error.stderr || error.stdout || error.message;
    throw new Error(`Codex CLI failed: ${String(detail).trim().split('\n').slice(-4).join(' ')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Claude Code CLI backend. Uses the user's Claude subscription via `claude -p`
// with --json-schema for schema-enforced structured output, returning the same
// parsed object contract as runCodexCli. Not billed against the codex quota.
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

async function runClaude({
  prompt,
  schema,
  model = process.env.CLAUDE_MODEL || 'sonnet',
  webSearch = false,
  timeoutMs = Number(process.env.CLAUDE_TIMEOUT_MS) || Number(process.env.CODEX_TIMEOUT_MS) || 600_000,
  cwd = process.cwd(),
}) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--model', model,
    ...(webSearch ? ['--allowedTools', 'WebSearch'] : ['--disallowedTools', 'Bash Edit Write WebSearch WebFetch']),
  ];
  const stdout = await new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: grouped,
    });
    if (grouped) activeProcessGroups.add(child.pid);
    let out = '';
    let err = '';
    let settled = false;
    const killTree = (signal) => {
      try {
        if (grouped) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (!['ESRCH', 'EPERM'].includes(error.code)) throw error;
      }
    };
    const timer = setTimeout(() => {
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 2_000);
      if (!settled) { settled = true; reject(new Error(`timed out after ${timeoutMs}ms`)); }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.length > 40 * 1024 * 1024) { killTree('SIGKILL'); if (!settled) { settled = true; reject(new Error('stdout exceeded 40 MiB')); } }
    });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => {
      activeProcessGroups.delete(child.pid);
      if (settled) return; settled = true; clearTimeout(timer); reject(error);
    });
    child.on('close', (code, signal) => {
      activeProcessGroups.delete(child.pid);
      if (settled) return; settled = true; clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exit ${code ?? signal}: ${(err || out).trim().split('\n').slice(-4).join(' ')}`));
    });
    child.stdin.end(prompt);
  });

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`Claude CLI failed: non-JSON output: ${stdout.trim().slice(-400)}`);
  }
  if (envelope.is_error || envelope.subtype !== 'success') {
    throw new Error(`Claude CLI failed: ${String(envelope.result || envelope.subtype || 'unknown error').slice(-400)}`);
  }
  if (envelope.structured_output == null) {
    throw new Error(`Claude CLI failed: no structured_output in result: ${String(envelope.result || '').slice(-400)}`);
  }
  return envelope.structured_output;
}

// Backend dispatcher. Keeps the runCodex(...) call sites in write-sequences.js
// unchanged; GEN_BACKEND=claude routes generation to the Claude Code CLI.
export async function runCodex(opts) {
  const backend = String(process.env.GEN_BACKEND || 'codex').toLowerCase();
  if (backend === 'claude') {
    // Callers pass a codex model name; force a Claude model for this backend.
    return runClaude({ ...opts, model: process.env.CLAUDE_MODEL || 'sonnet' });
  }
  return runCodexCli(opts);
}
