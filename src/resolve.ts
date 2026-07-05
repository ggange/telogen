import * as fs from 'fs';
import * as path from 'path';
import { getTsconfig, createPathsMatcher, type TsConfigResult } from 'get-tsconfig';
import * as t from '@babel/types';
import { parseSource } from './parse.js';
import { PAGE_EXTENSIONS } from './router.js';
import type { ImportBinding } from './visitor.js';

// Barrel re-export chains are followed at most this deep. One-hop extraction
// means we never recurse into a component's own imports, but a barrel like
// components/index.ts → ./cards/index.ts → ./cards/Pricing.tsx is still
// "one hop" from the page's point of view.
const MAX_BARREL_DEPTH = 3;

export interface Resolver {
  /**
   * Resolves an import binding from `importerFile` to the absolute path of
   * the file that actually declares it (following barrels), or null when
   * the import is bare (node_modules), missing, outside the project, or a
   * namespace import.
   */
  resolve(binding: ImportBinding, importerFile: string): string | null;
}

/**
 * Builds the per-run resolver. tsconfig/jsconfig `paths` aliases go through
 * get-tsconfig (tsconfig.json is JSONC — comments and trailing commas are
 * legal — so plain JSON.parse is not an option; extends-chains come free).
 *
 * A malformed or unreachable `extends` chain makes get-tsconfig throw, so
 * both the config load and the matcher are wrapped: an unusable tsconfig
 * degrades to "no aliases" rather than aborting the run — this is
 * best-effort enrichment, never a failure source.
 */
export function createResolver(projectRoot: string): Resolver {
  let tsconfig: TsConfigResult | null = null;
  try {
    tsconfig = getTsconfig(projectRoot) ?? getTsconfig(projectRoot, 'jsconfig.json');
  } catch {
    tsconfig = null;
  }
  let matcher: ((specifier: string) => string[]) | null = null;
  if (tsconfig) {
    try {
      matcher = createPathsMatcher(tsconfig);
    } catch {
      matcher = null;
    }
  }

  const root = path.resolve(projectRoot);
  // Resolved file path → its parsed AST. A shared barrel imported by many
  // routes is otherwise re-read and re-parsed once per importing route.
  const parseCache = new Map<string, t.File | null>();
  // Fully-resolved binding cache, keyed by importer + specifier + imported
  // name, so a repeatedly-imported component's barrel chain is walked once.
  const resolveCache = new Map<string, string | null>();

  function inProject(file: string): boolean {
    const resolved = path.resolve(file);
    return resolved.startsWith(root + path.sep) && !resolved.includes(`${path.sep}node_modules${path.sep}`);
  }

  function readAst(file: string): t.File | null {
    if (parseCache.has(file)) return parseCache.get(file)!;
    let ast: t.File | null;
    try {
      ast = parseSource(fs.readFileSync(file, 'utf-8'));
    } catch {
      ast = null;
    }
    parseCache.set(file, ast);
    return ast;
  }

  /** Tries file, file+ext, file/index+ext — the Node/bundler lookup order. */
  function resolveToFile(base: string): string | null {
    const ext = path.extname(base);
    // NodeNext/ESM specifiers often write the compiled '.js' extension even
    // though the source is '.ts'/'.tsx' — try the source extensions first.
    const withoutJsExt = /\.(m|c)?js$/.test(ext) ? base.slice(0, -ext.length) : null;

    const candidates = [
      ...(ext ? [base] : []),
      ...(withoutJsExt ? PAGE_EXTENSIONS.map(e => withoutJsExt + e) : []),
      ...(ext ? [] : PAGE_EXTENSIONS.map(e => base + e)),
      ...PAGE_EXTENSIONS.map(e => path.join(base, 'index' + e)),
    ];
    for (const c of candidates) {
      try {
        const st = fs.statSync(c, { throwIfNoEntry: false });
        if (st?.isFile()) return path.resolve(c);
      } catch {
        // unreadable (permissions) — treat as not found
      }
    }
    return null;
  }

  function resolveSpecifier(specifier: string, importerFile: string): string | null {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const file = resolveToFile(path.resolve(path.dirname(importerFile), specifier));
      return file && inProject(file) ? file : null;
    }
    if (matcher) {
      for (const candidate of matcher(specifier)) {
        const file = resolveToFile(candidate);
        if (file && inProject(file)) return file;
      }
    }
    // Bare specifier without a matching alias → node_modules → out of scope
    return null;
  }

  /**
   * If `file` re-exports `exportedName` from elsewhere (a barrel), follows
   * the chain to the declaring file. Returns null when the name can't be
   * traced (missing target, depth cap, cycle) — the caller falls back to
   * the barrel file itself, which is harmless to extract from.
   */
  function followBarrel(file: string, exportedName: string, depth: number, visited: Set<string>): string | null {
    if (depth >= MAX_BARREL_DEPTH || visited.has(file)) return null;
    visited.add(file);

    const ast = readAst(file);
    if (!ast) return null;

    const starSources: string[] = [];
    let target: { source: string; name: string } | null = null;

    for (const node of ast.program.body) {
      if (t.isExportNamedDeclaration(node) && node.source) {
        for (const spec of node.specifiers) {
          if (!t.isExportSpecifier(spec)) continue;
          const exported = t.isIdentifier(spec.exported) ? spec.exported.name : spec.exported.value;
          if (exported !== exportedName) continue;
          // export { X } from './x' / export { default as X } from './x'
          target = { source: node.source.value, name: spec.local.name };
        }
      } else if (t.isExportAllDeclaration(node)) {
        starSources.push(node.source.value);
      } else if (declaresName(node, exportedName)) {
        return file; // declared right here — not a barrel for this name
      }
    }

    if (target) {
      const next = resolveSpecifier(target.source, file);
      return next ? followBarrel(next, target.name, depth + 1, visited) : null;
    }
    // export * — probe each source for the name
    for (const source of starSources) {
      const next = resolveSpecifier(source, file);
      if (!next || visited.has(next)) continue;
      const found = followBarrel(next, exportedName, depth + 1, visited);
      if (found) return found;
    }
    return null;
  }

  return {
    resolve(binding: ImportBinding, importerFile: string): string | null {
      if (binding.imported === '*') return null;
      const cacheKey = `${importerFile}\0${binding.source}\0${binding.imported}`;
      if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey)!;

      const file = resolveSpecifier(binding.source, importerFile);
      let result: string | null;
      if (!file) {
        result = null;
      } else {
        // Default and named imports both may point at a barrel; follow it
        // either way, falling back to the resolved file itself when the
        // chain can't be traced (still extractable — a re-export file with
        // no local content simply yields nothing).
        const name = binding.imported === 'default' ? 'default' : binding.imported;
        result = followBarrel(file, name, 0, new Set()) ?? file;
      }
      resolveCache.set(cacheKey, result);
      return result;
    },
  };
}

/** Does this top-level statement export a declaration named `name`? */
function declaresName(node: t.Statement, name: string): boolean {
  if (t.isExportDefaultDeclaration(node)) return name === 'default';
  if (!t.isExportNamedDeclaration(node) || node.source) return false;
  const decl = node.declaration;
  if (t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) {
    return decl.id?.name === name;
  }
  if (t.isVariableDeclaration(decl)) {
    return decl.declarations.some(d => t.isIdentifier(d.id, { name }));
  }
  // export { X } without source: X is declared somewhere in this file
  return node.specifiers.some(
    s => t.isExportSpecifier(s) &&
      (t.isIdentifier(s.exported) ? s.exported.name : s.exported.value) === name
  );
}
