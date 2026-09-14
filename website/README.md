# HermesUI NG website

This folder contains the static marketing site published with GitHub Pages.

## Local build

Requires Node 22, matching the application repository:

```sh
npm --prefix website run check
npm --prefix website run build
python3 -m http.server 8080 --directory website/dist
```

The site is dependency-free. `build.mjs` validates local anchors/source files, copies `src/` to `dist/`, injects build metadata and writes `.nojekyll`.

## Publishing

`.github/workflows/pages.yml` builds pull requests that touch `website/**` and publishes `website/dist` from `main` to GitHub Pages. The workflow uses the GitHub Pages Actions deployment path; no `gh-pages` branch is required.

Product preview images under `src/screenshots/` are intentionally synthetic renders using the current HermesUI NG layout/tokens and safe sample data. They must not contain real prompts, credentials, hostnames or private repository data.
