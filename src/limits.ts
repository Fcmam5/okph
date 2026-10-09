/** Refuse to read a single markdown file larger than this (DoS guard). */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/** Most files read at once, so a huge bundle can't exhaust file descriptors or memory. */
export const MAX_CONCURRENT_READS = 32;

/** `items.map(fn)` with at most `limit` calls in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
