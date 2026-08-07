# @mavio/docs

The Mavio-MCP documentation website. Built with [Nextra 4](https://nextra.site) on Next.js App
Router. Content lives as MDX under [`content/`](content); sidebar order comes from `_meta.js` files.

## Local development

```bash
pnpm install
pnpm --filter @mavio/docs dev        # http://localhost:3001
```

## Build

```bash
pnpm --filter @mavio/docs build
pnpm --filter @mavio/docs start
```

## Structure

```
apps/docs/
├── app/
│   ├── layout.jsx                 # mounts nextra-theme-docs (navbar, footer, banner)
│   └── [[...mdxPath]]/page.jsx     # catch-all: lazy-imports MDX from content/
├── mdx-components.js               # required Nextra 4 root export
├── next.config.mjs                 # withNextra() wrapper
└── content/                        # all docs pages (MDX) + _meta.js sidebar order
    ├── getting-started/
    ├── concepts/
    ├── guides/
    ├── security/
    ├── reference/
    └── deployment/
```

## Editing

- Add a page: drop `content/<section>/<page>.mdx` and list it in that section's `_meta.js`.
- Add a section: create `content/<section>/_meta.js` and register it in `content/_meta.js`.
- Frontmatter `title:` sets the page `<title>` and breadcrumb.

## Deploy to Vercel

This is a pnpm monorepo. In the Vercel project settings:

- **Root Directory**: `apps/docs`
- **Framework Preset**: Next.js
- **Install Command**: `pnpm install` (run from repo root — enable "Include source files outside the
  Root Directory")
- **Build Command**: `pnpm --filter @mavio/docs build`

The site is fully static and needs no runtime environment variables.
