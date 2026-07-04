import { describe, test, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Force extraction crashes deterministically (works on Windows CI too, unlike
// chmod-based fixtures): any route file whose path contains "boom" throws.
vi.mock('../visitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../visitor.js')>();
  return {
    ...actual,
    extractContent: vi.fn(async (filePath: string, skip?: Set<string>) => {
      if (filePath.includes('boom')) {
        throw new Error(`traverse blew up on ${filePath}`);
      }
      return actual.extractContent(filePath, skip);
    }),
  };
});

import { run } from '../cli.js';

async function mkFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telogen-iso-'));
  for (const [rel, content] of Object.entries(structure)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }
  return root;
}

describe('per-route error isolation', () => {
  test('one failing route yields a stub, the rest of the run completes', async () => {
    const root = await mkFixture({
      'app/page.tsx': `export default function Page() { return <h1>Home page content</h1>; }`,
      'app/boom/page.tsx': `export default function Page() { return <h1>Never extracted</h1>; }`,
    });
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m: string) => { logs.push(String(m)); });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation((m: string) => { errors.push(String(m)); });
    try {
      await run(root, ['--out', 'out']);

      // Healthy route unaffected
      const index = await fs.readFile(path.join(root, 'out', 'index.md'), 'utf-8');
      expect(index).toContain('Home page content');

      // Failed route gets exactly the stub comment (not the dynamic-content one)
      const stub = await fs.readFile(path.join(root, 'out', 'boom.md'), 'utf-8');
      expect(stub).toBe('<!-- extraction failed — content available at runtime via /boom -->\n');

      // llms.txt entry falls back to urlToTitle, no description
      const llms = await fs.readFile(path.join(root, 'out', 'llms.txt'), 'utf-8');
      expect(llms).toContain('- [Boom](/boom.md)');
      expect(llms).not.toMatch(/\[Boom\]\(\/boom\.md\): ./);

      // Counted once, in the unreachable bucket
      const summary = logs.find(l => l.includes('routes →'));
      expect(summary).toContain('1 with content');
      expect(summary).toContain('1 unreachable');
      expect(summary).not.toContain('mostly empty');

      // Aggregated failures produce one pre-filled issue URL
      const report = errors.find(e => e.includes('github.com/ggange/telogen/issues/new'));
      expect(report).toBeDefined();
      expect(report).toContain('template=bug_report');
      // Absolute tmp paths must not leak into the report
      expect(report).not.toContain(root);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
