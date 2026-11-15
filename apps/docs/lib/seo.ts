import type { Metadata } from 'next';
import { i18n } from '@/lib/i18n';
import { SITE_NAME, source } from '@/lib/source';
import { SITE_HOST } from '@/lib/site';

/**
 * Canonical production origin — the origin every absolute URL in this module is
 * built on, and the `metadataBase` every relative metadata URL resolves against.
 *
 * Derived from `SITE_HOST` in `lib/site.ts`, which `middleware.ts` imports for
 * the canonical-domain redirect. That leaf module is now the single definition
 * of the host; this is the `https://` origin built on it, the only form any
 * node-runtime caller needs. Before it existed the host was spelled out twice,
 * here and in `middleware.ts`, with nothing enforcing that the two agreed.
 *
 * `middleware.ts` still cannot import anything from THIS module, and the
 * constraint has not softened — it has moved to `lib/site.ts`. Middleware runs
 * in the edge runtime; this module imports `lib/source.ts`, which drags the
 * fumadocs loader and every compiled MDX module into that bundle. Measured on
 * this tree: 149,745 B of edge JavaScript becomes 17,375,914 B, roughly 116x,
 * with `next build` still exiting 0 — so the cost surfaces at deploy on
 * Cloudflare Workers rather than in CI. `lib/site.ts` is the import that is
 * safe from both runtimes, and it stays safe only while it imports nothing.
 */
export const SITE_URL = `https://${SITE_HOST}`;

/**
 * Absolute URL for a logical (locale-independent) path, hiding the locale
 * prefix for the default language (matches i18n.hideLocale = 'default-locale').
 * `path` has no leading slash, e.g. '' (home) or 'docs/architecture'.
 */
export function localeUrl(lang: string, path: string): string {
  const suffix = path ? `/${path}` : '';
  return lang === i18n.defaultLanguage
    ? `${SITE_URL}${suffix}`
    : `${SITE_URL}/${lang}${suffix}`;
}

/**
 * The locales that have a *real* translated source file for `slugs`.
 *
 * Why this cannot be read off the loader's own per-language APIs: `defineI18n`
 * leaves `fallbackLanguage` unset, which fumadocs resolves to `defaultLanguage`
 * — so every non-English locale's in-memory file system is constructed by
 * copying the English files in and letting real translations overwrite them.
 * The consequences, measured against fumadocs-core 16.8.12 with this repo's
 * content:
 *
 * - `source.getPages(lang)` and `source.getLanguages()` report 79 pages for
 *   *all seven* locales — they cannot tell a translation from a fallback.
 * - `source.getPages()` with no argument returns every locale's page set
 *   concatenated (553), not the default-language set.
 *
 * What does survive the copy is the file identity: `page.path` keeps the
 * ORIGINAL locale-suffixed filename it was authored under. A real Japanese page
 * is `operate/backup.ja.mdx`; an inherited fallback is the English
 * `operate/backup.mdx` under a `ja` lookup. Comparing against the English
 * page's path is therefore the discriminator, and it needs no filesystem access
 * at request time.
 *
 * English is the authored source (AGENTS.md: "English is the single source of
 * truth"), so it is present for every real page — and absent here only for a
 * translation-only file, which AGENTS.md forbids and which this function
 * correctly reports as having no English URL to advertise.
 */
export function translatedLocales(slugs: string[]): string[] {
  const englishPath = source.getPage(slugs, i18n.defaultLanguage)?.path;

  return i18n.languages.filter((lang) => {
    const page = source.getPage(slugs, lang);
    if (!page) return false;
    return lang === i18n.defaultLanguage || page.path !== englishPath;
  });
}

/**
 * hreflang alternates map for a logical path, over the locales that actually
 * have a translation of it, plus an x-default pointing at the English
 * (canonical) URL. Shape matches the `alternates.languages` field of Next.js
 * Metadata and MetadataRoute.Sitemap.
 *
 * `locales` is required on purpose. It used to be implicit — every caller got
 * all seven — and that is the defect this signature removes; a default value
 * would let a future call site silently reproduce it.
 */
export function languageAlternates(
  path: string,
  locales: Iterable<string>,
): Record<string, string> {
  const available = new Set(locales);
  const languages: Record<string, string> = {};
  // Iterate i18n.languages rather than `locales` so the map order is the
  // declared locale order regardless of what the caller passes.
  for (const lang of i18n.languages) {
    if (available.has(lang)) languages[lang] = localeUrl(lang, path);
  }
  languages['x-default'] = localeUrl(i18n.defaultLanguage, path);
  return languages;
}

/**
 * Head metadata for a page that is not in `content/docs/` and keeps its copy in
 * a per-locale record in its own route file: `privacy` and `terms` (#299).
 * Before this, both pages inherited the root layout's head: the title
 * "ObjectOS", the 511-character site description, and no canonical URL.
 *
 * `content` is that record. Its keys are the locales the page is really written
 * in. Any other locale route renders the English entry, so it names the English
 * URL as canonical and is `noindex`, which is the rule docs pages follow through
 * `canonicalLocale`. The hreflang cluster lists only the written locales, the
 * same set `sitemap.ts` advertises for these paths.
 *
 * `openGraph.title` is set explicitly so the share preview reads "Privacy
 * Policy", not the `%s | ObjectOS` tab title. `siteName` already carries the
 * brand, as it does on docs pages.
 */
export function staticPageMetadata(
  path: string,
  lang: string,
  content: Record<string, { title: string; description: string }>,
): Metadata {
  const contentLang = Object.hasOwn(content, lang) ? lang : i18n.defaultLanguage;
  const { title, description } = content[contentLang];
  const canonical = localeUrl(contentLang, path);

  return {
    title,
    description,
    // A locale this page is not written in renders the English copy: noindex,
    // follow, on top of the English canonical (#469). Search Console listed
    // `/xx/terms` and `/xx/privacy` as "Duplicate without user-selected
    // canonical"; the docs pages' fallback rule now covers these two as well.
    ...(contentLang !== lang ? { robots: { index: false, follow: true } } : {}),
    alternates: { canonical, languages: languageAlternates(path, Object.keys(content)) },
    openGraph: { type: 'website', url: canonical, siteName: SITE_NAME, title, description },
  };
}
