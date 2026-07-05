import { describe, test, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseArgs, run } from '../cli.js';

async function mkFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telogen-cli-'));
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
    expect(() => parseArgs(['--skip-components', '--out', 'dist']))
      .toThrow(/--skip-components requires/);
  });

  test('--out without a value errors', () => {
    expect(() => parseArgs(['--out'])).toThrow(/--out requires/);
  });

  test('unknown flag throws UsageError with did-you-mean hint', () => {
    expect(() => parseArgs(['--skip-component'])).toThrow(/did you mean --skip-components\?/);
    expect(() => parseArgs(['--frce'])).toThrow(/did you mean --force\?/);
  });

  test('unknown positional argument throws', () => {
    expect(() => parseArgs(['banana'])).toThrow(/unknown argument: banana/);
  });

  test('--force sets flag', () => {
    expect(parseArgs(['--force']).force).toBe(true);
    expect(parseArgs([]).force).toBe(false);
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
        export default function Page() { return <Hero title="Welcome to telogen" />; }
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telogen-empty-'));
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

describe('version banner', () => {
  test('llms.txt has H1 first, banner on the second line', async () => {
    const root = await mkFixture({
      'app/page.tsx': `export default function Page() { return <h1>Hi there</h1>; }`,
    });
    try {
      await run(root, ['--out', 'out']);
      const llms = await fs.readFile(path.join(root, 'out', 'llms.txt'), 'utf-8');
      const lines = llms.split('\n');
      expect(lines[0].startsWith('# ')).toBe(true);
      expect(lines[1]).toMatch(/^<!-- generated by telogen v.* -->$/);
    } finally {
      await cleanUp(root);
    }
  });

  test('.md with a title has banner after the H1, not first', async () => {
    const root = await mkFixture({
      'app/page.tsx': `
        export const metadata = { title: 'Home', description: 'Welcome' };
        export default function Page() { return <main><p>Body</p></main>; }
      `,
    });
    try {
      await run(root, ['--out', 'out']);
      const md = await fs.readFile(path.join(root, 'out', 'index.md'), 'utf-8');
      const lines = md.split('\n');
      expect(lines[0]).toBe('# Home');
      expect(lines[1]).toMatch(/^<!-- generated by telogen v.* -->$/);
    } finally {
      await cleanUp(root);
    }
  });
});

describe('overwrite guard', () => {
  const page = `export default function Page() { return <h1>Fresh content</h1>; }`;

  test('overwrites its own output (banner present) without complaint', async () => {
    const root = await mkFixture({ 'app/page.tsx': page });
    try {
      await run(root, ['--out', 'out']);
      await run(root, ['--out', 'out']); // second run over own output
      const llms = await fs.readFile(path.join(root, 'out', 'llms.txt'), 'utf-8');
      expect(llms).toContain('generated by telogen');
    } finally {
      await cleanUp(root);
    }
  });

  test('v0.1.4-shaped llms.txt (no banner) is overwritten with a warning', async () => {
    const legacy = '# my-app\n\n- [Home](/index.md): Welcome\n';
    const root = await mkFixture({ 'app/page.tsx': page, 'out/llms.txt': legacy });
    try {
      await run(root, ['--out', 'out']);
      const llms = await fs.readFile(path.join(root, 'out', 'llms.txt'), 'utf-8');
      expect(llms).toContain('generated by telogen');
    } finally {
      await cleanUp(root);
    }
  });

  test('handcrafted llms.txt is refused without --force', async () => {
    const handcrafted = '# My careful docs\n\nSome prose an agent should read.\n\n## Section\n';
    const root = await mkFixture({ 'app/page.tsx': page, 'out/llms.txt': handcrafted });
    try {
      await expect(run(root, ['--out', 'out'])).rejects.toThrow(/--force/);
      const untouched = await fs.readFile(path.join(root, 'out', 'llms.txt'), 'utf-8');
      expect(untouched).toBe(handcrafted);
    } finally {
      await cleanUp(root);
    }
  });

  test('--force overwrites a handcrafted llms.txt', async () => {
    const handcrafted = '# My careful docs\n\nSome prose.\n';
    const root = await mkFixture({ 'app/page.tsx': page, 'out/llms.txt': handcrafted });
    try {
      await run(root, ['--out', 'out', '--force']);
      const llms = await fs.readFile(path.join(root, 'out', 'llms.txt'), 'utf-8');
      expect(llms).toContain('generated by telogen');
    } finally {
      await cleanUp(root);
    }
  });
});

describe('duplicate URL warning', () => {
  test('warns and keeps the first file when route groups collide', async () => {
    const root = await mkFixture({
      'app/(a)/x/page.tsx': `export default function Page() { return <h1>A wins</h1>; }`,
      'app/(b)/x/page.tsx': `export default function Page() { return <h1>B loses</h1>; }`,
    });
    const warns: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((m: string) => { warns.push(m); });
    try {
      await run(root, ['--out', 'out']);
      expect(warns.some(w => w.includes('duplicate URL /x'))).toBe(true);
      const md = await fs.readFile(path.join(root, 'out', 'x.md'), 'utf-8');
      expect(md).toContain('A wins');
    } finally {
      spy.mockRestore();
      await cleanUp(root);
    }
  });
});

describe('coverage summary', () => {
  test('reports content / mostly-empty buckets', async () => {
    const root = await mkFixture({
      'app/page.tsx': `export default function Page() { return <h1>Real content here</h1>; }`,
      'app/empty/page.tsx': `export default function Page() { return <Shell />; }`,
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: string) => { logs.push(String(m)); });
    try {
      await run(root, ['--out', 'out']);
      const summary = logs.find(l => l.includes('routes →'));
      expect(summary).toBeDefined();
      expect(summary).toContain('1 with content');
      expect(summary).toContain('1 mostly empty');
      expect(summary).toContain('ai-annotation-guide.md');
    } finally {
      spy.mockRestore();
      await cleanUp(root);
    }
  });

  test('prints every written path', async () => {
    const root = await mkFixture({
      'app/page.tsx': `export default function Page() { return <h1>Hello world</h1>; }`,
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: string) => { logs.push(String(m)); });
    try {
      await run(root, ['--out', 'out']);
      expect(logs.some(l => l.includes('wrote') && l.includes('index.md'))).toBe(true);
      expect(logs.some(l => l.includes('wrote') && l.includes('llms.txt'))).toBe(true);
      expect(logs.some(l => l.includes('wrote ai-annotation-guide.md'))).toBe(true);
    } finally {
      spy.mockRestore();
      await cleanUp(root);
    }
  });

  test('prints telogen version at run start', async () => {
    const root = await mkFixture({
      'app/page.tsx': `export default function Page() { return <h1>Hello world</h1>; }`,
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: string) => { logs.push(String(m)); });
    try {
      await run(root, ['--out', 'out']);
      expect(logs[0]).toMatch(/^telogen v/);
    } finally {
      spy.mockRestore();
      await cleanUp(root);
    }
  });
});

describe('MDX hint', () => {
  test('all-MDX app dir mentions MDX in the no-routes error', async () => {
    const root = await mkFixture({
      'app/page.mdx': '# Hello',
      'app/notes/page.mdx': '# Notes',
    });
    try {
      await expect(run(root, ['--out', 'out']))
        .rejects.toThrow(/2 markdown pages \(\.md\/\.mdx\) — Markdown\/MDX routes aren't supported yet/);
    } finally {
      await cleanUp(root);
    }
  });
});
