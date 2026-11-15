#!/usr/bin/env node
/**
 * Locale-surface gate — the locale composition of the BUILT artifacts, checked
 * against an oracle computed from `content/docs/`.
 *
 * ## Why this exists
 *
 * The same missing-language-argument defect has been found and fixed in four
 * separate generated artifacts — `sitemap.ts` (#169), `llms.txt` (#170),
 * `llms-full.txt` (#177) and the OG card (#185) — and every one of them was
 * green on every gate for its entire lifetime. On the pre-#169 tree
 * `sitemap.xml` advertised 3892 entries over 574 distinct URLs, 3318 of them
 * exact duplicates, against 335 real MDX source files. Type-check passed,
 * build passed, test passed. On #177 the same shape meant 4.6 MB of
 * seven-locale text served under a `robots.txt` that had just been opened to
 * crawlers.
 *
 * The common root cause is an API that takes an optional language argument and
 * quietly returns EVERY locale's page set when you omit it. Nothing about that
 * is a type error and nothing about it is a build error. It is only visible as
 * a count.
 *
 * So this gate asserts the count — or rather the set, which is strictly
 * stronger and localises the failure. Both directions are defects:
 *
 *   - too many entries: untranslated URLs are being advertised again, which is
 *     the #169 / #177 defect returning;
 *   - too few entries: a shipped translation is invisible to crawlers, which
 *     is the same bug with the sign flipped and is otherwise indistinguishable
 *     from "nobody has translated that page yet".
 *
 * ## The oracle is the content tree, not a recorded snapshot
 *
 * A gate that pins 346 by hand needs hand-editing on every content PR and gets
 * deleted within a month; worse, the edit that updates the number is the same
 * edit that would hide a regression. So the expected surface is DERIVED, every
 * run, from two authorities the repo already has:
 *
 *   - `content/docs/**\/*.mdx` — the pages, and which locales each really has.
 *     A translation is a locale-suffixed sibling (`foo.ja.mdx`); its absence
 *     means the page falls back to English, and a fallback URL must not be
 *     advertised as a translation (AGENTS.md, "Locale conventions").
 *   - `apps/docs/lib/i18n.ts` — the locale list and the default locale.
 *     AGENTS.md names it the authority; `check-translation-output.mjs` already
 *     reads it the same way, and `turbo.json` already names it an input to the
 *     `test` task.
 *
 * Nothing here reads app code. The gate must be able to go red when app code
 * is wrong, which it cannot do if app code is where it gets its expectations.
 *
 * ## Why it reads the build output rather than importing `sitemap.ts`
 *
 * Importing `apps/docs/app/sitemap.ts` pulls in the whole MDX collection and
 * the `@/` alias, which is why every measurement on this backlog was taken off
 * the build artifact instead. That makes this a post-`build` step rather than
 * a standalone zero-dependency self-test like `check-node-floor.mjs`, and it
 * is why CI invokes it as its own step after `pnpm turbo run build` rather
 * than as a turbo task: turbo would hash it against this package's inputs,
 * which do not include another package's `.next/` output, and a locale gate
 * replaying a cached green is precisely the failure this card exists to end.
 *
 * The `--self-test` mode below needs no build: it drives the same
 * collect/evaluate pipeline over fixture trees in a temp directory.
 *
 * ## Adding an artifact
 *
 * `ARTIFACTS` is the whole extension point. Each entry says where the built
 * file is, how to read the advertised locale surface out of it, what the
 * content tree says that surface should be, and which VOCABULARY the two are
 * compared in. #184 added `llms.txt` and `llms-full.txt` alongside the sitemap.
 *
 * Two vocabularies exist because the three artifacts do not all identify a page
 * the same way. The sitemap advertises URLs, so `BY_URL` compares URL sets. The
 * `llms` bodies advertise page TITLES and never emit a page's own URL, so
 * `BY_LOCALE_EXCLUSIVE_TITLE` compares the titles that belong to exactly one
 * locale. Both are assertions on COMPOSITION — which pages, in which locales —
 * and neither says anything about ORDER. That is deliberate and load-bearing:
 * `llms-full.txt`'s page order was measured to differ between two builds of the
 * same commit, and #196 then changed the order on purpose to follow the
 * navigation tree. Any assertion on sequence, a golden file, or a diff against
 * a recorded body would have flaked before that change and broken after it.
 * `llms.txt` walks the page tree, whose order comes from `meta.json`, so it is
 * not exposed to the same non-determinism — it is written the same way anyway,
 * because a gate whose halves have different robustness properties is a gate
 * someone reads wrong later.
 *
 * ## Dotted slugs (#208)
 *
 * `middleware.ts`'s matcher exempts `.*\..*`, unanchored, so it skips the
 * locale rewrite for ANY path containing a dot in ANY segment — not only the
 * asset paths the exemption exists for. Because `hideLocale: 'default-locale'`
 * means that rewrite is what maps the unprefixed public URL onto the internal
 * `/en/...` route, a page whose slug contains a dot builds, prerenders, and is
 * advertised correctly by every artifact above — the page genuinely exists and
 * its URL is genuinely in the content tree — and then 404s at that very URL,
 * while every OTHER locale (which does not depend on the rewrite) serves it
 * fine. #209 measured that tightening the matcher instead is not cheap:
 * `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt` and every
 * `.mdx` page route depend on the exemption today, and a regression in it
 * would be caught by nothing here — this gate reads build output, not a
 * running server.
 *
 * So instead of touching the matcher, this gate rejects the slug outright.
 * `dottedSlugPages` below reuses the same page path `readDocsPages` already
 * derives for the oracle above — which strips the locale suffix
 * (`quickstart.zh-Hans.mdx` → `docs/quickstart`) before building that path —
 * so a real translation file never trips it; only a dot that survives into
 * the derived URL segment does (`probe.dotted.mdx` → `docs/probe.dotted`).
 *
 * ## The `llms` bodies are markdown, not HTML (#282)
 *
 * `page.data.getText('processed')` is what `/llms-full.txt` and every per-page
 * `/llms.mdx` body serve. In `fumadocs-core` it encodes markdown punctuation
 * as HTML numeric character references (#197) — into files no reader runs
 * through an HTML parser, and in four places into the closing `)` of a link,
 * which stops that link being a link. #197 fixed it at the producer with
 * `patches/fumadocs-core@16.8.12.patch` (since #239, `@16.15.2.patch`), pinned to
 * that exact version string,
 * and #197 measured the defect in 16.15.1, 16.15.2 and 16.15.8 as well, so
 * upgrading does not remove it. What a bump does to the pin, measured with
 * pnpm 10.28.2 and #239's 16.15.2 (#282): a lockfile-updating install
 * refuses the now-unused pin with `ERR_PNPM_UNUSED_PATCH`, exit 1 — but the
 * first remedy that error offers is to delete the pin, after which install
 * exits 0 and the defect is back at its full count; and `--frozen-lockfile`,
 * what CI runs, does not check for an unused patch at all.
 *
 * So this gate asserts the OUTCOME, on the built bytes of BOTH consumers — the
 * `llms-full.txt` body and every `.body` file under `llms.mdx/` — rather than
 * the mechanism, which an upstream fix would make obsolete:
 *
 *   - `numeric-character-reference`: any decimal or hex numeric reference, the
 *     only form `mdast-util-to-markdown`'s encoder emits;
 *   - `malformed-link-target`: a `](` opener whose target does not close with
 *     a literal `)` before whitespace. Same cause, different question, and the
 *     one with the user-visible consequence: two such targets also escaped the
 *     absolute-URL rewrite in `app/llms-full.txt/route.ts`, whose `SITE_LINK`
 *     needs that literal `)`, and were served relative.
 *
 * Measured off `.next` on the two real commits either side of the fix, with
 * the same figures in each consumer: `d725081` 67 references and 4 of 661
 * targets malformed; `cb0c146` 0 and 0 of 661.
 *
 * Neither rule may pass over nothing. The oracle says which `llms.mdx` bodies
 * must exist — one per page with an English source — so a directory that was
 * never written, or half written, is `llms-page-body-missing` rather than a
 * clean scan of zero files. A consumer in which no link target could be read
 * at all is `no-link-targets`, because the malformed-target rule would then
 * have measured nothing. And every gate run first feeds the #197 shape
 * through the same scan for both consumers and requires both rules to fire;
 * if either stays silent, `negative-control-passed` fails the run. That is a
 * live control, on every run, not only the `--self-test` fixtures.
 *
 * Deliberately the whole body, code fences included. All 661 targets in
 * today's corpus sit outside a fence and no English source page carries a
 * reference, so this costs nothing now, while tracking fences across a
 * concatenated body would let one page's unclosed fence hide every later page
 * from the scan. A page that one day needs a literal reference in a code
 * sample, or a titled link (`[a](url "t")`, which the second rule reads as
 * malformed), is a reason to change this rule on purpose, not to weaken it.
 *
 * These rules live in this gate rather than in a script of their own because
 * this gate already reads the `llms-full.txt` body right after the build, and
 * the content-tree oracle above is the thing that says which `llms.mdx`
 * bodies must exist.
 *
 * #299 adds a third rule on the same bodies, `mdx-comment`: no `{/*` in either
 * consumer. An MDX comment is a note to the page's next editor. It renders
 * nothing, but the processed Markdown kept it as text, so the internal naming
 * note in `resources/license.mdx` shipped in both consumers and in what Copy
 * Markdown copies. `getLLMText` in `apps/docs/lib/source.ts` now strips them,
 * except inside a code fence. This rule reads the whole body, fences included,
 * for the reason given above. A code sample that one day needs a literal `{/*`
 * is a reason to change this rule on purpose.
 *
 * ## The built docs pages: chrome names and page-tree languages (#308)
 *
 * #298 and #305 made two promises about every localized page that nothing
 * checked afterwards. This gate now reads them off the prerendered HTML under
 * `apps/docs/.next/server/app/<locale>/`, `<script>` bodies (the RSC payload)
 * skipped, so it measures markup and not data:
 *
 *   - `english-chrome-name`: no accessible name on a localized page is one of
 *     the English site's chrome names, unless the element sits inside
 *     `lang="en"`. A name is an `aria-label`, `title`, `alt` or `placeholder`
 *     value, an `svg` `<title>`, or the text of a `.sr-only` element (where
 *     fumadocs 16.10 and later put the names 16.8.12 keeps in `aria-label`).
 *     The English set is read off the built English pages, minus
 *     `LANGUAGE_NEUTRAL_NAMES`, so a name fumadocs adds in a later release is
 *     covered the day it ships. Measured on the pages `main` built at cec227a:
 *     1067 in `zh-Hans` and `zh-Hant` and 821 in each other locale, all of
 *     them fumadocs' own names (#305's 1375-1387 per locale also counted the
 *     ones inside a fallback page's `lang="en"` body, which this rule
 *     rightly does not); on #305's tree, 0.
 *   - `untranslated-entry-unmarked`: a page-tree entry (a sidebar item, a
 *     previous/next card) for a page the locale has no source file for shows
 *     the English title, so its text must resolve to `lang="en"`. On cec227a:
 *     687 such entries in `zh-Hans` and `zh-Hant` and 920 in each other
 *     locale, none marked; on #305's tree, all of them marked.
 *   - `translated-entry-marked-english`: the same entry for a page the locale
 *     DOES have must not resolve to `en`. Without this half, marking every
 *     entry English would pass the rule above.
 *   - `localized-name-marked-english` (#308 review): the inverse of the first
 *     rule. One of the locale's OWN names inside a `lang="en"` region, with no
 *     `lang` of its own, is read with English rules. #305 localized the
 *     heading-anchor and code-copy buttons, and on a fallback page they sit in
 *     the body #298 marks English: on `main` at cf449fa, 520 + 115 per
 *     Latin-script locale over 55 fallback pages and 336 + 58 in `zh-Hans`
 *     and `zh-Hant` over 31, and nothing else. The locale's own names are
 *     read off its built pages the way the English set is: the names that
 *     resolve to the locale there, minus the English set.
 *
 * Folder names (a sidebar folder's button, the breadcrumb's crumbs) are not
 * links and are not read: every folder has a `meta.<locale>.json` title
 * today, so none is English.
 *
 * The oracle for "untranslated" is the content tree `readDocsPages` already
 * builds, not the app's own detection, so the gate cannot agree with the app
 * by construction. An entry is a link to `/<locale>/docs/...` outside the page
 * body (`.prose`) whose text contains the target page's title in the language
 * it should be shown in. The title test is what keeps the header logo, whose
 * text is the brand and which links to the docs home, from reading as an
 * entry; the body exclusion keeps a translated page's own prose links, which
 * are content in the page's language, from reading as unmarked entries.
 *
 * Neither rule may pass over nothing: every page with an English source must
 * have a built HTML file in every locale (`docs-page-html-missing`); the
 * English pages must yield at least one chrome name (`no-chrome-names`); and a
 * locale whose content tree has pages of a kind must show at least one entry
 * of that kind (`no-tree-entries`), since each page's own sidebar entry is on
 * its own page. A live control also feeds both #305 shapes, built from the
 * real oracle values, through the same reader on every run.
 *
 * ## Usage
 *
 *   node .github/scripts/check-locale-surface.mjs              # the gate (needs a build)
 *   node .github/scripts/check-locale-surface.mjs --self-test  # prove every rule can fail
 *
 * No dependencies, no network, no credentials.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

/** Every rule this gate enforces; the self-test asserts each one has a red fixture. */
const RULES = [
  'artifact-missing',
  'artifact-empty',
  'nothing-expected',
  'unexpected-url',
  'missing-url',
  'duplicate-url',
  'legal-english-unmarked',
  'legal-translation-shows-english',
  'legal-page-unread',
  'unexpected-locale-title',
  'missing-locale-title',
  'translation-orphan',
  'dotted-slug',
  'numeric-character-reference',
  'malformed-link-target',
  'mdx-comment',
  'no-link-targets',
  'llms-page-body-missing',
  'english-chrome-name',
  'untranslated-entry-unmarked',
  'translated-entry-marked-english',
  'localized-name-marked-english',
  'docs-page-html-missing',
  'no-chrome-names',
  'no-tree-entries',
];

/**
 * The rule the live negative control fires when the encoding scan could not
 * go red on the #197 shape. Not in `RULES`: no artifact can trip it, only a
 * scan that has gone blind, so the self-test demonstrates it by blinding the
 * scan rather than with a fixture tree.
 */
const CONTROL_RULE = 'negative-control-passed';

/**
 * Canonical production host. Must match `SITE_URL` in `apps/docs/lib/seo.ts`.
 * Deliberately re-declared rather than imported: this file is the independent
 * check, and a check that shares a constant with the thing it checks cannot
 * catch that constant being wrong. A mismatch shows up as every URL landing in
 * both `unexpected-url` and `missing-url`, which is loud and unambiguous.
 */
const SITE_URL = 'https://docs.objectos.ai';

/**
 * Top-level pages that are NOT in `content/docs/`, with the locales they are
 * really written in.
 *
 * `privacy` and `terms` carry their copy in a `content` record inside their own
 * route component, which falls back to English for anything not listed there.
 * They are declared here rather than derived because they are not in the
 * content tree at all, and because the oracle deliberately does not read app
 * code (see the header). This list changing is a deliberate act — translating
 * the privacy policy — so a drift going red and naming the page is the correct
 * outcome, not a maintenance tax: unlike the docs counts, it does not move on
 * every content PR. `zh-Hant` is listed because its copy is generated from the
 * `zh-Hans` entry by `apps/docs/scripts/gen-zh-hant.mjs` (#312), the way every
 * other Traditional page is.
 *
 * The same list is the oracle for what the built legal pages SHOW (#312, see
 * `legalPages` below): a listed locale shows its own copy, and any other
 * locale shows the English entry marked `lang="en"`.
 *
 * The site root is deliberately NOT here, and not expected anywhere below. It
 * is a language dispatch page that redirects to that locale's `/docs` — a URL
 * that serves no content — and `sitemap.ts` stopped submitting it under
 * objectos#171, following www.objectos.ai's `noindex` dispatch page excluded
 * from its sitemap. A root URL in the artifact is therefore `unexpected-url`,
 * which is what keeps the redirect from creeping back in at `priority: 1`.
 */
const STATIC_PAGES = [
  { path: 'privacy', locales: ['en', 'zh-Hans', 'zh-Hant'] },
  { path: 'terms', locales: ['en', 'zh-Hans', 'zh-Hant'] },
];

const rel = (p) => relative(ROOT, p);

/* ------------------------------------------------------------- the oracle -- */

/**
 * Locale list and default locale, parsed as text out of `lib/i18n.ts`.
 * Same reader shape `check-translation-output.mjs` uses. Throws rather than
 * defaulting: a gate that guesses the locale list when it cannot read one is a
 * gate that reports a green it did not measure.
 */
function readI18n(root) {
  const path = join(root, 'apps/docs/lib/i18n.ts');
  const text = readFileSync(path, 'utf8');

  const list = text.match(/languages:\s*\[([^\]]+)\]/);
  if (!list) throw new Error(`could not parse languages[] out of ${rel(path)}`);
  const languages = list[1]
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean);
  if (languages.length === 0) throw new Error(`languages[] is empty in ${rel(path)}`);

  const def = text.match(/defaultLanguage:\s*['"]([^'"]+)['"]/);
  if (!def) throw new Error(`could not parse defaultLanguage out of ${rel(path)}`);
  const defaultLanguage = def[1];
  if (!languages.includes(defaultLanguage)) {
    throw new Error(`defaultLanguage "${defaultLanguage}" is not in languages[] in ${rel(path)}`);
  }

  return { languages, defaultLanguage };
}

/**
 * The frontmatter `title:` of an `.mdx` file, or `undefined`.
 *
 * A deliberately small YAML reader, for the same reason `readI18n` parses
 * `i18n.ts` as text: this gate takes no dependencies, and the surface it needs
 * is one scalar out of the leading `---` block. Every one of the 335 files in
 * the tree today has an unquoted single-line `title:`; matching quotes are
 * stripped anyway so that the first title needing them (one containing a colon)
 * does not silently read as `"Foo"` and stop matching the built body.
 *
 * A page with no title contributes nothing to the buckets below, which narrows
 * what can be asserted rather than breaking it. That is not a hole worth its
 * own rule: `title` is required by the fumadocs frontmatter schema, so a page
 * without one fails `build` long before this gate runs.
 */
function readTitle(text) {
  if (!text.startsWith('---')) return undefined;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return undefined;
  const match = text.slice(3, end).match(/^title:\s*(.+)$/m);
  if (!match) return undefined;

  const value = match[1].trim();
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return (quoted ? quoted[2] : value).trim() || undefined;
}

function walkMdx(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkMdx(p, out);
    else if (entry.name.endsWith('.mdx')) out.push(p);
  }
  return out;
}

/**
 * The logical docs pages and, for each, the locales that have a REAL source
 * file for it.
 *
 * A page is identified by its site path (`docs/build/data`), derived from the
 * file path the way fumadocs derives slugs: strip the locale suffix, strip
 * `.mdx`, and drop a trailing `index` segment. English is the authored source
 * for every page (AGENTS.md: "English is the single source of truth"), so a
 * locale file with no English sibling is reported rather than counted — it
 * would otherwise inflate the oracle to match an artifact that is also wrong.
 */
function readDocsPages(root, { languages, defaultLanguage }) {
  const docsDir = join(root, 'content/docs');
  const nonDefault = languages.filter((l) => l !== defaultLanguage);
  const pages = new Map();

  for (const file of existsSync(docsDir) ? walkMdx(docsDir) : []) {
    const relPath = relative(docsDir, file).split('\\').join('/');
    const locale = nonDefault.find((l) => relPath.endsWith(`.${l}.mdx`)) ?? defaultLanguage;
    const suffix = locale === defaultLanguage ? '.mdx' : `.${locale}.mdx`;
    const segments = relPath.slice(0, -suffix.length).split('/');
    if (segments[segments.length - 1] === 'index') segments.pop();
    const path = ['docs', ...segments].join('/');

    if (!pages.has(path)) pages.set(path, { locales: new Set(), files: new Map(), titles: new Map() });
    pages.get(path).locales.add(locale);
    pages.get(path).files.set(locale, rel(file));

    const title = readTitle(readFileSync(file, 'utf8'));
    if (title !== undefined) pages.get(path).titles.set(locale, title);
  }

  const orphans = [];
  for (const [path, page] of pages) {
    if (!page.locales.has(defaultLanguage)) {
      orphans.push({
        path,
        locales: [...page.locales],
        files: [...page.files.values()],
      });
    }
  }

  return { pages, orphans };
}

/**
 * Logical pages whose derived slug contains a dot in any segment (see
 * "Dotted slugs" above). `path` is the same string `readDocsPages` already
 * built for the oracle — `['docs', ...segments].join('/')` after the locale
 * suffix and `.mdx` are stripped — so this is a pure re-check of a value the
 * oracle already computed, not a second parse of the filename. That is what
 * keeps a real translation (`quickstart.zh-Hans.mdx`, sharing `docs/quickstart`
 * with its English sibling) from tripping it: the dot that named the locale is
 * gone before this function ever sees the string.
 *
 * Every locale's file for an offending page is named in the finding — a
 * dotted slug is a property of the URL, which every locale advertising the
 * page shares, not of one file.
 */
function dottedSlugPages(surface) {
  const offenders = [];
  for (const [path, page] of surface.pages) {
    if (path.split('/').some((segment) => segment.includes('.'))) {
      offenders.push({ path, files: [...page.files.values()].sort() });
    }
  }
  return offenders.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Absolute URL for a logical path in a locale. Mirrors `localeUrl()` in
 * `apps/docs/lib/seo.ts`, including `hideLocale: 'default-locale'`.
 */
function localeUrl(lang, path, defaultLanguage) {
  const suffix = path ? `/${path}` : '';
  return lang === defaultLanguage ? `${SITE_URL}${suffix}` : `${SITE_URL}/${lang}${suffix}`;
}

/**
 * The full expected sitemap URL set: the two legal pages in the locales they
 * are written in, and every docs page in the locales that really have it.
 * Not the root — see `STATIC_PAGES`.
 */
function expectedSitemapUrls(surface) {
  const { languages, defaultLanguage, pages } = surface;
  const urls = new Set();

  for (const { path, locales } of STATIC_PAGES) {
    for (const lang of locales) {
      if (languages.includes(lang)) urls.add(localeUrl(lang, path, defaultLanguage));
    }
  }

  for (const [path, page] of pages) {
    if (!page.locales.has(defaultLanguage)) continue; // orphan; reported separately
    for (const lang of languages) {
      if (page.locales.has(lang)) urls.add(localeUrl(lang, path, defaultLanguage));
    }
  }

  return urls;
}

/* ------------------------------------------------- the legal pages (#312) --
 * `privacy` and `terms` in a locale `STATIC_PAGES` does not list render the
 * English entry inside `<html lang="LOCALE">`. Until #312 nothing marked it, so
 * a German screen reader read the privacy policy with German rules, and
 * `zh-Hant` got that English too. Three rules over the built HTML, with the
 * English page's own `<main>` text as the oracle for "English":
 *
 *   - `legal-english-unmarked`: on a locale that is not listed, every text
 *     node of `<main>` that is also English-page text must resolve to
 *     `lang="en"` (the nearest `lang`, as a screen reader applies it). The
 *     notice above it is in the route locale and is not English-page text.
 *   - `legal-translation-shows-english`: on a listed locale, no text node of
 *     `<main>` is English-page text and none resolves to `en`. It catches a
 *     locale that is advertised as written while it still shows English, the
 *     way `zh-Hant` did.
 *   - `legal-page-unread`: a built page missing in some locale, an English page
 *     with no `<main>` text, or an unlisted locale showing none of the English
 *     text. Each means a rule above compared nothing.
 *
 * "`<main>`" means the page's content: text inside a `<main>` and outside any
 * `<header>` or `<nav>`. `HomeLayout`'s `<main id="nd-home-layout">` holds its
 * own header (logo, search, language switcher), which is localized chrome and
 * not page copy, next to the page's `<article>`. `<script>` and `<style>`
 * content is skipped, so the RSC payload (a JSON copy of every string) does
 * not read as markup. The names are prefixed `legal` on
 * purpose, so that this block stands alone next to any other HTML reader in
 * this file.
 */

/** Where Next writes a prerendered legal page: `<locale>/<path>.html`, English under `en/`. */
const LEGAL_PAGES_DIR = 'apps/docs/.next/server/app';

const LEGAL_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const LEGAL_TAG = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

const legalText = (s) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const legalIsEnglish = (lang, defaultLanguage) =>
  lang?.toLowerCase().split('-')[0] === defaultLanguage.toLowerCase().split('-')[0];

/** Every text node of the page's content (see above), with the `lang` it resolves to. */
function legalMainText(html) {
  const texts = [];
  const stack = [{ tag: '#document', lang: undefined, main: false, chrome: false }];
  const tags = new RegExp(LEGAL_TAG.source, 'g');
  let last = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    const top = stack[stack.length - 1];
    const text = legalText(html.slice(last, m.index));
    if (text && top.main && !top.chrome) texts.push({ text, lang: top.lang });
    last = tags.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const tag = m[2].toLowerCase();
    if (m[1] === '/') {
      const at = stack.findLastIndex((frame) => frame.tag === tag);
      if (at > 0) stack.length = at;
      continue;
    }
    if (tag === 'script' || tag === 'style') {
      const end = html.toLowerCase().indexOf(`</${tag}`, tags.lastIndex);
      last = tags.lastIndex = end < 0 ? html.length : end;
      continue;
    }
    const lang = /(?:^|\s)lang\s*=\s*"([^"]*)"/.exec(m[3])?.[1] ?? top.lang;
    if (!LEGAL_VOID.has(tag) && !m[3].trimEnd().endsWith('/')) {
      stack.push({ tag, lang, main: top.main || tag === 'main', chrome: top.chrome || tag === 'header' || tag === 'nav' });
    }
  }
  return texts;
}

/** The built legal pages, keyed `<locale>/<path>`; an empty map when none is built. */
function collectLegalPages(root, languages) {
  const pages = new Map();
  for (const { path } of STATIC_PAGES) {
    for (const lang of languages) {
      const file = join(root, LEGAL_PAGES_DIR, lang, `${path}.html`);
      if (existsSync(file)) pages.set(`${lang}/${path}`, { file, texts: legalMainText(readFileSync(file, 'utf8')) });
    }
  }
  return pages;
}

/** The three rules above, and one row per non-English page for the summary. */
function legalPages({ surface, pages }) {
  const { languages, defaultLanguage } = surface;
  const findings = [];
  const rows = [];
  if (pages.size === 0) {
    findings.push({
      rule: 'artifact-missing',
      artifact: 'legal pages',
      detail:
        `legal pages: no built page at ${LEGAL_PAGES_DIR}/<locale>/{${STATIC_PAGES.map((p) => p.path).join(',')}}.html ` +
        '— run `pnpm turbo run build` first. Not finding them is a failure, never a skip.',
    });
    return { findings, rows };
  }
  const unread = (detail) => findings.push({ rule: 'legal-page-unread', artifact: 'legal pages', detail });

  for (const { path, locales } of STATIC_PAGES) {
    const english = pages.get(`${defaultLanguage}/${path}`);
    const englishText = new Set((english?.texts ?? []).map((x) => x.text));
    if (englishText.size === 0) {
      unread(
        `${defaultLanguage}/${path}: ${english ? `no <main> text in ${rel(english.file)}` : 'not built'} — ` +
          'it is the oracle for what English looks like, so nothing about this page was compared',
      );
      continue;
    }
    for (const lang of languages) {
      if (lang === defaultLanguage) continue;
      const page = pages.get(`${lang}/${path}`);
      if (!page) {
        unread(`${lang}/${path}: no built page at ${LEGAL_PAGES_DIR}/${lang}/${path}.html, so it was never read`);
        continue;
      }
      const written = locales.includes(lang);
      const shown = page.texts.filter((x) => englishText.has(x.text));
      const wrong = written
        ? page.texts.filter((x) => englishText.has(x.text) || legalIsEnglish(x.lang, defaultLanguage))
        : shown.filter((x) => !legalIsEnglish(x.lang, defaultLanguage));
      rows.push({ page: `${lang}/${path}`, written, texts: page.texts.length, english: shown.length, wrong: wrong.length });

      if (written && wrong.length) {
        findings.push({
          rule: 'legal-translation-shows-english',
          artifact: 'legal pages',
          detail:
            `${rel(page.file)}: \`STATIC_PAGES\` says ${path} is written in ${lang}, but ${wrong.length} text ` +
            `node(s) of its <main> are English-page text or marked English, first "${wrong[0].text.slice(0, 80)}" ` +
            `(lang="${wrong[0].lang ?? 'none'}"). Add the ${lang} entry to the page's \`content\` (zh-Hant: run ` +
            '`gen:zh-hant`), or drop the locale from `STATIC_PAGES`',
        });
      } else if (!written && shown.length === 0) {
        unread(
          `${lang}/${path}: none of the English page's ${englishText.size} text node(s) is in its <main> — either ` +
            `${path} is now written in ${lang} (list it in \`STATIC_PAGES\`) or this reader has gone blind`,
        );
      } else if (!written && wrong.length) {
        findings.push({
          rule: 'legal-english-unmarked',
          artifact: 'legal pages',
          detail:
            `${rel(page.file)}: ${wrong.length} of the ${shown.length} English text node(s) ${lang} shows for ` +
            `${path} resolve to lang="${wrong[0].lang ?? 'none'}", first "${wrong[0].text.slice(0, 80)}" — a ` +
            `${lang} reader hears English with ${lang} rules. Mark the English entry lang="${defaultLanguage}" ` +
            `(\`app/[lang]/${path}/page.tsx\`)`,
        });
      }
    }
  }
  return { findings, rows };
}

/**
 * Per locale, the page titles that belong to THAT LOCALE AND NO OTHER, each
 * mapped to one source file that carries it.
 *
 * ## Why titles, and why only the exclusive ones
 *
 * The `llms` bodies never emit a page's own URL — `llms-full.txt` is page texts
 * concatenated, each opening with the `# <title>` line `getLLMText` puts there
 * — so a URL set cannot be read out of them. The title can. But a plain "every
 * title in the artifact equals every English title" comparison is the wrong
 * assertion twice over: three pairs of English pages share a title today
 * (`Approvals`, `Dashboards`, `Notifications`), and any page that grows an `#`
 * heading in its own body would read as an extra page. Both would go red on a
 * content PR that broke nothing — and a gate that cries wolf on content growth
 * is a gate that gets deleted, which is the failure the "no hand-pinned counts"
 * rule at the top of this file is already about.
 *
 * Restricting the comparison to titles that are unique to one locale is what
 * makes it stable. A title held by exactly one locale is a fingerprint for that
 * locale's page set, so:
 *
 *   - every `en`-exclusive title must be in the body — if one goes missing,
 *     English pages stopped being served;
 *   - no other locale's exclusive title may be — if one appears, the language
 *     argument was dropped and every locale is being emitted again.
 *
 * Measured on the tree this shipped against: 60 / 52 / 31 / 25 / 32 / 28 / 31
 * exclusive titles for `en` / `zh-Hans` / `ja` / `de` / `es` / `fr` / `ko`, and
 * both built bodies read 60 / 0 / 0 / 0 / 0 / 0 / 0. Issue #184 recorded the
 * same shape one tree earlier as 63/53/31/25/32/28/31 collapsing to 63/0×6.
 * The numbers move with the content; nothing here pins them.
 *
 * Titles are bucketed from EVERY `.mdx` file, translation-only orphans
 * included. An orphan is already reported by `translation-orphan`, and letting
 * its title count for its own locale can only make the guard stricter.
 */
function localeExclusiveTitles({ languages, pages }) {
  const buckets = new Map(languages.map((lang) => [lang, new Map()]));

  for (const [, page] of pages) {
    for (const [locale, title] of page.titles) {
      const bucket = buckets.get(locale);
      if (bucket && !bucket.has(title)) bucket.set(title, page.files.get(locale));
    }
  }

  const exclusive = new Map();
  for (const lang of languages) {
    const others = languages.filter((l) => l !== lang);
    const own = new Map();
    for (const [title, file] of buckets.get(lang)) {
      if (!others.some((other) => buckets.get(other).has(title))) own.set(title, file);
    }
    exclusive.set(lang, own);
  }

  return exclusive;
}

/** The titles a correct `llms` body advertises: the default locale's exclusive ones. */
function expectedExclusiveTitles(surface) {
  return new Set(surface.exclusiveTitles.get(surface.defaultLanguage).keys());
}

/** Every locale-exclusive title, in any locale — the comparison's whole universe. */
function everyExclusiveTitle(surface) {
  const all = new Set();
  for (const [, titles] of surface.exclusiveTitles) for (const title of titles.keys()) all.add(title);
  return all;
}

/** The locale an exclusive title belongs to, and the file that carries it. */
function ownerOf(title, surface) {
  for (const [lang, titles] of surface.exclusiveTitles) {
    if (titles.has(title)) return { lang, file: titles.get(title) };
  }
  return { lang: '?', file: '?' };
}

/* ------------------------------------------------------- artifact readers -- */

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Every `loc` a sitemap advertises, in document order and WITH duplicates —
 * the pre-#169 tree's 3892 entries over 574 distinct URLs is only visible if
 * the reader does not de-duplicate on the way in.
 *
 * hreflang `alternate` links are deliberately not collected: they are the
 * reciprocal cluster for an entry, not separate advertised URLs, and every one
 * of them is some other entry's `loc`.
 */
function readSitemapUrls(text) {
  return [...text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => unescapeXml(m[1].trim()));
}

/**
 * Every page title `llms.txt` advertises: the link text of each page bullet,
 * `- [Title](https://…): description`, at any indentation.
 *
 * Structured rather than "does the body contain this string". A substring
 * search over the same bodies produces four false hits on today's tree —
 * `Glossar` inside `Glossary`, and `Datasources`, `Roles` and `Licence` sitting
 * in English prose — each of which reads as "a German page is being served".
 * The link text is the page title and nothing else is.
 *
 * Section headings (`## Build`) and the bullets for folders that have no index
 * page (`- Data`) are deliberately not collected: their text comes from
 * `meta.json`, not from a page's frontmatter, so they are not evidence that a
 * page is in the artifact.
 */
function readLlmsIndexTitles(text) {
  return [...text.matchAll(/^[ \t]*-[ \t]+\[([^\]]+)\]\([^)\s]*\)/gm)].map((m) => m[1].trim());
}

/** Opening or closing line of a fenced code block — mirrors the `llms-full.txt` route. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * Every page title `llms-full.txt` advertises: the `# ` heading that
 * `getLLMText` puts at the top of each page's text.
 *
 * Fenced code blocks are skipped, matching what the route itself does when it
 * rewrites links. Not a nicety — 14 shell-comment lines in today's corpus start
 * with `# `, and a fence-blind reader takes all of them for page titles.
 *
 * Fence state is tracked across the whole joined body rather than per page,
 * because the page boundaries are exactly what this reader is trying to find.
 * A page that leaves a fence open therefore swallows the NEXT page's title —
 * which surfaces as `missing-locale-title` naming that page. That is the right
 * outcome and the safe direction: an unclosed fence is a real authoring defect
 * that mangles the served body too, and the failure is loud rather than a green
 * over an unread artifact.
 */
function readLlmsFullTitles(text) {
  const titles = [];
  let fence;

  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    const heading = /^#[ \t]+(\S.*)$/.exec(line);
    if (heading) titles.push(heading[1].trim());
  }

  return titles;
}

/* ------------------------------------------------- comparison vocabularies -- */

/**
 * How an artifact's advertised entries are compared with the oracle: what an
 * entry IS, which entries are in scope, whether a repeat is a defect, and the
 * rules and wording a mismatch is reported under.
 *
 * The wording is per-vocabulary rather than shared because a shared message is
 * a wrong message: telling a reader that `データモデル` "is advertised but the
 * content tree has no source file for it" is false twice — it is not a URL and
 * it has a source file. The whole point of the finding is to name what is
 * actually wrong.
 */
const BY_URL = {
  unit: 'URL',
  /** No restriction: every `loc` in a sitemap is an advertised URL. */
  universe: null,
  /**
   * A URL is an identity, so advertising one twice is a defect on its own —
   * the pre-#169 tree emitted 3318 exact duplicates, and de-duplicating on the
   * way in would have hidden every one of them behind a correct distinct count.
   */
  duplicate: {
    rule: 'duplicate-url',
    detail: (spec, url, count) => `${spec.id}: ${url} advertised ${count} times`,
  },
  unexpected: {
    rule: 'unexpected-url',
    detail: (spec, url) =>
      `${spec.id}: ${url} is advertised but the content tree has no source file for it — ` +
      'an untranslated page is being advertised as a translation',
  },
  missing: {
    rule: 'missing-url',
    detail: (spec, url) =>
      `${spec.id}: ${url} has a source file in the content tree but is not advertised — ` +
      'a shipped translation is invisible to crawlers',
  },
};

const BY_LOCALE_EXCLUSIVE_TITLE = {
  unit: 'locale-exclusive title',
  /**
   * Only titles that belong to exactly one locale are compared. Everything else
   * the reader picked up — a title several locales share, a heading inside a
   * page — carries no evidence about which locale's pages are in the body, and
   * including it would make the gate red on content growth. See
   * `localeExclusiveTitles`.
   */
  universe: everyExclusiveTitle,
  /**
   * A title is a label, not an identity: `Approvals`, `Dashboards` and
   * `Notifications` each name two different English pages today. A repeated
   * title is therefore not the defect a repeated URL is, and counting it as one
   * would put three permanent findings on a correct build.
   */
  duplicate: null,
  unexpected: {
    rule: 'unexpected-locale-title',
    detail: (spec, title, surface) => {
      const { lang, file } = ownerOf(title, surface);
      return (
        `${spec.id}: "${title}" is in the body, and that title exists only in ${lang} ` +
        `(${file}) — a non-${surface.defaultLanguage} page is being served here, which is ` +
        "the language argument having been dropped from this route's page lookup"
      );
    },
  },
  missing: {
    rule: 'missing-locale-title',
    detail: (spec, title, surface) => {
      const { file } = ownerOf(title, surface);
      return (
        `${spec.id}: "${title}" is a page title that exists only in ${surface.defaultLanguage} ` +
        `(${file}), and it is NOT in the body — ${surface.defaultLanguage} pages have stopped ` +
        'being served here'
      );
    },
  },
};

/**
 * The artifacts this gate asserts.
 *
 * `file` is relative to the repo root. The built output of a Next.js route
 * handler lands beside a `.meta` and the route module itself; the `.body` file
 * is the bytes actually served.
 *
 * All three are generated from the same `source` loader by the same call shape,
 * and all three have had the language argument dropped from it at some point —
 * `sitemap.ts` (#169), `llms.txt` (#170), `llms-full.txt` (#177) — which is why
 * they belong in one gate rather than three.
 */
const ARTIFACTS = [
  {
    id: 'sitemap.xml',
    file: 'apps/docs/.next/server/app/sitemap.xml.body',
    read: readSitemapUrls,
    expected: expectedSitemapUrls,
    compare: BY_URL,
  },
  {
    id: 'llms.txt',
    file: 'apps/docs/.next/server/app/llms.txt.body',
    read: readLlmsIndexTitles,
    expected: expectedExclusiveTitles,
    compare: BY_LOCALE_EXCLUSIVE_TITLE,
  },
  {
    id: 'llms-full.txt',
    file: 'apps/docs/.next/server/app/llms-full.txt.body',
    read: readLlmsFullTitles,
    expected: expectedExclusiveTitles,
    compare: BY_LOCALE_EXCLUSIVE_TITLE,
  },
];

/* --------------------------------------------- llms body encoding (#282) -- */

/** The one-file consumer: the same body the `llms-full.txt` entry above reads. */
const LLMS_FULL_BODY = ARTIFACTS.find((a) => a.id === 'llms-full.txt').file;

/**
 * The per-page consumer: `app/llms.mdx/docs/[[...slug]]/route.ts`, prerendered
 * to one `.body` file per page. A page at site path `docs/build/data` is
 * served from `/llms.mdx/docs/build/data` and built to
 * `llms.mdx/docs/build/data.body`. Re-declared rather than read out of the
 * route, for the same reason `SITE_URL` is.
 */
const LLMS_MDX_DIR = 'apps/docs/.next/server/app/llms.mdx';

/** The two consumers, by the id every finding and table row names them with. */
const LLMS_CONSUMERS = ['llms-full.txt', 'llms.mdx'];

/** Decimal or hex, the terminating `;` required — what the encoder emits. */
const NUMERIC_REFERENCE = /&#(?:[0-9]+|[xX][0-9a-fA-F]+);/g;

/** Where a markdown link target starts. */
const LINK_OPENER = '](';

/**
 * Printable form of a stretch of body text. Every `&` becomes `AMP` — the
 * tracker convention from #197 — because this output lands in a markdown step
 * summary, and a renderer that decodes the references back into the
 * characters they encode would make the evidence read as the clean text.
 */
const printable = (s) => JSON.stringify(s.replace(/&/g, 'AMP'));

/** 1-based line of a character offset. */
const lineAt = (text, index) => {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line += 1;
  return line;
};

/**
 * Every numeric character reference, every link target, and the targets that
 * are malformed, in one body.
 *
 * A target runs from the `](` to the first `)` or whitespace. Well-formed means
 * the character that stopped it is a literal `)`. The #197 shape is a target
 * whose `)` was itself encoded, so the run goes on through the reference and
 * into the prose until the next space or line break.
 */
function scanBody(text) {
  const references = [...text.matchAll(NUMERIC_REFERENCE)].map((m) => ({ index: m.index, text: m[0] }));

  let targets = 0;
  const malformed = [];
  for (let i = text.indexOf(LINK_OPENER); i !== -1; i = text.indexOf(LINK_OPENER, i + 1)) {
    targets += 1;
    let end = i + LINK_OPENER.length;
    while (end < text.length && text[end] !== ')' && !/\s/.test(text[end])) end += 1;
    if (text[end] !== ')') malformed.push({ index: i, text: text.slice(i, end) });
  }

  const comments = [...text.matchAll(/\{\/\*/g)].map((m) => ({ index: m.index }));

  return { references, targets, malformed, comments };
}

/** Every `.body` file under `dir`, keyed by its path relative to `dir` without `.body`. */
function readBodies(dir, base = dir, out = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) readBodies(p, base, out);
    else if (entry.isFile() && entry.name.endsWith('.body')) {
      out.set(relative(base, p).split('\\').join('/').slice(0, -'.body'.length), p);
    }
  }
  return out;
}

/**
 * Findings and per-consumer tallies for a list of bodies, each
 * `{ consumer, path, text }`. `consumers` names the consumers that were
 * actually found on disk, so one that is present with no bodies in it still
 * gets a tally row — and a `no-link-targets` finding — instead of vanishing.
 *
 * Shared by the gate, the live control and the self-test, and `scan` is a
 * parameter only so that the self-test can hand the live control a blinded
 * scan and watch it go red.
 */
function encodingFindings(bodies, consumers, scan = scanBody) {
  const findings = [];
  const tally = new Map(
    consumers.map((c) => [c, { bodies: 0, references: 0, targets: 0, malformed: 0, comments: 0, kinds: new Map() }]),
  );

  for (const body of bodies) {
    const t = tally.get(body.consumer);
    const found = scan(body.text);
    t.bodies += 1;
    t.references += found.references.length;
    t.targets += found.targets;
    t.malformed += found.malformed.length;
    t.comments += found.comments.length;
    for (const r of found.references) t.kinds.set(r.text, (t.kinds.get(r.text) ?? 0) + 1);

    const where = rel(body.path);
    if (found.references.length) {
      const kinds = new Map();
      for (const r of found.references) kinds.set(r.text, (kinds.get(r.text) ?? 0) + 1);
      const first = found.references[0];
      findings.push({
        rule: 'numeric-character-reference',
        artifact: body.consumer,
        detail:
          `${body.consumer}: ${found.references.length} numeric character reference(s) in ${where} — ` +
          [...kinds].map(([k, n]) => `${k.replace(/&/g, 'AMP')} ×${n}`).join(', ') +
          `; first at line ${lineAt(body.text, first.index)}: ` +
          printable(body.text.slice(Math.max(0, first.index - 24), first.index + first.text.length + 24)),
      });
    }
    if (found.malformed.length) {
      findings.push({
        rule: 'malformed-link-target',
        artifact: body.consumer,
        detail:
          `${body.consumer}: ${found.malformed.length} of ${found.targets} link target(s) in ${where} ` +
          'do not close with a literal ")" — ' +
          found.malformed
            .slice(0, 3)
            .map((m) => `line ${lineAt(body.text, m.index)}: ${printable(m.text.slice(0, 80))}`)
            .join('; '),
      });
    }
    if (found.comments.length) {
      const first = found.comments[0].index;
      findings.push({
        rule: 'mdx-comment',
        artifact: body.consumer,
        detail:
          `${body.consumer}: ${found.comments.length} MDX comment(s) in ${where}; first at line ` +
          `${lineAt(body.text, first)}: ${printable(body.text.slice(first, first + 60))} — an editor's ` +
          'note shipped as text, which `getLLMText` in `apps/docs/lib/source.ts` strips',
      });
    }
  }

  for (const [consumer, t] of tally) {
    if (t.targets === 0) {
      findings.push({
        rule: 'no-link-targets',
        artifact: consumer,
        detail:
          `${consumer}: no "](" link target could be read in ${t.bodies} body file(s), so ` +
          '`malformed-link-target` measured nothing — either the links stopped being ' +
          'inline markdown links or the bodies are empty',
      });
    }
  }

  return { findings, tally };
}

/**
 * The encoding findings for the built bodies, measured against the oracle for
 * which `llms.mdx` bodies must exist.
 *
 * A missing `llms-full.txt` body is not reported here: the `llms-full.txt`
 * entry in `ARTIFACTS` reads the same file and already fails
 * `artifact-missing` on it. A missing `llms.mdx` directory has no such entry,
 * so it is reported here, under the same rule.
 *
 * An oracle with no English page at all cannot make this pass over nothing:
 * it also leaves both `llms` title comparisons with nothing expected, and
 * `nothing-expected` fails the run.
 */
function bodyEncoding({ surface, bodies }) {
  const findings = [];
  const entries = [];
  const consumers = [];

  if (bodies.full) {
    consumers.push('llms-full.txt');
    entries.push({ consumer: 'llms-full.txt', ...bodies.full });
  }

  // Orphans (no English source) are reported separately and have no body.
  const english = [...surface.pages].filter(([, page]) => page.locales.has(surface.defaultLanguage));
  const expected = english.length;
  if (!bodies.mdx) {
    findings.push({
      rule: 'artifact-missing',
      artifact: 'llms.mdx',
      detail:
        `llms.mdx: no built directory at ${LLMS_MDX_DIR} — run \`pnpm turbo run build\` first. ` +
        'Not finding it is a failure, never a skip: a scan of a directory that was never ' +
        'written finds no references.',
    });
  } else {
    consumers.push('llms.mdx');
    for (const [path, page] of english) {
      if (!bodies.mdx.has(path)) {
        findings.push({
          rule: 'llms-page-body-missing',
          artifact: 'llms.mdx',
          detail:
            `llms.mdx: ${path} has an English source (${page.files.get(surface.defaultLanguage)}) ` +
            `but no built body at ${LLMS_MDX_DIR}/${path}.body — that page's served text was ` +
            'never scanned',
        });
      }
    }
    for (const [, body] of bodies.mdx) entries.push({ consumer: 'llms.mdx', ...body });
  }

  const scanned = encodingFindings(entries, consumers);
  return { findings: [...findings, ...scanned.findings], tally: scanned.tally, expected };
}

/**
 * The live negative control: the #197 shape — a link whose closing `)` was
 * encoded — fed through the same scan as the real bodies, once per consumer,
 * before they are judged. Both rules must fire for both consumers, or this
 * run's green would be a claim rather than a measurement.
 */
const CONTROL_BODY =
  '# Dashboards\n\nDescribe the dashboard to [AI Builder](/docs/build/ai-builder&#x29; — ' +
  'it drafts the widgets.\n';

function encodingControl(scan = scanBody) {
  const { findings } = encodingFindings(
    LLMS_CONSUMERS.map((consumer) => ({ consumer, path: join(ROOT, '(negative control)'), text: CONTROL_BODY })),
    LLMS_CONSUMERS,
    scan,
  );
  const fired = new Set(findings.map((f) => `${f.artifact}:${f.rule}`));
  const silent = LLMS_CONSUMERS.flatMap((c) =>
    ['numeric-character-reference', 'malformed-link-target']
      .filter((rule) => !fired.has(`${c}:${rule}`))
      .map((rule) => `${c}:${rule}`),
  );

  if (silent.length === 0) {
    return {
      findings: [],
      line:
        'Live negative control: the #197 shape (a link target whose `)` is encoded as `AMP#x29;`) ' +
        'was fed through this scan for both consumers and fired `numeric-character-reference` and ' +
        '`malformed-link-target` for each — the scan below can go red, so its result is a measurement.',
    };
  }
  return {
    findings: [
      {
        rule: CONTROL_RULE,
        detail:
          `the #197 shape was fed through the encoding scan and ${silent.join(', ')} stayed silent — ` +
          'this scan cannot currently tell an encoded body from a clean one, so its result on the ' +
          'real bodies means nothing',
      },
    ],
    line: `Live negative control: FAILED — ${silent.join(', ')} did not fire on the #197 shape.`,
  };
}

/**
 * Which `fumadocs-core` the docs app resolves, and which version(s) a patch is
 * pinned to. Diagnosis only — printed beside the table, never a finding —
 * because a mismatch is the likeliest reason the table above it is red, and
 * the one a Dependabot bump produces.
 */
function fumadocsPin(root) {
  const pinned = new Set();
  for (const file of ['package.json', 'pnpm-workspace.yaml']) {
    try {
      const text = readFileSync(join(root, file), 'utf8');
      for (const m of text.matchAll(/["']?fumadocs-core@([0-9][^"':\s]*)["']?\s*:/g)) pinned.add(m[1]);
    } catch {
      // absent file: nothing pinned there
    }
  }
  let installed;
  try {
    installed = JSON.parse(
      readFileSync(join(root, 'apps/docs/node_modules/fumadocs-core/package.json'), 'utf8'),
    ).version;
  } catch {
    installed = undefined;
  }
  return { pinned: [...pinned], installed };
}

/* ------------------------------------------- built docs pages (#308) -- */

/** Where Next writes the prerendered HTML: `<locale>/docs/<slug>.html`. */
const PAGES_DIR = 'apps/docs/.next/server/app';

/** Attributes whose value is (part of) an element's accessible name. */
const NAME_ATTRIBUTES = ['aria-label', 'title', 'alt', 'placeholder'];

/**
 * Names that are the same word in every language: a proper noun and a host
 * name. They appear on the English pages and, rightly, verbatim on every
 * other locale's. Anything added here is a claim that the string needs no
 * translation; a translation that happens to equal its English source is the
 * other reason to add one, and the finding says so.
 */
const LANGUAGE_NEUTRAL_NAMES = new Set(['GitHub', 'www.objectos.ai']);

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

/** Elements whose content is not markup: the RSC payload lives in `<script>`. */
const SKIPPED_ELEMENTS = new Set(['script', 'style', 'template']);

const decodeHtml = (s) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&');

const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** Text or a double-quoted attribute value, made safe to put back into HTML. */
const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `en` for `en`, `en-US`; `zh` for `zh-Hans`. Undefined stays undefined. */
const primaryLanguage = (tag) => tag?.toLowerCase().split('-')[0];

const TAG = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function readAttributes(source) {
  const attributes = new Map();
  for (const m of source.matchAll(ATTRIBUTE)) {
    attributes.set(m[1].toLowerCase(), decodeHtml(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attributes;
}

/**
 * The two things this gate reads off one built page, with the language each
 * resolves to (the nearest `lang`, as a screen reader would apply it):
 *
 *   - `names`: every accessible name — the `NAME_ATTRIBUTES` values, `svg`
 *     `<title>` text and `.sr-only` text;
 *   - `links`: every `<a href>`, its text nodes, and whether it sits inside
 *     the page body (`.prose`, fumadocs' `DocsBody`).
 *
 * Both leave out anything under `aria-hidden="true"`, which nobody hears.
 *
 * A small tag scanner rather than a parser: this gate takes no dependencies,
 * and React's server output is regular — every attribute quoted, every
 * non-void element closed. A stray close tag pops to its opener or is
 * ignored. The content of `script`, `style` and `template` is skipped whole,
 * which is what keeps the RSC payload, a JSON copy of every string on the
 * page, from reading as markup.
 */
function readHtml(text) {
  const names = [];
  const links = [];
  const stack = [{ tag: '#document', lang: undefined, content: false, hidden: false, srOnly: false, svg: false, link: null }];
  const top = () => stack[stack.length - 1];

  const addText = (raw) => {
    const value = squash(decodeHtml(raw));
    if (!value) return;
    const frame = top();
    if (frame.hidden) return;
    if (frame.link) frame.link.texts.push({ text: value, lang: frame.lang });
    if (frame.srOnly) names.push({ value, lang: frame.lang, where: 'sr-only text' });
    else if (frame.svg && frame.tag === 'title') names.push({ value, lang: frame.lang, where: 'svg title' });
  };

  let last = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(text); m; m = TAG.exec(text)) {
    addText(text.slice(last, m.index));
    last = TAG.lastIndex;
    if (m[0].startsWith('<!--')) continue;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();

    if (closing) {
      const at = stack.findLastIndex((frame) => frame.tag === tag);
      if (at > 0) stack.length = at;
      continue;
    }

    if (SKIPPED_ELEMENTS.has(tag)) {
      const close = new RegExp(`</${tag}`, 'gi');
      close.lastIndex = TAG.lastIndex;
      const end = close.exec(text)?.index ?? text.length;
      last = end;
      TAG.lastIndex = end;
      continue;
    }

    const attributes = readAttributes(m[3]);
    const parent = top();
    const classes = (attributes.get('class') ?? '').split(/\s+/);
    const frame = {
      tag,
      lang: attributes.has('lang') ? attributes.get('lang') : parent.lang,
      content: parent.content || classes.includes('prose'),
      hidden: parent.hidden || attributes.get('aria-hidden') === 'true',
      srOnly: parent.srOnly || classes.includes('sr-only'),
      svg: parent.svg || tag === 'svg',
      link: parent.link,
    };

    if (!frame.hidden) {
      for (const name of NAME_ATTRIBUTES) {
        const value = squash(attributes.get(name) ?? '');
        if (value) names.push({ value, lang: frame.lang, where: name });
      }
    }
    if (tag === 'a' && attributes.has('href')) {
      frame.link = { href: attributes.get('href'), content: frame.content, texts: [] };
      links.push(frame.link);
    }

    if (!VOID_ELEMENTS.has(tag) && !m[3].trimEnd().endsWith('/')) stack.push(frame);
  }
  addText(text.slice(last));

  return { names, links };
}

/** Every `.html` file under `dir`, keyed by its path relative to `dir` without `.html`. */
function readHtmlFiles(dir, base = dir, out = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) readHtmlFiles(p, base, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.set(relative(base, p).split('\\').join('/').slice(0, -'.html'.length), p);
    }
  }
  return out;
}

/**
 * The built pages of every locale, read: `<locale>.html` and everything under
 * `<locale>/`. `null` when the build directory does not exist at all.
 */
function collectPages(root, languages, read = readHtml) {
  const dir = join(root, PAGES_DIR);
  if (!existsSync(dir)) return null;
  const pages = new Map();
  for (const lang of languages) {
    const own = new Map();
    const index = join(dir, `${lang}.html`);
    if (existsSync(index)) own.set(lang, { path: index, ...read(readFileSync(index, 'utf8')) });
    const sub = join(dir, lang);
    if (existsSync(sub)) {
      for (const [page, path] of readHtmlFiles(sub)) {
        own.set(`${lang}/${page}`, { path, ...read(readFileSync(path, 'utf8')) });
      }
    }
    pages.set(lang, own);
  }
  return pages;
}

/** The logical docs path a link targets in `lang`, or null: `/de/docs/build/data#x` → `docs/build/data`. */
function docsTarget(href, lang, defaultLanguage) {
  const prefix = lang === defaultLanguage ? '' : `/${lang}`;
  if (!href.startsWith(`${prefix}/docs`)) return null;
  const m = /^\/docs(?:\/([^?#]*?))?\/?(?:[?#].*)?$/.exec(href.slice(prefix.length));
  return m ? (m[1] ? `docs/${m[1]}` : 'docs') : null;
}

/**
 * The English site's chrome names: every accessible name on the built English
 * pages, minus `LANGUAGE_NEUTRAL_NAMES`, each mapped to how many times those
 * pages carry it, which is printed.
 */
function englishChromeNames(pages, defaultLanguage) {
  const chrome = new Map();
  for (const [, page] of pages.get(defaultLanguage) ?? []) {
    for (const { value } of page.names) {
      if (!LANGUAGE_NEUTRAL_NAMES.has(value)) chrome.set(value, (chrome.get(value) ?? 0) + 1);
    }
  }
  return chrome;
}

/**
 * One locale's own chrome names (#308 review): every accessible name on that
 * locale's built pages that resolves to the locale itself, minus the English
 * set and `LANGUAGE_NEUTRAL_NAMES`, each mapped to how many times it appears
 * there. Read off the build, like the English set, so it needs no copy of
 * `lib/ui-text`: a heading-anchor or code-copy name shows up on a translated
 * page, where the body is in the locale. What it cannot see is a name that
 * ONLY ever appears inside an English body, which needs a locale with no
 * translated page at all; every locale has translated pages today.
 */
function localChromeNames(own, lang, chrome) {
  const local = new Map();
  for (const [, page] of own ?? []) {
    for (const { value, lang: resolved } of page.names) {
      if (primaryLanguage(resolved) !== primaryLanguage(lang)) continue;
      if (chrome.has(value) || LANGUAGE_NEUTRAL_NAMES.has(value)) continue;
      local.set(value, (local.get(value) ?? 0) + 1);
    }
  }
  return local;
}

/**
 * Findings for one locale's built pages, and its tallies. Shared by the gate,
 * the live control and the self-test.
 */
function pageFindings({ surface, lang, pages, chrome, local = new Map() }) {
  const { defaultLanguage } = surface;
  const findings = [];
  const t = { pages: 0, names: 0, english: 0, localEnglish: 0, untranslated: 0, unmarked: 0, translated: 0, markedEnglish: 0 };

  for (const [id, page] of pages) {
    t.pages += 1;
    const where = page.path === undefined ? id : rel(page.path);

    for (const name of page.names) {
      t.names += 1;
      // The inverse (#308 review): this locale's own name inside an English
      // region with no `lang` of its own, read with English rules.
      if (
        lang !== defaultLanguage &&
        local.has(name.value) &&
        primaryLanguage(name.lang) === primaryLanguage(defaultLanguage)
      ) {
        t.localEnglish += 1;
        findings.push({
          rule: 'localized-name-marked-english',
          artifact: 'docs pages',
          detail:
            `${where}: ${name.where} "${name.value}" is a ${lang} chrome name (×${local.get(name.value)} on ` +
            `the ${lang} pages) inside a lang="${name.lang}" region with no lang of its own — it is read to a ` +
            `${lang} reader with English rules. Give the element lang="${lang}" (the heading-anchor and ` +
            'code-copy buttons take it from `useI18n().locale` in `patches/fumadocs-ui@16.15.2.patch`)',
        });
        continue;
      }
      if (!chrome.has(name.value) || primaryLanguage(name.lang) === primaryLanguage(defaultLanguage)) continue;
      t.english += 1;
      findings.push({
        rule: 'english-chrome-name',
        artifact: 'docs pages',
        detail:
          `${where}: ${name.where} "${name.value}" is an English chrome name (×${chrome.get(name.value)} on ` +
          `the English pages) in a page whose language there is "${name.lang ?? 'none'}" — it is read to a ` +
          `${lang} reader in English with ${lang} pronunciation. Localize it through ` +
          '`apps/docs/lib/ui-text`; if the string is really the same in every language, add it to ' +
          '`LANGUAGE_NEUTRAL_NAMES` and say why',
      });
    }

    if (lang === defaultLanguage) continue;
    for (const link of page.links) {
      if (link.content) continue;
      const path = docsTarget(link.href, lang, defaultLanguage);
      const target = path && surface.pages.get(path);
      if (!target || !target.locales.has(defaultLanguage)) continue;

      const translated = target.locales.has(lang);
      const title = target.titles.get(translated ? lang : defaultLanguage);
      // Joined with a space: each text node arrives trimmed, and "Why" + "ObjectOS"
      // has to read as "Why ObjectOS" again.
      if (!title || !squash(link.texts.map((x) => x.text).join(' ')).includes(squash(title))) continue;

      const english = (x) => primaryLanguage(x.lang) === primaryLanguage(defaultLanguage);
      if (translated) {
        t.translated += 1;
        const wrong = link.texts.filter(english);
        if (wrong.length === 0) continue;
        t.markedEnglish += 1;
        findings.push({
          rule: 'translated-entry-marked-english',
          artifact: 'docs pages',
          detail:
            `${where}: the entry for ${path} ("${title}") is marked lang="${defaultLanguage}", but ${lang} ` +
            `has its own page (${target.files.get(lang)}) — a ${lang} title is being read as English`,
        });
      } else {
        t.untranslated += 1;
        const wrong = link.texts.filter((x) => !english(x));
        if (wrong.length === 0) continue;
        t.unmarked += 1;
        findings.push({
          rule: 'untranslated-entry-unmarked',
          artifact: 'docs pages',
          detail:
            `${where}: the entry for ${path} shows its English title "${title}" (${lang} has no ` +
            `source file for it) but ${wrong.map((x) => `"${x.text}"`).join(', ')} resolves to ` +
            `lang="${wrong[0].lang ?? 'none'}" — mark it lang="${defaultLanguage}" (the page-tree ` +
            'transform in `app/[lang]/docs/layout.tsx`)',
        });
      }
    }
  }

  return { findings, tally: t };
}

/**
 * The live control: the two #305 shapes, built from THIS run's oracle values
 * — a real English chrome name on a button, and a real untranslated page's
 * English title in an unmarked sidebar link — read through `read` and judged
 * by `pageFindings`, before the real pages are. Both rules must fire, or the
 * run's green over the real pages is a claim rather than a measurement.
 */
function pagesControl(surface, chrome, localByLang = new Map(), read = readHtml) {
  const lang = surface.languages.find((l) => l !== surface.defaultLanguage);
  const untranslated = [...surface.pages].find(
    ([, p]) => p.locales.has(surface.defaultLanguage) && !p.locales.has(lang) && p.titles.has(surface.defaultLanguage),
  );
  const name = chrome.keys().next().value;
  const local = localByLang.get(lang) ?? new Map();
  const localName = local.keys().next().value;
  if (!lang || !untranslated || name === undefined || localName === undefined) {
    return {
      findings: [],
      line: 'Live negative control: not constructible on this tree (no second locale, no untranslated page, or no chrome name in English or in that locale); the rules above say why.',
    };
  }

  const [path, page] = untranslated;
  const html =
    `<!DOCTYPE html><html lang="${lang}"><body><aside id="nd-sidebar">` +
    `<button aria-label="${escapeHtml(name)}"></button>` +
    `<a href="/${lang}/${path}">${escapeHtml(page.titles.get(surface.defaultLanguage))}</a>` +
    `</aside><div class="prose" lang="${surface.defaultLanguage}"><button aria-label="${escapeHtml(localName)}"></button></div>` +
    '</body></html>';
  const { findings } = pageFindings({
    surface,
    lang,
    pages: new Map([['(negative control)', read(html)]]),
    chrome,
    local,
  });
  const fired = new Set(findings.map((f) => f.rule));
  const silent = ['english-chrome-name', 'untranslated-entry-unmarked', 'localized-name-marked-english'].filter(
    (r) => !fired.has(r),
  );
  if (silent.length === 0) {
    return {
      findings: [],
      line:
        `Live negative control: a ${lang} page with the English name "${name}" on a button, ` +
        `${path}'s English title unmarked in its sidebar, and the ${lang} name "${localName}" on a button ` +
        'inside lang="en" fired `english-chrome-name`, `untranslated-entry-unmarked` and ' +
        '`localized-name-marked-english` — the scan below can go red, so its result is a measurement.',
    };
  }
  return {
    findings: [
      {
        rule: CONTROL_RULE,
        detail:
          `the #305 shapes and their inverse were fed through the built-page scan and ${silent.join(', ')} stayed ` +
          'silent — this scan cannot currently tell a marked page from an unmarked one, so its result ' +
          'on the real pages means nothing',
      },
    ],
    line: `Live negative control: FAILED — ${silent.join(', ')} did not fire on the #305 shapes or their inverse.`,
  };
}

/** Every rule over the built pages, plus the guards that keep it from passing over nothing. */
function builtPages({ surface, pages }) {
  const { languages, defaultLanguage } = surface;
  const findings = [];
  const tally = new Map();

  // No docs page in any locale is one finding, not one per page: the build
  // did not run (or not this far), which `artifact-missing` already names.
  // Docs pages only: the legal pages and the locale roots live in the same
  // directories and say nothing about whether the docs were built.
  const isDocsPage = (id) => /^[^/]+\/docs(?:\/|$)/.test(id);
  if (!pages || [...pages.values()].every((own) => ![...own.keys()].some(isDocsPage))) {
    findings.push({
      rule: 'artifact-missing',
      artifact: 'docs pages',
      detail:
        `docs pages: no built page under ${PAGES_DIR}/<locale>/ — run \`pnpm turbo run build\` first. ` +
        'Not finding them is a failure, never a skip.',
    });
    return { findings, tally, chrome: new Map(), local: new Map() };
  }

  for (const [path, page] of surface.pages) {
    if (!page.locales.has(defaultLanguage)) continue;
    for (const lang of languages) {
      if (!pages.get(lang).has(`${lang}/${path}`)) {
        findings.push({
          rule: 'docs-page-html-missing',
          artifact: 'docs pages',
          detail:
            `${lang}: ${path} has an English source (${page.files.get(defaultLanguage)}) but no built ` +
            `page at ${PAGES_DIR}/${lang}/${path}.html — that page's chrome and page tree were never read`,
        });
      }
    }
  }

  const chrome = englishChromeNames(pages, defaultLanguage);
  if (chrome.size === 0) {
    findings.push({
      rule: 'no-chrome-names',
      artifact: 'docs pages',
      detail:
        `no accessible name could be read off the ${pages.get(defaultLanguage).size} built ` +
        `${defaultLanguage} page(s), so \`english-chrome-name\` compared nothing — either the reader ` +
        'went blind or every name is in `LANGUAGE_NEUTRAL_NAMES`',
    });
  }

  const local = new Map(
    languages.filter((l) => l !== defaultLanguage).map((l) => [l, localChromeNames(pages.get(l), l, chrome)]),
  );

  for (const lang of languages) {
    const result = pageFindings({ surface, lang, pages: pages.get(lang), chrome, local: local.get(lang) });
    findings.push(...result.findings);
    tally.set(lang, result.tally);
    if (lang === defaultLanguage) continue;

    const english = [...surface.pages.values()].filter((p) => p.locales.has(defaultLanguage));
    for (const [kind, want, got] of [
      ['untranslated', english.filter((p) => !p.locales.has(lang)).length, result.tally.untranslated],
      ['translated', english.filter((p) => p.locales.has(lang)).length, result.tally.translated],
    ]) {
      if (want > 0 && got === 0) {
        findings.push({
          rule: 'no-tree-entries',
          artifact: 'docs pages',
          detail:
            `${lang}: the content tree has ${want} ${kind} page(s), each with an entry in its own ` +
            `sidebar, but no ${kind} page-tree entry could be recognised in ${result.tally.pages} built ` +
            'page(s) — the entry rules measured nothing for this kind',
        });
      }
    }
  }

  return { findings, tally, chrome, local };
}

/* ---------------------------------------------------------------- collect -- */

function collect(root) {
  const { languages, defaultLanguage } = readI18n(root);
  const { pages, orphans } = readDocsPages(root, { languages, defaultLanguage });
  const surface = { languages, defaultLanguage, pages, orphans };
  surface.exclusiveTitles = localeExclusiveTitles(surface);

  const artifacts = ARTIFACTS.map((spec) => {
    const path = join(root, spec.file);
    if (!existsSync(path)) return { spec, found: false, path, advertised: [] };
    return { spec, found: true, path, advertised: spec.read(readFileSync(path, 'utf8')) };
  });

  // The encoding rules read the bodies as TEXT, not as the entries the
  // readers above extract, so they are collected on their own.
  const fullPath = join(root, LLMS_FULL_BODY);
  const mdxDir = join(root, LLMS_MDX_DIR);
  const bodies = {
    full: existsSync(fullPath) ? { path: fullPath, text: readFileSync(fullPath, 'utf8') } : null,
    mdx: existsSync(mdxDir)
      ? new Map(
          [...readBodies(mdxDir)].map(([page, path]) => [page, { path, text: readFileSync(path, 'utf8') }]),
        )
      : null,
    // The built legal pages (#312), read as text too: their `<main>` text nodes.
    legal: { pages: collectLegalPages(root, languages) },
  };

  // Read as they are found and kept only as names and links: the HTML is
  // most of a hundred megabytes, the extract a small fraction of it.
  const html = collectPages(root, languages);

  return { surface, artifacts, bodies, html };
}

/* --------------------------------------------------------------- evaluate -- */

function evaluate({ surface, artifacts, bodies, html }) {
  const findings = [];
  const { defaultLanguage, languages } = surface;

  for (const orphan of surface.orphans) {
    findings.push({
      rule: 'translation-orphan',
      detail:
        `${orphan.path} has ${orphan.locales.join(', ')} but no ${defaultLanguage} source ` +
        `(${orphan.files.join(', ')}) — English is the authored source for every page, so ` +
        'this page has no canonical URL to advertise',
    });
  }

  for (const offender of dottedSlugPages(surface)) {
    findings.push({
      rule: 'dotted-slug',
      detail:
        `${offender.path} has a dot in its slug (${offender.files.join(', ')}) — ` +
        "middleware.ts's dot exemption (`.*\\..*`, unanchored) skips the locale rewrite for " +
        "any path containing a dot, so this page's default-locale URL 404s at its own public " +
        'address while every other locale, which does not depend on the rewrite, still serves ' +
        'it (#208)',
    });
  }

  // The legal pages (#312). The rows hang off `bodies.legal`, as the artifact
  // tallies below hang off each artifact, for the summary to print.
  const legal = legalPages({ surface, pages: bodies.legal.pages });
  findings.push(...legal.findings);
  bodies.legal.rows = legal.rows;

  for (const artifact of artifacts) {
    const { spec } = artifact;

    if (!artifact.found) {
      findings.push({
        rule: 'artifact-missing',
        artifact: spec.id,
        detail:
          `${spec.id}: no built artifact at ${rel(artifact.path)} — run \`pnpm turbo run build\` ` +
          'first. This gate reads the build output on purpose; not finding it is a failure, ' +
          'never a skip.',
      });
      continue;
    }

    if (artifact.advertised.length === 0) {
      findings.push({
        rule: 'artifact-empty',
        artifact: spec.id,
        detail:
          `${spec.id}: ${rel(artifact.path)} exists but no entries could be read out of it — ` +
          'either the artifact is empty or its format changed and this reader is now silently ' +
          'returning nothing',
      });
      continue;
    }

    const { compare } = spec;
    const expected = spec.expected(surface);

    // An oracle that expects nothing cannot contradict anything, so a green
    // over it is a claim and not a measurement — the same reason `artifact-empty`
    // above is a failure rather than a skip. It is reachable only for a
    // vocabulary with a `universe` in practice: the sitemap's expected set
    // holds the legal pages in every locale `STATIC_PAGES` names, so it is
    // empty only for a locale list that declares none of them.
    if (expected.size === 0) {
      findings.push({
        rule: 'nothing-expected',
        artifact: spec.id,
        detail:
          `${spec.id}: the oracle produced no ${defaultLanguage} ${compare.unit}(s), so nothing ` +
          'about this artifact was actually compared — the content tree can no longer ' +
          'distinguish this artifact being right from it being wrong',
      });
      continue;
    }

    // Entries outside the vocabulary's universe carry no evidence either way
    // and are dropped before the comparison — but AFTER `artifact-empty` above,
    // which stays a pure question about the format: did the reader read
    // anything at all.
    const universe = compare.universe?.(surface);
    const inScope = universe
      ? artifact.advertised.filter((entry) => universe.has(entry))
      : artifact.advertised;

    const seen = new Map();
    for (const entry of inScope) seen.set(entry, (seen.get(entry) ?? 0) + 1);

    if (compare.duplicate) {
      for (const [entry, count] of seen) {
        if (count > 1) {
          findings.push({
            rule: compare.duplicate.rule,
            artifact: spec.id,
            detail: compare.duplicate.detail(spec, entry, count),
          });
        }
      }
    }

    const unexpected = [...seen.keys()].filter((e) => !expected.has(e)).sort();
    const missing = [...expected].filter((e) => !seen.has(e)).sort();

    for (const entry of unexpected) {
      findings.push({
        rule: compare.unexpected.rule,
        artifact: spec.id,
        detail: compare.unexpected.detail(spec, entry, surface),
      });
    }
    for (const entry of missing) {
      findings.push({
        rule: compare.missing.rule,
        artifact: spec.id,
        detail: compare.missing.detail(spec, entry, surface),
      });
    }

    artifact.report = {
      read: artifact.advertised.length,
      total: inScope.length,
      distinct: seen.size,
      expected: expected.size,
      unexpected: unexpected.length,
      missing: missing.length,
      duplicates: compare.duplicate ? [...seen.values()].filter((c) => c > 1).length : null,
    };
  }

  const encoding = bodyEncoding({ surface, bodies });
  findings.push(...encoding.findings);

  const built = builtPages({ surface, pages: html });
  findings.push(...built.findings);

  // Per-locale docs composition, for the summary. Reported whether or not the
  // run is green: a green with the counts printed is a measurement, a bare
  // green is a claim.
  const perLocale = {};
  for (const lang of languages) perLocale[lang] = 0;
  for (const [, page] of surface.pages) {
    if (!page.locales.has(defaultLanguage)) continue;
    for (const lang of languages) if (page.locales.has(lang)) perLocale[lang] += 1;
  }

  return { findings, perLocale, encoding, built };
}

/* ------------------------------------------------------------------- gate -- */

function gate() {
  // One collect, one evaluate: `evaluate` hangs the per-artifact tallies off
  // the objects it was handed, so re-collecting would print a table of dashes
  // over a run that really did measure something.
  const collected = collect(ROOT);
  const { findings, perLocale, encoding, built } = evaluate(collected);
  const { surface, artifacts } = collected;

  // Run before the real bodies are judged, and its findings join theirs: a
  // scan that cannot go red on the #197 shape fails this run by itself.
  const control = encodingControl();
  findings.push(...control.findings);

  // The same for the built pages and the #305 shapes (#308).
  const pagesLive = pagesControl(surface, built.chrome, built.local);
  findings.push(...pagesLive.findings);

  const docsTotal = Object.values(perLocale).reduce((a, b) => a + b, 0);
  const logical = [...surface.pages.values()].filter((p) =>
    p.locales.has(surface.defaultLanguage),
  ).length;

  console.log('## Locale surface\n');
  console.log(
    `Oracle: **${logical}** logical docs page(s) over ${surface.languages.length} locale(s) ` +
      `= **${docsTotal}** docs entries, derived from \`content/docs/\` and ` +
      '`apps/docs/lib/i18n.ts`.\n',
  );
  console.log('| locale | docs entries |');
  console.log('|---|---:|');
  for (const [lang, n] of Object.entries(perLocale)) console.log(`| \`${lang}\` | ${n} |`);
  console.log('');

  // `read` and `in scope` differ only for a vocabulary that restricts the
  // comparison to a universe. Both are printed so that the restriction is
  // visible: a gate quietly ignoring most of what it read is the same failure
  // as a gate that read nothing.
  console.log('| artifact | compared as | read | in scope | distinct | expected | unexpected | missing | duplicated |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const a of artifacts) {
    const r = a.report;
    console.log(
      r
        ? `| \`${a.spec.id}\` | ${a.spec.compare.unit} | ${r.read} | ${r.total} | ${r.distinct} | ` +
            `${r.expected} | ${r.unexpected} | ${r.missing} | ${r.duplicates ?? 'n/a'} |`
        : `| \`${a.spec.id}\` | ${a.spec.compare.unit} | — | — | — | — | — | — | — |`,
    );
  }
  console.log('');

  // #312: what each built legal page shows, against `STATIC_PAGES`.
  console.log('## Legal pages: written, or English marked `lang="en"`\n');
  console.log('| page | written in this locale | `<main>` text nodes | English-page text | wrong |');
  console.log('|---|---|---:|---:|---:|');
  for (const r of collected.bodies.legal.rows ?? []) {
    console.log(`| \`${r.page}\` | ${r.written ? 'yes' : 'no, English fallback'} | ${r.texts} | ${r.english} | ${r.wrong} |`);
  }
  console.log(
    '\n`wrong` counts, on a fallback, English-page text not resolving to `lang="en"`; on a written page, ' +
      'English-page text or text marked English.\n',
  );

  console.log('## `llms` bodies are markdown, not HTML\n');
  console.log(
    'In this section `AMP` stands for one literal ampersand, so that a markdown renderer cannot ' +
      'decode a reference back into the character it encodes and make the evidence read clean.\n',
  );
  console.log(`${control.line}\n`);
  console.log('| consumer | bodies read | bodies expected | numeric references | link targets | malformed targets | MDX comments |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const consumer of LLMS_CONSUMERS) {
    const t = encoding.tally.get(consumer);
    const expected = consumer === 'llms.mdx' ? encoding.expected : 1;
    console.log(
      t
        ? `| \`${consumer}\` | ${t.bodies} | ${expected} | ${t.references} | ${t.targets} | ${t.malformed} | ${t.comments} |`
        : `| \`${consumer}\` | NOT MEASURED — not built | ${expected} | — | — | — | — |`,
    );
  }
  for (const [consumer, t] of encoding.tally) {
    if (!t.kinds.size) continue;
    console.log(
      `\nReferences by kind in \`${consumer}\`: ` +
        [...t.kinds]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `\`${k.replace(/&/g, 'AMP')}\` ×${n}`)
          .join(', '),
    );
  }
  const pin = fumadocsPin(ROOT);
  console.log(
    `\n\`fumadocs-core\` resolved by \`apps/docs\`: **${pin.installed ?? 'not found'}** · ` +
      `patch pinned to: **${pin.pinned.join(', ') || 'none'}**` +
      (pin.installed && pin.pinned.length && !pin.pinned.includes(pin.installed)
        ? ' — the pin does not name the installed version, so pnpm applied no patch to it. ' +
          'Regenerate it against the new version (`pnpm patch fumadocs-core@<version>`), or drop it ' +
          'if that version carries the upstream `peek` fix; see `patches/fumadocs-core@16.15.2.patch`.'
        : ''),
  );
  console.log('');

  console.log('## Built pages: chrome names and page-tree languages\n');
  console.log(`${pagesLive.line}\n`);
  console.log(
    `English chrome names read off the built \`${surface.defaultLanguage}\` pages: ` +
      ([...built.chrome].map(([name, n]) => `"${name}" ×${n}`).join(', ') || 'none') +
      `. Language-neutral, not compared: ${[...LANGUAGE_NEUTRAL_NAMES].map((n) => `"${n}"`).join(', ')}.\n`,
  );
  console.log(
    '| locale | pages read | names read | English chrome names | own names read as English | untranslated entries | of them unmarked | translated entries | of them marked English |',
  );
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const lang of surface.languages) {
    const t = built.tally.get(lang);
    const tree = lang === surface.defaultLanguage;
    console.log(
      t
        ? `| \`${lang}\` | ${t.pages} | ${t.names} | ${tree ? 'n/a (the oracle)' : t.english} | ` +
            `${tree ? 'n/a' : `${t.localEnglish} (of ${built.local.get(lang)?.size ?? 0} own names)`} | ` +
            `${tree ? 'n/a' : t.untranslated} | ${tree ? 'n/a' : t.unmarked} | ${tree ? 'n/a' : t.translated} | ` +
            `${tree ? 'n/a' : t.markedEnglish} |`
        : `| \`${lang}\` | NOT MEASURED — not built | — | — | — | — | — | — | — |`,
    );
  }
  console.log('');

  if (findings.length === 0) {
    console.log(
      '✓ every advertised URL has a source file and every source file is advertised; both ' +
        `\`llms\` bodies carry every ${surface.defaultLanguage}-only page title and none from ` +
        'the other locales; no page slug in the content tree contains a dot; neither ' +
        '`llms` consumer carries a numeric character reference, a malformed link target or an MDX comment; ' +
        `and no built page outside \`${surface.defaultLanguage}\` names a control in English, ` +
        'reads one of its own names inside lang="en" with English rules, ' +
        'shows an untranslated page-tree entry without lang="en", or marks a translated one English',
    );
    return;
  }

  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f.detail);
  }

  console.log(`✗ **${findings.length}** locale-surface finding(s)\n`);
  for (const [rule, details] of byRule) {
    console.log(`**${rule}** — ${details.length}\n`);
    for (const d of details.slice(0, 15)) console.log(`  - ${d}`);
    if (details.length > 15) console.log(`  - …and ${details.length - 15} more`);
    console.log('');
  }

  console.error(`\n✗ locale surface: ${findings.length} finding(s)`);
  process.exit(1);
}

/* -------------------------------------------------------------- self-test --
 * 裁决 (PR #74): a validator observed only green is indistinguishable from one
 * that cannot go red. Every rule ships the fixture that trips it, and the
 * assertion is on the EXACT set of rules fired — a fixture that goes red for
 * the wrong reason proves nothing about the rule it was written for.
 *
 * Fixtures are whole repo-shaped trees written to a temp directory and read
 * back through `collect()`, so the readers are exercised too: a gate whose
 * rules are all provably able to fire, wired to a reader that silently returns
 * nothing, is still a gate that cannot go red.
 */

const I18N_FIXTURE = `import { defineI18n } from 'fumadocs-core/i18n';
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'zh-Hans', 'ja'],
  hideLocale: 'default-locale',
});
`;

/** An `.mdx` fixture file: frontmatter title plus body, the shape the oracle reads. */
const mdx = (title, body = 'Body text.') => `---\ntitle: ${title}\n---\n\n${body}`;

/**
 * A page in every fixture tree: English plus a real Japanese translation.
 *
 * The titles matter as much as the paths now. `Home`, `Guide` and `Deep` are
 * `en`-exclusive; `ガイド` is `ja`-exclusive; between them they are the whole
 * universe the `llms` vocabulary compares in.
 */
const BASE_CONTENT = {
  'index.mdx': mdx('Home'),
  'guide.mdx': mdx('Guide'),
  'guide.ja.mdx': mdx('ガイド'),
  'deep/index.mdx': mdx('Deep'),
};

/** The `en`-exclusive titles of `BASE_CONTENT`, in the order a correct body lists them. */
const BASE_TITLES = ['Home', 'Guide', 'Deep'];

/**
 * The sitemap the base fixture SHOULD produce: the two legal pages in their
 * two locales, `docs` and `docs/deep` in English only, and `docs/guide` in
 * English and Japanese. No root in any locale — see `STATIC_PAGES`.
 */
const BASE_URLS = [
  'https://docs.objectos.ai/privacy',
  'https://docs.objectos.ai/zh-Hans/privacy',
  'https://docs.objectos.ai/terms',
  'https://docs.objectos.ai/zh-Hans/terms',
  'https://docs.objectos.ai/docs',
  'https://docs.objectos.ai/docs/guide',
  'https://docs.objectos.ai/ja/docs/guide',
  'https://docs.objectos.ai/docs/deep',
];

/** Each fixture locale's legal copy (#312): a title and a body line, and the fallback notice. */
const LEGAL_FIXTURE = {
  en: { privacy: 'Privacy Policy', terms: 'Terms of Service', body: 'We collect request logs.', back: '← Back to home' },
  'zh-Hans': { privacy: '隐私政策', terms: '服务条款', body: '我们收集请求日志。', back: '← 返回首页' },
  ja: { notice: 'このページはまだ翻訳されていません。英語で表示しています。' },
};

/**
 * The legal pages a correct build produces (#312), keyed `<locale>/<path>` like
 * `collectLegalPages`: each `STATIC_PAGES` path in every fixture locale. A
 * listed locale (en, zh-Hans) shows its own copy. `ja` is not listed, so it
 * shows the notice in Japanese and then the English entry, marked `lang="en"`.
 * Nested the way the real page is: `HomeLayout`'s `<main>` holds its header,
 * whose brand text is the same on every locale, and the page's `<article>`.
 * Every page carries an RSC-payload `<script>` with the English title in it,
 * which a reader that did not skip scripts would take for English text on the
 * `zh-Hans` page. No accessible names and no `/docs` links: these fixtures share
 * the build directory with other built-page fixtures.
 */
function legalFixturePages({ languages, defaultLanguage }) {
  const files = {};
  const en = LEGAL_FIXTURE[defaultLanguage];
  for (const { path, locales } of STATIC_PAGES) {
    for (const lang of languages) {
      const own = locales.includes(lang) ? LEGAL_FIXTURE[lang] : null;
      const mark = own ? '' : ` lang="${defaultLanguage}"`;
      const t = own ?? en;
      files[`${lang}/${path}`] =
        `<!DOCTYPE html><html lang="${lang}"><head><title>${t[path]}</title></head><body>` +
        '<main id="nd-home-layout"><header id="nd-nav"><nav><a href="/">ObjectOS</a></nav></header><article class="mx-auto">' +
        (own ? '' : `<div role="note"><div>${LEGAL_FIXTURE[lang]?.notice ?? 'Notice.'}</div></div>`) +
        `<h1${mark}>${t[path]}</h1><div${mark}><section><p>${t.body}</p></section></div>` +
        `<div${mark}><a href="/${lang}">${t.back}</a></div></article></main>` +
        `<script>self.__next_f.push([1,"<h1>${en[path]}</h1><p>${en.body}</p>"])</script></body></html>`;
    }
  }
  return files;
}

const sitemapXml = (urls) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((u) => `<url>\n<loc>${u}</loc>\n</url>`).join('\n') +
  '\n</urlset>\n';

/**
 * An `llms.txt` body: a header, then one bullet per page, the shape
 * `llms(source).indexNode` emits.
 */
const llmsIndex = (titles) =>
  `# ObjectOS\n\n> Summary line.\n\n## Overview\n\n` +
  titles
    .map((t) => `- [${t}](https://docs.objectos.ai/docs/${t.toLowerCase()}): Description of ${t}.`)
    .join('\n') +
  '\n';

/**
 * An `llms-full.txt` body: page texts joined, each opening with the `# <title>`
 * line `getLLMText` prepends. Each page links somewhere, as real pages do, so
 * that a clean fixture has link targets for `malformed-link-target` to read
 * and does not trip `no-link-targets`.
 */
const llmsFull = (titles) =>
  `${titles.map((t) => `# ${t}\n\nBody of ${t}, see [the overview](https://docs.objectos.ai/docs).`).join('\n\n')}\n`;

/** One per-page `llms.mdx` body: what `getLLMText` returns for a single page. */
const llmsPage = (title) => `# ${title}\n\nBody of ${title}, see [the overview](/docs).\n`;

/** Each fixture locale's word for the sidebar chrome name the built-page fixtures carry. */
const FIXTURE_CHROME = { en: 'Open Search', 'zh-Hans': '打开搜索', ja: '検索を開く' };

/** And for the heading-anchor button inside the body, which carries its own `lang` (#308 review). */
const FIXTURE_ANCHOR = { en: 'Copy Anchor Link', 'zh-Hans': '复制锚点链接', ja: 'アンカーリンクをコピー' };

/**
 * The built pages a correct build of `dir`'s content produces (#308): one per
 * page with an English source, in every locale, keyed `<locale>/<path>` like
 * `collectPages`. Each carries what the real pages carry and the rules must
 * get right, all of it clean:
 *
 *   - a sidebar listing every page, untranslated entries wrapped in
 *     `<span lang="en">`, translated ones in the locale;
 *   - the header logo linking to the docs home with the brand as its text,
 *     which is no page's title, so it is not an entry;
 *   - a button named in the page's locale, and a "GitHub" link
 *     (`LANGUAGE_NEUTRAL_NAMES`);
 *   - the body, marked `lang="en"` on a fallback, holding a heading whose
 *     anchor button is named in the page's locale and says so with its own
 *     `lang` (the #308 review fix);
 *   - an RSC-payload `<script>` holding the English name as a string of
 *     markup, which a reader that did not skip scripts would take for a
 *     button named in English on every localized page.
 */
function fixturePages(dir, { languages, defaultLanguage }) {
  const english = [...readDocsPages(dir, { languages, defaultLanguage }).pages].filter(([, p]) =>
    p.locales.has(defaultLanguage),
  );
  const files = {};
  for (const lang of languages) {
    const prefix = lang === defaultLanguage ? '' : `/${lang}`;
    const titleIn = (p) => escapeHtml(p.titles.get(p.locales.has(lang) ? lang : defaultLanguage) ?? '');
    const sidebar = english
      .map(([path, p]) => {
        const title = titleIn(p);
        const text = p.locales.has(lang) ? title : `<span lang="${defaultLanguage}">${title}</span>`;
        return `<a data-active="false" href="${prefix}/${path}">${text}</a>`;
      })
      .join('');
    for (const [path, p] of english) {
      const marked = p.locales.has(lang) ? '' : ` lang="${defaultLanguage}"`;
      files[`${lang}/${path}`] =
        `<!DOCTYPE html><html lang="${lang}"><head><title>${titleIn(p)}</title></head><body>` +
        '<aside id="nd-sidebar">' +
        `<a href="${prefix}/docs"><img alt="" aria-hidden="true" src="/logo.svg"/>ObjectOS</a>` +
        `<button type="button" aria-label="${FIXTURE_CHROME[lang]}"><svg aria-hidden="true"></svg></button>` +
        '<a href="https://github.com/objectstack-ai/objectos" aria-label="GitHub"><svg aria-hidden="true"></svg></a>' +
        `${sidebar}</aside>` +
        `<article id="nd-page" role="main"><h1${marked}>${titleIn(p)}</h1>` +
        `<div class="prose"${marked}><h2 id="part"><a href="#part">Part</a>` +
        `<button lang="${lang}" aria-label="${FIXTURE_ANCHOR[lang]}"></button></h2><p>Body.</p></div></article>` +
        '<script>self.__next_f.push([1,"<button aria-label=\\"Open Search\\"></button>"])</script>' +
        '</body></html>';
    }
  }
  return files;
}

/** Replace exactly one occurrence, or throw: a fixture edit that misses is a case that tests nothing. */
const once = (html, from, to) => {
  if (html.split(from).length !== 2) throw new Error(`fixture anchor not found exactly once: ${from}`);
  return html.replace(from, () => to);
};

/** Artifact paths by id — never by index, so adding an artifact cannot repoint one. */
const fileOf = (id) => ARTIFACTS.find((a) => a.id === id).file;
const SITEMAP_FILE = fileOf('sitemap.xml');
const LLMS_INDEX_FILE = fileOf('llms.txt');
const LLMS_FULL_FILE = fileOf('llms-full.txt');

const CASES = [
  {
    name: 'clean baseline',
    expect: [],
  },
  {
    // objectos#171, reading 1: the redirecting root used to be submitted in
    // every locale at `priority: 1`. It is excluded now, and a sitemap that
    // advertises it again is the regression this case keeps red.
    name: 'the redirecting root creeps back into the sitemap',
    urls: ['https://docs.objectos.ai', 'https://docs.objectos.ai/ja', ...BASE_URLS],
    expect: ['unexpected-url'],
  },
  {
    // The #169 defect, in miniature: every page advertised in every locale.
    name: 'every page in every locale (the #169 shape)',
    urls: [
      ...BASE_URLS,
      'https://docs.objectos.ai/zh-Hans/docs',
      'https://docs.objectos.ai/ja/docs',
      'https://docs.objectos.ai/zh-Hans/docs/guide',
      'https://docs.objectos.ai/zh-Hans/docs/deep',
      'https://docs.objectos.ai/ja/docs/deep',
    ],
    expect: ['unexpected-url'],
  },
  {
    // A real translation exists on disk but the artifact does not list it.
    name: 'shipped translation not advertised',
    urls: BASE_URLS.filter((u) => u !== 'https://docs.objectos.ai/ja/docs/guide'),
    expect: ['missing-url'],
  },
  {
    // The pre-#169 tree emitted 3318 exact duplicates. De-duplicating on read
    // would have hidden all of them behind a correct distinct count.
    name: 'duplicated entries',
    urls: [...BASE_URLS, 'https://docs.objectos.ai/docs/guide'],
    expect: ['duplicate-url'],
  },

  /* ---------------------------------------------- legal pages (#312) -- */
  // `legalFixturePages` says what a clean build carries; the clean baseline
  // is also the green case for the notice in the route locale and for the
  // English title inside the RSC-payload script on the zh-Hans page.

  {
    // The #312 shape, as main served /de/privacy: the English entry inside
    // <html lang="de"> with nothing marking it.
    name: 'a fallback legal page shows English unmarked (the #312 shape)',
    legal: (f) => ({ ...f, 'ja/privacy': f['ja/privacy'].replaceAll(' lang="en"', '') }),
    expect: ['legal-english-unmarked'],
  },
  {
    // zh-Hant before #312, had it been listed: a locale advertised as written
    // that shows the English entry.
    name: 'a written legal page shows the English entry',
    legal: (f) => ({ ...f, 'zh-Hans/terms': f['en/terms'].replace('<html lang="en">', '<html lang="zh-Hans">') }),
    expect: ['legal-translation-shows-english'],
  },
  {
    name: 'a legal page missing from one locale of the build',
    legal: (f) => Object.fromEntries(Object.entries(f).filter(([file]) => file !== 'ja/terms')),
    expect: ['legal-page-unread'],
  },
  {
    // The oracle going blind: an English page whose <main> holds no text.
    name: 'an English legal page with no main text',
    legal: (f) => ({ ...f, 'en/privacy': f['en/privacy'].replace(/<main[\s\S]*<\/main>/, '<main></main>') }),
    expect: ['legal-page-unread'],
  },
  {
    // Every other artifact built, the legal pages not at all.
    name: 'legal pages not built',
    legal: null,
    expect: ['artifact-missing'],
  },
  {
    name: 'no built artifact',
    artifacts: null,
    expect: ['artifact-missing'],
  },
  {
    // A format change that leaves the reader matching nothing must be a
    // failure, not a green over zero measurements.
    name: 'sitemap present but unreadable',
    rawSitemap:
      '<?xml version="1.0"?>\n<urlset><url><location>https://docs.objectos.ai</location></url></urlset>\n',
    expect: ['artifact-empty'],
  },
  {
    // AGENTS.md forbids a translation-only file. Counting it would inflate the
    // oracle to agree with an artifact that is also wrong.
    name: 'translation with no English source',
    content: { ...BASE_CONTENT, 'orphan.ja.mdx': mdx('孤児') },
    expect: ['translation-orphan'],
  },

  /* ---------------------------------------------------- dotted slugs (#208) -- */

  {
    // The #208 shape: a page whose derived slug carries a dot builds and
    // advertises fine — the sitemap/llms entries below are extended to match
    // it exactly — but 404s at its own default-locale URL because
    // middleware.ts's dot exemption skips the rewrite. Isolating the sitemap
    // and llms bodies to be otherwise correct keeps this case proof of the
    // new rule alone, not a side effect of the others.
    name: 'page slug contains a dot (the #208 shape)',
    content: { ...BASE_CONTENT, 'probe.dotted.mdx': mdx('Probe') },
    urls: [...BASE_URLS, 'https://docs.objectos.ai/docs/probe.dotted'],
    indexBody: llmsIndex([...BASE_TITLES, 'Probe']),
    fullBody: llmsFull([...BASE_TITLES, 'Probe']),
    expect: ['dotted-slug'],
  },
  {
    // The trap the card names directly: the locale suffix IS a dot
    // (`quickstart.zh-Hans.mdx`). `readDocsPages` strips it before this rule
    // ever sees the string, so a real bilingual page — the shape 62 files in
    // the real tree already are — must stay green.
    name: 'a real locale-suffixed filename does not trip the dotted-slug rule',
    content: {
      ...BASE_CONTENT,
      'quickstart.mdx': mdx('Quickstart'),
      'quickstart.zh-Hans.mdx': mdx('快速开始'),
    },
    urls: [
      ...BASE_URLS,
      'https://docs.objectos.ai/docs/quickstart',
      'https://docs.objectos.ai/zh-Hans/docs/quickstart',
    ],
    indexBody: llmsIndex([...BASE_TITLES, 'Quickstart']),
    fullBody: llmsFull([...BASE_TITLES, 'Quickstart']),
    expect: [],
  },

  /* ------------------------------------------- the two `llms` bodies (#184) -- */

  {
    // The #177 defect: `source.getPages()` called with no language returns
    // every locale's pages, so a Japanese page's text lands in the English
    // body. Measured on the real tree as 4.6 MB over seven locales.
    name: 'llms-full.txt carries another locale (the #177 shape)',
    fullBody: llmsFull([...BASE_TITLES, 'ガイド']),
    expect: ['unexpected-locale-title'],
  },
  {
    // The same defect one route over (#170): `source.getPageTree()` with no
    // language builds an index over every locale's pages.
    name: 'llms.txt carries another locale (the #170 shape)',
    indexBody: llmsIndex([...BASE_TITLES, 'ガイド']),
    expect: ['unexpected-locale-title'],
  },
  {
    // The sign-flipped defect, and the reason the card asserts both
    // directions: English pages silently stop being served and every check
    // that only looks for foreign pages stays green.
    name: 'llms-full.txt has dropped an English page',
    fullBody: llmsFull(['Home', 'Guide']),
    expect: ['missing-locale-title'],
  },
  {
    name: 'llms.txt has dropped an English page',
    indexBody: llmsIndex(['Home', 'Guide']),
    expect: ['missing-locale-title'],
  },
  {
    // `getLLMText` stops prepending `# <title>`, or `indexNode` stops emitting
    // bullets: the reader matches nothing and the artifact must fail rather
    // than pass over zero entries.
    name: 'llms-full.txt present but unreadable',
    fullBody: 'Home\n\nBody of Home, see [Guide](/docs/guide).\n\nGuide\n\nBody of Guide.\n',
    expect: ['artifact-empty'],
  },
  {
    name: 'llms.txt present but unreadable',
    indexBody: '# ObjectOS\n\n> Summary line.\n\nHome, Guide and Deep are documented.\n',
    expect: ['artifact-empty'],
  },
  {
    // Green on purpose. 14 lines in the real corpus open with `# ` inside a
    // shell fence; a fence-blind reader calls each of them a page title. This
    // fixture puts a ja-exclusive title inside a fence, where a wrong reader
    // fires `unexpected-locale-title` and the right one stays silent.
    name: 'a `# ` line inside a code fence is not a page title',
    fullBody: `${llmsFull(BASE_TITLES)}\n\`\`\`sh\n# ガイド\n\`\`\`\n`,
    expect: [],
  },
  {
    // Green on purpose, the `llms.txt` half of the same property. Substring
    // matching over these bodies produces four false hits on the real tree
    // (`Glossar` in `Glossary`; `Datasources`, `Roles`, `Licence` in English
    // prose), each reading as a foreign page being served.
    name: 'a title named in prose is not an advertisement',
    indexBody: `${llmsIndex(BASE_TITLES)}\nThe ガイド page is the Japanese translation of Guide.\n`,
    expect: [],
  },
  {
    // The hole the universe restriction opens: if no English title is unique
    // to English, the comparison has nothing to compare and both `llms`
    // artifacts would pass without measuring anything.
    name: 'no title is exclusive to any locale',
    content: { 'index.mdx': mdx('Shared'), 'index.ja.mdx': mdx('Shared') },
    urls: [
      'https://docs.objectos.ai/privacy',
      'https://docs.objectos.ai/zh-Hans/privacy',
      'https://docs.objectos.ai/terms',
      'https://docs.objectos.ai/zh-Hans/terms',
      'https://docs.objectos.ai/docs',
      'https://docs.objectos.ai/ja/docs',
    ],
    indexBody: llmsIndex(['Shared']),
    fullBody: llmsFull(['Shared']),
    expect: ['nothing-expected'],
  },

  /* ----------------------------------------- llms body encoding (#282) -- */

  {
    // The bulk of #197: 58 of its 67 references encoded the asterisk that
    // opens an emphasis run, in prose, with every link intact.
    name: 'llms-full.txt carries a numeric character reference',
    fullBody: `${llmsFull(BASE_TITLES)}\nAn &#x2A;emphasised* word.\n`,
    expect: ['numeric-character-reference'],
  },
  {
    // A target that runs on into the prose, and no reference anywhere — so
    // the malformed-target rule is shown to fire on its own.
    name: 'llms-full.txt carries a malformed link target',
    fullBody: `${llmsFull(BASE_TITLES)}\nSee [Guide](/docs/guide, then read on.\n`,
    expect: ['malformed-link-target'],
  },
  {
    // The #197 shape exactly: the closing `)` is itself encoded. One defect,
    // both rules.
    name: 'a link whose ) is encoded (the #197 shape)',
    fullBody: `${llmsFull(BASE_TITLES)}\nAsk [AI Builder](/docs/build/ai-builder&#x29;, say what you need.\n`,
    expect: ['malformed-link-target', 'numeric-character-reference'],
  },
  {
    // Decimal this time: the rule is about the form, not the one spelling
    // the encoder happens to use today.
    name: 'an llms.mdx body carries a numeric character reference',
    mdx: (pages) => ({ ...pages, 'docs/guide': `${pages['docs/guide']}\nA &#96;literal backtick.\n` }),
    expect: ['numeric-character-reference'],
  },
  {
    name: 'an llms.mdx body carries a malformed link target',
    mdx: (pages) => ({
      ...pages,
      'docs/deep': `${pages['docs/deep']}\nSee [Home](https://docs.objectos.ai/docs then read on.\n`,
    }),
    expect: ['malformed-link-target'],
  },
  {
    // #299: the internal note in `resources/license.mdx`, as the processed
    // Markdown carried it — a whole-line comment over several lines.
    name: 'llms-full.txt carries an MDX comment',
    fullBody: `${llmsFull(BASE_TITLES)}\n{/*\n  Naming, decided under #79.\n  */}\n`,
    expect: ['mdx-comment'],
  },
  {
    name: 'an llms.mdx body carries an MDX comment',
    mdx: (pages) => ({ ...pages, 'docs/guide': `${pages['docs/guide']}\nText {/* aside */} more.\n` }),
    expect: ['mdx-comment'],
  },
  {
    // One page's body not built: its text was never scanned, and a clean
    // scan of the other bodies must not read as covering it.
    name: 'an English page has no llms.mdx body',
    mdx: (pages) => Object.fromEntries(Object.entries(pages).filter(([path]) => path !== 'docs/guide')),
    expect: ['llms-page-body-missing'],
  },
  {
    // A directory that exists and was never written: zero bodies must not
    // read as zero references.
    name: 'llms.mdx built but empty',
    mdx: () => ({}),
    expect: ['llms-page-body-missing', 'no-link-targets'],
  },
  {
    // The other three artifacts built, this one not at all.
    name: 'llms.mdx not built',
    mdx: null,
    expect: ['artifact-missing'],
  },
  {
    // Links that stop being inline markdown links (reference-style,
    // autolinks, HTML) would leave the malformed-target rule passing over
    // nothing.
    name: 'no link target anywhere in llms-full.txt',
    fullBody: `${BASE_TITLES.map((t) => `# ${t}\n\nBody of ${t}.`).join('\n\n')}\n`,
    expect: ['no-link-targets'],
  },
  {
    // Green on purpose: shapes a careless pattern would call a defect. A bare
    // ampersand in prose or a query string is not a reference; `&#` with no
    // terminating `;` is not one in markdown either; and a target with a `(`
    // in it still closes on a literal `)`.
    name: 'ampersands and parentheses in a URL are not findings',
    fullBody:
      `${llmsFull(BASE_TITLES)}\nR&D at AT&T, see [search](https://docs.objectos.ai/docs?q=a&b=c) ` +
      'and [Foo](https://en.wikipedia.org/wiki/Foo_(bar)); issue &#197 is prose; `/api/v1/data/*` is a path.\n',
    expect: [],
  },

  /* ---------------------------------------------- built pages (#308) -- */
  // `fixturePages` says what a clean page carries; the clean baseline above
  // is also the green case for the logo link, the neutral "GitHub" name and
  // the English name inside the RSC-payload script.

  {
    // #305's first shape, as main served it on every locale page: a fumadocs
    // control still named in English inside <html lang="ja">.
    name: 'a localized page names a control in English (the #305 shape)',
    html: (f) => ({
      ...f,
      'ja/docs/guide': once(f['ja/docs/guide'], 'aria-label="検索を開く"', 'aria-label="Open Search"'),
    }),
    expect: ['english-chrome-name'],
  },
  {
    // fumadocs 16.10 and later carry these names as `.sr-only` text rather
    // than `aria-label`; an upgrade must not move them out of sight.
    name: 'an English name in screen-reader-only text',
    html: (f) => ({
      ...f,
      'zh-Hans/docs': once(
        f['zh-Hans/docs'],
        '</aside>',
        '<button type="button"><span class="sr-only">Open Search</span></button></aside>',
      ),
    }),
    expect: ['english-chrome-name'],
  },
  {
    // Green on purpose: inside an element marked lang="en" (a fallback's
    // body), an English name is announced as English, which is what it is.
    name: 'an English name inside lang="en" is correctly marked',
    html: (f) => ({
      ...f,
      'ja/docs/deep': once(f['ja/docs/deep'], '<p>Body.</p>', '<p>Body.</p><button aria-label="Open Search"></button>'),
    }),
    expect: [],
  },
  {
    // The inverse, as #305 shipped it: on a ja fallback page the heading's
    // anchor button is named in Japanese, inside the English body, with no
    // lang of its own — read with English rules.
    name: 'a localized name inside lang="en" with no lang of its own',
    html: (f) => ({
      ...f,
      'ja/docs/deep': once(
        f['ja/docs/deep'],
        '<button lang="ja" aria-label="アンカーリンクをコピー">',
        '<button aria-label="アンカーリンクをコピー">',
      ),
    }),
    expect: ['localized-name-marked-english'],
  },
  {
    // The same name reaching the English body through an inherited lang: the
    // button carries none, its parent says ja. Green, which is what lets the
    // fix live on a wrapper as well as on the button.
    name: 'a localized name inside lang="en" whose own wrapper says the locale',
    html: (f) => ({
      ...f,
      'ja/docs/deep': once(
        f['ja/docs/deep'],
        '<button lang="ja" aria-label="アンカーリンクをコピー"></button>',
        '<span lang="ja"><button aria-label="アンカーリンクをコピー"></button></span>',
      ),
    }),
    expect: [],
  },
  {
    // #305's second shape: the English title of a page ja has no source file
    // for, in ja's sidebar, read with Japanese rules.
    name: 'an untranslated page-tree entry with no lang marker (the #305 shape)',
    html: (f) => ({ ...f, 'ja/docs/guide': once(f['ja/docs/guide'], '<span lang="en">Deep</span>', 'Deep') }),
    expect: ['untranslated-entry-unmarked'],
  },
  {
    // The over-marking direction: marking every entry English would satisfy
    // the rule above and mislabel every real translation.
    name: 'a translated page-tree entry marked English',
    html: (f) => ({ ...f, 'ja/docs/deep': once(f['ja/docs/deep'], '>ガイド</a>', '><span lang="en">ガイド</span></a>') }),
    expect: ['translated-entry-marked-english'],
  },
  {
    // Green on purpose: a translated page's own prose links an untranslated
    // page in the page's language. That is content, not the page tree, and a
    // reader that did not skip `.prose` calls it an unmarked entry.
    name: 'a link in the page body is not a page-tree entry',
    html: (f) => ({
      ...f,
      'ja/docs/guide': once(f['ja/docs/guide'], '<p>Body.</p>', '<p><a href="/ja/docs/deep">Deep のページ</a></p>'),
    }),
    expect: [],
  },
  {
    // One page not built in one locale: its chrome and tree were never read,
    // and a clean scan of the others must not read as covering it.
    name: 'a page missing from one locale of the build',
    html: (f) => Object.fromEntries(Object.entries(f).filter(([file]) => file !== 'ja/docs/deep')),
    expect: ['docs-page-html-missing'],
  },
  {
    // The oracle going blind: no English name, so nothing to compare.
    name: 'no accessible name on any English page',
    html: (f) =>
      Object.fromEntries(
        Object.entries(f).map(([file, h]) => [
          file,
          file.startsWith('en/')
            ? once(once(h, ' aria-label="Open Search"', ''), ' aria-label="Copy Anchor Link"', '')
            : h,
        ]),
      ),
    expect: ['no-chrome-names'],
  },
  {
    // The entry reader going blind: zh-Hans has three untranslated pages and
    // its pages show none of them.
    name: 'no page-tree entry recognisable in one locale',
    html: (f) =>
      Object.fromEntries(
        Object.entries(f).map(([file, h]) => [
          file,
          file.startsWith('zh-Hans/') ? h.replace(/<a data-active[^>]*>[\s\S]*?<\/a>/g, '') : h,
        ]),
      ),
    expect: ['no-tree-entries'],
  },
  {
    // Every other artifact built, the pages not at all.
    name: 'docs pages not built',
    html: null,
    expect: ['artifact-missing'],
  },
];

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'locale-surface-'));
  let failed = 0;
  /** Artifact ids that some fixture actually drove into a finding. */
  const exercised = new Set();
  /** `artifact:rule` pairs that some fixture actually fired. */
  const pairs = new Set();

  try {
    for (const c of CASES) {
      rmSync(join(dir, 'content'), { recursive: true, force: true });
      rmSync(join(dir, 'apps'), { recursive: true, force: true });

      mkdirSync(join(dir, 'apps/docs/lib'), { recursive: true });
      writeFileSync(join(dir, 'apps/docs/lib/i18n.ts'), c.i18n ?? I18N_FIXTURE);

      for (const [name, body] of Object.entries(c.content ?? BASE_CONTENT)) {
        const p = join(dir, 'content/docs', name);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, `${body}\n`);
      }

      // Every case writes ALL THREE artifacts, clean unless it overrides one.
      // A case that mutates the sitemap must leave the `llms` bodies correct,
      // or its assertion on the exact set of rules fired stops being about the
      // thing it was written for.
      const written =
        c.artifacts === null
          ? []
          : [
              [SITEMAP_FILE, c.rawSitemap ?? sitemapXml(c.urls ?? BASE_URLS)],
              [LLMS_INDEX_FILE, c.indexBody ?? llmsIndex(BASE_TITLES)],
              [LLMS_FULL_FILE, c.fullBody ?? llmsFull(BASE_TITLES)],
            ];

      for (const [file, bytes] of written) {
        const p = join(dir, file);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, bytes);
      }

      // The legal pages (#312): every `STATIC_PAGES` path in every locale,
      // clean. `c.legal` transforms the `<locale>/<path>`-to-HTML map; `null`
      // leaves them unbuilt.
      if (c.artifacts !== null && c.legal !== null) {
        const files = legalFixturePages(readI18n(dir));
        for (const [file, html] of Object.entries(c.legal ? c.legal(files) : files)) {
          const p = join(dir, LEGAL_PAGES_DIR, `${file}.html`);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, html);
        }
      }

      // `llms.mdx`: one clean body per page with an English source, derived
      // from THIS case's content, so that a case adding a page cannot trip
      // `llms-page-body-missing` by accident. `c.mdx` transforms that
      // path-to-body map; `null` leaves the directory unbuilt.
      if (c.artifacts !== null && c.mdx !== null) {
        const i18n = readI18n(dir);
        const defaults = {};
        for (const [path, page] of readDocsPages(dir, i18n).pages) {
          if (!page.locales.has(i18n.defaultLanguage)) continue;
          defaults[path] = llmsPage(page.titles.get(i18n.defaultLanguage) ?? path);
        }
        mkdirSync(join(dir, LLMS_MDX_DIR), { recursive: true });
        for (const [path, body] of Object.entries(c.mdx ? c.mdx(defaults) : defaults)) {
          const p = join(dir, LLMS_MDX_DIR, `${path}.body`);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, body);
        }
      }

      // Built pages (#308): every page in every locale, clean, derived from
      // THIS case's content the same way. `c.html` transforms the
      // `<locale>/<path>`-to-HTML map; `null` leaves the directory unbuilt.
      if (c.artifacts !== null && c.html !== null) {
        const files = fixturePages(dir, readI18n(dir));
        mkdirSync(join(dir, PAGES_DIR), { recursive: true });
        for (const [file, html] of Object.entries(c.html ? c.html(files) : files)) {
          const p = join(dir, PAGES_DIR, `${file}.html`);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, html);
        }
      }

      const { findings } = evaluate(collect(dir));
      // `artifact-missing` deliberately does not count. The `no built artifact`
      // case omits every file at once, so any entry added to ARTIFACTS fires it
      // for free — counting it would let a new artifact satisfy the coverage
      // check below without one line of its reader ever having run.
      for (const f of findings) {
        if (!f.artifact || f.rule === 'artifact-missing') continue;
        exercised.add(f.artifact);
        pairs.add(`${f.artifact}:${f.rule}`);
      }
      const fired = [...new Set(findings.map((f) => f.rule))].sort();
      const want = [...c.expect].sort();
      const ok = fired.join(',') === want.join(',');
      if (!ok) failed += 1;
      console.log(
        `${ok ? '✓' : '✗'} ${c.name.padEnd(52)} fired [${fired.join(' ') || '—'}]` +
          (ok ? '' : `  expected [${want.join(' ') || '—'}]`),
      );
      if (!ok) for (const f of findings) console.error(`      [${f.rule}] ${f.detail}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('');

  // The oracle's own arithmetic, asserted directly: the baseline fixture is
  // three locales over three logical pages with exactly one translation, and
  // the per-locale tally is what the gate prints and what a reviewer reads.
  const dir2 = mkdtempSync(join(tmpdir(), 'locale-surface-tally-'));
  try {
    mkdirSync(join(dir2, 'apps/docs/lib'), { recursive: true });
    writeFileSync(join(dir2, 'apps/docs/lib/i18n.ts'), I18N_FIXTURE);
    for (const [name, body] of Object.entries(BASE_CONTENT)) {
      const p = join(dir2, 'content/docs', name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, `${body}\n`);
    }
    for (const [file, bytes] of [
      [SITEMAP_FILE, sitemapXml(BASE_URLS)],
      [LLMS_INDEX_FILE, llmsIndex(BASE_TITLES)],
      [LLMS_FULL_FILE, llmsFull(BASE_TITLES)],
    ]) {
      const p = join(dir2, file);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, bytes);
    }

    const collected = collect(dir2);
    const { perLocale } = evaluate(collected);
    const want = { en: 3, 'zh-Hans': 0, ja: 1 };
    const ok = JSON.stringify(perLocale) === JSON.stringify(want);
    if (!ok) failed += 1;
    console.log(
      `${ok ? '✓' : '✗'} per-locale tally ${JSON.stringify(perLocale)}` +
        (ok ? '' : `  expected ${JSON.stringify(want)}`),
    );

    // The other oracle's arithmetic, asserted the same way. `Home`, `Guide` and
    // `Deep` are English-only; `ガイド` is Japanese-only; `zh-Hans` has no page
    // and therefore no exclusive title. A bug that quietly emptied these sets
    // would leave every `llms` comparison trivially satisfiable.
    const exclusive = Object.fromEntries(
      [...collected.surface.exclusiveTitles].map(([lang, titles]) => [lang, [...titles.keys()].sort()]),
    );
    const wantExclusive = { en: ['Deep', 'Guide', 'Home'], 'zh-Hans': [], ja: ['ガイド'] };
    const exclusiveOk = JSON.stringify(exclusive) === JSON.stringify(wantExclusive);
    if (!exclusiveOk) failed += 1;
    console.log(
      `${exclusiveOk ? '✓' : '✗'} locale-exclusive titles ${JSON.stringify(exclusive)}` +
        (exclusiveOk ? '' : `  expected ${JSON.stringify(wantExclusive)}`),
    );

    // The built-page live control (#308) must pass with the real reader and
    // go red with a reader blinded to names or to `lang`. It never meets a
    // fixture tree, so this is how its `negative-control-passed` is shown
    // able to fire.
    const chrome = new Map([['Open Search', 3]]);
    const localByLang = new Map([['zh-Hans', new Map([['打开搜索', 3]])]]);
    for (const [name, read, wantRed] of [
      ['the real reader', readHtml, false],
      ['a reader blind to names', (t) => ({ ...readHtml(t), names: [] }), true],
      [
        'a reader blind to lang',
        (t) => {
          const r = readHtml(t);
          return { ...r, links: r.links.map((l) => ({ ...l, texts: l.texts.map((x) => ({ ...x, lang: 'en' })) })) };
        },
        true,
      ],
      [
        // Every name resolved to the page's locale, `lang` on regions ignored:
        // the inverse half goes silent.
        'a reader blind to lang on names',
        (t) => {
          const r = readHtml(t);
          return { ...r, names: r.names.map((n) => ({ ...n, lang: 'zh-Hans' })) };
        },
        true,
      ],
    ]) {
      const red = pagesControl(collected.surface, chrome, localByLang, read).findings.some((f) => f.rule === CONTROL_RULE);
      const ok = red === wantRed;
      if (!ok) failed += 1;
      console.log(
        `${ok ? '✓' : '✗'} built-page live control with ${name}: ${red ? `red (${CONTROL_RULE})` : 'green'}` +
          (ok ? '' : `  expected ${wantRed ? 'red' : 'green'}`),
      );
    }
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }

  // A locale list this gate cannot read is a gate that cannot measure. It must
  // throw rather than fall back to a guess.
  for (const [name, body] of [
    ['no languages[]', "export const i18n = defineI18n({ defaultLanguage: 'en' });"],
    ['no defaultLanguage', "export const i18n = defineI18n({ languages: ['en', 'ja'] });"],
    ['default not in list', "export const i18n = defineI18n({ defaultLanguage: 'xx', languages: ['en'] });"],
  ]) {
    const d = mkdtempSync(join(tmpdir(), 'locale-surface-i18n-'));
    let threw = false;
    try {
      mkdirSync(join(d, 'apps/docs/lib'), { recursive: true });
      writeFileSync(join(d, 'apps/docs/lib/i18n.ts'), body);
      try {
        collect(d);
      } catch {
        threw = true;
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
    if (!threw) failed += 1;
    console.log(`${threw ? '✓' : '✗'} unreadable i18n.ts rejected: ${name}`);
  }

  // The encoding scan's own arithmetic (#282), asserted as exact counts: hex,
  // decimal and upper-case-X references; a well-formed target, one with a `(`
  // inside it, one broken by whitespace and one cut off at the end of the
  // body. The tallies this produces are the numbers the gate prints.
  {
    const found = scanBody(
      'a &#x2A;b* c &#42; d &#X2a; [x](/y) [z](/w &#x29; [p](https://h/q_(r)) tail [end](/e',
    );
    const got = {
      references: found.references.map((r) => r.text),
      targets: found.targets,
      malformed: found.malformed.map((m) => m.text),
    };
    const want = {
      references: ['&#x2A;', '&#42;', '&#X2a;', '&#x29;'],
      targets: 4,
      malformed: ['](/w', '](/e'],
    };
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed += 1;
    console.log(
      `${ok ? '✓' : '✗'} encoding scan tally ${JSON.stringify(got).replace(/&/g, 'AMP')}` +
        (ok ? '' : `  expected ${JSON.stringify(want).replace(/&/g, 'AMP')}`),
    );
  }

  // The live negative control (#282) must pass with the real scan and go red
  // with a scan blinded to either rule. It never meets a fixture tree, so this
  // is how `negative-control-passed` is shown able to fire.
  for (const [name, scan, wantRed] of [
    ['the real scan', scanBody, false],
    ['a scan blind to references', (t) => ({ ...scanBody(t), references: [] }), true],
    ['a scan blind to malformed targets', (t) => ({ ...scanBody(t), malformed: [] }), true],
  ]) {
    const red = encodingControl(scan).findings.some((f) => f.rule === CONTROL_RULE);
    const ok = red === wantRed;
    if (!ok) failed += 1;
    console.log(
      `${ok ? '✓' : '✗'} live negative control with ${name}: ${red ? `red (${CONTROL_RULE})` : 'green'}` +
        (ok ? '' : `  expected ${wantRed ? 'red' : 'green'}`),
    );
  }

  console.log('');
  const covered = new Set(CASES.flatMap((c) => c.expect));
  for (const rule of RULES) {
    if (!covered.has(rule)) {
      console.error(`✗ rule "${rule}" has no fixture that trips it`);
      failed += 1;
    }
  }

  // Rule coverage alone stopped being enough once one rule could fire for any
  // of three artifacts: `unexpected-locale-title` being covered says nothing
  // about whether `llms.txt`'s reader has ever produced a finding. This card
  // exists because an artifact nobody asserted looked exactly like an artifact
  // that was fine, so the per-artifact form of the same question is the one
  // worth asking — a new ARTIFACTS entry with no red fixture fails here.
  for (const { id } of ARTIFACTS) {
    if (!exercised.has(id)) {
      console.error(
        `✗ artifact "${id}" is in ARTIFACTS but no fixture ever drove it red on its own ` +
          'content — add a case that mutates its body, not just one that omits the file',
      );
      failed += 1;
    }
  }

  // The encoding rules (#282) and `mdx-comment` (#299), for both consumers.
  // Rule coverage alone would pass with every reference fixture written
  // against `llms-full.txt`, and
  // the 79 `llms.mdx` bodies would then have a rule nobody had seen fire on
  // them — the mistake #197 already recorded once.
  for (const consumer of LLMS_CONSUMERS) {
    for (const rule of ['numeric-character-reference', 'malformed-link-target', 'mdx-comment']) {
      if (!pairs.has(`${consumer}:${rule}`)) {
        console.error(`✗ no fixture drives "${rule}" red on the ${consumer} consumer`);
        failed += 1;
      }
    }
  }

  if (failed) {
    console.error(`\n✗ self-test: ${failed} case(s) did not behave as declared`);
    process.exit(1);
  }
  console.log(
    `✓ self-test: ${CASES.length} case(s) over ${RULES.length} rule(s) and ${ARTIFACTS.length} ` +
      'artifact(s) — every rule demonstrated able to fail and every artifact demonstrated ' +
      'able to fail it, on fixtures read through the real readers; the encoding and MDX-comment rules ' +
      'demonstrated on both `llms` consumers; and both live controls (the #197 encoding shape and the ' +
      `#305 built-page shapes and their inverse) demonstrated able to fire ${CONTROL_RULE}`,
  );
}

function main() {
  if (process.argv.slice(2).some((a) => a === '--self-test')) return selfTest();
  return gate();
}

main();
