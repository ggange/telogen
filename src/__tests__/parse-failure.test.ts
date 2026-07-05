import { describe, test, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Force an unrecoverable parse failure deterministically: parseSource returns
// null for any source containing the marker (babel's errorRecovery makes real
// unparseable fixtures nearly impossible to construct).
vi.mock('../parse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../parse.js')>();
  return {
    ...actual,
    parseSource: vi.fn((src: string) =>
      src.includes('UNPARSEABLE_MARKER') ? null : actual.parseSource(src)
    ),
  };
});

import { extractContent } from '../visitor.js';
import { run } from '../cli.js';

async function mkFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telogen-pf-'));
  for (const [rel, content] of Object.entries(structure)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }
  return root;
}

describe('unrecoverable parse failures', () => {
  test('extractContent marks parseFailed instead of returning a silent empty', async () => {
    const root = await mkFixture({ 'broken.tsx': '// UNPARSEABLE_MARKER' });
    try {
      const content = await extractContent(path.join(root, 'broken.tsx'));
      expect(content.parseFailed).toBe(true);
      expect(content.blocks).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('run() counts a parse-failed route as unreachable, not mostly empty', async () => {
    const root = await mkFixture({
      'app/page.tsx': `export default function Page() { return <h1>Fine page content</h1>; }`,
      'app/broken/page.tsx': `// UNPARSEABLE_MARKER`,
    });
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m: string) => { logs.push(String(m)); });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation((m: string) => { errors.push(String(m)); });
    try {
      await run(root, ['--out', 'out']);

      const stub = await fs.readFile(path.join(root, 'out', 'broken.md'), 'utf-8');
      expect(stub).toContain('<!-- extraction failed');

      const summary = logs.find(l => l.includes('routes →'));
      expect(summary).toContain('1 unreachable');
      expect(summary).not.toContain('mostly empty');

      // Surfaces as a reportable telogen limitation, not a silent empty page
      expect(errors.some(e => e.includes('issues/new'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
