import { describe, test, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { detectRoutes } from '../router.js';

async function mkFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telo-router-'));
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

describe('App Router detection', () => {
  test('detects app/ and produces correct URLs', async () => {
    const root = await mkFixture({
      'app/page.tsx': '',
      'app/about/page.tsx': '',
    });
    try {
      const { routes, router } = await detectRoutes(root);
      expect(router).toBe('app');
      const urls = routes.map(r => r.url).sort();
      expect(urls).toEqual(['/', '/about']);
    } finally {
      await cleanUp(root);
    }
  });

  test('strips route groups from URLs', async () => {
    const root = await mkFixture({
      'app/(marketing)/pricing/page.tsx': '',
      'app/(marketing)/about/page.tsx': '',
    });
    try {
      const { routes } = await detectRoutes(root);
      const urls = routes.map(r => r.url).sort();
      expect(urls).toContain('/pricing');
      expect(urls).toContain('/about');
      expect(urls.some(u => u.includes('(marketing)'))).toBe(false);
    } finally {
      await cleanUp(root);
    }
  });

  test('skips dynamic [param] segments', async () => {
    const root = await mkFixture({
      'app/page.tsx': '',
      'app/blog/[slug]/page.tsx': '',
      'app/[id]/settings/page.tsx': '',
    });
    try {
      const { routes, skipped } = await detectRoutes(root);
      const urls = routes.map(r => r.url);
      expect(urls).toContain('/');
      expect(urls.some(u => u.includes('['))).toBe(false);
      expect(skipped.length).toBe(2);
    } finally {
      await cleanUp(root);
    }
  });

  test('skips @slot parallel routes', async () => {
    const root = await mkFixture({
      'app/page.tsx': '',
      'app/@modal/page.tsx': '',
    });
    try {
      const { routes, skipped } = await detectRoutes(root);
      const urls = routes.map(r => r.url);
      expect(urls).toEqual(['/']);
      expect(skipped.some(s => s.includes('@modal'))).toBe(true);
    } finally {
      await cleanUp(root);
    }
  });
});

describe('Pages Router detection', () => {
  test('detects pages/ and produces correct URLs', async () => {
    const root = await mkFixture({
      'pages/index.tsx': '',
      'pages/about.tsx': '',
      'pages/blog/index.tsx': '',
    });
    try {
      const { routes, router } = await detectRoutes(root);
      expect(router).toBe('pages');
      const urls = routes.map(r => r.url).sort();
      expect(urls).toContain('/');
      expect(urls).toContain('/about');
      expect(urls).toContain('/blog');
    } finally {
      await cleanUp(root);
    }
  });

  test('excludes _app, _document, _error, and api routes', async () => {
    const root = await mkFixture({
      'pages/index.tsx': '',
      'pages/_app.tsx': '',
      'pages/_document.tsx': '',
      'pages/_error.tsx': '',
      'pages/api/hello.ts': '',
    });
    try {
      const { routes } = await detectRoutes(root);
      const urls = routes.map(r => r.url);
      expect(urls).toEqual(['/']);
    } finally {
      await cleanUp(root);
    }
  });

  test('skips dynamic [param] pages routes', async () => {
    const root = await mkFixture({
      'pages/index.tsx': '',
      'pages/[slug].tsx': '',
    });
    try {
      const { routes, skipped } = await detectRoutes(root);
      expect(routes.map(r => r.url)).toEqual(['/']);
      expect(skipped.length).toBeGreaterThan(0);
    } finally {
      await cleanUp(root);
    }
  });
});

describe('router=none fallback', () => {
  test('returns none when no Next.js structure exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telo-empty-'));
    try {
      const { router, routes } = await detectRoutes(root);
      expect(router).toBe('none');
      expect(routes).toHaveLength(0);
    } finally {
      await cleanUp(root);
    }
  });
});
