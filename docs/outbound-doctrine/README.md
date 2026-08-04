# Outbound doctrine

Four focused handbooks that fix specific, recurring generator failures. They were
built on 2026-08-02 from ten practitioner talks (see `sources.md`), distilled and
synthesized rather than pasted in. They sit *under* `docs/HANDBOOK.md` (still the
source of truth) and their hard rules are wired into the writer's brain
(`playbooks/_shared.md`, the `OUTBOUND-DOCTRINE` block and Gate 1).

## Why this exists — the failure modes being fixed

The generator kept doing these seven things. Each maps to the handbook that fixes
it:

| # | Recurring failure | Fixed in |
|---|-------------------|----------|
| 1 | Turning a plausible hypothesis into an asserted workflow | A, B |
| 2 | Inferring ownership from someone's title | A, B, D |
| 3 | Introducing solution, pilot, and ROI before confirming the problem | B, C |
| 4 | Repeating the same hypothesis across follow-ups | D |
| 5 | Using invented operational language | A, C |
| 6 | Contacting several people at one company with no routing strategy | D |
| 7 | Making the recipient do too much work to answer | B, C |

These are not mainly copywriting problems. Copy (Handbook C) is the last mile; the
first three failures are research and reasoning problems (Handbooks A and B), and
the routing failures are account-strategy problems (Handbook D).

## The two governing hard rules

1. **Evidence boundary (Handbook A).** Public evidence may establish the
   company's environment, but it cannot establish the private workflow, its owner,
   its difficulty or its financial consequence.
2. **Follow-up value gate (Handbook D).** Reject any follow-up that does not add
   new evidence, a more concrete example, a useful artifact or a materially
   different ask.

## The four handbooks

- **[A — Research and proof boundaries](A-research-and-proof-boundaries.md):** what
  public evidence can and cannot claim; observed fact vs inferred relevance; proof
  scope.
- **[B — Problem-hypothesis and ownership testing](B-problem-hypothesis-and-ownership-testing.md):**
  falsifiable hypotheses, uncertainty language, last-real-case questions, the
  SPICED order, testing ownership, no premature ROI/pilot.
- **[C — Cold-email construction](C-cold-email-construction.md):** line-level
  edits, length and structure, one low-effort ask, positioning before pitch.
- **[D — Sequence progression and account routing](D-sequence-progression-and-account-routing.md):**
  every touch adds new value; operator / router / economic-owner routing; reach a
  second stakeholder deliberately instead of blasting the account.

Each handbook contains: the rules the generator must follow (source-tagged),
common failure patterns, bad/good example pairs, the conditions each rule applies
under, and an evaluation checklist a reviewer can run against a draft.

## How to use them

- **Writing:** the consolidated hard rules and pre-send checklist live in the
  `OUTBOUND-DOCTRINE` managed block in `playbooks/_shared.md`, which the writer
  loads automatically. These handbooks are the full reference behind that block.
- **Reviewing:** run each handbook's evaluation checklist against a draft. Any
  `→ fail` is a `do_not_contact` or `revise`, not a stylistic note.
- **Changing behavior:** edit the relevant handbook here, then propagate the rule
  into the `OUTBOUND-DOCTRINE` block and, where deterministic, into
  `src/outreach-quality.js`. `docs/HANDBOOK.md` remains authoritative on conflict.

## Provenance

`sources.md` lists the ten talks with URLs and which handbook each feeds.
Cleaned transcripts are in `transcripts/`. These are practitioner training talks,
not controlled research; treat every rule as a disciplined default to test, and
never quote a speaker's reported conversion/reply statistic as a forecast.
