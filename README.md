# The Chore Chart

A family chore and rewards app (single-page PWA), hosted on Cloudflare Workers with Firebase behind it.

- `chore-tracker.jsx`: the app (React)
- `_build/`: build script, helper scripts and tests. Run `python3 _build/build.py` to rebuild.
- `public/`: what the website serves (built). Cloudflare deploys this on every push to `main`.
- `wrangler.jsonc`: Cloudflare settings
- `firebase/`: server functions and security rules (deployed by hand with the Firebase CLI; see `firebase/DEPLOY.md`)
- `chore-chart-guide.md`: user guide
