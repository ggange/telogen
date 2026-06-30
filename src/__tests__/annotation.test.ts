import { describe, test, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { scanForAnnotations, renderAnnotationGuide } from '../annotation-guide.js';
import type { FileAnnotations } from '../annotation-guide.js';

async function mkFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telo-ann-'));
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

describe('scanForAnnotations', () => {
  test('detects content-prop string on a custom component', async () => {
    const root = await mkFixture({
      'src/Hero.tsx': `
        export function Hero() {
          return <HeroSection title="Welcome to telo" />;
        }
      `,
    });
    try {
      const files = await scanForAnnotations(root);
      expect(files.length).toBeGreaterThan(0);
      const hints = files.flatMap(f => f.hints);
      const prop = hints.find(h => h.type === 'prop');
      expect(prop).toBeDefined();
      if (prop?.type === 'prop') {
        expect(prop.propName).toBe('title');
        expect(prop.elementName).toBe('HeroSection');
      }
    } finally {
      await cleanUp(root);
    }
  });

  test('detects JSX text literal longer than 20 chars', async () => {
    const root = await mkFixture({
      'src/Page.tsx': `
        export default function Page() {
          return <p>Everything you need to ship faster today</p>;
        }
      `,
    });
    try {
      const files = await scanForAnnotations(root);
      const hints = files.flatMap(f => f.hints);
      const literal = hints.find(h => h.type === 'literal');
      expect(literal).toBeDefined();
      if (literal?.type === 'literal') {
        expect(literal.parentElement).toBe('p');
        expect(literal.preview).toContain('Everything you need');
      }
    } finally {
      await cleanUp(root);
    }
  });

  test('ignores JSX text ≤ 20 chars', async () => {
    const root = await mkFixture({
      'src/Short.tsx': `
        export default function Short() {
          return <p>Short text</p>;
        }
      `,
    });
    try {
      const files = await scanForAnnotations(root);
      const literals = files.flatMap(f => f.hints).filter(h => h.type === 'literal');
      expect(literals).toHaveLength(0);
    } finally {
      await cleanUp(root);
    }
  });

  test('ignores non-content props like className and href', async () => {
    const root = await mkFixture({
      'src/Nav.tsx': `
        export function Nav() {
          return <a className="btn" href="/about">About</a>;
        }
      `,
    });
    try {
      const files = await scanForAnnotations(root);
      const propHints = files.flatMap(f => f.hints).filter(h => h.type === 'prop');
      expect(propHints).toHaveLength(0);
    } finally {
      await cleanUp(root);
    }
  });

  test('excludes test files from scan', async () => {
    const root = await mkFixture({
      'src/Hero.test.tsx': `
        export function test() {
          return <HeroSection title="Should be excluded" />;
        }
      `,
    });
    try {
      const files = await scanForAnnotations(root);
      expect(files).toHaveLength(0);
    } finally {
      await cleanUp(root);
    }
  });

  test('excludes node_modules from scan', async () => {
    const root = await mkFixture({
      'node_modules/lib/Component.tsx': `
        export function Comp() {
          return <Section title="Should not appear" />;
        }
      `,
    });
    try {
      const files = await scanForAnnotations(root);
      expect(files).toHaveLength(0);
    } finally {
      await cleanUp(root);
    }
  });

  test('.teloignore excludes matching files (glob pattern)', async () => {
    const root = await mkFixture({
      'src/Hero.tsx': `export function Hero() { return <HeroSection title="Keep me" />; }`,
      'src/ignored/Nav.tsx': `export function Nav() { return <NavSection title="Exclude me" />; }`,
      '.teloignore': 'src/ignored/**',
    });
    try {
      const files = await scanForAnnotations(root);
      const paths = files.map(f => f.filePath);
      expect(paths.some(p => p.includes('ignored'))).toBe(false);
      expect(paths.some(p => p.includes('Hero'))).toBe(true);
    } finally {
      await cleanUp(root);
    }
  });

  test('.teloignore strips comments and blank lines', async () => {
    const root = await mkFixture({
      'src/Hero.tsx': `export function Hero() { return <HeroSection title="Keep me" />; }`,
      '.teloignore': '# this is a comment\n\n# another comment\n',
    });
    try {
      const files = await scanForAnnotations(root);
      expect(files.length).toBeGreaterThan(0);
    } finally {
      await cleanUp(root);
    }
  });

  test('.teloignore bare directory path is normalized to glob', async () => {
    const root = await mkFixture({
      'src/Hero.tsx': `export function Hero() { return <HeroSection title="Keep me" />; }`,
      'src/ignored/Nav.tsx': `export function Nav() { return <NavSection title="Exclude me" />; }`,
      '.teloignore': 'src/ignored',
    });
    try {
      const files = await scanForAnnotations(root);
      const paths = files.map(f => f.filePath);
      expect(paths.some(p => p.includes('ignored'))).toBe(false);
      expect(paths.some(p => p.includes('Hero'))).toBe(true);
    } finally {
      await cleanUp(root);
    }
  });

  test('.teloignore trailing-slash directory is normalized to glob', async () => {
    const root = await mkFixture({
      'src/Hero.tsx': `export function Hero() { return <HeroSection title="Keep me" />; }`,
      'src/ignored/Nav.tsx': `export function Nav() { return <NavSection title="Exclude me" />; }`,
      '.teloignore': 'src/ignored/',
    });
    try {
      const files = await scanForAnnotations(root);
      expect(files.some(f => f.filePath.includes('ignored'))).toBe(false);
    } finally {
      await cleanUp(root);
    }
  });

  test('missing .teloignore does not affect scan', async () => {
    const root = await mkFixture({
      'src/Hero.tsx': `export function Hero() { return <HeroSection title="Welcome" />; }`,
    });
    try {
      const files = await scanForAnnotations(root);
      expect(files.length).toBeGreaterThan(0);
    } finally {
      await cleanUp(root);
    }
  });
});

describe('renderAnnotationGuide', () => {
  test('empty input includes "No annotation candidates found"', () => {
    const out = renderAnnotationGuide([]);
    expect(out).toContain('No annotation candidates found');
  });

  test('renders file section header', () => {
    const files: FileAnnotations[] = [
      {
        filePath: 'src/Hero.tsx',
        hints: [{ type: 'prop', elementName: 'Hero', propName: 'title', line: 5 }],
      },
    ];
    const out = renderAnnotationGuide(files);
    expect(out).toContain('## src/Hero.tsx');
  });

  test('renders prop hint with AIContent instruction', () => {
    const files: FileAnnotations[] = [
      {
        filePath: 'src/Hero.tsx',
        hints: [{ type: 'prop', elementName: 'HeroSection', propName: 'description', line: 8 }],
      },
    ];
    const out = renderAnnotationGuide(files);
    expect(out).toContain('`description`');
    expect(out).toContain('<HeroSection>');
    expect(out).toContain('<AIContent');
    expect(out).toContain('line 8');
  });

  test('renders literal hint with preview', () => {
    const files: FileAnnotations[] = [
      {
        filePath: 'src/Page.tsx',
        hints: [{ type: 'literal', parentElement: 'p', preview: 'Everything you need to ship faster', line: 12 }],
      },
    ];
    const out = renderAnnotationGuide(files);
    expect(out).toContain('Everything you need to ship faster');
    expect(out).toContain('line 12');
    expect(out).toContain('<AIContent>');
  });

  test('renders multiple files', () => {
    const files: FileAnnotations[] = [
      { filePath: 'src/A.tsx', hints: [{ type: 'prop', elementName: 'A', propName: 'title', line: 1 }] },
      { filePath: 'src/B.tsx', hints: [{ type: 'prop', elementName: 'B', propName: 'label', line: 2 }] },
    ];
    const out = renderAnnotationGuide(files);
    expect(out).toContain('## src/A.tsx');
    expect(out).toContain('## src/B.tsx');
  });
});
