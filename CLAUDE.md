# Working on The Chore Chart

- Source of truth is this repository. Edit `chore-tracker.jsx` and the helpers in `_build/`, never `public/` by hand.
- Build: `python3 _build/build.py` (needs esbuild; it writes `index.html`, `sw.js`, `public/`, `wrangler.jsonc`). Every build stamps a new version id, which is what makes devices pick up the update.
- Tests (Playwright + Chromium): `node _build/tests/e2e/run.js`, `form-popup.js`, `screensaver.js`, `autoupdate.js`; server: `node firebase/functions/test/handlers.test.js`.
- Deploy: pushing to `main` makes Cloudflare run `npx wrangler deploy`, which publishes `public/`. Commit the rebuilt `public/` with every app change.
- Firebase functions and rules are NOT deployed by a push. When `firebase/` changes, the owner deploys by hand (`firebase deploy --only functions` from the `firebase` folder, with `$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"` first on Windows).
- The owner likes to discuss changes before building; wait for "build".
