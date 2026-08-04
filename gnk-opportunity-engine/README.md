# GnK opportunity engine (extracted)

This folder is the **opportunity / research engine** that was built inside the
public **GnK** website repo (`Documents/gnk`). It has been
copied here on **2026-07-29** so the research and CRM strategy tooling lives in
the CRM repo, not in the public marketing site.

> Rationale (from the engine's own doctrine): *"`GnK` is the public
> studio name; the research and build infrastructure remains deliberately
> independent from the brand."* The website should ship without this engine.

## Relationship to wahpaki's native Problem Radar

**wahpaki-industries already has the canonical, runnable version of this system.**
This extracted folder is a parallel **Next.js** implementation and should be
treated as reference / a source to integrate from — not the runtime.

| Concept | Canonical (wahpaki, use this) | Extracted here (reference) |
| --- | --- | --- |
| Problem discovery | `scripts/discover-problems.js`, `src/problems.js` | `scripts/research-scout.mjs`, `lib/research/` |
| Dashboard | `src/server.js` → `/problems` (`public/problems.*`) | `app/lab/` (Next.js React) |
| Codex / OpenClaw | `src/codex.js`, `src/openclaw.js` | `openclaw-workspaces/`, `agents/*/instructions.md` |
| Spec / doctrine | `docs/problem-found/SPEC.md`, `DISCOVERY.md` | `docs/OPPORTUNITY-ENGINE.md` |
| Opportunity data | `data/*.json`, `data/crm.db` | `data/opportunities.json`, `data/research-state.json` |

If you want a single system, migrate anything unique from here into wahpaki's
native modules, then this folder can be deleted.

## What's inside

- `agents/` — instruction files + `registry.json` for the four roles
  (problem-radar, opportunity-underwriter, evidence-auditor, mvp-architect).
- `openclaw-workspaces/` — per-agent OpenClaw workspace scaffolding.
- `app/lab/` — the Next.js `/lab` dashboard (React). Needs a Next host to run.
- `app/api/research/`, `app/api/opportunities/[id]/prepare/` — the Next route
  handlers the dashboard called.
- `lib/opportunities.ts` — typed store/reader used by the Next routes.
- `lib/research/{runner,store,schemas}.mjs` — the Node research runner.
- `data/opportunities.json`, `data/research-state.json`, `data/logs/` — engine
  state snapshot at extraction time (synthetic / working data).
- `docs/OPPORTUNITY-ENGINE.md` — full doctrine and claim boundaries.
- `ops/launchd/com.gnk.problem-radar.plist.example` — inactive macOS schedule
  example (targets ~02:15 local; review absolute paths before ever installing).
- `scripts/` — `research-scout.mjs`, `setup-openclaw.mjs`, `prepare-mvp.mjs`.

## Original npm scripts (from the gnk package.json)

These invoked the engine when it lived in the website repo:

```jsonc
"research:scout": "node scripts/research-scout.mjs",   // discover + score opportunities
"agents:setup":   "node scripts/setup-openclaw.mjs",   // register OpenClaw workspaces
"mvp:prepare":    "node scripts/prepare-mvp.mjs"        // build packet after human approval
```

They are **not** wired into wahpaki's `package.json`. Wire them up (or port them)
only if you decide to run this implementation instead of the native one.

## Provenance / rollback

- Extracted from `Documents/gnk` on 2026-07-29.
- The pre-rebrand rollback tarball retains its historical filename outside this repository.
- At extraction time the originals were **left in place** in `gnk`
  pending confirmation that no scheduled research job would break; they will be
  removed from the website repo in a follow-up step.
