# GitHub Actions: CI, building cities in the cloud, and publishing

Three workflows live in `.github/workflows/`.

## CI (`ci.yml`)

Runs on every pull request and every push to `main`, on **Ubuntu and Windows**:
1. `npm ci`, `npm run typecheck`, `npm test`;
2. an offline demo build (`npm run build:world -- melbourne --synthetic --preview`) and a check that it wrote the city;
3. `vite build`.

No setup needed.

## Build a city (`build-city.yml`)

Build any city without installing anything:

1. **Actions → Build a city → Run workflow.**
2. Fill in:
   - **place**, e.g. `Valletta, Malta`, or the folder name of a city already in `cities/` to rebuild it;
   - **size**, e.g. `1500` for 1.5 × 1.5 km (leave blank for the place's own size, at most 2 km);
   - **open_pr**: whether to open a pull request adding the city's profile.
3. When it finishes (about 5–20 minutes, mostly downloading), the run's page has an artifact `city-<slug>` with:
   - `public/cities/<slug>/`, the built city;
   - `cities/<slug>/city.json`, its profile.

To view the artifact locally:
- unzip it into the project folder, so `public/cities/<slug>/manifest.json` exists;
- run `npm run build:world -- <slug>` once if `public/cities/index.json` doesn't list it (or just open `?city=<slug>`);
- start the viewer with `npm run dev`.

The pull request adds the profile to `cities/`, so the city becomes part of the Pages site once merged.

Permissions:
- **Contents and pull requests (write):** the workflow pushes a branch and opens the pull request with the built-in `GITHUB_TOKEN`.
- **Organisation repositories:** if pull requests from Actions are disabled, allow them under Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests".
- **CI on these pull requests:** pull requests opened by `GITHUB_TOKEN` don't trigger CI on their own; close and reopen one to run it.

## Publish to GitHub Pages (`pages.yml`)

This builds **every city in `cities/`** and publishes the viewer with its city picker. It's off until you opt in:

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository variable:** `DEPLOY_PAGES` = `true`.
3. **Actions → Deploy to GitHub Pages → Run workflow**, or push a change to `cities/`, `pipeline/` or `src/`.

The site appears at `https://<user>.github.io/<repo>/`. Open a particular city with `?city=<slug>`.

Notes:
- **Caching:** downloads are cached for a week, keyed on the profiles, so redeploys don't hammer the map servers.
- **Failures:** a city that fails to build (e.g. the servers are busy) is skipped with a warning rather than failing the deploy.
- **Plans and privacy:** Pages on a private repository needs a paid GitHub plan, and the published site is public even when the repository is private.
- **Size limits:** Pages sites are limited to 1 GB, so keep the total of all built cities under that (about 40 cities of 2 × 2 km).

## Running it on your own fork

Everything uses the built-in `GITHUB_TOKEN`; no secrets are needed. Forks have Actions disabled until you enable them on the fork's Actions tab.
