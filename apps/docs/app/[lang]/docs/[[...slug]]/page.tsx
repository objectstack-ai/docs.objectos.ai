import { SITE_NAME, getLLMText, getPageImage, source } from '@/lib/source';
import type { Metadata } from 'next';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { Callout } from 'fumadocs-ui/components/callout';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { File, Folder, Files } from 'fumadocs-ui/components/files';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { LLMCopyButton, type MarkdownSource, ViewOptions } from '@/components/ai/page-actions';
import { gitConfig } from '@/lib/layout.shared';
import { SITE_URL, languageAlternates, localeUrl, translatedLocales } from '@/lib/seo';
import { i18n } from '@/lib/i18n';
import { uiText } from '@/lib/ui-text';
import type { InferPageType } from 'fumadocs-core/source';
import type { TOCItemType } from 'fumadocs-core/toc';
import { EditionBadges } from '@/components/editions';
import { EDITIONS_PAGE_SLUGS } from '@/lib/editions';
import { loadPageBody } from '@/lib/page-body';

/**
 * The page type the loader actually produces, frontmatter schema included.
 *
 * Deliberately inferred rather than hand-written: a structural annotation like
 * `{ data: { seoTitle?: string } }` would type-check whether or not the schema
 * extension in `source.config.ts` ever reached the generated collection types,
 * which is exactly the thing that has to be true for `seoTitle` to arrive.
 * Inferring it means `tsc` fails if the field is not really there.
 */
type DocsPageData = InferPageType<typeof source>;

/** Logical, locale-independent path of a docs page, e.g. `docs/build/interface/views`. */
function docsPath(slugs: string[]): string {
  return ['docs', ...slugs].join('/');
}

/**
 * Site-relative URL of a page's Markdown form, and deliberately the
 * locale-independent one — `/docs/architecture.mdx` on every locale route, not
 * `/zh-Hans/docs/architecture.mdx`.
 *
 * Built from `page.slugs` rather than from `page.url` because `page.url`
 * carries whatever locale prefix the route was resolved under, and the `.mdx`
 * surface has no prefixed form to point at. `next.config.mjs` rewrites exactly
 * one shape, `/docs/:path*.mdx` to `/llms.mdx/docs/:path*`; a prefixed URL
 * matches no rewrite, falls through to this route with `architecture.mdx` as a
 * slug, and is answered by `/_not-found` under `dynamicParams = false`. That was
 * six of seven locales on all 79 pages — roughly 400 rendered links, every one
 * of them 404, and only ever on the locales an English-speaking maintainer does
 * not click.
 *
 * The prefix is dropped rather than the rewrite widened, and that is a
 * conformance decision rather than the cheaper of two repairs. The
 * machine-facing markdown surface here is English-only by AGENTS.md rule 1, the
 * same pin `llms.txt` and `llms-full.txt` carry, and `check-locale-surface.mjs`
 * fails the build if either drifts off it. `/llms.mdx/docs/[[...slug]]` is
 * English-only by construction too — its handler calls `source.getPage(slug)`
 * with no language, so the default language is the only thing it can serve, and
 * it prerenders 79 bodies rather than 553. Adding a `/:lang/docs/:path*.mdx`
 * rewrite would therefore not deliver translated markdown; it would either
 * serve English from a URL claiming a locale, or turn `/llms.mdx` into a
 * locale-aware surface and put it out of step with the two `llms` files beside
 * it. Reversing that policy is a decision about the whole markdown surface, not
 * a 404 fix.
 *
 * Byte-identical to the previous expression on the default locale, where
 * `page.url` has no prefix to carry: the English link target does not move.
 */
function markdownUrl(page: DocsPageData): string {
  return `/${docsPath(page.slugs)}.mdx`;
}

/**
 * The string the `<title>` tag should carry. A page may declare `seoTitle` when
 * its H1 noun is too short to match anything a reader would search for; most
 * pages declare nothing and fall back to `title`, rendering byte-identically to
 * before this field existed. `??` is safe rather than lax because the schema
 * rejects an empty or whitespace-only `seoTitle` at build time.
 */
function seoTitleOf(page: DocsPageData): string {
  return page.data.seoTitle ?? page.data.title;
}

/**
 * Absolute URL of the generated 1200x630 share card for a page, in the language
 * the card should be rendered in.
 *
 * `lang` here is the *content* locale, not `params.lang` — the same resolution
 * `canonical` and `og:url` already use. On a route whose locale has no
 * translation the body being served is the English page, so the card that
 * depicts it is the English card, and asking for a `ja` card would produce a
 * second URL rendering identical English pixels. That is worse than wasteful:
 * `og:image` sits beside an `og:url` naming the English page, so a card URL
 * claiming to be the Japanese one would contradict the object it illustrates.
 *
 * This also makes the fallback rule and the cost ceiling the same rule. Cards
 * are enumerated over `translatedLocales`, so resolving the URL through
 * `canonicalLocale` is what keeps an English-only page pointing at the one card
 * that exists for it rather than at six that were never generated.
 */
function shareCardUrl(page: DocsPageData, lang: string): string {
  return `${SITE_URL}${getPageImage(page, lang).url}`;
}

/**
 * The locale a page's content actually lives in, as seen from `lang`.
 *
 * `lang` when that locale really has a translation of `slugs`; the default
 * language otherwise, because fumadocs serves the English body under every
 * unprefixed locale route (`fallbackLanguage` resolves to `defaultLanguage` —
 * see `translatedLocales`). `/ja/docs/operate/backup` has no Japanese source,
 * so the content sitting at that URL is the English page and every field that
 * names where this content lives has to say so.
 *
 * `translated` is passed in rather than looked up so a caller that already
 * needs the list — `generateMetadata` builds the hreflang cluster from it —
 * computes it once.
 */
function canonicalLocale(lang: string, translated: readonly string[]): string {
  return translated.includes(lang) ? lang : i18n.defaultLanguage;
}

/**
 * Absolute URL of the page at `slugs` as seen from `lang`: its own locale URL
 * when it is really translated there, the English URL when it is a fallback.
 *
 * Resolved per page, not once per request, because translation status is a
 * property of the individual page. A translated page can sit under an
 * untranslated ancestor and vice versa, so the breadcrumb trail has to ask
 * about each crumb separately.
 */
function canonicalUrl(lang: string, slugs: string[]): string {
  return localeUrl(canonicalLocale(lang, translatedLocales(slugs)), docsPath(slugs));
}

/**
 * The table of contents of a page whose headings are in `contentLang`, ready to
 * render inside a document declaring a different language.
 *
 * The TOC is the page's own headings, so on a fallback they are English — but
 * Fumadocs renders them in its own container next to the localized "On this
 * page" label, outside the element that carries the content's `lang`. Marking
 * the container would mislabel that heading (and the "no headings" notice), so
 * each item's title is wrapped instead: the list, the mobile popover and the
 * popover trigger all render `title`, so this one wrap reaches all three.
 */
function tocInLanguage(toc: TOCItemType[], contentLang: string): TOCItemType[] {
  return toc.map((item) => ({ ...item, title: <span lang={contentLang}>{item.title}</span> }));
}

/**
 * Open Graph wants `language_TERRITORY`. Our locale tags carry no territory
 * (`en`, `zh-Hans`, `ja`, …), so the honest mapping is the tag with the
 * separator swapped — the same one the marketing site emits, which keeps
 * og:locale consistent across the two properties.
 */
function ogLocale(lang: string): string {
  return lang.replace('-', '_');
}

/**
 * Serialize a JSON-LD node for injection into a `<script>` tag.
 *
 * Every `<` is rewritten to the six-character JSON escape backslash-u-0-0-3-c,
 * which parses back to the same character but cannot be read as markup. Without
 * it a closing script tag inside a title or description would end the block
 * early and drop the rest of the JSON into the document as markup.
 */
function jsonLdHtml(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * `BreadcrumbList` over the page's own ancestry: the docs root, then every
 * prefix of its slugs *that has a page of its own*. Each crumb is named by the
 * page sitting at that path, so the name matches what a reader sees in the
 * sidebar.
 *
 * A prefix with no page is not emitted at all. `content/docs/meta.json`
 * declares `reference` and `resources` as sidebar folders and neither has an
 * `index.mdx`, so a trail through them was advertising a path that 404s in
 * every locale. `item` is defined as the URL of the page the crumb names, so a
 * crumb whose URL resolves to nothing is not a weaker claim than a good one but
 * a false one — and a consumer may drop the whole trail rather than the single
 * entry. Keeping the step and omitting only its `item` is schema.org-legal, but
 * it trades a false URL for a `ListItem` missing a field that is expected on
 * every entry except the last, so the crumb goes rather than the URL.
 *
 * Positions are assigned after the drop, so a trail that lost a middle crumb is
 * numbered 1..n with no hole. `position` is an ordinal within this list — 1
 * signifies the beginning of the trail — not an index into the folder
 * hierarchy: a gap would assert an element the consumer was not sent, which is
 * the same false claim moved into a different field.
 *
 * The check costs nothing at request time. `source.getPage()` is the in-memory
 * resolver this function already called to name each crumb; it is now called
 * once per crumb and answers both questions. Because fumadocs seeds every
 * locale's file system from English and lets real translations overwrite it
 * (see `translatedLocales`), it resolves whenever *any* locale has the page —
 * so a crumb is dropped only where the path has no page anywhere, and the
 * surviving trail is identical across the seven locales. Give those two folders
 * an `index.mdx` later and their crumbs reappear with no change here.
 *
 * Existence and translation are separate questions, asked in that order. A
 * crumb that survives is then pointed at its own canonical URL crumb by crumb:
 * a breadcrumb entry is a claim about where *that* page lives, so it names this
 * locale's URL when the locale really has that page and the English URL when it
 * would only be serving the English fallback.
 */
function breadcrumbListLd(lang: string, slugs: string[]): Record<string, unknown> {
  const trails = [[] as string[], ...slugs.map((_, i) => slugs.slice(0, i + 1))];
  const crumbs = trails.flatMap((trail) => {
    const page = source.getPage(trail, lang);
    return page ? [{ trail, page }] : [];
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(({ trail, page }, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: page.data.title,
      item: canonicalUrl(lang, trail),
    })),
  };
}

/**
 * `TechArticle` for a docs page.
 *
 * Deliberately carries no `publisher`/`author`: those are entity-level claims
 * about the organization, and which entity this site speaks for is the open
 * question on the positioning card. A TechArticle without them is valid; a
 * TechArticle asserting the wrong entity would have to be retracted.
 */
function techArticleLd(args: {
  lang: string;
  title: string;
  description?: string;
  url: string;
  image: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: args.title,
    ...(args.description ? { description: args.description } : {}),
    url: args.url,
    image: args.image,
    inLanguage: args.lang,
    isAccessibleForFree: true,
  };
}

export default async function Page(props: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug ?? [], params.lang);
  if (!page) notFound();

  // `async: true` on the docs collection makes the compiled body and toc load
  // on demand instead of being statically imported, so they are awaited here.
  // Frontmatter (`title`, `description`, `full`) stays eager.
  //
  // Under `dynamicParams = false` this await runs at BUILD time, in Node, on
  // every one of the 1139 prerendered paths — the Worker serves the prerendered
  // result out of the static-assets incremental cache and does not re-render.
  //
  // Loaded through `lib/page-body.ts`, not `page.data.load()`: `source` is
  // built without the compiled bodies so the route handlers do not bundle a
  // second copy of every page (#395).
  const loaded = await loadPageBody(page);
  const MDX = loaded.body;

  // Resolved once and handed to both controls (through `copySource` and
  // `assistantReadUrl` below), so they cannot drift apart and
  // so a third control added below inherits the locale-independent URL instead
  // of re-deriving a `.mdx` URL from `page.url`. That re-derivation is the whole defect:
  // it is invisible in the rendered markup — `markdownUrl` reaches the browser
  // only as a client-component prop in the RSC payload — so a broken value
  // produces no build error, no console warning and no failing gate, and shows
  // up only when a reader clicks.
  const pageMarkdownUrl = markdownUrl(page);

  // The locale this page's content really lives in — `params.lang` for a real
  // translation, English for a fumadocs fallback. `url` and `inLanguage` are
  // properties of one `TechArticle` node, so they resolve together: a node that
  // named the English URL while claiming `inLanguage: "ja"` would assert that
  // the English page is Japanese.
  const contentLang = canonicalLocale(params.lang, translatedLocales(page.slugs));

  // A fallback is a locale route serving the English page because that locale
  // has no source file for it. Exact, not inferred: fumadocs builds each
  // locale's file system by copying the English file OBJECTS in and letting
  // real translations overwrite them, so a fallback page carries the English
  // file's own `path` (`operate/backup.mdx`, never `operate/backup.ja.mdx`) —
  // the discriminator `translatedLocales` reads. `page.locale` cannot answer
  // this: it is the locale the page was looked up under, on both kinds.
  const isFallback = contentLang !== params.lang;

  // What the content elements declare. Only a fallback needs anything: a
  // translated or English page is already in the document's language, which
  // `<html lang>` declares for the chrome and the content alike. `<html lang>`
  // itself stays the route locale (#181) — the sidebar, search and buttons
  // around this page ARE in that language.
  const contentLangAttr = isFallback ? contentLang : undefined;
  const text = uiText(params.lang);

  // Copy Markdown copies the page on screen. For an English page and for a
  // fallback that is the English page, served at `pageMarkdownUrl`. For a real
  // translation it is this locale's text, which the `.mdx` surface does not
  // serve (English-only, see `markdownUrl`), so it is rendered into the page
  // instead: `getLLMText` builds it exactly as `/llms.mdx/docs/...` builds the
  // English body, from the module `loadPageBody` above already loaded.
  const copySource: MarkdownSource =
    contentLang === i18n.defaultLanguage
      ? { url: pageMarkdownUrl }
      : { text: await getLLMText(page, loaded._exports._markdown as string) };

  // "Open in ChatGPT / Claude" follows the same rule (#305): the assistant is
  // sent to the page on screen. The English Markdown when that is the English
  // page; the translated page itself when it is a translation — `page.url` is
  // this locale's URL, the one being read — because its Markdown has no URL and
  // is too long to inline into the prompt (`ViewOptions` has the measurement).
  const assistantReadUrl = contentLang === i18n.defaultLanguage ? pageMarkdownUrl : page.url;

  // The editions this page is true for, read from the English page on every
  // route: the set is a fact about the page, not its language, and a
  // translation is not required to carry the key (`source.config.ts`). The
  // badges link to the comparison page as this locale's reader would reach it.
  const editions = source.getPage(page.slugs, i18n.defaultLanguage)?.data.editions;
  const editionsUrl = source.getPage(EDITIONS_PAGE_SLUGS, params.lang)?.url;

  // Structured data. Emitted from the page rather than from `generateMetadata`,
  // which can only produce meta/link elements — the Metadata API has no channel
  // for a JSON-LD script. Google reads `application/ld+json` from either the
  // head or the body, so rendering it here is a supported placement, not a
  // workaround.
  const jsonLd = [
    breadcrumbListLd(params.lang, page.slugs),
    techArticleLd({
      lang: contentLang,
      title: seoTitleOf(page),
      description: page.data.description,
      url: localeUrl(contentLang, docsPath(page.slugs)),
      image: shareCardUrl(page, contentLang),
    }),
  ];

  return (
    <>
      {jsonLd.map((item) => (
        <script
          key={item['@type'] as string}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(item) }}
        />
      ))}
      {/*
        `role="main"`: the page's main landmark (#308). Fumadocs 16.8.12
        renders none anywhere in the docs layout, so a screen reader's "main"
        jump went nowhere. DocsPage passes its other props to the `<article>`
        it renders (breadcrumb, title, body, footer; not the sidebar or the
        table of contents), and ARIA in HTML allows `main` on an article.
        Upgrade note: fumadocs-ui 16.16.2 wraps that article in a `<main>` of
        its own. On a version that does, delete this prop, or the page has two
        main landmarks (`patches/fumadocs-ui@16.8.12.patch` says the same).
      */}
      <DocsPage
        role="main"
        toc={isFallback ? tocInLanguage(loaded.toc, contentLang) : loaded.toc}
        full={page.data.full}
      >
        {isFallback && (
          // In the route locale, outside every element marked `lang` below:
          // the notice is addressed to this locale's reader, and it comes
          // before the English it describes so it is read first.
          <Callout type="info" role="note" className="my-0" data-untranslated-notice="">
            {text.notTranslated}
          </Callout>
        )}
        <DocsTitle lang={contentLangAttr}>{page.data.title}</DocsTitle>
        <DocsDescription lang={contentLangAttr} className="mb-0">
          {page.data.description}
        </DocsDescription>
        {editions && editionsUrl && (
          <EditionBadges editions={editions} label={text.editionsLabel} href={editionsUrl} />
        )}
        <div className="flex flex-row gap-2 items-center border-b pb-6">
          <LLMCopyButton markdown={copySource} label={text.copyMarkdown} />
          <ViewOptions
            readUrl={assistantReadUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
            labels={{
              open: text.openMenu,
              openInGitHub: text.openInGitHub,
              openInChatGPT: text.openInChatGPT,
              openInClaude: text.openInClaude,
              openInLLMPrompt: text.pageActionsOpenInLLMPrompt,
            }}
          />
        </div>
        <DocsBody lang={contentLangAttr}>
          <MDX
            components={getMDXComponents({
              a: createRelativeLink(source, page),
              Step,
              Steps,
              File,
              Folder,
              Files,
              FileTree: Files,
              Tab,
              Tabs,
            })}
          />
        </DocsBody>
      </DocsPage>
    </>
  );
}

/**
 * Only the pages `generateStaticParams` enumerates are servable; every other
 * slug is answered by the prerendered `/_not-found` route.
 *
 * This is what makes a docs 404 render at all. `notFound()` raised while a
 * request is being rendered *dynamically* escapes both the RSC and the SSR
 * render; Next catches it in the SSR error handler and builds the response from
 * `getErrorRSCPayload`, which seeds the document as an empty error shell and
 * ships the real 404 tree only in the RSC payload, for the client to render
 * after hydration. No `not-found` boundary participates in that server render —
 * not at the root, not in the locale segment, not beside the page. Measured at
 * every one of those placements, and a boundary added in the locale segment is
 * byte-for-byte a no-op, which is why this fix is a routing flag and not a new
 * `not-found.tsx`.
 *
 * So the 404 has to be reached by the path that already works. An unmatched URL
 * is served by `/_not-found`, an ordinary prerendered page render, which is why
 * `/no-such-page` has always rendered its body server-side while
 * `/docs/no-such-page` served a blank one. `dynamicParams = false` routes an
 * unknown docs slug there too, instead of rendering this page so it can throw.
 * Not a workaround for the boundary: it removes the dynamic render that the
 * boundary cannot survive.
 *
 * The behavioural cost, stated plainly: a page that is not in the enumeration
 * needs a rebuild to appear, rather than rendering on demand. Every page here
 * comes from local MDX that `generateStaticParams` already enumerates, so that
 * is true in practice today — this makes it explicit rather than introducing
 * it. `app/og/docs/[...slug]/route.tsx` sets the same flag for the same reason.
 *
 * `notFound()` below stays: it is still what answers a slug that is enumerated
 * but unresolvable, and it is the type-level narrowing for `page`.
 */
export const dynamicParams = false;

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string; slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug ?? [], params.lang);
  if (!page) notFound();

  // Logical path is locale-independent; reconstruct each locale URL from slugs.
  const path = docsPath(page.slugs);
  const translated = translatedLocales(page.slugs);
  // Where this content lives. An untranslated locale route serves the English
  // body (fumadocs falls back), so it points at the English URL instead of
  // declaring itself canonical — the fallback copy is not a separate page.
  const contentLang = canonicalLocale(params.lang, translated);
  const canonical = localeUrl(contentLang, path);
  const title = seoTitleOf(page);
  const description = page.data.description;
  // Rendered in `contentLang`, matching `title`/`description` above: the loader
  // already resolved those through the same fallback, so the card's text and
  // the metadata's text are the same strings in the same language.
  const image = shareCardUrl(page, contentLang);

  return {
    title,
    description,
    alternates: {
      canonical,
      // Only the locales that really have this page. The cluster is keyed by
      // the logical path, not by params.lang, so every page in it advertises
      // the same reciprocal set. Untouched by the fallback rule above: an
      // untranslated locale is already absent from it, which is #169's settled
      // shape and stays correct whatever `canonical` points at.
      languages: languageAlternates(path, translated),
    },
    openGraph: {
      type: 'article',
      // og:url is Open Graph's permanent id for the object, so it tracks
      // `canonical` — an object identified by the English URL and by this
      // locale's URL at the same time is two objects.
      url: canonical,
      siteName: SITE_NAME,
      // Set explicitly rather than inherited: the root layout's `%s | ObjectOS`
      // template belongs on the title tag, where the brand suffix helps. Here
      // `siteName` already carries the brand, so repeating it would render
      // "Views | ObjectOS — ObjectOS" in a share preview.
      title,
      description,
      // The locale of the object og:url names, which is the English page when
      // this route is a fallback. Not the same claim as `<html lang>`: that one
      // describes the document being served, chrome included, and #181 settled
      // it on the route segment.
      locale: ogLocale(contentLang),
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}
