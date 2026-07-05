import { describe, test, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { run } from '../cli.js';

async function mkFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telogen-onehop-'));
  for (const [rel, content] of Object.entries(structure)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }
  return root;
}

async function cleanUp(root: string) {
  await fs.rm(root, { recursive: true, force: true });
}

async function readIndexMd(root: string): Promise<string> {
  return fs.readFile(path.join(root, 'out', 'index.md'), 'utf-8');
}

const PRICING = `
export function Pricing() {
  return (
    <section>
      <h2>Simple pricing</h2>
      <p>Every plan includes the lifetime guarantee.</p>
    </section>
  );
}
`;

describe('one-hop import extraction', () => {
  test('relative import: component content lands in the page .md', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Pricing } from './Pricing';
        export default function Page() { return <main><h1>Home page</h1><Pricing /></main>; }
      `,
      'app/Pricing.tsx': PRICING,
    });
    try {
      await run(root, ['--out', 'out']);
      const md = await readIndexMd(root);
      expect(md).toContain('# Home page');
      expect(md).toContain('## Simple pricing');
      expect(md).toContain('lifetime guarantee');
    } finally {
      await cleanUp(root);
    }
  });

  test('default import resolves', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import Hero from '../components/Hero';
        export default function Page() { return <Hero />; }
      `,
      'components/Hero.tsx': `
        export default function Hero() {
          return <h1>Welcome to the product</h1>;
        }
      `,
    });
    try {
      await run(root, ['--out', 'out']);
      expect(await readIndexMd(root)).toContain('# Welcome to the product');
    } finally {
      await cleanUp(root);
    }
  });

  test('tsconfig paths alias (JSONC with comments) resolves', async () => {
    const root = await mkFixture({
      'tsconfig.json': `{
        // JSONC on purpose — real tsconfigs have comments and trailing commas
        "compilerOptions": {
          "paths": {
            "@/*": ["./src/*"],
          },
        },
      }`,
      'app/page.tsx': `
        import { Pricing } from '@/components/Pricing';
        export default function Page() { return <Pricing />; }
      `,
      'src/components/Pricing.tsx': PRICING,
    });
    try {
      await run(root, ['--out', 'out']);
      expect(await readIndexMd(root)).toContain('## Simple pricing');
    } finally {
      await cleanUp(root);
    }
  });

  test('barrel file: named re-export is followed to the declaring file', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Pricing } from '../components';
        export default function Page() { return <Pricing />; }
      `,
      'components/index.ts': `export { Pricing } from './Pricing';`,
      'components/Pricing.tsx': PRICING,
    });
    try {
      await run(root, ['--out', 'out']);
      expect(await readIndexMd(root)).toContain('## Simple pricing');
    } finally {
      await cleanUp(root);
    }
  });

  test('export * barrel is probed for the name', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Pricing } from '../components';
        export default function Page() { return <Pricing />; }
      `,
      'components/index.ts': `export * from './cards';\nexport * from './Pricing';`,
      'components/cards.tsx': `export function Card() { return <div title="Unrelated card content" />; }`,
      'components/Pricing.tsx': PRICING,
    });
    try {
      await run(root, ['--out', 'out']);
      const md = await readIndexMd(root);
      expect(md).toContain('## Simple pricing');
      expect(md).not.toContain('Unrelated card content');
    } finally {
      await cleanUp(root);
    }
  });

  test('barrel re-export cycle terminates without hanging', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Pricing } from '../a';
        export default function Page() { return <main><h1>Cycle page</h1><Pricing /></main>; }
      `,
      'a.ts': `export * from './b';`,
      'b.ts': `export * from './a';`,
    });
    try {
      await run(root, ['--out', 'out']);
      expect(await readIndexMd(root)).toContain('# Cycle page');
    } finally {
      await cleanUp(root);
    }
  });

  test('missing file and node_modules imports are skipped silently', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Gone } from './DoesNotExist';
        import { Button } from 'some-ui-lib';
        export default function Page() { return <main><h1>Still works</h1><Gone /><Button /></main>; }
      `,
    });
    try {
      await run(root, ['--out', 'out']);
      expect(await readIndexMd(root)).toContain('# Still works');
    } finally {
      await cleanUp(root);
    }
  });

  test('components inside nav chrome or --skip-components are not expanded', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { NavLinks } from './NavLinks';
        import { Sidebar } from './Sidebar';
        export default function Page() {
          return <main><nav><NavLinks /></nav><Sidebar /><h1>Body content</h1></main>;
        }
      `,
      'app/NavLinks.tsx': `export function NavLinks() { return <p>Navigation menu items list</p>; }`,
      'app/Sidebar.tsx': `export function Sidebar() { return <p>Sidebar promotional text here</p>; }`,
    });
    try {
      await run(root, ['--out', 'out', '--skip-components', 'Sidebar']);
      const md = await readIndexMd(root);
      expect(md).toContain('# Body content');
      expect(md).not.toContain('Navigation menu');
      expect(md).not.toContain('Sidebar promotional');
    } finally {
      await cleanUp(root);
    }
  });

  test('dynamic component marks the page dynamic', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { LivePrices } from './LivePrices';
        export default function Page() { return <main><h1>Prices</h1><LivePrices /></main>; }
      `,
      'app/LivePrices.tsx': `
        export function LivePrices() {
          const { data } = useSWR('/api/prices');
          return <p>Live market prices updated hourly</p>;
        }
      `,
    });
    try {
      await run(root, ['--out', 'out']);
      const md = await readIndexMd(root);
      expect(md).toContain('Live market prices');
      expect(md).toContain('<!-- dynamic content');
    } finally {
      await cleanUp(root);
    }
  });
});

describe('one-hop review fixes', () => {
  test('component content is spliced in at its JSX position, not appended after page text', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Pricing } from './Pricing';
        export default function Page() {
          return <main><Pricing /><h1>Contact us</h1></main>;
        }
      `,
      'app/Pricing.tsx': PRICING,
    });
    try {
      await run(root, ['--out', 'out']);
      const md = await readIndexMd(root);
      const pricingIdx = md.indexOf('Simple pricing');
      const contactIdx = md.indexOf('Contact us');
      expect(pricingIdx).toBeGreaterThan(-1);
      expect(contactIdx).toBeGreaterThan(-1);
      expect(pricingIdx).toBeLessThan(contactIdx);
    } finally {
      await cleanUp(root);
    }
  });

  test('default import is followed through a barrel re-export', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import Hero from '../components';
        export default function Page() { return <Hero />; }
      `,
      'components/index.ts': `export { default } from './Hero';`,
      'components/Hero.tsx': `export default function Hero() { return <h1>Welcome to the product</h1>; }`,
    });
    try {
      await run(root, ['--out', 'out']);
      expect(await readIndexMd(root)).toContain('# Welcome to the product');
    } finally {
      await cleanUp(root);
    }
  });

  test('member-expression JSX (namespace/context) is not treated as a one-hop component', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Ctx } from './ctx';
        export default function Page() {
          return <Ctx.Provider><h1>Real page content</h1></Ctx.Provider>;
        }
      `,
      'app/ctx.tsx': `export const Ctx = { Provider: () => null, secretConfigValue: 'internal-only-string' };`,
    });
    try {
      await run(root, ['--out', 'out']);
      const md = await readIndexMd(root);
      expect(md).toContain('# Real page content');
      expect(md).not.toContain('internal-only-string');
    } finally {
      await cleanUp(root);
    }
  });

  test('NodeNext-style .js specifier resolves to the .tsx source', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Pricing } from './Pricing.js';
        export default function Page() { return <main><h1>Home</h1><Pricing /></main>; }
      `,
      'app/Pricing.tsx': PRICING,
    });
    try {
      await run(root, ['--out', 'out']);
      expect(await readIndexMd(root)).toContain('Simple pricing');
    } finally {
      await cleanUp(root);
    }
  });

  test('a broken tsconfig extends chain degrades to no aliases instead of crashing the run', async () => {
    const root = await mkFixture({
      'tsconfig.json': JSON.stringify({ extends: './does-not-exist.json' }),
      'app/page.tsx': `export default function Page() { return <h1>Still generates</h1>; }`,
    });
    try {
      await run(root, ['--out', 'out']); // must not throw
      expect(await readIndexMd(root)).toContain('# Still generates');
    } finally {
      await cleanUp(root);
    }
  });

  test('a circular tsconfig extends chain degrades to no aliases instead of crashing the run', async () => {
    const root = await mkFixture({
      'tsconfig.json': JSON.stringify({ extends: './tsconfig.json' }),
      'app/page.tsx': `export default function Page() { return <h1>Still generates</h1>; }`,
    });
    try {
      await run(root, ['--out', 'out']);
      expect(await readIndexMd(root)).toContain('# Still generates');
    } finally {
      await cleanUp(root);
    }
  });

  test('one-hop-extracted component files are excluded from the annotation guide', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Pricing } from './Pricing';
        export default function Page() { return <main><h1>Home</h1><Pricing /></main>; }
      `,
      'app/Pricing.tsx': PRICING,
    });
    try {
      await run(root, ['--out', 'out']);
      const guide = await fs.readFile(path.join(root, 'ai-annotation-guide.md'), 'utf-8');
      expect(guide).not.toContain('lifetime guarantee');
      expect(guide).not.toContain('Pricing.tsx');
    } finally {
      await cleanUp(root);
    }
  });

  test('an unresolvable component keeps the page out of "with content" only if truly empty', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        import { Gone } from './DoesNotExist';
        export default function Page() { return <Gone />; }
      `,
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: string) => { logs.push(String(m)); });
    try {
      await run(root, ['--out', 'out']);
      const summary = logs.find(l => l.includes(' → '));
      expect(summary).toContain('1 mostly empty');
    } finally {
      spy.mockRestore();
      await cleanUp(root);
    }
  });
});
