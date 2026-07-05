/**
 * Maps `items` through `fn` with at most `limit` promises in flight — a
 * rolling pool, not fixed batches, so one slow item never stalls the rest.
 * Shared bound for every file-reading/parsing path (route extraction,
 * annotation scan): an unbounded Promise.all over a monorepo-sized list
 * exhausts file descriptors and memory.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export const FILE_CONCURRENCY = 32;
