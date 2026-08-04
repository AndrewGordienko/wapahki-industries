# Vendored open-source outreach assets

Brought in 2026-08-03 while surveying OSS cold-outreach tooling. Everything here is
**permissively licensed** and safe to reuse in this (commercial) product. GPL / no-license
repos were deliberately **not** vendored — see "Reference-only" below.

## What's here

| Path | Source | License | Why we kept it |
|------|--------|---------|----------------|
| `gtm-agents/` | [gtmagents/gtm-agents](https://github.com/gtmagents/gtm-agents) | Apache-2.0 | GTM skill library (cold-outreach, lead-qualification, signal-enrichment, cold-email-personalization). Drafts-only, no paid-data dependency. Runs in Codex CLI / Claude Code. |
| `b2b-sdr-skills/` | [iPythoning/b2b-sdr-agent-template](https://github.com/iPythoning/b2b-sdr-agent-template) | MIT | Three OpenClaw skills only: `lead-discovery` (web-search prospecting), `sdr-humanizer` (natural-message rules), `chroma-memory` (per-contact vector memory — future: attacks the follow-up-repetition + "no per-contact signals" gaps). |
| `trustpilot-signal-flow/` | [dancolta/trustpilot-outreach-automation](https://github.com/dancolta/trustpilot-outreach-automation) | ISC | Reference implementation of a **drafts-only** signal→email→Gmail-draft pipeline. The `src/gmail.js` Gmail-draft staging + `src/emailGen.js` signal-driven generation are the reusable parts; `src/trustpilot.js` is the swappable signal source. |

## Installed into the Codex runtime

The most useful skills were also copied into `~/.codex/skills/` so Codex/Claude load them
automatically (see `~/.codex/skills/VENDORED-FROM-OSS.md` for the list and how to remove them).
The copies here in `vendor/` are the source of truth + license text.

## What we built on top

`scripts/research-pass.js` (`npm run outreach:research`) — a per-account evidence pass that
uses the existing `runCodex()` login (no API billing) + web search to produce conservative,
source-cited evidence in the exact `{summary, source_url, source_date, warning}` shape that
`scripts/write-sequences.js` already reads from `data/outreach-research.json`. Fail-closed:
writes to `data/outreach-research.proposed.json` for review; only merges into the live file
with `RESEARCH_APPLY=1` (and backs it up first). This is informed by the gtm-agents
`lead-researcher` / `signal-taxonomy` skills but reimplemented in our own stack.

## Reference-only (NOT vendored here — license risk)

Cloned to `~/oss-outreach-reference/` (outside the product tree) for pattern-study only:

- **OpenOutreach** (GPLv3 — *viral*; copying its code would force GPL on our product). Worth
  studying for its Gaussian-Process + active-learning (BALD) lead scoring.
- **kaymen99/sales-outreach-automation-langgraph** (no license = all-rights-reserved).
  Multi-source per-lead research node.
- **mayooear/ai-company-researcher** (archived, no license). Clean modular research core.

"No license" means the code is legally all-rights-reserved even though the repo is public —
we can read it for ideas but must not copy it into this product.
