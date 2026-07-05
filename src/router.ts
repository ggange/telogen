import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { KnownError } from './errors.js';

export type Router = 'app' | 'pages' | 'none';

export interface Route {
  filePath: string;
  url: string;
  isDynamic: boolean;
}

/** A route file whose URL collided with an earlier file — first one wins. */
export interface DuplicateRoute {
  url: string;
  filePath: string;
}

export interface DetectedRoutes {
  routes: Route[];
  skipped: string[];
  duplicates: DuplicateRoute[];
  router: Router;
  /** absolute path of the detected app/ or pages/ dir; null when router is 'none' */
  routerDir: string | null;
}

export const PAGE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

// Segments matching [param] or [...slug] or [[...slug]]
const DYNAMIC_SEGMENT = /\[.*?\]/;

// Next.js resolution order: root app/ > root pages/ > src/app > src/pages.
// A root app/ or pages/ makes Next.js ignore src/ entirely.
const ROUTER_DIRS: Array<{ dir: string; router: Exclude<Router, 'none'> }> = [
  { dir: 'app', router: 'app' },
  { dir: 'pages', router: 'pages' },
  { dir: 'src/app', router: 'app' },
  { dir: 'src/pages', router: 'pages' },
];

export function detectRouter(projectRoot: string): { router: Router; routerDir: string | null } {
  for (const { dir, router } of ROUTER_DIRS) {
    if (fs.existsSync(path.join(projectRoot, dir))) {
      return { router, routerDir: path.join(projectRoot, dir) };
    }
  }
  return { router: 'none', routerDir: null };
}

/**
 * Guards against running telogen in a directory that has an app/ or pages/
 * dir but isn't a Next.js project (e.g. a monorepo root). Only enforced when
 * a package.json exists — a missing/unreadable one can't prove anything.
 */
export function checkNextDependency(projectRoot: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8');
  } catch {
    return;
  }
  let pkg: any;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return;
  }
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
  if (!('next' in deps)) {
    throw new KnownError(
      "found an app/ or pages/ directory but no 'next' dependency in package.json — " +
        'this does not look like a Next.js project. If this is a monorepo, run telogen ' +
        'from the app directory (e.g. apps/web).'
    );
  }
}

// fast-glob only understands forward slashes; path.join produces backslashes
// on Windows and the pattern then matches nothing.
export function toGlobPattern(dir: string, suffix: string): string {
  return fg.convertPathToPattern(dir) + suffix;
}

export async function detectRoutes(projectRoot: string): Promise<DetectedRoutes> {
  const { router, routerDir } = detectRouter(projectRoot);
  if (router === 'none' || !routerDir) {
    return { routes: [], skipped: [], duplicates: [], router: 'none', routerDir: null };
  }

  checkNextDependency(projectRoot);

  return router === 'app'
    ? detectAppRouterRoutes(routerDir)
    : detectPagesRouterRoutes(routerDir);
}

// Markdown counterparts of the code-page globs below — kept adjacent so the
// route-file conventions live in exactly one module.
const APP_MD_SUFFIX = '/**/page.{mdx,md}';
const PAGES_MD_SUFFIX = '/**/*.{mdx,md}';

// Non-route markdown that commonly lives inside pages/ trees.
const NON_ROUTE_MD = /^(readme|changelog|contributing|license)$/i;

/**
 * Counts .md/.mdx files that look like route pages, for the "no static
 * routes found" hint — all-markdown sites (MDX blogs) should hear "markdown
 * routes aren't supported yet", not a bare error that reads like a bug.
 */
export async function countMarkdownPages(routerDir: string, router: Router): Promise<number> {
  if (router === 'none') return 0;
  const suffix = router === 'app' ? APP_MD_SUFFIX : PAGES_MD_SUFFIX;
  const files = await fg(toGlobPattern(routerDir, suffix), { onlyFiles: true });
  if (router === 'app') return files.length;
  return files.filter(f => {
    const { name } = path.parse(f);
    return !NON_ROUTE_MD.test(name) && !name.startsWith('_');
  }).length;
}

/** Keeps the first file per URL; later collisions go to `duplicates`. */
function dedupeByUrl(routes: Route[]): { routes: Route[]; duplicates: DuplicateRoute[] } {
  const seen = new Map<string, Route>();
  const duplicates: DuplicateRoute[] = [];
  for (const route of routes) {
    if (seen.has(route.url)) {
      duplicates.push({ url: route.url, filePath: route.filePath });
    } else {
      seen.set(route.url, route);
    }
  }
  return { routes: [...seen.values()], duplicates };
}

async function detectAppRouterRoutes(appDir: string): Promise<DetectedRoutes> {
  const pattern = toGlobPattern(appDir, '/**/page.{tsx,ts,jsx,js}');
  const files = (await fg(pattern, { onlyFiles: true })).sort();

  const routes: Route[] = [];
  const skipped: string[] = [];

  for (const filePath of files) {
    const relative = path.relative(appDir, filePath);
    const segments = path.dirname(relative).split(path.sep);

    const urlSegments: string[] = [];
    let isDynamic = false;

    for (const seg of segments) {
      if (seg === '.') continue;
      // Route groups like (marketing) → drop from URL
      if (seg.startsWith('(') && seg.endsWith(')')) continue;
      // Parallel route slots like @slot → skip entire route
      if (seg.startsWith('@')) { isDynamic = true; break; }
      // Dynamic segments [param] [...slug] [[...slug]]
      if (DYNAMIC_SEGMENT.test(seg)) { isDynamic = true; break; }
      urlSegments.push(seg);
    }

    const url = '/' + urlSegments.join('/');

    if (isDynamic) {
      skipped.push(filePath);
    } else {
      routes.push({ filePath, url: url === '/' ? '/' : url, isDynamic: false });
    }
  }

  const deduped = dedupeByUrl(routes);
  return { ...deduped, skipped, router: 'app', routerDir: appDir };
}

async function detectPagesRouterRoutes(pagesDir: string): Promise<DetectedRoutes> {
  const extensions = PAGE_EXTENSIONS.map(e => e.slice(1)).join(',');
  const pattern = toGlobPattern(pagesDir, `/**/*.{${extensions}}`);
  const files = (await fg(pattern, { onlyFiles: true })).sort();

  const routes: Route[] = [];
  const skipped: string[] = [];

  // Excluded filenames (without extension)
  const EXCLUDED = new Set(['_app', '_document', '_error']);

  for (const filePath of files) {
    const relative = path.relative(pagesDir, filePath);
    const { dir, name } = path.parse(relative);

    // Skip _app, _document, _error, and api/ directory
    if (EXCLUDED.has(name)) continue;
    if (dir === 'api' || dir.startsWith('api/') || dir.startsWith('api\\')) continue;

    // Dynamic segments
    if (DYNAMIC_SEGMENT.test(relative)) {
      skipped.push(filePath);
      continue;
    }

    const segments = dir ? dir.split(path.sep) : [];
    const urlParts = [...segments, name === 'index' ? '' : name].filter(Boolean);
    const url = '/' + urlParts.join('/');

    routes.push({ filePath, url, isDynamic: false });
  }

  const deduped = dedupeByUrl(routes);
  return { ...deduped, skipped, router: 'pages', routerDir: pagesDir };
}
