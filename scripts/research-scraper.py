#!/usr/bin/env python3
"""Build a resumable, provenance-rich sales research corpus.

The collector uses official APIs for discovery, reads public YouTube captions,
and extracts only publicly accessible web pages allowed by robots.txt. It does
not download video/audio, bypass logins/paywalls, or copy book/course content.
Google Books entries contain metadata and publisher descriptions only.

Examples:
    python3 scripts/research-scraper.py local
    python3 scripts/research-scraper.py youtube --max-new 10
    python3 scripts/research-scraper.py youtube --youtube-url URL
    python3 scripts/research-scraper.py google --max-results 5
    python3 scripts/research-scraper.py books --max-results 5
    python3 scripts/research-scraper.py all --max-new 25
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError as exc:
    raise SystemExit(
        f"Missing {getattr(exc, 'name', 'a dependency')}. Run: "
        "python3 -m pip install -r requirements-research.txt"
    ) from exc

try:
    import trafilatura
except ImportError:
    trafilatura = None

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    YouTubeTranscriptApi = None


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config" / "research-sources.json"
# The corpus path is overridable so a focused variant (for example the
# second-touchpoint pipeline) can build its own corpus without disturbing the
# default first-touch corpus. Relative overrides resolve against the repo root.
_corpus_override = os.environ.get("WAHPAKI_RESEARCH_CORPUS", "").strip()
CORPUS_PATH = (
    (Path(_corpus_override) if Path(_corpus_override).is_absolute() else ROOT / _corpus_override)
    if _corpus_override
    else ROOT / "data" / "research" / "corpus.json"
)
OUT_DIR = CORPUS_PATH.parent
USER_AGENT = (
    "WahpakiResearchBot/1.0 (+local sales research; read-only; "
    "contact: repository owner)"
)
TRACKING_PARAMS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "source",
}
SOURCE_RANK = {
    "local": 6,
    "youtube": 5,
    "article": 4,
    "course": 4,
    "open_textbook": 4,
    "book_excerpt": 3,
    "book": 2,
    "google_summary": 1,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_dotenv() -> None:
    """Load simple KEY=VALUE entries without overwriting the real environment."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            os.environ.setdefault(key, value)


def clean_text(value: str) -> str:
    value = html.unescape(value or "").replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = []
    for part in re.split(r"\n\s*\n", value):
        part = re.sub(r"[ \t\f\v]+", " ", part)
        part = re.sub(r"\n+", " ", part).strip()
        if part:
            paragraphs.append(part)
    return "\n\n".join(paragraphs)


def canonical_url(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"}:
        return value
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host in {"youtu.be", "youtube.com", "m.youtube.com"}:
        video_id = youtube_video_id(value)
        if video_id:
            return f"https://youtube.com/watch?v={video_id}"
    netloc = host
    if parts.port and not (
        (parts.scheme == "http" and parts.port == 80)
        or (parts.scheme == "https" and parts.port == 443)
    ):
        netloc += f":{parts.port}"
    query = []
    for key, val in parse_qsl(parts.query, keep_blank_values=True):
        if key.lower().startswith("utm_") or key.lower() in TRACKING_PARAMS:
            continue
        query.append((key, val))
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    if path != "/":
        path = path.rstrip("/")
    return urlunsplit((parts.scheme.lower(), netloc, path, urlencode(query), ""))


def youtube_video_id(value: str) -> str:
    parts = urlsplit(value)
    host = (parts.hostname or "").lower()
    candidate = ""
    if host.endswith("youtu.be"):
        candidate = parts.path.strip("/").split("/")[0]
    elif "youtube.com" in host:
        if parts.path == "/watch":
            candidate = dict(parse_qsl(parts.query)).get("v", "")
        elif parts.path.startswith(("/shorts/", "/embed/", "/live/")):
            candidate = parts.path.strip("/").split("/")[1]
    return candidate if re.fullmatch(r"[A-Za-z0-9_-]{6,20}", candidate) else ""


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def error_summary(exc: BaseException) -> str:
    message = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return f"{type(exc).__name__}: {message}" if message else type(exc).__name__


def item_id(url: str, fallback: str = "") -> str:
    identity = canonical_url(url) or fallback
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


def host_for(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def value_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)] if str(value).strip() else []


class Corpus:
    def __init__(self, path: Path):
        self.path = path
        self.items: list[dict[str, Any]] = []
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise SystemExit(f"Cannot read {path}: {exc}") from exc
            if not isinstance(loaded, list):
                raise SystemExit(f"Corpus must be a JSON array: {path}")
            self.items = [item for item in loaded if isinstance(item, dict)]
        self.by_id = {item.get("id"): item for item in self.items if item.get("id")}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(self.items, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, self.path)

    def upsert(self, incoming: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        incoming["url"] = canonical_url(incoming.get("url", ""))
        incoming["id"] = item_id(
            incoming["url"],
            f"{incoming.get('source_type', '')}:{incoming.get('title', '')}",
        )
        incoming["text"] = clean_text(incoming.get("text", ""))
        incoming["text_chars"] = len(incoming["text"])
        incoming["content_sha256"] = content_hash(incoming["text"])
        incoming.setdefault("retrieved_at", utc_now())
        incoming["queries"] = sorted(set(value_list(incoming.get("queries"))))

        existing = self.by_id.get(incoming["id"])
        if not existing:
            self.items.append(incoming)
            self.by_id[incoming["id"]] = incoming
            self.save()
            return "added", incoming

        existing["queries"] = sorted(
            set(value_list(existing.get("queries")) + incoming["queries"])
        )
        existing["last_seen_at"] = utc_now()
        methods = set(value_list(existing.get("ingestion_methods")))
        methods.add(incoming.get("ingestion_method", incoming.get("source_type", "")))
        existing["ingestion_methods"] = sorted(method for method in methods if method)

        old_rank = SOURCE_RANK.get(existing.get("source_type", ""), 0)
        new_rank = SOURCE_RANK.get(incoming.get("source_type", ""), 0)
        changed = incoming["content_sha256"] != existing.get("content_sha256")
        should_replace = changed and (
            new_rank > old_rank
            or (
                new_rank == old_rank
                and incoming["text_chars"] > existing.get("text_chars", 0)
            )
        )
        if should_replace:
            keep = {
                "id": existing["id"],
                "queries": existing["queries"],
                "last_seen_at": existing["last_seen_at"],
                "ingestion_methods": existing["ingestion_methods"],
            }
            existing.clear()
            existing.update(incoming)
            existing.update(keep)
            status = "updated"
        else:
            for key in ("title", "author", "publisher", "published_at"):
                if not existing.get(key) and incoming.get(key):
                    existing[key] = incoming[key]
            status = "seen"
        self.save()
        return status, existing


@dataclass
class Limits:
    max_results: int
    max_new: int
    max_text_chars: int
    delay: float


class PublicWeb:
    def __init__(self, *, delay: float, skip_domains: Iterable[str]):
        self.delay = delay
        self.skip_domains = {domain.lower().removeprefix("www.") for domain in skip_domains}
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
            }
        )
        self.robot_cache: dict[str, RobotFileParser] = {}
        self.last_request = 0.0

    def _pace(self) -> None:
        wait = self.delay - (time.monotonic() - self.last_request)
        if wait > 0:
            time.sleep(wait)

    def _get(self, url: str, **kwargs: Any) -> requests.Response:
        self._pace()
        response = self.session.get(url, timeout=(10, 35), **kwargs)
        self.last_request = time.monotonic()
        return response

    def allowed(self, url: str) -> bool:
        host = host_for(url)
        if not host or host in self.skip_domains or any(
            host.endswith("." + blocked) for blocked in self.skip_domains
        ):
            return False
        origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
        if origin not in self.robot_cache:
            parser = RobotFileParser()
            parser.set_url(urljoin(origin, "/robots.txt"))
            try:
                response = self._get(parser.url)
                if response.status_code < 400:
                    parser.parse(response.text.splitlines())
                else:
                    parser.parse([])
            except requests.RequestException:
                parser.parse([])
            self.robot_cache[origin] = parser
        return self.robot_cache[origin].can_fetch(USER_AGENT, url)

    def resolve_redirect(self, url: str) -> str:
        if "vertexaisearch.cloud.google.com" not in host_for(url):
            return url
        try:
            response = self._get(url, allow_redirects=True, stream=True)
            resolved = response.url
            response.close()
            return resolved
        except requests.RequestException:
            return url

    def extract(self, url: str, *, kind: str, query: str, max_chars: int) -> dict[str, Any] | None:
        url = self.resolve_redirect(url)
        if urlsplit(url).scheme not in {"http", "https"}:
            return None
        if not self.allowed(url):
            print(f"    skip robots/domain: {url}")
            return None
        try:
            response = self._get(url, allow_redirects=True, stream=True)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            content_length = int(response.headers.get("content-length", "0") or 0)
            if "html" not in content_type or content_length > 6_000_000:
                response.close()
                print(f"    skip unsupported/large content: {url}")
                return None
            chunks = []
            size = 0
            for chunk in response.iter_content(chunk_size=64 * 1024):
                size += len(chunk)
                if size > 6_000_000:
                    response.close()
                    print(f"    skip page over 6 MB: {url}")
                    return None
                chunks.append(chunk)
            raw = b"".join(chunks)
            encoding = response.encoding or "utf-8"
            page = raw.decode(encoding, errors="replace")
            final_url = response.url
            x_robots = response.headers.get("x-robots-tag", "").lower()
        except (requests.RequestException, ValueError) as exc:
            print(f"    fetch failed {url}: {str(exc).splitlines()[0]}")
            return None

        soup = BeautifulSoup(page, "html.parser")
        meta_robots = " ".join(
            tag.get("content", "")
            for tag in soup.select('meta[name="robots"], meta[name="googlebot"]')
        ).lower()
        if any(flag in f"{x_robots} {meta_robots}" for flag in ("noarchive", "nosnippet")):
            print(f"    skip publisher archive restriction: {final_url}")
            return None

        title = ""
        title_tag = soup.find("meta", property="og:title")
        if title_tag:
            title = title_tag.get("content", "")
        if not title and soup.title:
            title = soup.title.get_text(" ", strip=True)

        author = ""
        published_at = ""
        for selector in (
            'meta[name="author"]',
            'meta[property="article:author"]',
            'meta[name="byl"]',
        ):
            tag = soup.select_one(selector)
            if tag and tag.get("content"):
                author = tag["content"].strip()
                break
        for selector in (
            'meta[property="article:published_time"]',
            'meta[name="date"]',
            'meta[name="datePublished"]',
        ):
            tag = soup.select_one(selector)
            if tag and tag.get("content"):
                published_at = tag["content"].strip()
                break

        extracted = ""
        if trafilatura is not None:
            extracted = trafilatura.extract(
                page,
                url=final_url,
                include_comments=False,
                include_tables=True,
                favor_precision=True,
            ) or ""
        if not extracted:
            for tag in soup(
                ["script", "style", "nav", "footer", "header", "aside", "form", "noscript"]
            ):
                tag.decompose()
            main = soup.find("article") or soup.find("main") or soup.body
            extracted = main.get_text("\n\n", strip=True) if main else ""
        extracted = clean_text(extracted)[:max_chars]
        if len(extracted) < 500:
            print(f"    skip thin page ({len(extracted)} chars): {final_url}")
            return None
        return {
            "source_type": (
                kind
                if kind
                in {"article", "course", "open_textbook", "book_excerpt"}
                else "article"
            ),
            "title": clean_text(title) or host_for(final_url),
            "url": final_url,
            "author": clean_text(author),
            "publisher": host_for(final_url),
            "published_at": published_at,
            "queries": [query] if query else [],
            "rights": "public-web-page; robots-allowed; no login/paywall bypass",
            "ingestion_method": "public-html-extraction",
            "text": extracted,
            "metadata": {"content_type": content_type},
        }


def load_config(path: Path) -> dict[str, Any]:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Cannot read research config {path}: {exc}") from exc
    if not isinstance(config, dict):
        raise SystemExit("Research config must be a JSON object.")
    return config


def local_metadata(path: Path, text: str) -> tuple[str, str, str]:
    title_match = re.search(r"^#\s+(.+)$", text, flags=re.MULTILINE)
    source_match = re.search(r"^\*\*Source:\*\*\s*(https?://\S+)", text, flags=re.MULTILINE)
    channel_match = re.search(r"^\*\*Channel:\*\*\s*(.+)$", text, flags=re.MULTILINE)
    title = title_match.group(1).strip() if title_match else path.stem.replace("-", " ").title()
    url = source_match.group(1).rstrip(".,)") if source_match else path.resolve().as_uri()
    channel = channel_match.group(1).strip() if channel_match else "local research"
    return title, url, channel


def ingest_local(
    corpus: Corpus, config: dict[str, Any], *, dry_run: bool, max_new: int
) -> int:
    paths: list[Path] = []
    for pattern in config.get("local_markdown_globs", []):
        paths.extend(Path(name) for name in glob.glob(str(ROOT / pattern)))
    excluded: set[Path] = set()
    for pattern in config.get("local_exclude_globs", []):
        excluded.update(Path(name).resolve() for name in glob.glob(str(ROOT / pattern)))
    paths = sorted(
        {
            path.resolve()
            for path in paths
            if path.is_file() and path.resolve() not in excluded
        }
    )
    print(f"Local research: {len(paths)} markdown files")
    if dry_run:
        for path in paths:
            print(f"  {path.relative_to(ROOT)}")
        return 0
    added = 0
    for path in paths:
        raw = path.read_text(encoding="utf-8", errors="replace")
        title, url, publisher = local_metadata(path, raw)
        status, _ = corpus.upsert(
            {
                "source_type": "local",
                "title": title,
                "url": url,
                "publisher": publisher,
                "queries": ["curated local research"],
                "rights": "local user-provided research material",
                "ingestion_method": "local-markdown-import",
                "text": raw,
                "metadata": {"local_path": str(path.relative_to(ROOT))},
            }
        )
        added += status == "added"
        print(f"  {status:7} {path.relative_to(ROOT)}")
        if max_new and added >= max_new:
            break
    return added


def youtube_search(query: str, key: str, max_results: int) -> list[dict[str, Any]]:
    response = requests.get(
        "https://www.googleapis.com/youtube/v3/search",
        params={
            "key": key,
            "part": "snippet",
            "q": query,
            "type": "video",
            "videoCaption": "closedCaption",
            "relevanceLanguage": "en",
            "safeSearch": "moderate",
            "order": "relevance",
            "maxResults": min(max_results, 50),
        },
        headers={"User-Agent": USER_AGENT},
        timeout=(10, 35),
    )
    response.raise_for_status()
    return response.json().get("items", [])


def transcript_with_ytdlp(
    video_id: str, languages: list[str], cookies_from_browser: str = ""
) -> tuple[str, dict[str, Any]]:
    executable = shutil.which("yt-dlp")
    if not executable:
        raise RuntimeError(
            "caption request was blocked and yt-dlp fallback is not installed"
        )
    requested_languages = list(
        dict.fromkeys(["en-orig", "en", *languages])
    )
    download_languages = requested_languages[:2]
    with tempfile.TemporaryDirectory(prefix="wahpaki-youtube-captions-") as temp:
        template = str(Path(temp) / "%(id)s.%(ext)s")
        command = [
                executable,
                "--no-playlist",
                "--no-warnings",
                "--skip-download",
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                ",".join(download_languages),
                "--sub-format",
                "json3",
                "--socket-timeout",
                "30",
                "--output",
                template,
                "--print-json",
                f"https://www.youtube.com/watch?v={video_id}",
        ]
        if cookies_from_browser:
            command[1:1] = ["--cookies-from-browser", cookies_from_browser]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode:
            detail = (result.stderr or result.stdout).strip().splitlines()
            raise RuntimeError(detail[-1] if detail else "yt-dlp caption fetch failed")
        info: dict[str, Any] = {}
        for line in reversed(result.stdout.splitlines()):
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict):
                info = candidate
                break
        files = list(Path(temp).glob(f"{video_id}.*.json3"))
        if not files:
            raise RuntimeError("yt-dlp found no English public captions")
        priority = {
            language: index for index, language in enumerate(requested_languages)
        }

        def subtitle_priority(path: Path) -> int:
            language = path.name.removeprefix(f"{video_id}.").removesuffix(".json3")
            return priority.get(language, len(priority))

        caption_file = sorted(files, key=subtitle_priority)[0]
        payload = json.loads(caption_file.read_text(encoding="utf-8"))
        lines = []
        for event in payload.get("events") or []:
            value = "".join(
                segment.get("utf8", "")
                for segment in event.get("segs") or []
                if isinstance(segment, dict)
            )
            value = clean_text(value)
            if value and (not lines or value != lines[-1]):
                lines.append(value)
        language_code = caption_file.name.removeprefix(
            f"{video_id}."
        ).removesuffix(".json3")
        return clean_text("\n".join(lines)), {
            "language": language_code,
            "language_code": language_code,
            "is_generated": language_code in {"en", "en-orig"},
            "snippet_count": len(lines),
            "caption_client": "yt-dlp",
            "video_title": clean_text(info.get("title", "")),
            "channel": clean_text(
                info.get("channel") or info.get("uploader") or ""
            ),
            "published_at": info.get("upload_date", ""),
            "description": clean_text(info.get("description", ""))[:2000],
        }


def youtube_transcript(
    video_id: str, languages: list[str], cookies_from_browser: str = ""
) -> tuple[str, dict[str, Any]]:
    primary_error: BaseException | None = None
    if YouTubeTranscriptApi is not None:
        try:
            fetched = YouTubeTranscriptApi().fetch(video_id, languages=languages)
            text = clean_text("\n".join(snippet.text for snippet in fetched))
            return text, {
                "language": fetched.language,
                "language_code": fetched.language_code,
                "is_generated": fetched.is_generated,
                "snippet_count": len(fetched),
                "caption_client": "youtube-transcript-api",
            }
        except Exception as exc:
            primary_error = exc
    try:
        return transcript_with_ytdlp(video_id, languages, cookies_from_browser)
    except Exception as fallback_error:
        if primary_error:
            raise RuntimeError(
                f"{error_summary(primary_error)}; fallback: "
                f"{error_summary(fallback_error)}"
            ) from fallback_error
        raise


def ingest_youtube(
    corpus: Corpus,
    config: dict[str, Any],
    limits: Limits,
    *,
    urls: list[str],
    cookies_from_browser: str,
    dry_run: bool,
) -> int:
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    queries = value_list(config.get("youtube_queries"))
    seed_urls = value_list(config.get("youtube_seed_urls")) + urls
    languages = value_list(config.get("languages")) or ["en"]
    candidates: dict[str, dict[str, Any]] = {}

    for url in seed_urls:
        video_id = youtube_video_id(url)
        if video_id:
            candidates[video_id] = {
                "id": {"videoId": video_id},
                "snippet": {
                    "title": f"YouTube video {video_id}",
                    "channelTitle": "YouTube",
                    "description": "",
                },
                "query": "seed URL",
            }
        else:
            print(f"  invalid YouTube URL: {url}")

    if key:
        for query in queries:
            if dry_run:
                print(f'YouTube query: "{query}"')
                continue
            try:
                results = youtube_search(query, key, limits.max_results)
            except requests.RequestException as exc:
                print(f'  YouTube search failed "{query}": {str(exc).splitlines()[0]}')
                continue
            for result in results:
                video_id = (result.get("id") or {}).get("videoId")
                if video_id and video_id not in candidates:
                    result["query"] = query
                    candidates[video_id] = result
            if limits.delay:
                time.sleep(limits.delay)
    elif queries:
        print(
            "YouTube discovery skipped: set YOUTUBE_API_KEY. "
            "Direct --youtube-url and configured seed URLs still work."
        )

    if dry_run:
        print(f"YouTube seed URLs: {len(seed_urls)}")
        return 0

    print(f"YouTube: {len(candidates)} unique caption candidates")
    added = 0
    for video_id, result in candidates.items():
        snippet = result.get("snippet") or {}
        query = result.get("query", "")
        try:
            text, transcript_meta = youtube_transcript(
                video_id, languages, cookies_from_browser
            )
        except Exception as exc:
            print(f"  captions unavailable {video_id}: {error_summary(exc)}")
            continue
        title = clean_text(snippet.get("title", ""))
        if not title or title == f"YouTube video {video_id}":
            title = transcript_meta.get("video_title", "") or f"YouTube {video_id}"
        publisher = clean_text(snippet.get("channelTitle", ""))
        if not publisher or publisher == "YouTube":
            publisher = transcript_meta.get("channel", "") or "YouTube"
        published_at = snippet.get("publishedAt", "") or transcript_meta.get(
            "published_at", ""
        )
        description = clean_text(snippet.get("description", "")) or transcript_meta.get(
            "description", ""
        )
        text = text[: limits.max_text_chars]
        if len(text) < 500:
            print(f"  skip thin transcript {video_id}")
            continue
        status, _ = corpus.upsert(
            {
                "source_type": "youtube",
                "title": title,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "publisher": publisher,
                "published_at": published_at,
                "queries": [query] if query else [],
                "rights": "public YouTube caption transcript; no video/audio downloaded",
                "ingestion_method": "youtube-public-captions",
                "text": text,
                "metadata": {
                    **transcript_meta,
                    "description": description[:2000],
                },
            }
        )
        added += status == "added"
        print(f"  {status:7} {video_id} {title[:70]}")
        if limits.max_new and added >= limits.max_new:
            break
        if limits.delay:
            time.sleep(limits.delay)
    return added


def gemini_google_search(
    query: str, kind: str, key: str, max_results: int
) -> tuple[str, list[dict[str, str]], list[str]]:
    model = os.environ.get("GOOGLE_RESEARCH_MODEL", "gemini-2.5-flash").strip()
    prompt = (
        f"Use Google Search to find up to {max_results} distinct, high-quality public "
        f"{kind} sources for this sales-research query: {query!r}. Prefer original "
        "practitioner material, official technical guidance, university/open course "
        "pages, and sources with concrete methods or evidence. Exclude login-only or "
        "paid course lessons, pirated copies, scraped textbook copies, thin SEO "
        "listicles, affiliate roundups, and social-network posts. Summarize what each "
        "source contributes. Every source must be cited by Google Search. Do not invent "
        "URLs."
    )
    response = requests.post(
        (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        ),
        headers={
            "x-goog-api-key": key,
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0.1},
        },
        timeout=(15, 120),
    )
    response.raise_for_status()
    payload = response.json()
    candidates = payload.get("candidates") or []
    if not candidates:
        raise RuntimeError(
            "Gemini returned no candidate "
            f"({(payload.get('promptFeedback') or {}).get('blockReason', 'unknown')})"
        )
    candidate = candidates[0]
    text = "\n".join(
        part.get("text", "")
        for part in ((candidate.get("content") or {}).get("parts") or [])
        if isinstance(part, dict)
    ).strip()
    grounding = candidate.get("groundingMetadata") or {}
    sources = []
    for chunk in grounding.get("groundingChunks") or []:
        web = chunk.get("web") if isinstance(chunk, dict) else None
        if web and web.get("uri"):
            sources.append({"url": web["uri"], "title": web.get("title", "")})
    queries = [str(value) for value in grounding.get("webSearchQueries") or []]
    return text, sources[:max_results], queries


def custom_search(
    query: str, key: str, cx: str, max_results: int
) -> list[dict[str, str]]:
    results = []
    for start in range(1, min(max_results, 20) + 1, 10):
        count = min(10, max_results - len(results))
        response = requests.get(
            "https://customsearch.googleapis.com/customsearch/v1",
            params={"key": key, "cx": cx, "q": query, "num": count, "start": start},
            headers={"User-Agent": USER_AGENT},
            timeout=(10, 35),
        )
        response.raise_for_status()
        results.extend(
            {"url": item.get("link", ""), "title": item.get("title", "")}
            for item in response.json().get("items", [])
            if item.get("link")
        )
        if len(results) >= max_results:
            break
    return results[:max_results]


def ingest_google(
    corpus: Corpus,
    config: dict[str, Any],
    limits: Limits,
    web: PublicWeb,
    *,
    provider: str,
    urls: list[str],
    dry_run: bool,
) -> int:
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    legacy_key = os.environ.get("GOOGLE_SEARCH_API_KEY", "").strip()
    legacy_cx = os.environ.get("GOOGLE_SEARCH_CX", "").strip()
    if provider == "auto":
        provider = "gemini" if gemini_key else "custom-search"
    queries = config.get("google_queries") or []
    seed_specs: list[dict[str, str]] = []
    for raw_seed in config.get("web_seed_urls") or []:
        if isinstance(raw_seed, str):
            seed_specs.append(
                {"url": raw_seed, "kind": "article", "query": "seed URL"}
            )
        elif isinstance(raw_seed, dict) and raw_seed.get("url"):
            seed_specs.append(
                {
                    "url": str(raw_seed["url"]),
                    "kind": str(raw_seed.get("kind", "article")),
                    "query": str(raw_seed.get("query", "seed URL")),
                    "rights": str(raw_seed.get("rights", "")),
                }
            )
    seed_specs.extend(
        {"url": url, "kind": "article", "query": "CLI seed URL"} for url in urls
    )

    if dry_run:
        print(f"Google provider: {provider}")
        for spec in queries:
            print(f'  {spec.get("kind", "article")}: {spec.get("query", "")}')
        for spec in seed_specs:
            print(f"  seed ({spec['kind']}): {spec['url']}")
        return 0

    if provider == "gemini" and not gemini_key:
        print(
            "Google discovery skipped: set GEMINI_API_KEY for current Google Search "
            "grounding, or use --google-provider custom-search with an existing CSE."
        )
        queries = []
    if provider == "custom-search" and not (legacy_key and legacy_cx):
        print(
            "Legacy Google discovery skipped: GOOGLE_SEARCH_API_KEY and "
            "GOOGLE_SEARCH_CX are not set. This API is closed to new customers."
        )
        queries = []

    discovered: list[tuple[str, str, str, str, str]] = []
    for spec in queries:
        query = str(spec.get("query", "")).strip()
        kind = str(spec.get("kind", "article")).strip()
        if not query:
            continue
        try:
            if provider == "gemini":
                summary, sources, used_queries = gemini_google_search(
                    query, kind, gemini_key, limits.max_results
                )
                if summary:
                    corpus.upsert(
                        {
                            "source_type": "google_summary",
                            "title": f"Google research synthesis: {query}",
                            "url": "",
                            "publisher": "Google Search grounding via Gemini",
                            "queries": [query, *used_queries],
                            "rights": "model-generated grounded summary; verify cited sources",
                            "ingestion_method": "gemini-google-search-grounding",
                            "text": summary,
                            "metadata": {
                                "cited_urls": [source["url"] for source in sources]
                            },
                        }
                    )
            else:
                sources = custom_search(query, legacy_key, legacy_cx, limits.max_results)
            for source in sources:
                discovered.append(
                    (source["url"], source.get("title", ""), kind, query, "")
                )
            print(f'Google "{query}": {len(sources)} cited results')
        except (requests.RequestException, RuntimeError) as exc:
            print(f'Google search failed "{query}": {str(exc).splitlines()[0]}')
        if limits.delay:
            time.sleep(limits.delay)

    for spec in seed_specs:
        discovered.append(
            (
                spec["url"],
                "",
                spec["kind"],
                spec["query"],
                spec.get("rights", ""),
            )
        )

    deduped: dict[str, tuple[str, str, str, str, str]] = {}
    for record in discovered:
        deduped.setdefault(canonical_url(record[0]), record)
    print(f"Google/web: {len(deduped)} unique public page candidates")
    added = 0
    for _, (url, discovered_title, kind, query, rights) in deduped.items():
        item = web.extract(
            url, kind=kind, query=query, max_chars=limits.max_text_chars
        )
        if not item:
            continue
        if not item.get("title") and discovered_title:
            item["title"] = discovered_title
        if rights:
            item["rights"] = rights
        status, _ = corpus.upsert(item)
        added += status == "added"
        print(f"  {status:7} {item['title'][:76]}")
        if limits.max_new and added >= limits.max_new:
            break
    return added


def ingest_books(
    corpus: Corpus,
    config: dict[str, Any],
    limits: Limits,
    *,
    dry_run: bool,
) -> int:
    key = os.environ.get("GOOGLE_BOOKS_API_KEY", "").strip()
    queries = value_list(config.get("book_queries"))
    if dry_run:
        for query in queries:
            print(f'Google Books query: "{query}"')
        return 0
    if not key:
        print(
            "Google Books skipped: set GOOGLE_BOOKS_API_KEY. Only public metadata "
            "and publisher descriptions are ever stored."
        )
        return 0

    added = 0
    for query in queries:
        try:
            response = requests.get(
                "https://www.googleapis.com/books/v1/volumes",
                params={
                    "key": key,
                    "q": query,
                    "printType": "books",
                    "orderBy": "relevance",
                    "projection": "full",
                    "maxResults": min(limits.max_results, 40),
                },
                headers={"User-Agent": USER_AGENT},
                timeout=(10, 35),
            )
            response.raise_for_status()
            items = response.json().get("items", [])
        except requests.RequestException as exc:
            print(f'Google Books failed "{query}": {str(exc).splitlines()[0]}')
            continue
        print(f'Google Books "{query}": {len(items)} results')
        for record in items:
            info = record.get("volumeInfo") or {}
            access = record.get("accessInfo") or {}
            description = clean_text(info.get("description", ""))
            if len(description) < 160:
                continue
            book_id = record.get("id", "")
            title = clean_text(info.get("title", ""))
            subtitle = clean_text(info.get("subtitle", ""))
            text = "\n\n".join(
                part
                for part in [
                    f"{title}: {subtitle}".rstrip(": "),
                    "Authors: " + ", ".join(info.get("authors") or []),
                    f"Publisher: {info.get('publisher', '')}".rstrip(),
                    f"Published: {info.get('publishedDate', '')}".rstrip(),
                    description,
                ]
                if part and not part.endswith(":")
            )
            status, _ = corpus.upsert(
                {
                    "source_type": "book",
                    "title": f"{title}: {subtitle}".rstrip(": "),
                    "url": info.get("infoLink")
                    or f"https://books.google.com/books?id={book_id}",
                    "author": ", ".join(info.get("authors") or []),
                    "publisher": info.get("publisher", ""),
                    "published_at": info.get("publishedDate", ""),
                    "queries": [query],
                    "rights": "Google Books metadata and publisher description only",
                    "ingestion_method": "google-books-metadata",
                    "text": text,
                    "metadata": {
                        "google_books_id": book_id,
                        "categories": info.get("categories") or [],
                        "language": info.get("language", ""),
                        "page_count": info.get("pageCount"),
                        "viewability": access.get("viewability", ""),
                        "public_domain": access.get("publicDomain", False),
                    },
                }
            )
            added += status == "added"
            print(f"  {status:7} {title[:76]}")
            if limits.max_new and added >= limits.max_new:
                return added
        if limits.delay:
            time.sleep(limits.delay)
    return added


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "sources",
        nargs="*",
        choices=["all", "local", "youtube", "google", "books"],
        default=["all"],
        help="Collectors to run (default: all).",
    )
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--max-results", type=int, default=0, metavar="N")
    parser.add_argument(
        "--max-new",
        type=int,
        default=0,
        metavar="N",
        help="Maximum additions per collector; 0 means no limit.",
    )
    parser.add_argument("--delay", type=float, default=1.25, metavar="SECONDS")
    parser.add_argument("--youtube-url", action="append", default=[], metavar="URL")
    parser.add_argument(
        "--youtube-cookies-from-browser",
        default="",
        metavar="BROWSER",
        help=(
            "Optional yt-dlp fallback (for example: chrome). Reads browser cookies "
            "only when explicitly supplied and never stores them."
        ),
    )
    parser.add_argument("--url", action="append", default=[], metavar="URL")
    parser.add_argument(
        "--google-provider",
        choices=["auto", "gemini", "custom-search"],
        default="auto",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.max_results < 0 or args.max_new < 0 or args.delay < 0:
        parser.error("limits and delay cannot be negative")
    return args


def run() -> None:
    load_dotenv()
    args = parse_args()
    config = load_config(args.config)
    max_results = args.max_results or int(config.get("max_results_per_query", 8))
    limits = Limits(
        max_results=max_results,
        max_new=args.max_new,
        max_text_chars=int(config.get("max_text_chars", 120000)),
        delay=args.delay,
    )
    requested = set(args.sources)
    if "all" in requested:
        requested = {"local", "youtube", "google", "books"}
    corpus = Corpus(CORPUS_PATH)
    web = PublicWeb(
        delay=limits.delay, skip_domains=value_list(config.get("skip_domains"))
    )
    total_added = 0
    if "local" in requested:
        total_added += ingest_local(
            corpus, config, dry_run=args.dry_run, max_new=limits.max_new
        )
    if "youtube" in requested:
        total_added += ingest_youtube(
            corpus,
            config,
            limits,
            urls=args.youtube_url,
            cookies_from_browser=args.youtube_cookies_from_browser,
            dry_run=args.dry_run,
        )
    if "google" in requested:
        total_added += ingest_google(
            corpus,
            config,
            limits,
            web,
            provider=args.google_provider,
            urls=args.url,
            dry_run=args.dry_run,
        )
    if "books" in requested:
        total_added += ingest_books(corpus, config, limits, dry_run=args.dry_run)
    if not args.dry_run:
        by_type: dict[str, int] = {}
        for item in corpus.items:
            kind = item.get("source_type", "unknown")
            by_type[kind] = by_type.get(kind, 0) + 1
        summary = "  ".join(f"{kind}:{count}" for kind, count in sorted(by_type.items()))
        print(f"Corpus: {len(corpus.items)} items ({summary or 'empty'})")
        print(f"Added this run: {total_added}. Saved to {CORPUS_PATH}")


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\nStopped. Already saved items are safe.", file=sys.stderr)
        raise SystemExit(130)
