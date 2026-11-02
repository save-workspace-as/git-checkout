# Git Checkout website

The site for the extension: a landing page and the docs, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build).
It lives in the `site/` folder of the extension repository, so a change to the README or a screenshot and the page it feeds go in one pull request.

- `src/pages/index.astro` is the landing page; `src/components` and `src/styles/landing.css` style it.
- The docs, the changelog and the screenshots are **not kept here**. `npm run sync` (which `dev` and `build` run first) brings them from the
  repository above: the README sections become the pages in `src/content/docs/docs/`, `CHANGELOG.md` becomes the changelog, and `docs/screenshots/` the
  pictures. Edit them there. The synced files are ignored by Git. Astro turns the screenshots into WebP at build time. The sync stops with a message
  when the README loses a section the site needs, so rename one only together with `scripts/sync-from-extension.mjs`.

```sh
cd site
npm install
npm run dev      # http://localhost:4321/git-checkout/
npm run build
```

The site is served from `SITE_BASE` (default `/git-checkout`, a project site). For a custom domain set the repository variables
`SITE_URL` and `SITE_BASE=/`. The workflow `.github/workflows/site.yml` builds it on every pull request that touches the README, the docs, the changelog or `site/`, and deploys it when one is merged.
