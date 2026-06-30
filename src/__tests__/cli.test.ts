import { describe, test, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseArgs, run } from '../cli.js';

async function mkFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telo-cli-'));
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

describe('parseArgs', () => {
  test('defaults', () => {
    const f = parseArgs([]);
    expect(f.out).toBe('public');
    expect(f.skipDynamic).toBe(false);
    expect(f.help).toBe(false);
  });

  test('--out sets output directory', () => {
    expect(parseArgs(['--out', 'dist']).out).toBe('dist');
  });

  test('--skip-dynamic sets flag', () => {
    expect(parseArgs(['--skip-dynamic']).skipDynamic).toBe(true);
  });

  test('--help sets flag', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  test('--skip-components parses comma-separated names', () => {
    expect(parseArgs(['--skip-components', 'NavBar,Header']).skipComponents).toEqual(['NavBar', 'Header']);
  });

  test('--skip-components defaults to empty array', () => {
    expect(parseArgs([]).skipComponents).toEqual([]);
  });

  test('--skip-components does not consume a following flag as its value', () => {
    const f = parseArgs(['--skip-components', '--out', 'dist']);
    expect(f.skipComponents).toEqual([]);
    expect(f.out).toBe('dist');
  });
});

describe('run() — App Router', () => {
  test('generates llms.txt and .md files for static routes', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        export const metadata = { title: 'Home', description: 'Welcome' };
        export default function Page() { return <main><h1>Welcome</h1></main>; }
      `,
      'app/about/page.tsx': `
        export const metadata = { title: 'About', description: 'About us' };
        export default function Page() { return <main><p>About us</p></main>; }
      `,
    });
    const outDir = path.join(root, 'out');
    try {
      await run(root, ['--out', 'out']);
      const llms = await fs.readFile(path.join(outDir, 'llms.txt'), 'utf-8');
      expect(llms).toContain('[Home](/index.md)');
      expect(llms).toContain('[About](/about.md)');
      const index = await fs.readFile(path.join(outDir, 'index.md'), 'utf-8');
      expect(index).toContain('# Home');
      const about = await fs.readFile(path.join(outDir, 'about.md'), 'utf-8');
      expect(about).toContain('# About');
    } finally {
      await cleanUp(root);
    }
  });

  test('creates --out directory if it does not exist', async () => {
    const root = await mkFixture({
      'app/page.tsx': `export default function Page() { return <div>Hi</div>; }`,
    });
    const outDir = path.join(root, 'nested', 'output');
    try {
      await run(root, ['--out', path.join('nested', 'output')]);
      const stat = await fs.stat(outDir);
      expect(stat.isDirectory()).toBe(true);
    } finally {
      await cleanUp(root);
    }
  });

  test('--skip-dynamic omits placeholder comments', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        export default async function Page() {
          const data = await fetch('/api/data');
          return <main><h1>Dynamic</h1></main>;
        }
      `,
    });
    try {
      await run(root, ['--out', 'out', '--skip-dynamic']);
      const md = await fs.readFile(path.join(root, 'out', 'index.md'), 'utf-8');
      expect(md).not.toContain('<!-- dynamic content');
    } finally {
      await cleanUp(root);
    }
  });

  test('dynamic placeholder is present without --skip-dynamic', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        export default async function Page() {
          return <main><h1>Dynamic Page</h1></main>;
        }
      `,
    });
    try {
      await run(root, ['--out', 'out']);
      const md = await fs.readFile(path.join(root, 'out', 'index.md'), 'utf-8');
      expect(md).toContain('<!-- dynamic content');
    } finally {
      await cleanUp(root);
    }
  });

  test('--skip-components omits content inside named elements', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        export default function Page() {
          return <main><NavBar><a>Nav link</a></NavBar><h1>Real content</h1></main>;
        }
      `,
    });
    try {
      await run(root, ['--out', 'out', '--skip-components', 'NavBar']);
      const md = await fs.readFile(path.join(root, 'out', 'index.md'), 'utf-8');
      expect(md).not.toContain('Nav link');
      expect(md).toContain('Real content');
    } finally {
      await cleanUp(root);
    }
  });

  test('writes ai-annotation-guide.md to project root', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        export default function Page() { return <Hero title="Welcome to telo" />; }
      `,
    });
    try {
      await run(root, ['--out', 'out']);
      const guide = await fs.readFile(path.join(root, 'ai-annotation-guide.md'), 'utf-8');
      expect(guide).toContain('AI Content Annotation Guide');
    } finally {
      await cleanUp(root);
    }
  });
});

describe('run() — error cases', () => {
  test('throws when no Next.js project found', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telo-empty-'));
    try {
      await expect(run(root, [])).rejects.toThrow('no Next.js project found');
    } finally {
      await cleanUp(root);
    }
  });

  test('throws when all routes are dynamic', async () => {
    const root = await mkFixture({
      'app/blog/[slug]/page.tsx': `export default function Page() { return <div/>; }`,
    });
    try {
      await expect(run(root, [])).rejects.toThrow('no static routes found');
    } finally {
      await cleanUp(root);
    }
  });
});
