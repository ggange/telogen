import { parse, type ParseResult } from '@babel/parser';
import type * as t from '@babel/types';

/**
 * Single parse entry point for every telogen parse site (visitor, annotation
 * scan, and future import resolution) so parser plugins/options can't drift.
 *
 * Returns null on unrecoverable parse errors — errorRecovery already absorbs
 * everything recoverable, so callers treat null as "skip this file".
 */
export function parseSource(src: string): ParseResult<t.File> | null {
  try {
    return parse(src, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true,
    });
  } catch {
    return null;
  }
}
