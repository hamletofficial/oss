#!/usr/bin/env python3
"""Inject Hamlet's shared public site-search control into the Pages build artifact.

This runs only in the deployment workspace; it does not rewrite source HTML files.
Private/authenticated routes are deliberately excluded.
"""
from pathlib import Path
import re

ROOT = Path(".")
SKIP_PARTS = {".git", ".vs", ".firebase", "node_modules", ".github", "functions"}
SKIP_DIRS = {"app", "functions", "public", "superuser", "admin", "account", "accounts", "auth", "authentication", "onfido", "oauth"}
SKIP_FILES = {
    "admin.html", "login.html", "editprofile.html", "invoice.html", "archive.html",
    "dashboard.html", "live.html", "portfolio.html", "residential.html", "resi-resources.html",
    "resources.html", "members.html", "directory.html", "profile.html", "posts.html",
    "rankings.html", "messages.html", "requests.html", "settings.html", "loggedout.html",
    "callback.html", "success.html",
}

STYLE = """
<style id="hamlet-universal-search-style">
.site-search{position:relative;display:block;flex:1 1 260px;min-width:160px;max-width:460px;margin:.35rem 0;z-index:10001;font-family:inherit}
.site-search-form{display:flex;align-items:center;gap:.45rem;width:100%;min-height:42px;box-sizing:border-box;padding:.28rem .35rem .28rem .7rem;border:1px solid #45618d;border-radius:10px;background:#0b1b3a;color:#fff}
.site-search-form:focus-within{border-color:#bfdbfe;box-shadow:0 0 0 3px #bfdbfe24}
.site-search-icon{width:18px;height:18px;flex:0 0 auto;color:#bfdbfe}
.site-search-input{display:block;flex:1 1 auto;width:100%;min-width:0;min-height:32px;border:0!important;outline:0;background:transparent!important;color:#fff!important;font:inherit;font-size:.88rem}
.site-search-input::placeholder{color:#cbd5e1;opacity:1}
.site-search-submit{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-height:32px;padding:.35rem .65rem;border:0;border-radius:7px;background:#fff;color:#071d4a;font-size:.8rem;font-weight:800;cursor:pointer}
.site-search-results{position:absolute;top:calc(100% + .45rem);left:0;right:0;z-index:2147483647;max-height:min(65vh,440px);overflow:auto;padding:.35rem;border:1px solid #45618d;border-radius:11px;background:#111827;color:#f8fafc;box-shadow:0 16px 36px #020617b8}
.site-search-results[hidden]{display:none!important}
.site-search-result{display:block;padding:.65rem .7rem;border-radius:7px;color:#fff;text-decoration:none}
.site-search-result:hover,.site-search-result:focus-visible{background:#1f2937;outline:2px solid #93c5fd;outline-offset:-2px}
.site-search-result strong,.site-search-result small{display:block}
.site-search-result strong{font-size:.9rem;line-height:1.4;margin-bottom:.35rem}
.site-search-result small{color:#bfdbfe;font-size:.75rem;overflow-wrap:anywhere}
.site-search-empty{padding:.7rem;color:#cbd5e1;font-size:.85rem}
.site-search-retry{margin:.25rem .7rem .7rem;padding:.4rem .65rem;border:1px solid #64748b;border-radius:7px;background:#1f2937;color:#fff;font:inherit;cursor:pointer}
@media(max-width:760px){.site-search{flex:1 1 100%;max-width:none;order:10}.site-search-form{min-height:40px}}
</style>
"""

MARKUP = """
<div class="site-search" role="search" aria-label="Search Hamlet">
<form class="site-search-form" id="site-search-form" action="/search.html" method="get" autocomplete="off">
<svg class="site-search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" stroke-width="1.8"></circle><path d="m16 16 4.2 4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>
<input class="site-search-input" id="site-search-input" name="q" type="search" placeholder="Search all public pages…" aria-label="Search all public Hamlet pages" aria-controls="site-search-results" aria-expanded="false" minlength="2">
<button class="site-search-submit" type="submit">Search</button>
</form>
<div class="site-search-results" id="site-search-results" role="listbox" aria-label="Search suggestions" hidden></div>
</div>
"""

def eligible(path: Path) -> bool:
    if path.suffix.lower() != ".html" or path.name.startswith("."):
        return False
    if any(part in SKIP_PARTS for part in path.parts):
        return False
    if any(part.lower() in SKIP_DIRS for part in path.parts[:-1]):
        return False
    if path.name.lower() in SKIP_FILES:
        return False
    return True

def inject(path: Path) -> bool:
    source = path.read_text(encoding="utf-8", errors="ignore")
    updated = source
    if 'id="hamlet-universal-search-style"' not in updated and re.search(r"</head\s*>", updated, re.I):
        updated = re.sub(r"</head\s*>", STYLE + "\n</head>", updated, count=1, flags=re.I)
    if 'id="site-search-form"' not in updated:
        header_open = re.search(r"<header\b[^>]*>", updated, re.I)
        header_close = re.search(r"</header\s*>", updated, re.I)
        if header_open and header_close and header_open.end() < header_close.start():
            header_content = updated[header_open.end():header_close.start()]
            nav_close = list(re.finditer(r"</nav\s*>", header_content, re.I))
            if nav_close:
                # Place search beside the existing navigation, inside its layout wrapper.
                pos = header_open.end() + nav_close[-1].end()
                updated = updated[:pos] + "\n" + MARKUP + updated[pos:]
            else:
                # Put search inside the header's final layout wrapper, not below the header.
                final_div = list(re.finditer(r"</div\s*>", header_content, re.I))
                if final_div:
                    pos = header_open.end() + final_div[-1].start()
                    updated = updated[:pos] + MARKUP + "\n" + updated[pos:]
                else:
                    updated = updated[:header_close.start()] + MARKUP + "\n" + updated[header_close.start():]
        else:
            body = re.search(r"<body\b[^>]*>", updated, re.I)
            if body:
                updated = updated[:body.end()] + "\n" + MARKUP + updated[body.end():]
    # Always bump the shared script version so browsers/CDNs do not keep
    # running the previous JSON-only loader after a deployment.
    updated = re.sub(
        r'(<script\b[^>]*src=["\']/site-search\.js)(?:\?[^"\']*)?(["\'][^>]*>)',
        r'\1?v=20261025-json-index-1\2',
        updated,
        flags=re.I,
    )
    if 'src="/site-search.js' not in updated and re.search(r"</body\s*>", updated, re.I):
        updated = re.sub(r"</body\s*>", '<script src="/site-search.js?v=20261025-json-index-1" defer></script>\n</body>', updated, count=1, flags=re.I)
    if updated != source:
        path.write_text(updated, encoding="utf-8")
        return True
    return False

def main():
    changed = 0
    skipped = 0
    for path in sorted(ROOT.rglob("*.html")):
        if not eligible(path):
            skipped += 1
            continue
        if inject(path):
            changed += 1
    print(f"Universal site search: updated {changed} public HTML pages; excluded {skipped} non-public/non-HTML paths.")

if __name__ == "__main__":
    main()
