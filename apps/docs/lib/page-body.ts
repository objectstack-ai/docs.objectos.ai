import { docs } from 'fumadocs-mdx:collections/server';
import type { InferPageType } from 'fumadocs-core/source';
import type { source } from '@/lib/source';

/**
 * Each page's entry in fumadocs-mdx's full collection, by file path under
 * `content/docs`.
 *
 * This is the one module that imports the full collection, with its lazy
 * import of every compiled page (#395). Import it from the page route only:
 * anything a route handler imports puts every compiled page in the route
 * handlers' module graph, a second copy of them in the Worker upload, which is
 * what `lib/source.ts` is built to avoid.
 */
const entries = new Map(docs.docs.map((entry) => [entry.info.path, entry]));

/** `page`'s compiled body, toc and exports, as `page.data.load()` returns them on the full collection. */
export async function loadPageBody(page: InferPageType<typeof source>) {
  const entry = entries.get(page.data.info.path);
  if (!entry) throw new Error(`${page.data.info.path}: not in the fumadocs-mdx collection`);
  return entry.load();
}
