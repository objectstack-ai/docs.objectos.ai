import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { languageAlternates, localeUrl, translatedLocales } from '@/lib/seo';
import { contentLocales as privacyLocales } from './[lang]/privacy/page';
import { contentLocales as termsLocales } from './[lang]/terms/page';
import { lastmod } from '@/.route-data/lastmod';

/**
 * `<lastmod>` for a page built from these repo-relative files: the latest
 * commit date among them (#469), from `.route-data/lastmod.ts`. `undefined`
 * when none is known, which is a shallow clone: the field is then omitted
 * rather than filled with the build time, and `check-indexing.mjs` fails CI on
 * the gap. A build-time date would move on every deploy and is the value
 * Google learns to ignore.
 */
function lastModified(files: readonly string[]): string | undefined {
  const dates = files.map((file) => lastmod[file]).filter((date): date is string => Boolean(date));
  if (dates.length === 0) return undefined;
  return dates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/** Every file under one of the legal pages' route directories. */
function staticPageFiles(path: string): string[] {
  const dir = `apps/docs/app/[lang]/${path}/`;
  return Object.keys(lastmod).filter((file) => file.startsWith(dir));
}

export const revalidate = false;

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  // Top-level static pages (paths are locale-independent slugs).
  const staticPaths: Array<{
    path: string;
    priority: number;
    locales: readonly string[];
    files: (lang: string) => readonly string[];
  }> = [
    // The root is deliberately absent. `app/page.tsx` and `app/[lang]/page.tsx`
    // are language-dispatch redirects to that locale's `/docs` — a URL that
    // serves no content — and this file used to submit it in every locale at
    // `priority: 1`, the highest entry in the sitemap (objectos#171, reading
    // 1). www.objectos.ai is the precedent: its root is a `noindex` dispatch
    // page filtered out of its sitemap. `check-locale-surface.mjs` expects the
    // same absence, so a root entry creeping back is an `unexpected-url`.
    //
    // `privacy` and `terms` carry their copy in a `content` record inside their
    // own route component, and render `content[lang] ?? content.en` for every
    // other locale — the same fallback shape the docs pages had. So the locales
    // they can honestly advertise are the keys of those records, and each module
    // exports its own: this file derives the set instead of restating it, and a
    // translation added to either record reaches the sitemap by that edit alone.
    // Read separately because they are separate records — they agree today, and
    // nothing makes them have to.
    { path: 'privacy', priority: 0.3, locales: privacyLocales, files: () => staticPageFiles('privacy') },
    { path: 'terms', priority: 0.3, locales: termsLocales, files: () => staticPageFiles('terms') },
  ];

  // Documentation pages. `source.getPages()` with no argument returns every
  // locale's page set concatenated — the same logical page once per language —
  // so it must be pinned to the default language to enumerate pages rather than
  // page/locale pairs. Slugs are the same across locales, so we reconstruct
  // each locale URL from page.slugs.
  const docPaths = source.getPages(i18n.defaultLanguage).map((page) => ({
    path: ['docs', ...page.slugs].join('/'),
    priority: 0.8,
    locales: translatedLocales(page.slugs),
    // The source file each locale URL renders: the translation where one
    // exists, which is the only kind of locale URL listed here.
    files: (lang: string) => {
      const file = source.getPage(page.slugs, lang)?.path;
      return file ? [`content/docs/${file}`] : [];
    },
  }));

  for (const { path, priority, locales, files } of [...staticPaths, ...docPaths]) {
    // One reciprocal hreflang cluster per logical path, listing only the
    // locales that really have this page, and shared by every entry in it.
    const languages = languageAlternates(path, locales);
    for (const lang of locales) {
      entries.push({
        url: localeUrl(lang, path),
        lastModified: lastModified(files(lang)),
        changeFrequency: 'weekly',
        priority,
        alternates: { languages },
      });
    }
  }

  // Sort by url so the route is a function of the content rather than of the
  // build. `source.getPages()` enumerates in file-read completion order, which
  // varies between builds of an identical tree: two consecutive builds of an
  // untouched tree emitted different bytes for the same 346 entries, so every
  // `deploy-docs.yml` push rewrote the served sitemap whether or not any
  // content changed. Entry order carries no meaning to a crawler; the point is
  // that the bytes stop carrying noise. Compared by code unit rather than with
  // `localeCompare`, whose result depends on the runtime's ICU data and default
  // locale — a machine-dependent comparator would reintroduce exactly the
  // irreproducibility this removes.
  return entries.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}
