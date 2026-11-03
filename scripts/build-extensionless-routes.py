#!/usr/bin/env python3
"""Build clean URL aliases for Hamlet's public static GitHub Pages pages.

Runs only in the disposable deployment workspace. Source files stay *.html in Git.
Only links to eligible public HTML pages are rewritten; protected/excluded links stay intact.
"""
from pathlib import Path
import re
import sys

ROOT = Path(".")
SKIP_PARTS = {
    ".git", ".github", "node_modules", "functions", "sagat", "ryu", "ken",
    "hamlet-ai-gateway", "worker", "vendor", "app", "public", "superuser",
    "admin", "account", "accounts", "auth", "authentication", "onfido", "oauth",
}
SKIP_FILES = {
    "admin.html", "login.html", "editprofile.html", "invoice.html", "archive.html",
    "dashboard.html", "live.html", "portfolio.html", "residential.html",
    "resi-resources.html", "resources.html", "members.html", "directory.html",
    "profile.html", "posts.html", "rankings.html", "messages.html", "requests.html",
    "settings.html", "loggedout.html", "callback.html", "success.html",
    "search.html", "404.html",
}
HTML_SUFFIX = re.compile(r"(?i)\.html$")
ATTR_HREF = re.compile(r"""(?P<prefix>\bhref\s*=\s*)(?P<quote>["'])(?P<url>[^"'<>]+)(?P=quote)""", re.I)
CANONICAL_SCRIPT = r"""<script id="hamlet-extensionless-canonical">
(function () {
  var path = window.location.pathname;
  if (/\/index\.html$/i.test(path)) {
    var cleanIndex = path.replace(/index\.html$/i, '');
    window.location.replace((cleanIndex || '/') + window.location.search + window.location.hash);
  } else if (/\.html$/i.test(path)) {
    window.location.replace(path.slice(0, -5) + '/' + window.location.search + window.location.hash);
  }
})();
</script>"""

def excluded(path):
    return path.name.lower() in SKIP_FILES or any(part.lower() in SKIP_PARTS for part in path.parts)

def clean_link(url, source, eligible):
    if not url or url.startswith(("#", "//")) or re.match(r"(?i)^[a-z][a-z0-9+.-]*:", url):
        return url
    match = re.match(r"^([^?#]*)([?#].*)?$", url)
    if not match:
        return url
    path, suffix = match.group(1), match.group(2) or ""
    if not HTML_SUFFIX.search(path):
        return url

    # Resolve relative links against the source file, and root-relative links against site root.
    candidate = (ROOT / path.lstrip("/")) if path.startswith("/") else (source.parent / path)
    candidate = candidate.resolve()
    eligible_resolved = {p.resolve() for p in eligible}
    if candidate not in eligible_resolved:
        return url

    relative_target = candidate.relative_to(ROOT.resolve())
    if relative_target.name.lower() == "index.html":
        route = relative_target.parent.as_posix()
    else:
        route = (relative_target.parent / relative_target.stem).as_posix()
    clean = "/" if route in ("", ".") else "/" + route.strip("/") + "/"
    return clean + suffix

def add_base(document, base):
    if re.search(r"<base\b", document, re.I) or not re.search(r"<head\b[^>]*>", document, re.I):
        return document
    tag = '<base href="' + base + '">'
    return re.sub(r"(<head\b[^>]*>)", lambda m: m.group(1) + "\n    " + tag,
                  document, count=1, flags=re.I)

def main():
    html_files = sorted(p for p in ROOT.rglob("*.html")
                        if p.is_file() and not excluded(p.relative_to(ROOT)))
    if not html_files:
        print("No eligible HTML pages found.", file=sys.stderr)
        return 1

    # Pages with a pre-existing directory index cannot safely claim that route.
    # Leave their legacy .html links unchanged rather than pointing at unrelated content.
    eligible = {
        path for path in html_files
        if path.name.lower() == "index.html"
        or not (path.parent / path.stem / "index.html").exists()
    }
    originals = {}
    for path in html_files:
        document = path.read_text(encoding="utf-8", errors="replace")
        document = ATTR_HREF.sub(
            lambda m: m.group("prefix") + m.group("quote") +
                      clean_link(m.group("url"), path, eligible) + m.group("quote"), document)
        if path in eligible and 'id="hamlet-extensionless-canonical"' not in document:
            document = re.sub(r"</head\s*>", CANONICAL_SCRIPT + "\n</head>",
                              document, count=1, flags=re.I)
        path.write_text(document, encoding="utf-8")
        originals[path] = document

    created = 0
    for source, document in originals.items():
        if source.name.lower() == "index.html":
            continue
        target = source.parent / source.stem / "index.html"
        if target.exists():
            print(f"Preserving existing route: {target}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        parent_url = "/" if str(source.parent) == "." else "/" + source.parent.as_posix().strip("/") + "/"
        target.write_text(add_base(document, parent_url), encoding="utf-8")
        created += 1

    print(f"Clean URL build succeeded: {len(html_files)} public pages checked; "
          f"{created} extensionless aliases generated.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
