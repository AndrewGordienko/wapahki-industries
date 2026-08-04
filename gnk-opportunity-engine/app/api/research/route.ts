import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { join } from "node:path";
import { readResearchState } from "@/lib/opportunities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canRun() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_LOCAL_AGENT_RUNNER === "1"
  );
}

function isProcessAlive(pid?: number | null) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json(await readResearchState(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  if (!canRun()) {
    return NextResponse.json(
      { error: "The agent runner is disabled outside localhost." },
      { status: 403 },
    );
  }

  const state = await readResearchState();
  if (
    state.status === "running" &&
    (!state.pid || isProcessAlive(state.pid))
  ) {
    return NextResponse.json(
      { error: "A research run is already active.", state },
      { status: 409 },
    );
  }

  let body: { count?: number; focus?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Defaults are intentional for an empty request body.
  }
  const count = Math.max(1, Math.min(12, Number(body.count || 6)));
  const focus = String(body.focus || "").trim().slice(0, 280);
  const args = [join(process.cwd(), "scripts", "research-scout.mjs"), "--count", String(count)];
  if (focus) args.push("--focus", focus);

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RESEARCH_MODEL:
        process.env.INTERACTIVE_RESEARCH_MODEL || "gpt-5.6-terra",
      RESEARCH_REASONING:
        process.env.INTERACTIVE_RESEARCH_REASONING || "medium",
      RESEARCH_TIMEOUT_MS: process.env.RESEARCH_TIMEOUT_MS || "1800000",
    },
    detached: false,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json(
    {
      status: "starting",
      pid: child.pid,
      message: "Problem Radar is starting. This page will refresh when the run finishes.",
    },
    { status: 202 },
  );
}
