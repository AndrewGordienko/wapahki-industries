# Second touchpoint (first follow-up) research

The touch-2 twin of `docs/cold-email-writing/` (first touch) and
`docs/sales-research/` (cross-source guide). Everything here is aimed at one
question: **what should the SECOND touchpoint — the first follow-up after a cold
email goes unanswered — actually say?**

## What's here
- `*.md` — follow-up-focused YouTube transcripts (and any other local research),
  same header format as `docs/cold-email-writing/` (`**Channel:**`, `**Source:**`).
  These are ingested as local sources by the scraper.
- `touch2-wisdom.md` — the auto-generated, source-ID-cited field guide
  (written by `scripts/touch2-learn.js`; do not hand-edit).

## Pipeline (all re-runnable, mirrors the first-touch pipeline)
1. Collect transcripts into this folder (yt-dlp public captions → markdown).
2. `npm run touch2:research:scrape` → builds `data/research/touch2-corpus.json`
   from these transcripts + Google/Books discovery (needs `GEMINI_API_KEY` /
   `GOOGLE_BOOKS_API_KEY`) using `config/touch2-sources.json`.
3. `npm run touch2:reddit:scrape` → builds `data/reddit/touch2-corpus.json`
   from follow-up queries (needs a logged-in Reddit session in Chrome). Reddit
   search is deliberately broad and can return incidental matches. Review new
   threads, then add only relevant post IDs to `reddit_include_ids` in
   `config/touch2-sources.json`; unlisted raw threads remain available for audit
   but do not enter the distillation.
4. `npm run touch2:learn` → distills both corpora into `touch2-wisdom.md`, a
   managed `TOUCH2-WISDOM` block in `docs/HANDBOOK.md`, and an
   "Active second-touchpoint (T2) refinements" block in `playbooks/_shared.md`.
   Every model stage must succeed and every emitted `[T###]` citation must resolve
   before any knowledge file is replaced.

The learner reads its OWN corpora and writes its OWN managed blocks, so it never
overwrites the first-touch (`SALES-RESEARCH` / `REDDIT-WISDOM`) guides.
