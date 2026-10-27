import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import path from 'node:path';
import { EDITIONS, isEdition } from './lib/editions';
import { i18n } from './lib/i18n';

/**
 * A translation's file name: `foo.zh-Hans.mdx`, `foo.ja.mdx`, … — every
 * language `lib/i18n.ts` declares except the default, which has no suffix.
 */
const TRANSLATION_FILE = new RegExp(
  `\\.(?:${i18n.languages.filter((lang) => lang !== i18n.defaultLanguage).join('|')})\\.mdx$`,
);

/**
 * `editions:` — which ObjectOS editions a page is true for (`lib/editions.ts`).
 *
 * Built from `pageSchema.shape.title` for the reason `seoTitle` is below: `zod`
 * is not resolvable from this workspace. The `transform` only narrows the type
 * to the `Edition` union; the value is unchanged.
 */
const editionsSchema = pageSchema.shape.title
  .refine(isEdition, { message: `must be one of: ${EDITIONS.join(', ')}` })
  .transform((value) => value as (typeof EDITIONS)[number])
  .array()
  .min(1)
  .refine((list) => new Set(list).size === list.length, { message: 'lists an edition twice' });

const docsPageSchema = pageSchema.extend({
  /**
   * Optional SEO title: what the `<title>` tag should say, when that is not
   * what the H1 and the sidebar should say.
   *
   * `title` stays the short navigational noun ("Views") because it is what
   * renders in the sidebar, the breadcrumb and the H1. That same noun makes
   * a title tag carrying no query term at all, so a page may declare a
   * longer, keyword-bearing `seoTitle` here and `generateMetadata` prefers
   * it. Declaring nothing is the norm: the fallback is `title`, so a page
   * that says nothing renders exactly what it rendered before.
   *
   * Extending is not optional bookkeeping — the base `pageSchema` is a Zod
   * object with the default "strip" behaviour, so a `seoTitle:` in
   * frontmatter that is not declared here is silently dropped at parse time
   * rather than reaching `page.data`.
   *
   * Built from `pageSchema.shape.title` rather than a fresh `z.string()`
   * because `zod` is a *peer* dependency of fumadocs-core and is not
   * resolvable from this workspace — `require.resolve('zod')` fails in
   * `apps/docs`. Reusing the shape keeps the field's type identical to
   * `title`'s without adding a dependency to declare it.
   *
   * `.trim().min(1)` is deliberate: an empty or whitespace-only `seoTitle`
   * is an authoring mistake, and rejecting it at build time is what lets
   * the consumer use a plain `??` fallback instead of a tolerant one that
   * would quietly paper over the empty string.
   */
  seoTitle: pageSchema.shape.title.trim().min(1).optional(),
  /**
   * Optional in the shape, required of every English page by the refinement
   * in `defineDocs` below. A translation may omit it: the edition set is a
   * fact about the page, not about its language, so the badge row and the
   * sidebar mark read it from the English page on every locale route, and a
   * translation that copied the key could only drift from it.
   */
  editions: editionsSchema.optional(),
});

export const docs = defineDocs({
  dir: path.resolve(process.cwd(), '../../content/docs'),
  docs: {
    /**
     * Load each page's compiled body on demand instead of statically importing
     * all of them into every server entrypoint.
     *
     * Without this, `fumadocs-mdx:collections/server` eagerly imports all 397
     * `.mdx` files, so every route that touches `source` — the docs page, but
     * also `/llms.txt`, `/llms-full.txt`, `/llms.mdx/*`, `/og/*`, `/api/search`
     * and `/sitemap.xml` — pulls the entire corpus into its own chunk, and the
     * bundler then inlined the whole set five times over into one Worker.
     * 2.50 MiB of authored MDX became a ~100 MiB `handler.mjs`, and Cloudflare
     * rejects any Worker over 64 MiB uncompressed (`code: 10027`).
     *
     * The multiplier, not the corpus, is the problem: one probe sentence from a
     * single English page appeared 15 times in the bundle before this flag and 6
     * times after.
     *
     * The cost is that `page.data.body` and `page.data.toc` become
     * `page.data.load()`. Frontmatter stays eager, so `title`, `description`,
     * `seoTitle` and `full` are unaffected, and `getText('processed')` — what
     * the llms.txt routes call — is still a method on the entry.
     *
     * ## This flag did NOT break the site on 2026-09-04, and the record matters
     *
     * It shipped once (PR #263), the upload was accepted, the site 404'd, and it
     * was reverted (PR #268) on the reasonable assumption that the new thing was
     * the cause. It was not. Every page route on `main` was already unservable
     * for an unrelated reason — see the long comment in `open-next.config.ts` —
     * and had been since 2026-08-26, invisibly, because no deploy had been
     * accepted since 2026-08-25 to publish it. Measured on this tree: base
     * `main` with this flag ABSENT 404s on `/`, `/en/docs`, `/docs/quickstart`
     * and `/docs/build/interface/views` under real workerd, identically.
     */
    async: true,
    /**
     * A function of the file, so the one rule that depends on which file is
     * being read can be stated: an English page without `editions:` fails
     * here, in `fumadocs-mdx`, which `type-check` and `build` both run. A
     * translation (`foo.ja.mdx`) is held to the same shape but may leave the
     * key out — see `editions` above.
     */
    schema: ({ path: file }) =>
      TRANSLATION_FILE.test(file)
        ? docsPageSchema
        : docsPageSchema.refine((page) => page.editions !== undefined, {
            message: `an English page must declare \`editions:\` — a list of ${EDITIONS.join(', ')} (lib/editions.ts)`,
            path: ['editions'],
          }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      /**
       * Code comments, recoloured to clear 4.5:1 (#301).
       *
       * fumadocs' default code themes are `github-light` and `github-dark`,
       * and both colour comments #6a737d — and nothing else: that is the only
       * scope it is assigned to in either theme. On fumadocs' code-block
       * background it measured 3.65:1 in dark mode (#191919) and 4.26:1 in
       * light mode (#f1f1f1). The replacements are GitHub's own accessible
       * muted greys: #8b949e (5.72:1 on #191919) and #57606a (5.66:1 on
       * #f1f1f1).
       *
       * Scoped by theme name, so each theme's comment colour is replaced on
       * its own. fumadocs' defaults are spread in first — the two themes, the
       * notation transformers, the meta parser — so this adds one option and
       * replaces nothing.
       */
      ...rehypeCodeDefaultOptions,
      colorReplacements: {
        'github-dark': { '#6a737d': '#8b949e' },
        'github-light': { '#6a737d': '#57606a' },
      },
    },
  },
});
