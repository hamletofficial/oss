#!/usr/bin/env python3
"""Build and validate Hamlet's public-only static search index."""
import html
import json
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

ROOT = Path(".")
OUTPUT = ROOT / "search-index.json"
EXCLUDED_PARTS = {".git", ".vs", ".firebase", "node_modules", ".github"}
EXCLUDED_DIRS = {
    "superuser", "admin", "account", "accounts", "auth",
    "authentication", "app", "functions", "public", "onfido", "oauth",
}
EXCLUDED_FILES = {
    "admin.html", "login.html", "editprofile.html", "invoice.html",
    "search.html", "404.html", "archive.html", "dashboard.html",
    "live.html", "portfolio.html", "residential.html", "resi-resources.html",
    "resources.html", "members.html", "directory.html", "profile.html",
    "posts.html", "rankings.html", "messages.html", "requests.html",
    "settings.html", "loggedout.html", "callback.html", "success.html",
}
PRIVATE_PATH = re.compile(
    r"^(?:app|functions|public|superuser|admin|account|accounts|auth|authentication|onfido|oauth)(?:/|$)",
    re.I,
)
TRANSIENT_COPY = re.compile(r"(?i)loading\s+search\s+index[.…]*")


class PageText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.in_title = False
        self.skip_depth = 0
        self.skip_stack = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        should_skip = tag in {"script", "style", "noscript", "svg"} or attrs.get("id") == "search-page-count"
        if should_skip:
            self.skip_stack.append((tag, True))
            self.skip_depth += 1
        if tag == "title":
            self.in_title = True

    def handle_startendtag(self, tag, attrs):
        return

    def handle_endtag(self, tag):
        for i in range(len(self.skip_stack) - 1, -1, -1):
            if self.skip_stack[i][0] == tag:
                _, was_skipped = self.skip_stack.pop(i)
                if was_skipped:
                    self.skip_depth = max(0, self.skip_depth - 1)
                break
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        value = " ".join(data.split())
        if not value:
            return
        if self.in_title:
            self.title += (" " if self.title else "") + value
        if not self.skip_depth:
            self.parts.append(value)


def is_public_html(path):
    if any(part in EXCLUDED_PARTS for part in path.parts):
        return False
    if any(part.lower() in EXCLUDED_DIRS for part in path.parts[:-1]):
        return False
    if path.name.startswith(".") or path.name.lower() in EXCLUDED_FILES:
        return False
    if path.suffix.lower() != ".html":
        return False
    # Honour explicit page-level robots exclusions as an additional safety layer.
    try:
        source = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    for meta in re.findall("<meta[^>]*>", source, flags=re.I):
        compact = meta.lower().replace(" ", "").replace("\\t", "").replace("\\n", "")
        if "robots" in compact and "noindex" in compact:
            return False
    return True


def generate():
    pages = []
    for path in sorted(ROOT.rglob("*.html")):
        if not is_public_html(path):
            continue
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
            parser = PageText()
            parser.feed(source)
        except (OSError, ValueError):
            continue
        title = html.unescape(parser.title.strip()) or path.stem.replace("-", " ").replace("_", " ").title()
        text = html.unescape(" ".join(parser.parts))
        text = re.sub(r"\s+", " ", text).strip()
        text = TRANSIENT_COPY.sub(" ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        relative = path.as_posix()
        url = "/" if relative == "index.html" else "/" + relative
        pages.append({"title": title, "url": url, "path": relative, "text": text[:18000]})

    if not pages:
        raise SystemExit("ERROR: generated search index is empty; refusing to publish.")
    validate_records(pages)
    serialized = json.dumps(pages, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(serialized + "\n", encoding="utf-8")
    print(f"Generated and validated {len(pages)} public HTML pages in {OUTPUT}")


def validate_records(data):
    if not isinstance(data, list) or not data:
        raise ValueError("search index must be a non-empty JSON array")
    for record in data:
        if not isinstance(record, dict) or not all(k in record for k in ("title", "url", "path", "text")):
            raise ValueError("search index contains a malformed page record")
        path = str(record.get("path") or record.get("url") or "").lstrip("/")
        filename = path.split("/")[-1].lower()
        if filename in EXCLUDED_FILES or PRIVATE_PATH.match(path):
            raise ValueError(f"private or excluded page leaked into public search index: {path}")
        if TRANSIENT_COPY.search(" ".join(str(record.get(k, "")) for k in ("title", "path", "url", "text"))):
            raise ValueError(f"transient search status copy leaked into index: {path}")


def check_live(base_url):
    base_url = base_url.rstrip("/") + "/"
    index_url = urljoin(base_url, "search-index.json")
    last_error = None
    for attempt in range(6):
        try:
            request = Request(index_url, headers={"Cache-Control": "no-cache", "User-Agent": "Hamlet-Search-Index-Healthcheck/1.0"})
            with urlopen(request, timeout=15) as response:
                if response.status != 200:
                    raise ValueError(f"HTTP {response.status}")
                data = json.loads(response.read().decode("utf-8"))
            validate_records(data)
            print(f"PASS: live search index is HTTP 200, valid JSON, and contains {len(data)} public pages: {index_url}")
            return
        except HTTPError as exc:
            # Some CDN/WAF configurations deny automated GitHub-hosted runners.
            # This is an inconclusive external probe, not proof the index is absent.
            if exc.code in (403, 429):
                print(
                    f"WARNING: live endpoint returned HTTP {exc.code} to the automated probe; "
                    f"the CDN may be blocking GitHub Actions. Pre-deployment index validation passed, "
                    f"but live availability could not be confirmed: {index_url}",
                    file=sys.stderr,
                )
                return
            last_error = exc
            if attempt < 5:
                time.sleep(5)
        except (URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < 5:
                time.sleep(5)
    raise SystemExit(f"ERROR: live search index failed validation at {index_url}: {last_error}")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--check-live":
        check_live(sys.argv[2])
    elif len(sys.argv) == 1:
        generate()
    else:
        raise SystemExit("Usage: build-search-index.py [--check-live BASE_URL]")
