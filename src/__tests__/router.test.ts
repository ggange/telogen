import { describe, test, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { detectRoutes, toGlobPattern } from '../router.js';

async function mkFixture(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telogen-router-'));
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

describe('src/ layout support', () => {
  test('detects src/app when no root app/ exists', async () => {
    const root = await mkFixture({
      'src/app/page.tsx': '',
      'src/app/about/page.tsx': '',
    });
    try {
      const { routes, router } = await detectRoutes(root);
      expect(router).toBe('app');
      expect(routes.map(r => r.url).sort()).toEqual(['/', '/about']);
    } finally {
      await cleanUp(root);
    }
  });

  test('detects src/pages when no root dirs exist', async () => {
    const root = await mkFixture({
      'src/pages/index.tsx': '',
      'src/pages/about.tsx': '',
    });
    try {
      const { routes, router } = await detectRoutes(root);
      expect(router).toBe('pages');
      expect(routes.map(r => r.url).sort()).toEqual(['/', '/about']);
    } finally {
      await cleanUp(root);
    }
  });

  test('root app/ wins over src/app (Next.js precedence)', async () => {
    const root = await mkFixture({
      'app/page.tsx': '',
      'src/app/page.tsx': '',
      'src/app/ignored/page.tsx': '',
    });
    try {
      const { routes } = await detectRoutes(root);
      expect(routes.map(r => r.url)).toEqual(['/']);
      expect(routes[0].filePath).not.toContain(`${path.sep}src${path.sep}`);
    } finally {
      await cleanUp(root);
    }
  });

  test('root pages/ wins over src/app', async () => {
    const root = await mkFixture({
      'pages/index.tsx': '',
      'src/app/page.tsx': '',
    });
    try {
      const { router } = await detectRoutes(root);
      expect(router).toBe('pages');
    } finally {
      await cleanUp(root);
    }
  });
});

describe('next dependency check', () => {
  test('throws when app/ exists but package.json has no next dependency', async () => {
    const root = await mkFixture({
      'app/page.tsx': '',
      'package.json': JSON.stringify({ name: 'not-next', dependencies: { react: '^18.0.0' } }),
    });
    try {
      await expect(detectRoutes(root)).rejects.toThrow(/does not look like a Next\.js project/);
    } finally {
      await cleanUp(root);
    }
  });

  test('passes when next is a dependency', async () => {
    const root = await mkFixture({
      'app/page.tsx': '',
      'package.json': JSON.stringify({ name: 'ok', dependencies: { next: '^15.0.0' } }),
    });
    try {
      const { routes } = await detectRoutes(root);
      expect(routes.map(r => r.url)).toEqual(['/']);
    } finally {
      await cleanUp(root);
    }
  });

  test('passes when package.json is absent (fixtures, unusual setups)', async () => {
    const root = await mkFixture({ 'app/page.tsx': '' });
    try {
      const { routes } = await detectRoutes(root);
      expect(routes.map(r => r.url)).toEqual(['/']);
    } finally {
      await cleanUp(root);
    }
  });
});

describe('duplicate URLs', () => {
  test('route groups mapping to the same URL: first kept, rest reported', async () => {
    const root = await mkFixture({
      'app/(a)/x/page.tsx': '',
      'app/(b)/x/page.tsx': '',
    });
    try {
      const { routes, duplicates } = await detectRoutes(root);
      expect(routes.filter(r => r.url === '/x')).toHaveLength(1);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].url).toBe('/x');
    } finally {
      await cleanUp(root);
    }
  });

  test('pages router: about.tsx + about/index.tsx collide', async () => {
    const root = await mkFixture({
      'pages/about.tsx': '',
      'pages/about/index.tsx': '',
    });
    try {
      const { routes, duplicates } = await detectRoutes(root);
      expect(routes.filter(r => r.url === '/about')).toHaveLength(1);
      expect(duplicates.map(d => d.url)).toEqual(['/about']);
    } finally {
      await cleanUp(root);
    }
  });
});

describe('glob patterns', () => {
  test('patterns built from path.join output contain no backslashes', () => {
    // On Windows path.join yields backslashes; convertPathToPattern must
    // normalize them or fast-glob matches nothing. Trivially green on posix,
    // load-bearing on the windows-latest CI runner.
    const dir = path.join(os.tmpdir(), 'proj', 'app');
    const pattern = toGlobPattern(dir, '/**/page.{tsx,ts,jsx,js}');
    expect(pattern).not.toContain('\\\\');
    expect(pattern.includes('\\')).toBe(false);
  });
});

describe('router=none fallback', () => {
  test('returns none when no Next.js structure exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telogen-empty-'));
    try {
      const { router, routes } = await detectRoutes(root);
      expect(router).toBe('none');
      expect(routes).toHaveLength(0);
    } finally {
      await cleanUp(root);
    }
  });
});
