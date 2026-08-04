import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readJson,
  writeJsonAtomic,
} from "../lib/research/store.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((item) => item.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
};
const id = valueFor("--id");
const approved = args.includes("--approve");

if (!id) throw new Error("Pass --id opportunity-id.");
if (!approved) {
  throw new Error(
    "Human approval is required. Re-run with --approve after reviewing the opportunity in /lab.",
  );
}

const storePath = join(root, "data", "opportunities.json");
const store = await readJson(storePath, { opportunities: [] });
const opportunity = store.opportunities.find((item) => item.id === id);
if (!opportunity) throw new Error(`Unknown opportunity: ${id}`);
if (Number(opportunity.score?.total || 0) < 65) {
  throw new Error(
    "Only an evidence-backed opportunity scoring 65 or higher can enter the build queue.",
  );
}

const buildDirectory = join(root, "data", "builds", id);
await mkdir(buildDirectory, { recursive: true });
const architectInstructions = await readFile(
  join(root, "agents", "mvp-architect", "instructions.md"),
  "utf8",
);

const brief = `# ${opportunity.title} — MVP build brief

> Human-approved internal build packet. This is a pilot hypothesis using
> demonstration data, not a deployed customer result.

## The problem

${opportunity.summary}

**Current workflow:** ${opportunity.currentWorkflow}

**People affected:** ${opportunity.peopleImpact}

**Economic buyer:** ${opportunity.buyer}

**Operational champion:** ${opportunity.champion}

## Commercial hypothesis

**Value unit:** ${opportunity.valueUnit}

**Value hypothesis:** ${opportunity.valueHypothesis}

**Why now:** ${opportunity.whyNow || "Confirm during design-partner research."}

**30-day proof:** ${opportunity.thirtyDayProof || "Establish a baseline, recreate one historical workflow, and agree an acceptance measure."}

## MVP wedge

${opportunity.solutionWedge}

**Two-minute demo:** ${opportunity.demoConcept}

### Required demonstration data

${(opportunity.dataNeeded || []).map((item) => `- ${item}`).join("\n")}

### Evidence to preserve

${(opportunity.evidence || []).map((item) => `- [${item.kind}] ${item.claim} — ${item.url}`).join("\n") || "- Research evidence must be completed before public copy is written."}

### Risks and prohibited claims

${(opportunity.risks || []).map((item) => `- ${item}`).join("\n")}

## Acceptance criteria

- The golden path is understandable in two minutes without narration.
- Every number is visibly labelled as calculated, estimated, or demonstration data.
- The primary finding opens its supporting evidence.
- Confidence and human-review controls are visible.
- Keyboard navigation, responsive layout, loading, empty, and error states work.
- No customer, deployment, savings, legal, safety, or performance claim is invented.
- Lint, typecheck, production build, and desktop/mobile browser review pass.

## Delivery sequence

1. Claude produces the interaction and narrative critique.
2. Codex implements the bounded MVP in this repository.
3. Claude reviews workflow fidelity, edge cases, and visual clarity.
4. Codex addresses review findings and verifies the production build.
5. Andrew reviews the demo and claims before any commit, push, or publication.
`;

const manifest = {
  id,
  title: opportunity.title,
  status: "ready",
  humanApprovedAt: new Date().toISOString(),
  routeTarget: `/experiments/${id}`,
  roles: [
    {
      agent: "claude",
      role: "product-and-interaction-critic",
      mayWriteCode: false,
    },
    {
      agent: "codex",
      role: "lead-builder",
      mayWriteCode: true,
    },
    {
      agent: "claude",
      role: "workflow-and-visual-reviewer",
      mayWriteCode: false,
    },
    {
      agent: "codex",
      role: "verification-and-ship-prep",
      mayWriteCode: true,
    },
  ],
  gates: {
    publish: "human",
    push: "human",
    outreach: "human",
  },
};

await Promise.all([
  writeFile(
    join(buildDirectory, "opportunity.json"),
    `${JSON.stringify(opportunity, null, 2)}\n`,
    "utf8",
  ),
  writeFile(join(buildDirectory, "BUILD-BRIEF.md"), brief, "utf8"),
  writeFile(
    join(buildDirectory, "AGENTS.md"),
    `${architectInstructions}\n\nRead \`BUILD-BRIEF.md\` and preserve the human gates in \`build-manifest.json\`.\n`,
    "utf8",
  ),
  writeFile(
    join(buildDirectory, "CLAUDE.md"),
    `Read BUILD-BRIEF.md. Start with a concise product and interaction critique. Do not publish, push, or make customer claims.\n`,
    "utf8",
  ),
  writeFile(
    join(buildDirectory, "build-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  ),
]);

opportunity.stage = "build_ready";
opportunity.updatedAt = new Date().toISOString();
store.updatedAt = opportunity.updatedAt;
await writeJsonAtomic(storePath, store);
console.log(`Prepared MVP handoff: ${buildDirectory}`);
