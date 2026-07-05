import * as fs from 'fs/promises';
import * as path from 'path';
import { parseSource } from './parse.js';
import _traverse from '@babel/traverse';
// @babel/traverse is CommonJS; in ESM bundles the function is on .default
const traverse = ((_traverse as any).default ?? _traverse) as typeof _traverse;
import * as t from '@babel/types';

export interface ExtractedContent {
  /** true if the page/component fetches data dynamically */
  isDynamic: boolean;
  /** extracted text blocks in document order */
  blocks: ContentBlock[];
  /** page title from export const metadata or route path fallback */
  title: string | null;
  /** page description from export const metadata */
  description: string | null;
  /** generateMetadata() was detected — description unavailable statically */
  hasDynamicMetadata: boolean;
  /**
   * babel could not parse the file at all (even with errorRecovery).
   * Distinct from a page that genuinely has no extractable content: this is
   * a telogen limitation the CLI must surface, not bucket as "mostly empty".
   */
  parseFailed: boolean;
  /** import bindings by local name — feeds one-hop component extraction */
  imports: Record<string, ImportBinding>;
}

export interface ImportBinding {
  /** module specifier as written ('./Pricing', '@/components/Pricing') */
  source: string;
  /** exported name being imported; 'default' or '*' for those forms */
  imported: string;
}

export interface ContentBlock {
  type: 'heading' | 'paragraph' | 'listitem' | 'text' | 'component';
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /**
   * Only set when type is 'component': the local import name to resolve
   * for one-hop extraction. cli.ts replaces this placeholder — in place,
   * preserving document order — with the resolved file's own blocks, or
   * drops it silently if the import can't be resolved.
   */
  componentName?: string;
}

// Hooks that are known to be non-data-fetching
const SAFE_HOOKS = new Set([
  'useState', 'useCallback', 'useMemo', 'useRef',
  'useContext', 'useId', 'useReducer', 'useEffect',
  'useLayoutEffect', 'useInsertionEffect', 'useTransition',
  'useDeferredValue', 'useImperativeHandle', 'useDebugValue',
  'useFormStatus', 'useFormState', 'useOptimistic',
]);

// JSX element names that are navigation chrome → content skipped
const NAV_ELEMENTS = new Set(['nav', 'footer', 'aside', 'header']);

// JSX element names → markdown heading level
const HEADING_ELEMENTS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6,
};

// Prop names that signal textual content
const CONTENT_PROPS = new Set([
  'title', 'description', 'body', 'content',
  'text', 'label', 'heading', 'caption', 'summary',
]);

export async function extractContent(filePath: string, skipComponents?: Set<string>): Promise<ExtractedContent> {
  const src = await fs.readFile(filePath, 'utf-8');

  const ast = parseSource(src);
  if (!ast) {
    return { ...empty(), parseFailed: true };
  }

  const result: ExtractedContent = {
    isDynamic: false,
    blocks: [],
    title: null,
    description: null,
    hasDynamicMetadata: false,
    parseFailed: false,
    imports: {},
  };

  const skipSet = skipComponents ?? new Set<string>();
  let navDepth = 0;
  let skipDepth = 0;

  traverse(ast, {
    ImportDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      for (const spec of nodePath.node.specifiers) {
        if (t.isImportDefaultSpecifier(spec)) {
          result.imports[spec.local.name] = { source, imported: 'default' };
        } else if (t.isImportSpecifier(spec)) {
          const imported = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
          result.imports[spec.local.name] = { source, imported };
        } else if (t.isImportNamespaceSpecifier(spec)) {
          result.imports[spec.local.name] = { source, imported: '*' };
        }
      }
    },

    // ── Dynamic detection ────────────────────────────────────────

    // 1. async default export function → primary App Router signal
    ExportDefaultDeclaration(nodePath) {
      const decl = nodePath.node.declaration;
      if (
        (t.isFunctionDeclaration(decl) || t.isArrowFunctionExpression(decl)) &&
        decl.async
      ) {
        result.isDynamic = true;
      }
    },

    // 2. export default async arrow assigned to variable, or generateMetadata export
    ExportNamedDeclaration(nodePath) {
      const decl = nodePath.node.declaration;
      if (t.isFunctionDeclaration(decl) && decl.id?.name === 'generateMetadata') {
        result.hasDynamicMetadata = true;
        return;
      }
      if (t.isVariableDeclaration(decl)) {
        for (const d of decl.declarations) {
          if (
            (t.isArrowFunctionExpression(d.init) || t.isFunctionExpression(d.init)) &&
            d.init.async
          ) {
            result.isDynamic = true;
          }
          if (
            t.isIdentifier(d.id, { name: 'generateMetadata' }) &&
            (t.isArrowFunctionExpression(d.init) || t.isFunctionExpression(d.init))
          ) {
            result.hasDynamicMetadata = true;
          }
        }
      }
    },

    // export const metadata = { title: '...', description: '...' }
    VariableDeclarator(nodePath) {
      if (!t.isIdentifier(nodePath.node.id, { name: 'metadata' })) return;
      if (!t.isExportNamedDeclaration(nodePath.parentPath?.parentPath?.node)) return;
      const init = nodePath.node.init;
      if (!t.isObjectExpression(init)) return;
      for (const prop of init.properties) {
        if (!t.isObjectProperty(prop)) continue;
        const key = t.isIdentifier(prop.key) ? prop.key.name : null;
        const val = t.isStringLiteral(prop.value) ? prop.value.value : null;
        if (!val) continue;
        if (key === 'title') result.title = val;
        if (key === 'description') result.description = val;
      }
    },

    // 3. Unknown use* hook calls
    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      if (t.isIdentifier(callee)) {
        const name = callee.name;
        if (name.startsWith('use') && name.length > 3 && !SAFE_HOOKS.has(name)) {
          result.isDynamic = true;
        }
        // fetch() at any scope
        if (name === 'fetch') {
          result.isDynamic = true;
        }
      }
    },

    // ── JSX content extraction ───────────────────────────────────

    // Track nav-chrome and skip-component nesting at JSXElement level so depth
    // counters are still > 0 when JSXText children are visited. Skipped
    // components are checked first to prevent navDepth corruption if an element
    // is in both sets.
    JSXElement: {
      enter(nodePath) {
        const nameNode = nodePath.node.openingElement.name;
        const name = getElementName(nameNode);
        if (skipSet.has(name)) { skipDepth++; return; }
        if (NAV_ELEMENTS.has(name)) { navDepth++; return; }
        if (
          navDepth === 0 && skipDepth === 0 &&
          // Only plain identifiers (<Pricing/>) are one-hop candidates —
          // member expressions (<Ctx.Provider/>, <motion.div/>) collapse to
          // their object name via getElementName and would resolve the
          // wrong (or an unrelated) import.
          t.isJSXIdentifier(nameNode) && /^[A-Z]/.test(name)
        ) {
          // Placeholder in document order; cli.ts replaces it with the
          // resolved component's own blocks (or drops it if unresolved).
          result.blocks.push({ type: 'component', text: '', componentName: name });
        }
      },
      exit(nodePath) {
        const name = getElementName(nodePath.node.openingElement.name);
        if (skipSet.has(name)) { skipDepth--; return; }
        if (NAV_ELEMENTS.has(name)) navDepth--;
      },
    },

    // Extract content-prop string literals (e.g. title="…") from JSX attributes
    JSXOpeningElement(nodePath) {
      if (navDepth > 0 || skipDepth > 0) return;
      const name = getElementName(nodePath.node.name);
      for (const attr of nodePath.node.attributes) {
        if (!t.isJSXAttribute(attr)) continue;
        const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null;
        if (!attrName || !CONTENT_PROPS.has(attrName)) continue;
        const val = attr.value;
        if (t.isStringLiteral(val) && val.value.trim()) {
          const level = HEADING_ELEMENTS[name];
          result.blocks.push({
            type: level ? 'heading' : 'text',
            level,
            text: val.value.trim(),
          });
        }
      }
    },

    JSXText(nodePath) {
      if (navDepth > 0 || skipDepth > 0) return;
      const text = nodePath.node.value.trim();
      if (!text) return;

      // parentPath is the containing JSXElement (e.g. <h1>, <li>, <p>)
      const parentEl = nodePath.parentPath;
      if (!t.isJSXElement(parentEl?.node)) {
        result.blocks.push({ type: 'text', text });
        return;
      }
      const elName = getElementName((parentEl.node as t.JSXElement).openingElement.name);
      const headingLevel = HEADING_ELEMENTS[elName];

      if (headingLevel) {
        result.blocks.push({ type: 'heading', level: headingLevel, text });
      } else if (elName === 'li') {
        result.blocks.push({ type: 'listitem', text });
      } else {
        result.blocks.push({ type: 'paragraph', text });
      }
    },
  });

  return result;
}

function getElementName(name: t.JSXOpeningElement['name']): string {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) return getElementName(name.object);
  return '';
}

function empty(): ExtractedContent {
  return {
    isDynamic: false,
    blocks: [],
    title: null,
    description: null,
    hasDynamicMetadata: false,
    parseFailed: false,
    imports: {},
  };
}
