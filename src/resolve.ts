import * as fs from 'fs';
import * as path from 'path';
import { getTsconfig, createPathsMatcher, type TsConfigResult } from 'get-tsconfig';
import * as t from '@babel/types';
import { parseSource } from './parse.js';
import type { ImportBinding } from './visitor.js';

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

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
 */
export function createResolver(projectRoot: string): Resolver {
  const tsconfig: TsConfigResult | null =
    getTsconfig(projectRoot) ?? getTsconfig(projectRoot, 'jsconfig.json');
  let matcher: ((specifier: string) => string[]) | null = null;
  if (tsconfig) {
    try {
      matcher = createPathsMatcher(tsconfig);
    } catch {
      matcher = null;
    }
  }

  const root = path.resolve(projectRoot);

  function inProject(file: string): boolean {
    const resolved = path.resolve(file);
    return resolved.startsWith(root + path.sep) && !resolved.includes(`${path.sep}node_modules${path.sep}`);
  }

  /** Tries file, file+ext, file/index+ext — the Node/bundler lookup order. */
  function resolveToFile(base: string): string | null {
    const candidates = [
      ...(path.extname(base) ? [base] : []),
      ...EXTENSIONS.map(e => base + e),
      ...EXTENSIONS.map(e => path.join(base, 'index' + e)),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.resolve(c);
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
   * the chain to the declaring file. A file that declares the name itself
   * (or that we can't trace) is returned as-is — extracting from a barrel
   * that yields nothing is harmless.
   */
  function followBarrel(file: string, exportedName: string, depth: number, visited: Set<string>): string {
    if (depth >= MAX_BARREL_DEPTH || visited.has(file)) return file;
    visited.add(file);

    let src: string;
    try {
      src = fs.readFileSync(file, 'utf-8');
    } catch {
      return file;
    }
    const ast = parseSource(src);
    if (!ast) return file;

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
      return next ? followBarrel(next, target.name, depth + 1, visited) : file;
    }
    // export * — probe each source for the name
    for (const source of starSources) {
      const next = resolveSpecifier(source, file);
      if (!next || visited.has(next)) continue;
      const found = followBarrel(next, exportedName, depth + 1, visited);
      if (found !== next || declaresNameInFile(found, exportedName)) return found;
    }
    return file;
  }

  function declaresNameInFile(file: string, name: string): boolean {
    let src: string;
    try {
      src = fs.readFileSync(file, 'utf-8');
    } catch {
      return false;
    }
    const ast = parseSource(src);
    if (!ast) return false;
    return ast.program.body.some(node => declaresName(node, name));
  }

  return {
    resolve(binding: ImportBinding, importerFile: string): string | null {
      if (binding.imported === '*') return null;
      const file = resolveSpecifier(binding.source, importerFile);
      if (!file) return null;
      if (binding.imported === 'default') return file;
      return followBarrel(file, binding.imported, 0, new Set());
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
