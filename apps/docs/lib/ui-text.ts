import type { Translations } from 'fumadocs-ui/i18n';
import { i18n } from '@/lib/i18n';
import de from './ui-text/de.json';
import es from './ui-text/es.json';
import fr from './ui-text/fr.json';
import ja from './ui-text/ja.json';
import ko from './ui-text/ko.json';
import zhHans from './ui-text/zh-Hans.json';
import zhHant from './ui-text/zh-Hant.json';

/**
 * The docs site's interface copy — the chrome around a page, never the page.
 *
 * Two kinds of string live here. The first nineteen keys are Fumadocs' own
 * `Translations` (the search box, "On this page", "Choose a language", the
 * previous/next footer, the accessible names of its icon buttons, …);
 * `fumadocsTranslations()` hands exactly those to `RootProvider`, which is the
 * only channel Fumadocs reads them through. The rest are this app's own
 * controls and notices, read by the docs page and the 404 page.
 *
 * English is the source, written here and nowhere else (AGENTS.md rule 1). The
 * Fumadocs values are its built-in defaults verbatim, so the English site
 * renders byte-identically to before this table existed.
 *
 * Nine of the Fumadocs keys — `searchOpen` through `navMain` — do not exist in
 * fumadocs-ui 16.8.12 as published: there the names are English literals in
 * the components, outside the Translations API, so every locale page announced
 * "Open Search" and "Copy Anchor Link" inside `<html lang="de">`.
 * `patches/fumadocs-ui@16.8.12.patch` adds them: eight are a backport of
 * upstream 16.9.0's own fix (the same key names, the same English defaults),
 * and `navMain` replaces the `aria-label="Main"` Radix's navigation menu puts
 * on the legal pages' header, which upstream has not localized. They arrive
 * here through the one channel the other ten already use. The patch header
 * says why a patch rather than slot overrides, and when it can go.
 *
 * The locale tables are UI copy in app code — the shape `app/not-found.tsx`
 * and `app/[lang]/privacy/page.tsx` already use — not `content/docs/`
 * translations, which the separate pass in `docs/TRANSLATION.md` produces. They
 * are JSON rather than TypeScript for one reason: `ui-text/zh-Hant.json` is
 * GENERATED from `ui-text/zh-Hans.json` by `scripts/gen-zh-hant.mjs` (OpenCC
 * `s2twp`, the converter and preset that produce every `*.zh-Hant.mdx` and
 * `meta.zh-Hant.json`), and that generator converts a data file. Never edit the
 * Traditional file by hand; CI runs `gen-zh-hant --check` and fails on any byte
 * of drift.
 */
const en = {
  search: 'Search',
  searchNoResult: 'No results found',
  toc: 'On this page',
  tocNoHeadings: 'No Headings',
  lastUpdate: 'Last updated on',
  chooseLanguage: 'Choose a language',
  nextPage: 'Next Page',
  previousPage: 'Previous Page',
  chooseTheme: 'Theme',
  editOnGithub: 'Edit on GitHub',
  /** The icon buttons' accessible names: no visible text, only `aria-label`. */
  searchOpen: 'Open Search',
  themeToggle: 'Toggle Theme',
  sidebarOpen: 'Open Sidebar',
  sidebarCollapse: 'Collapse Sidebar',
  headingCopyAnchor: 'Copy Anchor Link',
  codeBlockCopy: 'Copy Text',
  codeBlockCopied: 'Copied Text',
  /** The legal pages' header (`HomeLayout`): its menu button on a narrow screen, and its own name. */
  menuToggle: 'Toggle Menu',
  navMain: 'Main',

  copyMarkdown: 'Copy Markdown',
  openMenu: 'Open',
  openInGitHub: 'Open in GitHub',
  openInChatGPT: 'Open in ChatGPT',
  openInClaude: 'Open in Claude',
  /**
   * What "Open in ChatGPT / Claude" asks the assistant (#308): `{url}` is
   * replaced by the page's read URL. The key, the placeholder and the English
   * are upstream fumadocs-ui 16.9.0's own. It is an app key, not passed to
   * fumadocs: the page actions are this app's component.
   */
  pageActionsOpenInLLMPrompt: 'Read {url}, I want to ask questions about it.',
  /**
   * The notice on a locale URL whose page has no source file in that locale,
   * so the body below it is the English page. Never rendered in English — an
   * English page is never a fallback — but it is the source every locale's
   * string is translated from, so it is kept.
   */
  notTranslated: 'This page is not yet translated; showing English.',
  /** The sidebar footer's links to `/privacy` and `/terms`, and their nav's name. */
  /**
   * The label before a page's edition badges, and the name of their list
   * (`components/editions.tsx`). The edition names themselves are product
   * nouns and are not in this table.
   */
  editionsLabel: 'Available in',
  legalNav: 'Legal',
  privacy: 'Privacy',
  terms: 'Terms',
  /**
   * The 404 page's message. `app/not-found.tsx` sits above the locale segment
   * and applies it in the browser from the URL's first segment (that file says
   * why); it lives here so that its Traditional Chinese string is generated from
   * the Simplified one like every other string in this table.
   */
  notFound: 'This page could not be found.',
} satisfies Translations & Record<string, string>;

export type UiText = Record<keyof typeof en, string>;

/**
 * Fumadocs' `Translations`, restated as a type alias. Same keys, same values;
 * the difference is that an alias satisfies the index signature of the
 * provider's `translations` prop (`TranslationsOption`) and an interface
 * cannot, so the interface would not type-check at the one place it is used.
 */
export type FumadocsTranslations = { [K in keyof Translations]: Translations[K] };

type Locale = (typeof i18n.languages)[number];

/** The `{name}` placeholders a string carries, sorted, one entry per occurrence. */
function placeholders(value: string): string[] {
  return (value.match(/\{[A-Za-z]+\}/g) ?? []).sort();
}

/**
 * A locale table, held to EXACTLY the English key set.
 *
 * A JSON import is not a fresh object literal, so assigning one to `UiText`
 * catches a missing key but lets an extra one through. The second half of the
 * parameter type closes that: any key English does not have must be `never`,
 * which a JSON string value is not, so a stale or misspelled key is a type
 * error instead of dead weight nobody reads.
 *
 * Placeholders are held to English too, which a type cannot do for a JSON
 * string. A translation that drops `{url}` from `pageActionsOpenInLLMPrompt`
 * would open the assistant on a prompt naming no page, so a mismatch throws
 * while this module loads, which fails `next build` on the first page that
 * renders.
 */
function table<T extends UiText>(
  locale: string,
  text: T & Record<Exclude<keyof T, keyof UiText>, never>,
): UiText {
  for (const key of Object.keys(en) as (keyof UiText)[]) {
    const want = placeholders(en[key]).join(' ');
    const got = placeholders(text[key]).join(' ');
    if (got !== want) {
      throw new Error(
        `lib/ui-text/${locale}.json: "${key}" has placeholders [${got}], English has [${want}]`,
      );
    }
  }
  return text;
}

/**
 * Every locale `lib/i18n.ts` declares, and no other: keyed by its literal
 * union, so a locale added there without a table here fails `tsc` rather than
 * rendering English chrome.
 */
const TEXT: Record<Locale, UiText> = {
  en,
  'zh-Hans': table('zh-Hans', zhHans),
  'zh-Hant': table('zh-Hant', zhHant),
  ja: table('ja', ja),
  de: table('de', de),
  es: table('es', es),
  fr: table('fr', fr),
  ko: table('ko', ko),
};

function isLocale(lang: string): lang is Locale {
  return (i18n.languages as readonly string[]).includes(lang);
}

/**
 * The interface copy for a route locale.
 *
 * Total over `string` for the same reason `documentLanguage` in
 * `app/[lang]/layout.tsx` is: `dynamicParams = false` means only an enumerated
 * locale reaches a caller, and the default-language branch is the quiet answer
 * for a routing invariant that broke, not a fallback anything relies on.
 */
export function uiText(lang: string): UiText {
  return TEXT[isLocale(lang) ? lang : i18n.defaultLanguage];
}

/**
 * Exactly the strings Fumadocs reads, for `RootProvider`'s `i18n.translations`.
 *
 * Picked rather than spread: the provider merges whatever it is given into the
 * context every Fumadocs component reads, and this app's own keys have no
 * business there. It also keeps the serialized client prop to nineteen strings.
 */
export function fumadocsTranslations(text: UiText): FumadocsTranslations {
  return {
    search: text.search,
    searchNoResult: text.searchNoResult,
    toc: text.toc,
    tocNoHeadings: text.tocNoHeadings,
    lastUpdate: text.lastUpdate,
    chooseLanguage: text.chooseLanguage,
    nextPage: text.nextPage,
    previousPage: text.previousPage,
    chooseTheme: text.chooseTheme,
    editOnGithub: text.editOnGithub,
    searchOpen: text.searchOpen,
    themeToggle: text.themeToggle,
    sidebarOpen: text.sidebarOpen,
    sidebarCollapse: text.sidebarCollapse,
    headingCopyAnchor: text.headingCopyAnchor,
    codeBlockCopy: text.codeBlockCopy,
    codeBlockCopied: text.codeBlockCopied,
    menuToggle: text.menuToggle,
    navMain: text.navMain,
  };
}
