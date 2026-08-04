import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

function canRun() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_LOCAL_AGENT_RUNNER === "1"
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  void request;
  if (!canRun()) {
    return NextResponse.json(
      { error: "Build preparation is disabled outside localhost." },
      { status: 403 },
    );
  }
  const { id } = await context.params;
  if (!/^[a-z0-9-]{2,80}$/.test(id)) {
    return NextResponse.json({ error: "Invalid opportunity id." }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        join(process.cwd(), "scripts", "prepare-mvp.mjs"),
        "--id",
        id,
        "--approve",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );
    return NextResponse.json({ status: "ready", message: stdout.trim() });
  } catch (error) {
    const failure = error as Error & { stderr?: string; stdout?: string };
    const detail =
      failure.stderr?.trim() ||
      failure.stdout?.trim() ||
      failure.message ||
      "Could not prepare the MVP handoff.";
    const explicitErrors = [...detail.matchAll(/^Error:\s+(.+)$/gm)];
    const safeMessage =
      explicitErrors.at(-1)?.[1]?.trim() ||
      detail.split("\n").find((line) => line.trim())?.trim() ||
      "Could not prepare the MVP handoff.";
    return NextResponse.json(
      { error: safeMessage },
      { status: 400 },
    );
  }
}
