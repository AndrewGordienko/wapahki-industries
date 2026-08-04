import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

export function normalizeScore(score) {
  const total =
    Number(score.pain || 0) +
    Number(score.budget || 0) +
    Number(score.data || 0) +
    Number(score.timing || 0) +
    Number(score.engineeringGap || 0) +
    Number(score.access || 0) +
    Number(score.repeatability || 0);
  return { ...score, total };
}

export async function mergeOpportunities(root, incoming) {
  const path = join(root, "data", "opportunities.json");
  const store = await readJson(path, {
    version: 1,
    updatedAt: new Date().toISOString(),
    opportunities: [],
  });
  const now = new Date().toISOString();
  const byId = new Map(
    (store.opportunities || []).map((item) => [item.id, item]),
  );

  for (const raw of incoming) {
    const id = slugify(raw.id || raw.title);
    const previous = byId.get(id);
    const score = normalizeScore(raw.score || {});
    const stage =
      raw.verdict === "shortlist" && score.total >= 65
        ? "shortlisted"
        : raw.verdict === "reject"
          ? "rejected"
          : "research";
    byId.set(id, {
      ...previous,
      ...raw,
      id,
      stage,
      score,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    });
  }

  const opportunities = [...byId.values()].sort(
    (a, b) => Number(b.score?.total || 0) - Number(a.score?.total || 0),
  );
  const next = {
    version: 1,
    updatedAt: now,
    opportunities,
  };
  await writeJsonAtomic(path, next);
  return next;
}
