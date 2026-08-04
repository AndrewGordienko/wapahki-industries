import { open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { researchRunner } from "../lib/research/runner.mjs";
import {
  radarSchema,
  underwritingSchema,
} from "../lib/research/schemas.mjs";
import {
  mergeOpportunities,
  readJson,
  writeJsonAtomic,
} from "../lib/research/store.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((item) => item.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : fallback;
};

const count = Math.max(1, Math.min(12, Number(valueFor("--count", "6"))));
const focus = valueFor(
  "--focus",
  "a balanced mix of construction, infrastructure, field service, healthcare operations, logistics, housing, local government operations, climate adaptation, and regulated business workflows",
);
const runnerKind = valueFor(
  "--runner",
  process.env.RESEARCH_RUNNER || "codex",
).toLowerCase();
const runId = `research-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const statePath = join(root, "data", "research-state.json");
const lockPath = join(root, "data", ".research.lock");
let lock;

async function setState(update) {
  const previous = await readJson(statePath, {});
  await writeJsonAtomic(statePath, { ...previous, ...update });
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return handle;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let metadata = null;
    try {
      metadata = JSON.parse(await readFile(lockPath, "utf8"));
    } catch {
      // An empty or interrupted lock is stale unless a live PID is recorded.
    }
    if (metadata?.pid) {
      try {
        process.kill(metadata.pid, 0);
        throw new Error("A research run is already active.");
      } catch (processError) {
        if (processError?.message === "A research run is already active.") {
          throw processError;
        }
      }
    }
    await rm(lockPath, { force: true });
    const handle = await open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return handle;
  }
}

lock = await acquireLock();

try {
  const startedAt = new Date().toISOString();
  await setState({
    status: "running",
    runner: runnerKind,
    startedAt,
    completedAt: null,
    message: "Problem Radar is searching current Canadian evidence.",
    lastRunId: runId,
    opportunitiesAdded: 0,
    pid: process.pid,
  });

  const [
    doctrine,
    radarInstructions,
    underwriterInstructions,
    auditorInstructions,
    existingStore,
  ] = await Promise.all([
      readFile(join(root, "docs", "OPPORTUNITY-ENGINE.md"), "utf8"),
      readFile(
        join(root, "agents", "problem-radar", "instructions.md"),
        "utf8",
      ),
      readFile(
        join(root, "agents", "opportunity-underwriter", "instructions.md"),
        "utf8",
      ),
      readFile(
        join(root, "agents", "evidence-auditor", "instructions.md"),
        "utf8",
      ),
      readJson(join(root, "data", "opportunities.json"), {
        opportunities: [],
      }),
    ]);

  const avoid = (existingStore.opportunities || [])
    .map((item) => item.title)
    .filter(Boolean);
  const run = researchRunner(runnerKind);
  const radarPrompt = [
    radarInstructions,
    "",
    "OPERATING DOCTRINE:",
    doctrine,
    "",
    `RUN DATE: ${new Date().toISOString().slice(0, 10)}`,
    `TASK: Find ${count} strong, distinct Canadian operational-problem candidates across ${focus}.`,
    "Prefer problems with an inspectable value unit, a reachable working owner, current timing, and a software wedge that can be shown with synthetic data.",
    "Include the succession and tacit-knowledge lane in the search. Use aggregate or voluntary public evidence only; never infer an individual's age or retirement plan.",
    "Find at least three plausible Canadian design-partner accounts for each candidate and at least one current signal.",
    avoid.length
      ? `Do not merely repeat these existing titles unless new evidence materially improves them: ${avoid.join("; ")}.`
      : "",
    "Return only the structured JSON requested by the supplied schema.",
  ]
    .filter(Boolean)
    .join("\n");

  const radar = await run({
    prompt: radarPrompt,
    schema: radarSchema,
    agent: "gnk-problem-radar",
    cwd: root,
  });

  await setState({
    message: `Opportunity Underwriter is testing ${radar.candidates?.length || 0} candidates.`,
  });

  const underwritingPrompt = [
    underwriterInstructions,
    "",
    "OPERATING DOCTRINE:",
    doctrine,
    "",
    `RUN DATE: ${new Date().toISOString().slice(0, 10)}`,
    "CANDIDATES FROM PROBLEM RADAR:",
    JSON.stringify(radar.candidates || [], null, 2),
    "",
    "Check source quality and current relevance with live web research. Recalculate every score total from its components.",
    "Only use verdict shortlist when the recalculated total is at least 65 and the evidence, buyer, data, timing, and 90-day close path are credible.",
    "Return only the structured JSON requested by the supplied schema.",
  ].join("\n");

  const underwriting = await run({
    prompt: underwritingPrompt,
    schema: underwritingSchema,
    agent: "gnk-opportunity-underwriter",
    cwd: root,
  });

  let finalOpportunities = underwriting.opportunities || [];
  const shortlist = finalOpportunities.filter(
    (item) => item.verdict === "shortlist" && item.score?.total >= 65,
  );
  if (shortlist.length) {
    await setState({
      message: `Evidence Auditor is challenging ${shortlist.length} shortlisted opportunities.`,
    });
    const auditPrompt = [
      auditorInstructions,
      "",
      "OPERATING DOCTRINE:",
      doctrine,
      "",
      `RUN DATE: ${new Date().toISOString().slice(0, 10)}`,
      "SHORTLIST FROM THE OPPORTUNITY UNDERWRITER:",
      JSON.stringify(shortlist, null, 2),
      "",
      "Use live web research to challenge the source quality, value calculation, buyer route, data access, incumbent-software gap and succession evidence where applicable.",
      "Return each reviewed opportunity in the opportunities array using the full supplied schema. Preserve defensible fields, correct or downgrade weak ones, recalculate the score, and use shortlist only when it still clears 65.",
      "Return only the structured JSON requested by the supplied schema.",
    ].join("\n");
    const audit = await run({
      prompt: auditPrompt,
      schema: underwritingSchema,
      agent: "gnk-evidence-auditor",
      cwd: root,
    });
    const auditedById = new Map(
      (audit.opportunities || []).map((item) => [item.id, item]),
    );
    finalOpportunities = finalOpportunities.map(
      (item) => auditedById.get(item.id) || item,
    );
  }

  const merged = await mergeOpportunities(root, finalOpportunities);
  const completedAt = new Date().toISOString();
  const accepted = finalOpportunities.length;
  await setState({
    status: "complete",
    completedAt,
    message: `Research complete. ${accepted} opportunities were added or updated for review.`,
    opportunitiesAdded: accepted,
    totalOpportunities: merged.opportunities.length,
    pid: null,
  });
  console.log(
    `Research complete: ${accepted} updated, ${merged.opportunities.length} total.`,
  );
} catch (error) {
  await setState({
    status: "failed",
    completedAt: new Date().toISOString(),
    message: String(error?.message || error).slice(0, 800),
    pid: null,
  });
  throw error;
} finally {
  await lock?.close();
  await rm(lockPath, { force: true });
}
