# Roadmap

What's planned after v0.1.5. Order reflects current priority; nothing here
is a commitment to a date. Ideas and votes welcome in
[Discussions](https://github.com/ggange/telogen/discussions).

## GitHub Action for auto-regeneration

A reusable Action: on push, run `npx telogen` and commit updated `llms.txt`
and `.md` files when they change. Keeps generated output in lockstep with
your source without a manual re-run — the answer to "won't this go stale?"

## `<AIContent>` — telogen-react

The [telogen-react](https://www.npmjs.com/package/telogen-react) package
will ship an `<AIContent>` React component (a Fragment passthrough — zero
DOM, zero layout impact) together with CLI-side extraction that follows
imports to read it. Marking content inside your components makes it visible
to telogen even where heuristics can't reach. The `ai-annotation-guide.md`
telogen generates today maps where annotation will be useful.

## Deeper import extraction

One-hop import following (relative paths, tsconfig/jsconfig `paths`
aliases, barrel files) shipped in v0.1.5. Next: configurable depth, so
content nested more than one component deep is reachable too.

## Build-platform plugins

Vercel and Netlify build plugins for zero-config generation on deploy.

## More routers

Remix and Astro support, as listed in the README.
