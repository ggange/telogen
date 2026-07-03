# @telogen/react

> Companion package for [telogen](https://github.com/ggange/telogen). The `<AIContent>`
> component ships here with telogen Phase 2 — it is not published yet.

telogen reads your route files directly and can't see content that lives inside child
components. `<AIContent>` is a lightweight marker that tells telogen to extract that
content on the next run.

## Planned API

```tsx
import { AIContent } from '@telogen/react';

// Wraps any content to make it visible to AI agents via telogen
function Hero({ title }: { title: string }) {
  return (
    <AIContent label="hero-title">
      <h1>{title}</h1>
    </AIContent>
  );
}
```

`<AIContent>` renders as a `React.Fragment` in v1 (zero DOM wrapper, zero layout impact).
The `label` prop is reserved for v2, which will use it as a heading prefix during CLI
extraction.

## Timeline

- `telogen` v0.1.0 — annotation guide tells you *where* to add `<AIContent>`
- `@telogen/react` v0.1.0 — ships the actual component (Phase 2)

Follow progress at [github.com/ggange/telogen](https://github.com/ggange/telogen).
