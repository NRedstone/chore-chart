#!/usr/bin/env python3
"""Builds the standalone deploy files for The Chore Chart.

Run from anywhere:   python3 /mnt/user-data/outputs/_build/build.py

Reads   ../chore-tracker.jsx  plus the helper files in this folder
        (icons.jsx, firestore-sync-shim.js, sw.template.js, register-sw.js)
Writes  ../index.html and ../sw.js (manifest.json is left as it is), then
        ../public/ and ../wrangler.jsonc, which is what Cloudflare deploys

Every run stamps a fresh build id into sw.js and into the page, so each
deploy is a *different* file to the browser — that is what lets devices
notice an update and show the "new version is ready" banner.
"""
import datetime
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
SRC = os.path.join(OUT, "chore-tracker.jsx")

KNOWN_ESBUILD = "/opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild"


def fail(msg):
    print("BUILD FAILED:", msg)
    sys.exit(1)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def find_esbuild():
    found = shutil.which("esbuild")
    if found:
        return found
    if os.path.exists(KNOWN_ESBUILD):
        return KNOWN_ESBUILD
    fail("esbuild not found")


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    build_id = now.strftime("%Y%m%d-%H%M%S")
    build_label = now.strftime("%Y-%m-%d %H:%M UTC")

    source = read(SRC)
    icons = read(os.path.join(HERE, "icons.jsx"))
    shim = read(os.path.join(HERE, "firestore-sync-shim.js"))
    account = read(os.path.join(HERE, "account-ui.js"))
    demo = read(os.path.join(HERE, "demo.js"))
    sw_template = read(os.path.join(HERE, "sw.template.js"))
    register_sw = read(os.path.join(HERE, "register-sw.js"))

    # 1) Every icon the source imports must exist in the hand-drawn icon set.
    first_lines = source[:800]
    import_line = [l for l in first_lines.split("\n") if "lucide-react" in l][0]
    needed = re.findall(r"\b(\w+)\b", import_line.split("{")[1].split("}")[0])
    defined = set(re.findall(r"function (\w+)\(", icons))
    missing = [n for n in needed if n not in defined]
    if missing:
        fail("icons missing from icons.jsx: %s" % missing)

    # 2) Strip the import lines, combine with icons, add the mount code, compile.
    lines = source.splitlines(keepends=True)
    if not (lines[0].startswith("import { useState") and lines[1].startswith("import { Check")):
        fail("unexpected import lines at the top of chore-tracker.jsx")
    body = "".join(lines[3:]).replace("export default function ChoreTracker()", "function ChoreTracker()")
    mount = """

const { useState, useEffect, useMemo, useRef } = React;

(async function mountApp() {
  if (window.__syncReady) {
    await window.__syncReady;
  }
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<ChoreTracker />);
})();
"""
    tmp = tempfile.mkdtemp()
    app_jsx = os.path.join(tmp, "app.jsx")
    app_js = os.path.join(tmp, "app.js")
    with open(app_jsx, "w", encoding="utf-8") as f:
        f.write(icons + "\n\n" + body + mount)
    result = subprocess.run(
        [find_esbuild(), app_jsx, "--jsx=transform", "--format=iife", "--target=es2018", "--outfile=" + app_js],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        fail("esbuild:\n" + result.stderr)
    compiled = read(app_js)

    # 3) Every capitalized component the compiled code renders must be defined.
    defined_c = set(re.findall(r"function (\w+)\(", compiled)) | set(re.findall(r"const (\w+) = ", compiled))
    used_c = {u for u in re.findall(r"React\.createElement\(\s*(\w+)", compiled) if u[0].isupper()}
    undefined = used_c - defined_c - {"React"}
    if undefined:
        fail("undefined components in compiled output: %s" % sorted(undefined))

    # 4) Assemble index.html.
    html = (
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />\n'
        "<title>The Chore Chart</title>\n"
        '<link rel="manifest" href="./manifest.json" />\n'
        '<meta name="theme-color" content="#7B61FF" />\n'
        '<meta name="mobile-web-app-capable" content="yes" />\n'
        '<meta name="apple-mobile-web-app-capable" content="yes" />\n'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\n'
        '<meta name="apple-mobile-web-app-title" content="Chore Chart" />\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com" />\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@600;700;800&family=Roboto:wght@500&display=swap" />\n'
        "<style>\n  html, body { margin: 0; padding: 0; min-height: 100%; background: #FFFFFF; }\n"
        "  #root { min-height: 100vh; }\n</style>\n</head>\n<body>\n"
        '<div id="root"></div>\n\n'
        '<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>\n'
        '<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js"></script>\n'
        '<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>\n'
        '<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-functions-compat.js"></script>\n\n'
        '<script>window.__ccBuild = "' + build_label + '";</script>\n\n'
        "<script>\n" + demo + "\n" + account + "\n" + shim + "\n</script>\n\n"
        '<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>\n'
        '<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>\n\n'
        "<script>\n" + compiled + "\n</script>\n\n"
        "<script>\n" + register_sw + "\n</script>\n"
        "</body>\n</html>\n"
    )
    if re.search(r"^(import |export )", html, re.M):
        fail("stray import/export left in index.html")
    if html.count("firebaseConfig = {") != 1:
        fail("expected exactly one firebaseConfig in index.html")
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    # 5) Stamp the service worker.
    if "__BUILD_ID__" not in sw_template:
        fail("sw.template.js has no __BUILD_ID__ placeholder")
    with open(os.path.join(OUT, "sw.js"), "w", encoding="utf-8") as f:
        f.write(sw_template.replace("__BUILD_ID__", build_id))

    # What Cloudflare serves: public/ (the 3 app files + cache rules) and
    # wrangler.jsonc, both at the top of the project. Cloudflare's Git
    # connection runs "npx wrangler deploy", which uploads public/.
    pub = os.path.join(OUT, "public")
    os.makedirs(pub, exist_ok=True)
    for name in ("index.html", "sw.js", "manifest.json"):
        shutil.copyfile(os.path.join(OUT, name), os.path.join(pub, name))
    with open(os.path.join(pub, "_headers"), "w", encoding="utf-8") as f:
        f.write("/sw.js\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n")
    with open(os.path.join(OUT, "wrangler.jsonc"), "w", encoding="utf-8") as f:
        f.write('{\n  // Must match the Worker\'s name in the Cloudflare dashboard exactly.\n  "name": "chore-chart-nsr",\n  "compatibility_date": "2026-10-01",\n  "assets": { "directory": "./public" }\n}\n')

    print("Built %s  (%d KB index.html)  build id %s" % (build_label, len(html) // 1024, build_id))


if __name__ == "__main__":
    main()
