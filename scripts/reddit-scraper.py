#!/usr/bin/env python3
"""Collect public Reddit threads using the current Chrome Reddit session.

The scraper is read-only, rate-limited, and resumable. It stores no Reddit
cookie or account information; only public post/comment text is written to
data/reddit/corpus.json.

Examples:
    python3 scripts/reddit-scraper.py
    python3 scripts/reddit-scraper.py sales LeadGeneration
    python3 scripts/reddit-scraper.py sales --max-new 5 --delay 0.5
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

try:
    import browser_cookie3
    import requests
except ImportError as exc:
    missing = getattr(exc, "name", "a required package")
    raise SystemExit(
        f"Missing {missing}. Run: python3 -m pip install -r requirements-reddit.txt"
    ) from exc


ROOT = Path(__file__).resolve().parent.parent
# The corpus path is overridable so a focused variant (for example the
# second-touchpoint pipeline) keeps its own corpus. Relative paths resolve
# against the repo root.
_reddit_corpus_override = os.environ.get("WAHPAKI_REDDIT_CORPUS", "").strip()
CORPUS = (
    (Path(_reddit_corpus_override) if Path(_reddit_corpus_override).is_absolute() else ROOT / _reddit_corpus_override)
    if _reddit_corpus_override
    else ROOT / "data" / "reddit" / "corpus.json"
)
OUT_DIR = CORPUS.parent
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36"
)
def _env_list(name, default):
    """Split a comma/newline-separated env override into a clean list."""
    raw = os.environ.get(name, "")
    values = [part.strip() for part in re.split(r"[\n,]+", raw) if part.strip()]
    return values or default


DEFAULT_SUBREDDITS = _env_list(
    "WAHPAKI_REDDIT_SUBREDDITS",
    [
        "sales",
        "salestechniques",
        "Entrepreneur",
        "freelancing",
        "LeadGeneration",
        "ideavalidation",
        "PromptEngineering",
        "ChatGPTPro",
        "SideProject",
    ],
)
QUERIES = _env_list(
    "WAHPAKI_REDDIT_QUERIES",
    [
        "cold email",
        "cold outreach",
        "cold email template",
        "cold email reply rate",
        "sales email",
        "cold email prompt",
        "follow up sequence",
        "email deliverability",
    ],
)
MIN_TEXT = 40


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build a public Reddit cold-outreach corpus using Chrome cookies."
    )
    parser.add_argument(
        "subreddits",
        nargs="*",
        help="Subreddits to scrape (default: the full configured list).",
    )
    parser.add_argument(
        "--posts-per-query",
        type=int,
        default=10,
        metavar="N",
        help="Search results requested per query (default: 10).",
    )
    parser.add_argument(
        "--comments-per-post",
        type=int,
        default=60,
        metavar="N",
        help="Top comments requested per thread (default: 60).",
    )
    parser.add_argument(
        "--max-new",
        type=int,
        default=0,
        metavar="N",
        help="Stop after N newly saved threads; 0 means no limit.",
    )
    parser.add_argument(
        "--max-new-per-subreddit",
        type=int,
        default=0,
        metavar="N",
        help="Save at most N new threads from each subreddit; 0 means no limit.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.5,
        metavar="SECONDS",
        help="Delay between Reddit requests (default: 1.5).",
    )
    args = parser.parse_args()
    if args.posts_per_query < 1 or args.comments_per_post < 1:
        parser.error("request limits must be positive integers")
    if args.max_new < 0 or args.max_new_per_subreddit < 0 or args.delay < 0:
        parser.error("--max-new, --max-new-per-subreddit, and --delay cannot be negative")
    args.subreddits = [
        re.sub(r"^r/", "", subreddit.strip(), flags=re.IGNORECASE)
        for subreddit in (args.subreddits or DEFAULT_SUBREDDITS)
        if subreddit.strip()
    ]
    return args


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def load_corpus():
    if not CORPUS.exists():
        return []
    try:
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Cannot read existing corpus {CORPUS}: {exc}") from exc
    if not isinstance(corpus, list):
        raise SystemExit(f"Existing corpus must be a JSON array: {CORPUS}")
    return corpus


def save_corpus(corpus):
    """Atomically replace the corpus so an interruption cannot corrupt it."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    temporary = CORPUS.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(corpus, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, CORPUS)


def walk_comments(nodes, output):
    for node in nodes or []:
        data = node.get("data") or {}
        if node.get("kind") == "t1":
            body = clean(data.get("body"))
            if len(body) >= MIN_TEXT and body not in ("[deleted]", "[removed]"):
                output.append(body)
        replies = data.get("replies")
        if isinstance(replies, dict):
            walk_comments((replies.get("data") or {}).get("children"), output)


class RedditClient:
    def __init__(self, delay):
        try:
            cookie_jar = browser_cookie3.chrome(domain_name="reddit.com")
        except Exception as exc:
            raise SystemExit(
                "Could not read Reddit cookies from Chrome. Make sure Chrome has a "
                "Reddit session and approve the macOS Keychain prompt, then retry. "
                f"Details: {exc}"
            ) from exc
        if not list(cookie_jar):
            raise SystemExit(
                "No reddit.com cookies were found in Chrome. Log in to Reddit in "
                "Chrome, then retry."
            )
        self.delay = delay
        self.session = requests.Session()
        self.session.cookies.update(cookie_jar)
        self.session.headers.update(
            {"User-Agent": USER_AGENT, "Accept": "application/json"}
        )
        print(f"Loaded {len(cookie_jar)} reddit.com cookies from Chrome.")

    def get_json(self, url, *, params=None, tries=3):
        last_error = None
        for attempt in range(1, tries + 1):
            try:
                response = self.session.get(
                    url, params=params, timeout=(10, 30)
                )
                if response.status_code == 429:
                    retry_after = response.headers.get("retry-after")
                    wait = float(retry_after) if retry_after else 3 * attempt
                    last_error = RuntimeError(
                        f"Reddit rate limit (HTTP 429; last backoff {wait:g}s)"
                    )
                    print(f"    Reddit rate limit; waiting {wait:g}s…")
                    time.sleep(wait)
                    continue
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "json" not in content_type.lower():
                    raise RuntimeError(
                        f"expected JSON, received {content_type or 'unknown content'}"
                    )
                payload = response.json()
                if self.delay:
                    time.sleep(self.delay)
                return payload
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                last_error = exc
                if attempt < tries:
                    time.sleep(2 * attempt)
        raise RuntimeError(f"GET {url} failed after {tries} tries: {last_error}")


def run():
    args = parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    corpus = load_corpus()
    seen = {
        item.get("id")
        for item in corpus
        if isinstance(item, dict) and item.get("id")
    }
    client = RedditClient(args.delay)
    added = 0
    stop = False

    for subreddit in args.subreddits:
        added_for_subreddit = 0
        post_ids = []
        for query in QUERIES:
            try:
                listing = client.get_json(
                    f"https://www.reddit.com/r/{quote(subreddit, safe='')}/search.json",
                    params={
                        "q": query,
                        "restrict_sr": 1,
                        "sort": "top",
                        "t": "all",
                        "limit": args.posts_per_query,
                        "raw_json": 1,
                    },
                )
            except Exception as exc:
                print(f'  r/{subreddit} "{query}": {exc}')
                continue
            children = (listing.get("data") or {}).get("children") or []
            post_ids.extend(
                child.get("data", {}).get("id")
                for child in children
                if child.get("data", {}).get("id")
            )

        post_ids = list(dict.fromkeys(post_ids))
        unseen = [post_id for post_id in post_ids if post_id not in seen]
        print(
            f"r/{subreddit}: {len(post_ids)} unique results; "
            f"{len(unseen)} new threads"
        )

        for post_id in unseen:
            try:
                thread = client.get_json(
                    (
                        f"https://www.reddit.com/r/{quote(subreddit, safe='')}/"
                        f"comments/{quote(post_id, safe='')}.json"
                    ),
                    params={
                        "limit": args.comments_per_post,
                        "depth": 3,
                        "sort": "top",
                        "raw_json": 1,
                    },
                )
                post = thread[0]["data"]["children"][0]["data"]
            except Exception as exc:
                print(f"    {post_id}: {exc}")
                continue

            comments = []
            walk_comments(thread[1]["data"]["children"], comments)
            pieces = [
                clean(post.get("title")),
                clean(post.get("selftext")),
                *comments,
            ]
            text = "\n\n".join(piece for piece in pieces if len(piece) >= MIN_TEXT)
            if not text:
                print(f"    {post_id}: skipped (no substantive text)")
                seen.add(post_id)
                continue

            corpus.append(
                {
                    "subreddit": subreddit,
                    "id": post_id,
                    "title": clean(post.get("title")),
                    "url": "https://reddit.com" + post.get("permalink", ""),
                    "ups": post.get("ups"),
                    "num_comments": post.get("num_comments"),
                    "text": text,
                }
            )
            seen.add(post_id)
            added += 1
            added_for_subreddit += 1
            save_corpus(corpus)
            print(f"    saved {added} new thread{'s' if added != 1 else ''}")

            if args.max_new and added >= args.max_new:
                stop = True
                break
            if (
                args.max_new_per_subreddit
                and added_for_subreddit >= args.max_new_per_subreddit
            ):
                break
        if stop:
            break

    by_subreddit = {}
    for item in corpus:
        subreddit = item.get("subreddit", "unknown")
        by_subreddit[subreddit] = by_subreddit.get(subreddit, 0) + 1
    summary = "  ".join(
        f"{subreddit}:{count}" for subreddit, count in by_subreddit.items()
    )
    print(f"Per subreddit: {summary or 'none'}")
    print(f"Done. {len(corpus)} threads in {CORPUS} ({added} new this run).")


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\nStopped. Already saved threads are safe.", file=sys.stderr)
        raise SystemExit(130)
