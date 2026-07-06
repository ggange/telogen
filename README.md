# telogen

Generate AI-readable markdown from your Next.js source — no proxy, no runtime cost.

```
npx telogen
```

![telogen demo](demo.gif)

Produces a `page.md` file alongside every static route and an `llms.txt` index that AI agents can follow, all derived directly from your source code at build time.

---

## Why

Modern websites are built for human eyes: rendered HTML, client-side hydration, CSS-driven layouts. AI agents parsing those pages discard most of the markup and often miss content entirely. Existing solutions (reverse proxies, middleware) add latency and require deployed infrastructure.

**telogen** works offline from your source tree. Because it reads the React AST — not the rendered output — it works even for CSR apps that are invisible to crawlers, requires no runtime dependency, and can run in CI next to your linter.

telogen **never executes your code**. It parses your source with `@babel/parser` and walks the AST — no imports are loaded, no build step runs, nothing in your project is evaluated.

### Does any agent actually read llms.txt?

Fair question — an oft-cited Ahrefs study found ~97% of llms.txt files are never fetched *by crawlers*. That stat measures the wrong consumers. Training crawlers (GPTBot, CCBot) ingest rendered HTML at scale and ignore llms.txt; but IDE assistants (Cursor, Claude Code, Copilot) and user-directed agents fetch llms.txt on demand when someone points them at your site — and those are the visits where being machine-readable decides whether the agent gets your pricing right or hallucinates it.

More importantly, telogen's real product is the **per-page `.md` files**. For CSR/SPA pages, a crawler that doesn't execute JavaScript sees an empty `<div id="root">` — the generated markdown is the only readable version of that content, llms.txt or not.

**See it before you install:** [`examples/demo/`](examples/demo/) is a committed example — a small App Router project with the actual generated [`llms.txt`](examples/demo/public/llms.txt), per-page `.md` files, and [`ai-annotation-guide.md`](examples/demo/ai-annotation-guide.md) checked in.

### How it differs from Cloudflare's approach

| | telogen | Cloudflare AI Gateway / Workers |
|---|---|---|
| Input | React source (AST) | Live HTTP response |
| When it runs | Build time / CI | Request time |
| Runtime cost | Zero | Proxy latency per request |
| Works for CSR/SPA | Yes | No (JS not executed) |
| Requires deployment | No | Yes |

---

## Output

For a Next.js project with this structure:

```
app/
  page.tsx          ← export const metadata = { title: 'Home', description: '…' }
  about/page.tsx
  pricing/page.tsx
```

Running `npx telogen` writes:

```
public/
  llms.txt          ← index following llmstxt.org spec
  index.md          ← extracted content for /
  about.md
  pricing.md
```

**`llms.txt`** (root of your site):

```
# my-project

- [Home](/index.md): The best place to start
- [About](/about.md): Learn about our company
- [Pricing](/pricing.md): dynamic — see generateMetadata()
```

**`about.md`** (one per page):

```markdown
# About Us

Learn about our company

Our mission is to build great software for everyone.

- Feature one
- Feature two
```

AI agents follow the two-hop pattern: fetch `/llms.txt` → follow links to per-page `.md` files. Both files use root-relative URLs so they work regardless of CDN path or deployment prefix.

---

## Installation

```bash
# Run once (no install needed)
npx telogen

# Or install globally
npm install -g telogen

# Or add to your project
npm install --save-dev telogen
```

Requires Node.js ≥ 18.

---

## Usage

```bash
npx telogen [options]
```

| Option | Default | Description |
|---|---|---|
| `--out <dir>` | `public` | Output directory |
| `--skip-dynamic` | off | Omit `<!-- dynamic content -->` comments |
| `--skip-components <list>` | — | Comma-separated JSX element names to exclude (e.g. `NavBar,Sidebar`) |
| `--force` | off | Overwrite an existing `llms.txt` that telogen didn't generate |
| `--help` | | Show help |

telogen refuses to overwrite an `llms.txt` it doesn't recognize as its own output — a handcrafted file needs `--force`. Every run starts by printing its version and ends with a coverage summary (`14 routes → 10 with content, 4 mostly empty`) pointing at `ai-annotation-guide.md` for the empty ones.

### In your build pipeline

```json
{
  "scripts": {
    "build": "next build && npx telogen"
  }
}
```

Or in CI alongside your existing steps — it reads source files, not build output, so order doesn't matter.

---

## Supported routers

| Router | Status |
|---|---|
| Next.js App Router (`app/` or `src/app/`) | Supported |
| Next.js Pages Router (`pages/` or `src/pages/`) | Supported |
| Remix | Planned |
| Astro | Planned |

telogen auto-detects which router your project uses, following Next.js's own precedence: `app/` > `pages/` > `src/app/` > `src/pages/` (a root `app/` or `pages/` makes `src/` variants invisible, exactly as in Next.js).

---

## Dynamic content

Pages are flagged as dynamic when telogen detects:

1. **`async` default export** — the primary App Router signal (`async function Page()`)
2. **Unknown `use*` hooks** — data-fetching hooks like `useSWR`, `useQuery` (safe hooks such as `useState`, `useEffect`, `useMemo` are not flagged)
3. **`fetch()` calls** at module scope

Dynamic pages get a comment in their `.md` file:

```markdown
<!-- dynamic content — available at runtime via /products -->
```

Pass `--skip-dynamic` to omit these comments entirely.

### `generateMetadata()`

When telogen finds `export async function generateMetadata()`, it cannot extract a static description. The `llms.txt` entry reads:

```
- [Products](/products.md): dynamic — see generateMetadata()
```

This signals to agents that a description exists at runtime, not that the page is empty.

---

## Dynamic routes

Routes with path parameters (`[slug]`, `[id]`, `[...catchAll]`) are skipped — telogen cannot enumerate the parameter values statically. A warning is printed to stderr for each skipped file:

```
telogen: skipped dynamic route: app/blog/[slug]/page.tsx
```

Parallel routes (`@slot`) and API routes (`pages/api/`) are also skipped.

---

## robots.txt consideration

The generated `.md` files live in `public/` and are URL-accessible by default. If you want to keep them available to AI agents but hidden from traditional search crawlers, add entries to your `public/robots.txt`:

```
User-agent: Googlebot
Disallow: /*.md$

User-agent: *
Allow: /llms.txt
Allow: /*.md$
```

Alternatively, use a different `--out` directory and configure your server to serve it under a path that traditional crawlers ignore.

---

## Content extraction

telogen extracts text from JSX using a set of heuristics:

- **Heading elements** (`h1`–`h6`) → markdown headings
- **List items** (`li`) → markdown list items
- **Paragraphs and other elements** → plain text
- **String props** on elements with semantic names (`title`, `description`, `label`, `heading`, `caption`, `summary`, `body`, `content`, `text`) → text blocks
- **Navigation chrome** (`nav`, `header`, `footer`, `aside`) → skipped entirely
- **Imported components** (`<Pricing />`) → resolved one hop (relative, alias, or barrel import) and extracted with the same rules

`export const metadata = { title, description }` (App Router) is extracted and used as the page title and description in both the `.md` file and the `llms.txt` entry.

---

## AI annotation guide

Every run writes `ai-annotation-guide.md` to your project root. It scans all
source files (not just route files) for components and string props whose
content telogen currently can't reach, and maps each one to the spot you'd mark
it for extraction.

The file is a diagnostic map: it shows you *where* extractable content lives
inside your components. `<AIContent>` (from `telogen-react`) and the CLI-side
extraction that reads it both ship together in Phase 2 — once they do, marking
these spots will let telogen pick up that content on the next run.

> **Note:** `ai-annotation-guide.md` is regenerated on every run — edits are
> ephemeral. Use `.telogenignore` to permanently exclude files.

### `.telogenignore`

Create `.telogenignore` in your project root to exclude files from the
annotation scan. One glob pattern per line, `#` for comments:

```
# .telogenignore
components/ui/primitives/**
components/icons/**
lib/utils
```

Bare paths without glob characters (`lib/utils`, `components/icons/`) are
automatically expanded to `lib/utils/**` and `components/icons/**`.
The scan always excludes `node_modules`, `.next`, `dist`, and test files
regardless of `.telogenignore`.

---

## Known limitations

**Imports are followed exactly one hop.** For every component a page renders, telogen resolves the import — relative paths, `tsconfig`/`jsconfig` `paths` aliases (`@/components/Pricing`), and barrel files (`components/index.ts`) all work — and extracts that component's content into the page's `.md`:

```tsx
// app/page.tsx — telogen follows <Pricing /> into Pricing.tsx and extracts its content
export default async function Page() {
  const products = await getProducts();
  return <Pricing products={products} />;
}
```

What it does **not** do: recurse further (components rendered *inside* `Pricing.tsx` are not followed), or look inside `node_modules`. Content deeper than one hop shows up in the generated `ai-annotation-guide.md` instead — and `<AIContent>` (from `telogen-react`) will let you mark it explicitly when it ships in Phase 2.

**Pages that only call `redirect()` produce empty output.** This is expected — there is no content to extract.

**Stale `llms.txt`.** The generated files are a snapshot of your source at the time you run telogen. If you update your pages, re-run telogen (or automate it in CI) to keep them fresh.

---

## Contributing

```bash
git clone https://github.com/ggange/telogen
cd telogen
npm install
npm test       # 142 tests, ~850ms
npm run build  # outputs dist/cli.js
```

telogen is built with `@babel/parser` + `@babel/traverse` for AST analysis and `tsup` for bundling. The CLI produces a single self-contained `dist/cli.js` with a Node shebang, suitable for `npx`.

---

## License

MIT
