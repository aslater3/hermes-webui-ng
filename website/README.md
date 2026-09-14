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

GitHub requires one repository-level bootstrap before `GITHUB_TOKEN` can deploy Pages: in **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. This cannot be safely auto-enabled with the workflow token because creating a Pages site requires repository administration permission. Until that one-time setting exists, the workflow still validates/builds the site and emits a warning instead of failing the repository CI. After enabling it, run **Publish website** manually once or change anything under `website/` to publish.

Product preview images under `src/screenshots/` are intentionally synthetic renders using the current HermesUI NG layout/tokens and safe sample data. They must not contain real prompts, credentials, hostnames or private repository data.
