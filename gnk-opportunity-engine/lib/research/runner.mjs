import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CODEX_BIN = process.env.CODEX_BIN || "codex";
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";

function runProcess(bin, args, { cwd, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const maxBuffer = 40 * 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > maxBuffer) child.kill("SIGTERM");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            `${bin} exited ${code ?? signal}: ${stderr || stdout || "no output"}`,
          ),
        );
      }
    });
    child.stdin.end(input);
  });
}

export async function runCodexResearch({
  prompt,
  schema,
  cwd,
  model = process.env.RESEARCH_MODEL || "gpt-5.6-sol",
  reasoning = process.env.RESEARCH_REASONING || "high",
  timeoutMs = Number(process.env.RESEARCH_TIMEOUT_MS) || 1_800_000,
}) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "gnk-research-"));
  const schemaPath = join(tempDirectory, "schema.json");
  const outputPath = join(tempDirectory, "last-message.json");

  try {
    await writeFile(schemaPath, JSON.stringify(schema), "utf8");
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--model",
      model,
      "--config",
      `model_reasoning_effort="${reasoning}"`,
      "--config",
      'web_search="live"',
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "--color",
      "never",
      "-",
    ];
    await runProcess(CODEX_BIN, args, {
      cwd,
      input: prompt,
      timeoutMs,
    });
    return JSON.parse(await readFile(outputPath, "utf8"));
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function extractOpenClawText(stdout) {
  try {
    const payload = JSON.parse(stdout);
    const messages = payload?.result?.payloads || payload?.payloads || [];
    const text = messages.map((item) => item?.text || "").join("\n").trim();
    if (text) return text;
  } catch {
    // Some OpenClaw versions return the model text without an envelope.
  }
  return stdout.trim();
}

function extractJsonObject(text) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last <= first) {
    throw new Error("OpenClaw returned no JSON object.");
  }
  return JSON.parse(text.slice(first, last + 1));
}

export async function runOpenClawResearch({
  prompt,
  agent,
  cwd,
  model = process.env.OPENCLAW_RESEARCH_MODEL || "openai/gpt-5.4-mini",
  timeoutMs = Number(process.env.RESEARCH_TIMEOUT_MS) || 1_800_000,
}) {
  if (process.env.ALLOW_OPENCLAW_LLM !== "1") {
    throw new Error(
      "OpenClaw model calls are opt-in because the configured provider may be usage billed. Set ALLOW_OPENCLAW_LLM=1 deliberately.",
    );
  }
  const timeoutSeconds = Math.max(60, Math.ceil(timeoutMs / 1000));
  const { stdout } = await runProcess(
    OPENCLAW_BIN,
    [
      "agent",
      "--agent",
      agent,
      "--model",
      model,
      "--json",
      "--timeout",
      String(timeoutSeconds),
      "--message",
      prompt,
    ],
    { cwd, input: "", timeoutMs },
  );
  return extractJsonObject(extractOpenClawText(stdout));
}

export function researchRunner(kind) {
  if (kind === "openclaw") {
    return ({ prompt, agent, cwd, model, timeoutMs }) =>
      runOpenClawResearch({ prompt, agent, cwd, model, timeoutMs });
  }
  return runCodexResearch;
}
