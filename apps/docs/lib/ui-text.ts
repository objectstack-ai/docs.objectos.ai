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
 * Two kinds of string live here. The first twenty keys are the strings
 * Fumadocs renders (the search box, "On this page", "Choose a language", the
 * previous/next footer, the accessible names of its icon buttons, …);
 * `fumadocsTranslations()` maps exactly those onto Fumadocs' own
 * `Translations` keys and hands them to `RootProvider`, which is the only
 * channel Fumadocs reads them through. The rest are this app's own controls
 * and notices, read by the docs page and the 404 page.
 *
 * English is the source, written here and nowhere else (AGENTS.md rule 1). The
 * Fumadocs values are its built-in defaults verbatim, so the English site
 * renders byte-identically to before this table existed.
 *
 * Since fumadocs-ui 16.10, Fumadocs' `Translations` are keyed by the English
 * string plus its notes (`"Open Search(search trigger)(aria-label)"`), not by
 * name, so the keys here are this app's own names and
 * `fumadocsTranslations()` is the one place that knows the mapping. Ten of
 * them — `searchOpen` through `menuToggle` — are the icon buttons'
 * accessible names. Eight of those 16.8.12 hard-coded in English outside its
 * Translations API (#305), and upstream has read them through it since 16.9.0.
 * `searchClose` and `sidebarClose` arrived with 16.15.2: the search dialog's
 * close button, which had no name before, and the name the sidebar button
 * takes while the mobile drawer is open. Both render only after interaction,
 * so no prerendered page carries them and `check-locale-surface.mjs` cannot
 * see them; they are here so that they are not English on a localized page.
 * `navMain` names the legal pages' header navigation, which Radix labels
 * "Main" and upstream still does not localize:
 * `patches/fumadocs-ui@16.15.2.patch` reads it through the same API under the
 * key `"Main(navigation menu)(aria-label)"`, and the patch header says why a
 * patch and when it can go.
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
  editOnGithub: 'Edit on GitHub',
  /** The icon buttons' accessible names: no visible text, only `aria-label`. */
  searchOpen: 'Open Search',
  searchClose: 'Close Search',
  themeToggle: 'Toggle Theme',
  sidebarOpen: 'Open Sidebar',
  sidebarCollapse: 'Collapse Sidebar',
  sidebarClose: 'Close Sidebar',
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
} satisfies Record<string, string>;

export type UiText = Record<keyof typeof en, string>;

/**
 * The subset of Fumadocs' `Translations` this site supplies. Optional per key,
 * because Fumadocs falls back to its English for a key it is not given and
 * most of its keys belong to components this site does not render (the type
 * table, the glass layout, its own page actions). Exact per key all the same:
 * `fumadocsTranslations()` returns an object literal of this type, so a key
 * Fumadocs renamed or dropped — or the patched navigation key, if the patch
 * stops applying — is an excess-property error in `tsc`, not an English name
 * on a localized page.
 */
export type FumadocsTranslations = { [K in keyof Translations]?: Translations[K] };

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
 * Exactly the strings Fumadocs reads, for `RootProvider`'s `i18n.translations`,
 * under Fumadocs' own keys.
 *
 * Picked rather than spread: the provider merges whatever it is given into the
 * context every Fumadocs component reads, and this app's own keys have no
 * business there. Two app strings each feed two Fumadocs keys, because
 * Fumadocs notes the same English twice: "Search" in the dialog and on the
 * trigger, and "Choose a language" as the picker's heading and as its button's
 * name.
 */
export function fumadocsTranslations(text: UiText): FumadocsTranslations {
  return {
    'Search(search dialog)': text.search,
    'Search(search trigger)': text.search,
    'No results found(search dialog)': text.searchNoResult,
    'On this page(table of contents)': text.toc,
    'No Headings(table of contents)': text.tocNoHeadings,
    'Last updated on(page footer)': text.lastUpdate,
    'Choose a language(language switcher)': text.chooseLanguage,
    'Choose a language(language switcher)(aria-label)': text.chooseLanguage,
    'Next Page(pagination)': text.nextPage,
    'Previous Page(pagination)': text.previousPage,
    'Edit on GitHub(edit page)': text.editOnGithub,
    'Open Search(search trigger)(aria-label)': text.searchOpen,
    'Close Search(search dialog)(aria-label)': text.searchClose,
    'Toggle Theme(theme switcher)(aria-label)': text.themeToggle,
    'Open Sidebar(sidebar)(aria-label)': text.sidebarOpen,
    'Collapse Sidebar(sidebar)(aria-label)': text.sidebarCollapse,
    'Close Sidebar(sidebar)(aria-label)': text.sidebarClose,
    'Copy Anchor Link(heading anchor)(aria-label)': text.headingCopyAnchor,
    'Copy Text(code block)(aria-label)': text.codeBlockCopy,
    'Copied Text(code block)(aria-label)': text.codeBlockCopied,
    'Toggle Menu(mobile menu)(aria-label)': text.menuToggle,
    'Main(navigation menu)(aria-label)': text.navMain,
  };
}
