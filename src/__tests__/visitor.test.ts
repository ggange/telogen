import { describe, test, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { extractContent } from '../visitor.js';

async function withTempFile(content: string, fn: (filePath: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'telo-test-'));
  const file = path.join(dir, 'page.tsx');
  await fs.writeFile(file, content, 'utf-8');
  try {
    await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('extractContent — dynamic detection', () => {
  test('async default export function → isDynamic', async () => {
    await withTempFile(
      `export default async function Page() { const data = await fetch('/api'); return <div/> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.isDynamic).toBe(true);
      }
    );
  });

  test('sync default export function → not dynamic', async () => {
    await withTempFile(
      `export default function Page() { return <div>Hello</div> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.isDynamic).toBe(false);
      }
    );
  });

  test('unknown use* hook → isDynamic', async () => {
    await withTempFile(
      `export default function Page() { const data = useSWR('/api'); return <div/> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.isDynamic).toBe(true);
      }
    );
  });

  test('safe hooks (useState, useEffect) do not trigger isDynamic', async () => {
    await withTempFile(
      `export default function Page() {
        const [v, setV] = useState(0);
        useEffect(() => {}, []);
        return <div>{v}</div>;
      }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.isDynamic).toBe(false);
      }
    );
  });

  test('bare fetch() call → isDynamic', async () => {
    await withTempFile(
      `export default function Page() { fetch('/api'); return <div/> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.isDynamic).toBe(true);
      }
    );
  });
});

describe('extractContent — JSX text extraction', () => {
  test('extracts h1 as heading block', async () => {
    await withTempFile(
      `export default function Page() { return <main><h1>Welcome</h1></main> }`,
      async (f) => {
        const c = await extractContent(f);
        const h1 = c.blocks.find(b => b.type === 'heading' && b.level === 1);
        expect(h1?.text).toBe('Welcome');
      }
    );
  });

  test('extracts paragraph text', async () => {
    await withTempFile(
      `export default function Page() { return <main><p>Hello world</p></main> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.blocks.some(b => b.text === 'Hello world')).toBe(true);
      }
    );
  });

  test('skips content inside <nav>', async () => {
    await withTempFile(
      `export default function Page() { return <main><nav><a>Menu item</a></nav><h1>Title</h1></main> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.blocks.some(b => b.text === 'Menu item')).toBe(false);
        expect(c.blocks.some(b => b.text === 'Title')).toBe(true);
      }
    );
  });

  test('skips content inside <footer>', async () => {
    await withTempFile(
      `export default function Page() { return <div><footer><p>Footer text</p></footer><p>Body</p></div> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.blocks.some(b => b.text === 'Footer text')).toBe(false);
        expect(c.blocks.some(b => b.text === 'Body')).toBe(true);
      }
    );
  });

  test('extracts list items as listitem blocks', async () => {
    await withTempFile(
      `export default function Page() { return <ul><li>Item A</li><li>Item B</li></ul> }`,
      async (f) => {
        const c = await extractContent(f);
        const items = c.blocks.filter(b => b.type === 'listitem');
        expect(items.map(b => b.text)).toEqual(['Item A', 'Item B']);
      }
    );
  });
});

describe('extractContent — metadata', () => {
  test('picks up title from export const metadata', async () => {
    await withTempFile(
      `export const metadata = { title: 'My Page', description: 'Desc' };
       export default function Page() { return <div/> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.title).toBe('My Page');
        expect(c.description).toBe('Desc');
        expect(c.hasDynamicMetadata).toBe(false);
      }
    );
  });

  test('detects generateMetadata', async () => {
    await withTempFile(
      `export async function generateMetadata({ params }) { return { title: params.id }; }
       export default function Page() { return <div/> }`,
      async (f) => {
        const c = await extractContent(f);
        expect(c.hasDynamicMetadata).toBe(true);
      }
    );
  });
});

describe('extractContent — error handling', () => {
  test('returns empty content on unrecoverable parse error', async () => {
    await withTempFile(
      `!!!! this is not valid @#$ source code &&& `,
      async (f) => {
        const c = await extractContent(f);
        expect(c.blocks).toHaveLength(0);
        expect(c.isDynamic).toBe(false);
        expect(c.title).toBeNull();
      }
    );
  });
});

describe('extractContent — skipComponents', () => {
  test('skips children of named component', async () => {
    await withTempFile(
      `export default function Page() {
        return <main><NavBar><a>Menu</a></NavBar><h1>Title</h1></main>;
      }`,
      async (f) => {
        const c = await extractContent(f, new Set(['NavBar']));
        expect(c.blocks.some(b => b.text === 'Menu')).toBe(false);
        expect(c.blocks.some(b => b.text === 'Title')).toBe(true);
      }
    );
  });

  test('content outside skipped component is preserved', async () => {
    await withTempFile(
      `export default function Page() {
        return <main><Sidebar><p>Nav stuff</p></Sidebar><p>Main content here</p></main>;
      }`,
      async (f) => {
        const c = await extractContent(f, new Set(['Sidebar']));
        expect(c.blocks.some(b => b.text === 'Nav stuff')).toBe(false);
        expect(c.blocks.some(b => b.text === 'Main content here')).toBe(true);
      }
    );
  });

  test('undefined skipComponents leaves behavior unchanged', async () => {
    await withTempFile(
      `export default function Page() { return <main><h1>Hello</h1></main>; }`,
      async (f) => {
        const c = await extractContent(f, undefined);
        expect(c.blocks.find(b => b.type === 'heading' && b.level === 1)?.text).toBe('Hello');
      }
    );
  });
});
