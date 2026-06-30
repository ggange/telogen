# @pkg/react

> **Namespace placeholder** — full implementation shipping with telo Phase 2.

This package reserves the `@pkg/react` npm namespace. The `<AIContent>` component will be published here once the Phase 2 implementation is complete.

## Planned API

```tsx
import { AIContent } from '@pkg/react';

// Wraps any content to make it visible to AI agents via telo
function Hero({ title }: { title: string }) {
  return (
    <AIContent label="hero-title">
      <h1>{title}</h1>
    </AIContent>
  );
}
```

`<AIContent>` renders as a `React.Fragment` in v1 (zero DOM wrapper, zero layout impact). The `label` prop is reserved for v2, which will use it as a heading prefix during CLI extraction.

## Timeline

- `telo` v0.1.0 — annotation guide tells you *where* to add `<AIContent>`
- `@pkg/react` v0.1.0 — ships the actual component (Phase 2)

Follow progress at [github.com/ggange/telo](https://github.com/ggange/telo).
