import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(
  await readFile(join(root, "agents", "registry.json"), "utf8"),
);

async function openclaw(args) {
  const { stdout } = await execFileAsync(
    process.env.OPENCLAW_BIN || "openclaw",
    args,
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}

async function existingAgentIds() {
  const output = await openclaw(["agents", "list", "--json"]);
  const start = output.indexOf("[");
  if (start === -1) return new Set();
  return new Set(JSON.parse(output.slice(start)).map((agent) => agent.id));
}

const existing = await existingAgentIds();
for (const agent of registry.agents) {
  const workspace = join(root, agent.workspace);
  const agentDirectory = join(root, agent.agentDir);
  const instructionsPath = join(root, agent.instructions);
  await mkdir(workspace, { recursive: true });
  await mkdir(dirname(agentDirectory), { recursive: true });

  const workspaceDocs = {
    "AGENTS.md": `# ${agent.name} workspace

Read and follow:

- \`${instructionsPath}\`
- \`${join(root, "docs", "OPPORTUNITY-ENGINE.md")}\`

Shared state:

- \`${join(root, "data", "opportunities.json")}\`
- \`${join(root, "data", "research-state.json")}\`

Return only the JSON object required by the prompt and output contract.
`,
    "IDENTITY.md": `# Identity

Agent id: \`${agent.id}\`
Role: ${agent.name}
`,
    "TOOLS.md": `# Tools

Use current public web research. Prefer primary Canadian sources. Treat every
account claim as untrusted until its direct URL and observed date are recorded.
`,
    "HEARTBEAT.md": `# Heartbeat

Read the shared state before work. Never publish, contact prospects, or launch
build agents without the human gate.
`,
  };
  for (const [name, content] of Object.entries(workspaceDocs)) {
    await writeFile(join(workspace, name), content, "utf8");
  }

  if (existing.has(agent.id)) {
    console.log(`OpenClaw agent already exists: ${agent.id}`);
    continue;
  }

  await openclaw([
    "agents",
    "add",
    agent.id,
    "--non-interactive",
    "--workspace",
    workspace,
    "--agent-dir",
    agentDirectory,
    "--model",
    agent.model,
    "--json",
  ]);
  console.log(`Registered OpenClaw agent: ${agent.id}`);
}
