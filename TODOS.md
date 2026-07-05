# TODOs

Deferred work with context. Effort: S/M/L/XL (human team) — with AI-assisted
development typically one size smaller. Priority: P1 (next up) / P2 / P3.

## P1 — first week post-HN

### GitHub Action for auto-regeneration
- **What:** Reusable Action: on push, run `npx telogen`, commit updated
  `llms.txt` + `.md` files with `[skip ci]` if changed; publish to the
  GitHub Marketplace.
- **Why:** Kills the stale-llms.txt objection (the #1 legit criticism of
  build-time generation) and opens a distribution channel.
- **Context:** Spec'd in the 2026-06-29 CEO plan (scope item 4). Deferred
  from the pre-HN window (D2, 2026-07-04) to keep launch week focused on
  first-run reliability. Needs `contents: write` permission; exit 0 on
  zero-diff, non-zero on CLI error.
- **Effort:** S · **Depends on:** stable v0.1.5

### Show HN post (Monday 2026-07-07)
- **What:** Write the post: confront the Ahrefs "97% of llms.txt never
  read" stat in the first paragraph (it measures crawlers; IDE/user-directed
  agents do fetch it), CSR/build-time differentiation table, traction line
  (400+ downloads organic), "never executes your code."
- **Why:** The post is the launch surface; the 97%-stat rebuttal is the
  make-or-break comment-thread move.
- **Effort:** S (human-written by choice, D8)

## P2 — post-launch roadmap (from 2026-06-29 plan Phase 2)

### Vercel build plugin
- **What:** Self-install npm package first; submit Marketplace application
  immediately (approval historically 4–12 weeks).
- **Why:** Zero-config for Vercel-native developers.
- **Effort:** M

### Netlify build plugin
- **What:** Separate package, separate plugin API; ship independently.
- **Effort:** M

### @telogen/react full <AIContent> implementation
- **What:** v1 component (Fragment passthrough) + CLI-side extraction via
  import-binding tracking (handles aliased imports; do NOT hardcode the
  string "AIContent"). Spec in 2026-06-29 CEO plan.
- **Why:** Closes the "content inside custom components" gap for annotated
  code; the "aria-label for AI" bet.
- **Depends on:** user signal that the annotation guide is used; placeholder
  package published (pre-HN checklist).
- **Effort:** M

### One-hop import extraction — remainder (if cut at the Sunday gate)
- **What:** Whatever of the one-hop resolver (tsconfig `paths` aliases,
  barrel files, depth-1 component extraction) didn't ship in v0.1.5;
  extend to `extends` chains and wildcard patterns → v0.2.0.
- **Context:** Spec + minimum-alias bar in the 2026-07-04 CEO plan
  (~/.gstack/projects/ggange-agentify/ceo-plans/).
- **Effort:** M

### CI publish pipeline for @telogen/react
- **What:** Wire `packages/react` into the tag-triggered publish workflow
  (same provenance flow `publish.yml` gives the root package; scoped tag
  like `react-v*` or a workspace-aware release step).
- **Why:** The placeholder is a one-off manual `npm publish`; real
  @telogen/react releases (Phase 2 AIContent) need the same repeatable,
  provenance-signed path as telogen itself.
- **Context:** Flagged in the 2026-07-04 eng review distribution check —
  `publish.yml` only builds/publishes the root package.
- **Depends on:** @telogen/react real implementation starting.
- **Effort:** S

## P3

### Windows deep-dive
- **What:** If the pre-HN Windows CI timebox trips on secondary bugs
  (beyond the posix-glob fix), finish the remaining failures here.
- **Effort:** S–M, unknown until CI runs
