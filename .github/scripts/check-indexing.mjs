#!/usr/bin/env node
/**
 * Indexing gate (#469): what a search engine is told by the BUILT site.
 *
 * ## Why this exists
 *
 * Search Console showed docs.objectos.ai as the domain's main source of index
 * noise, and every item on that list was green on every gate here:
 *
 *   1. `.mdx` URLs under a locale prefix (`/ko/docs/build/automation.mdx`)
 *      that 404. #211 fixed the source (the page actions' Markdown URL) but
 *      added no gate, and the URL is only visible in the rendered output.
 *      Links to pages that no longer exist (`/xx/docs/configure/uploads`)
 *      were in the same report.
 *   2. `/docs/<path>.mdx` answering 200 with the page's Markdown, a duplicate
 *      of the HTML page with nothing telling a crawler so.
 *   3. de/fr/es/ko pages rendering the English fallback, canonical to English
 *      but indexable, which Google overrode ("Duplicate, Google chose
 *      different canonical than user").
 *   4. `/xx/terms` and `/xx/privacy`, the same shape on the legal pages.
 *   5. Pages "Discovered - currently not indexed", in a sitemap with no
 *      `<lastmod>`.
 *
 * Each rule below is one of those, asserted on the build output so that the
 * defect cannot come back without this step going red.
 *
 * ## The oracle is the content tree
 *
 * Like `check-locale-surface.mjs`, expectations come from `content/docs/`
 * (which locales really have each page: a locale-suffixed sibling file) and
 * `apps/docs/lib/i18n.ts`, read as text. Nothing here imports app code, so
 * app code being wrong can turn this red.
 *
 * ## Rules
 *
 * Links, over every `<a href>` in every prerendered page:
 *   - `link-mdx`: an internal link whose path ends in `.mdx`. Markdown is
 *     reached through the page actions, never through a link.
 *   - `locale-mdx-url`: a `/<locale>/docs/….mdx` string anywhere in a page,
 *     RSC payload included. That URL has no rewrite and 404s; it is #211's
 *     shape, which reached the browser as a client-component prop, not a link.
 *   - `link-missing`: an internal link to a path that is not a built page, a
 *     redirect source in `next.config.mjs`, a file in `public/`, an English
 *     page's `.mdx` form, or a known route handler. Relative links are
 *     resolved against the page URL, which is what a crawler does.
 *
 * Head metadata, per page/locale (docs pages and the legal pages):
 *   - `fallback-indexable`: a locale route rendering another locale's copy
 *     without `noindex`.
 *   - `fallback-canonical`: such a route not canonical to the English URL.
 *   - `translated-noindex`: a real page (English or translated) marked noindex.
 *   - `translated-canonical`: a real page not self-canonical.
 *   - `hreflang-mismatch`: a page whose hreflang set is not exactly the locales
 *     that really have it, plus `x-default`.
 *
 * Markdown routes (`/docs/<path>.mdx`, prerendered under `llms.mdx/`):
 *   - `mdx-indexable`: no `X-Robots-Tag: noindex`, or no `Link` canonical to
 *     the page's HTML URL, in the route's stored headers.
 *
 * Sitemap:
 *   - `sitemap-lastmod-missing`: an entry without a valid `<lastmod>`, or one
 *     in the future. A shallow clone produces this (the sitemap then omits the
 *     field rather than stamping the build time), which is why CI fetches the
 *     full history.
 *   - `sitemap-unlinked`: an entry no `<a href>` chain reaches from the docs
 *     roots. A page only the sitemap knows about is the "Discovered" shape.
 *
 * And `artifact-missing` when the build output to read is not there, so a
 * missing build cannot pass as a clean one.
 *
 * Usage:
 *   node .github/scripts/check-indexing.mjs              # gate, after `next build`
 *   node .github/scripts/check-indexing.mjs --self-test  # prove every rule can fail
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const RULES = [
  'artifact-missing',
  'link-mdx',
  'locale-mdx-url',
  'link-missing',
  'fallback-indexable',
  'fallback-canonical',
  'translated-noindex',
  'translated-canonical',
  'hreflang-mismatch',
  'mdx-indexable',
  'sitemap-lastmod-missing',
  'sitemap-unlinked',
];

/**
 * Canonical production host. Re-declared rather than imported from
 * `apps/docs/lib/site.ts`, for the reason `check-locale-surface.mjs` gives: a
 * check sharing a constant with what it checks cannot catch that constant.
 */
const SITE_URL = 'https://docs.objectos.ai';
const SITE_HOST = new URL(SITE_URL).host;

/**
 * Pages outside `content/docs/` and the locales they are written in. The same
 * declaration as `check-locale-surface.mjs`, for the same reason: the oracle
 * does not read app code, and translating the privacy policy is a deliberate
 * act that should turn both gates red until they are told.
 */
const STATIC_PAGES = [
  { path: 'privacy', locales: ['en', 'zh-Hans', 'zh-Hant'] },
  { path: 'terms', locales: ['en', 'zh-Hans', 'zh-Hant'] },
];

/**
 * Paths served by something other than a prerendered page, which a link may
 * name. Prefixes end in `/`.
 */
const ROUTE_HANDLERS = ['/llms.txt', '/llms-full.txt', '/sitemap.xml', '/robots.txt', '/api/search', '/og/'];

const APP_OUT = 'apps/docs/.next/server/app';

/* ------------------------------------------------------------- the oracle -- */

function readI18n(root) {
  const path = join(root, 'apps/docs/lib/i18n.ts');
  const text = readFileSync(path, 'utf8');
  const list = text.match(/languages:\s*\[([^\]]+)\]/);
  const def = text.match(/defaultLanguage:\s*['"]([^'"]+)['"]/);
  if (!list || !def) throw new Error(`could not parse languages[] / defaultLanguage out of ${path}`);
  const languages = list[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  return { languages, defaultLanguage: def[1] };
}

function walk(dir, pick, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, pick, out);
    else if (pick(entry.name)) out.push(p);
  }
  return out;
}

/** Logical path (`docs/build/data`, `terms`) to the set of locales that really have it. */
function readPages(root, { languages, defaultLanguage }) {
  const docsDir = join(root, 'content/docs');
  const nonDefault = languages.filter((l) => l !== defaultLanguage);
  const pages = new Map();
  for (const file of walk(docsDir, (n) => n.endsWith('.mdx'))) {
    const relPath = relative(docsDir, file).split('\\').join('/');
    const locale = nonDefault.find((l) => relPath.endsWith(`.${l}.mdx`)) ?? defaultLanguage;
    const suffix = locale === defaultLanguage ? '.mdx' : `.${locale}.mdx`;
    const segments = relPath.slice(0, -suffix.length).split('/');
    if (segments.at(-1) === 'index') segments.pop();
    const path = ['docs', ...segments].join('/');
    if (!pages.has(path)) pages.set(path, new Set());
    pages.get(path).add(locale);
  }
  for (const { path, locales } of STATIC_PAGES) pages.set(path, new Set(locales));
  return pages;
}

function localeUrl(lang, path, defaultLanguage) {
  const suffix = path ? `/${path}` : '';
  return lang === defaultLanguage ? `${SITE_URL}${suffix}` : `${SITE_URL}/${lang}${suffix}`;
}

/** Redirect sources declared in `next.config.mjs` (`['/docs/a', '/docs/b']` pairs), read as text. */
function readRedirectSources(root) {
  const path = join(root, 'apps/docs/next.config.mjs');
  if (!existsSync(path)) return [];
  return [...readFileSync(path, 'utf8').matchAll(/\[\s*'(\/[^']+)'\s*,\s*'\/[^']+'\s*\]/g)].map((m) => m[1]);
}

/* ------------------------------------------------------- artifact readers -- */

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * Every prerendered HTML page, keyed by the public URL path it is served at.
 * The default locale is built under `en/` and served unprefixed (middleware
 * rewrite), so `en/docs/x.html` is `/docs/x`. Next's own `_not-found` and
 * `_global-error` are not pages of the site.
 */
function readBuiltPages(root, { languages, defaultLanguage }) {
  const base = join(root, APP_OUT);
  const pages = new Map();
  for (const file of walk(base, (n) => n.endsWith('.html'))) {
    const segments = relative(base, file).split('\\').join('/').slice(0, -'.html'.length).split('/');
    if (segments[0].startsWith('_')) continue;
    if (!languages.includes(segments[0])) continue;
    const lang = segments.shift();
    if (segments.at(-1) === 'index') segments.pop();
    const path = segments.join('/');
    const url = new URL(localeUrl(lang, path, defaultLanguage)).pathname;
    pages.set(url, { lang, path, html: readFileSync(file, 'utf8') });
  }
  return pages;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? decode(m[1] ?? m[2]) : undefined;
};

/** `robots`, `canonical` and the hreflang map out of a document's `<head>`. */
function readHead(html) {
  const end = html.indexOf('</head>');
  const head = end === -1 ? html : html.slice(0, end);
  let robots;
  let canonical;
  const hreflang = new Map();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    if (attr(tag, 'name')?.toLowerCase() === 'robots') robots = attr(tag, 'content');
  }
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(tag, 'rel')?.toLowerCase();
    if (rel === 'canonical') canonical = attr(tag, 'href');
    if (rel === 'alternate' && attr(tag, 'hreflang')) hreflang.set(attr(tag, 'hreflang'), attr(tag, 'href'));
  }
  return { robots, canonical, hreflang };
}

/** Every `<a href>` in a document, as written. */
const readHrefs = (html) => [...html.matchAll(/<a\b[^>]*?\shref=(?:"([^"]*)"|'([^']*)')/gi)].map((m) => decode(m[1] ?? m[2]));

/**
 * The internal path an href names, resolved the way a crawler resolves it
 * against the page it is on; `undefined` for external links and non-HTTP
 * schemes. Query and fragment dropped, trailing slash dropped.
 */
function internalPath(href, pageUrl) {
  let url;
  try {
    url = new URL(href, `${SITE_URL}${pageUrl}`);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol) || url.host !== SITE_HOST) return undefined;
  let path = decodeURI(url.pathname);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/** Stored response headers of each prerendered `/llms.mdx/docs/…` route, keyed by its public `.mdx` path. */
function readMdxRoutes(root) {
  const base = join(root, APP_OUT, 'llms.mdx');
  const routes = new Map();
  for (const file of walk(base, (n) => n.endsWith('.meta'))) {
    const rel = relative(base, file).split('\\').join('/').slice(0, -'.meta'.length);
    let headers = {};
    try {
      headers = JSON.parse(readFileSync(file, 'utf8')).headers ?? {};
    } catch {
      headers = {};
    }
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    routes.set(`/${rel}.mdx`, lower);
  }
  return routes;
}

/** Each sitemap `<url>` with its `<loc>` and `<lastmod>`. */
function readSitemap(text) {
  return [...text.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
    loc: decode(body.match(/<loc>([^<]*)<\/loc>/)?.[1]?.trim() ?? ''),
    lastmod: body.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1]?.trim(),
  }));
}

/* ------------------------------------------------------------------ rules -- */

function evaluate(root, { now = Date.now() } = {}) {
  const findings = [];
  const fail = (rule, where, detail) => findings.push({ rule, where, detail });

  const i18n = readI18n(root);
  const { languages, defaultLanguage } = i18n;
  const oracle = readPages(root, i18n);
  const built = readBuiltPages(root, i18n);
  const mdxRoutes = readMdxRoutes(root);
  const sitemapFile = join(root, APP_OUT, 'sitemap.xml.body');

  if (built.size === 0) fail('artifact-missing', APP_OUT, 'no prerendered locale pages; run `next build` first');
  if (mdxRoutes.size === 0) fail('artifact-missing', `${APP_OUT}/llms.mdx`, 'no prerendered .mdx routes');
  if (!existsSync(sitemapFile)) fail('artifact-missing', relative(root, sitemapFile), 'no built sitemap');
  if (findings.length) return findings;

  // ---- links
  const redirects = readRedirectSources(root);
  const publicFiles = new Set(
    walk(join(root, 'apps/docs/public'), () => true).map((f) => `/${relative(join(root, 'apps/docs/public'), f).split('\\').join('/')}`),
  );
  const nonDefault = languages.filter((l) => l !== defaultLanguage);
  const known = (path) => {
    if (built.has(path) || publicFiles.has(path) || mdxRoutes.has(path)) return true;
    if (path === '/' || nonDefault.some((l) => path === `/${l}`)) return true; // language dispatch
    if (ROUTE_HANDLERS.some((h) => (h.endsWith('/') ? path.startsWith(h) : path === h))) return true;
    const unprefixed = nonDefault.reduce((p, l) => (p.startsWith(`/${l}/`) ? p.slice(l.length + 1) : p), path);
    return redirects.includes(unprefixed);
  };
  const localeMdx = new RegExp(`/(?:${languages.map((l) => l.replace(/[-]/g, '\\-')).join('|')})/docs/[^"'\\s<>)]*?\\.mdx\\b`, 'g');

  const graph = new Map();
  for (const [url, page] of built) {
    const targets = new Set();
    for (const href of readHrefs(page.html)) {
      const path = internalPath(href, url);
      if (path === undefined) continue;
      targets.add(path);
      if (path.endsWith('.mdx')) fail('link-mdx', url, `<a href="${href}">`);
      else if (!known(path)) fail('link-missing', url, `<a href="${href}"> → ${path}`);
    }
    graph.set(url, targets);
    for (const m of new Set(page.html.match(localeMdx) ?? [])) fail('locale-mdx-url', url, m);
  }

  // ---- head metadata
  for (const [url, page] of built) {
    const locales = oracle.get(page.path);
    if (!locales) continue; // a built page with no oracle entry is not this gate's concern
    const head = readHead(page.html);
    const real = locales.has(page.lang);
    const noindex = /\bnoindex\b/i.test(head.robots ?? '');
    const english = localeUrl(defaultLanguage, page.path, defaultLanguage);
    const self = localeUrl(page.lang, page.path, defaultLanguage);
    if (real) {
      if (noindex) fail('translated-noindex', url, `robots="${head.robots}"`);
      if (head.canonical !== self) fail('translated-canonical', url, `canonical ${head.canonical ?? '(none)'}, expected ${self}`);
    } else {
      if (!noindex) fail('fallback-indexable', url, `renders ${defaultLanguage}; robots="${head.robots ?? '(none)'}"`);
      if (head.canonical !== english) fail('fallback-canonical', url, `canonical ${head.canonical ?? '(none)'}, expected ${english}`);
    }
    const expected = new Map(
      [...languages.filter((l) => locales.has(l)), 'x-default'].map((l) => [
        l,
        localeUrl(l === 'x-default' ? defaultLanguage : l, page.path, defaultLanguage),
      ]),
    );
    const got = [...head.hreflang].sort().map(([k, v]) => `${k}=${v}`).join(' ');
    const want = [...expected].sort().map(([k, v]) => `${k}=${v}`).join(' ');
    if (got !== want) fail('hreflang-mismatch', url, `hreflang [${got}] expected [${want}]`);
  }

  // ---- markdown routes
  for (const [path, headers] of mdxRoutes) {
    const html = `${SITE_URL}${path.slice(0, -'.mdx'.length)}`;
    const canonical = new RegExp(`<${html.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>;\\s*rel="?canonical"?`);
    if (!/\bnoindex\b/i.test(headers['x-robots-tag'] ?? '') || !canonical.test(headers.link ?? '')) {
      fail('mdx-indexable', path, `X-Robots-Tag "${headers['x-robots-tag'] ?? ''}", Link "${headers.link ?? ''}"`);
    }
  }

  // ---- sitemap
  const entries = readSitemap(readFileSync(sitemapFile, 'utf8'));
  const reached = new Set();
  const queue = [...new Set([defaultLanguage, ...nonDefault].map((l) => new URL(localeUrl(l, 'docs', defaultLanguage)).pathname))];
  while (queue.length) {
    const url = queue.shift();
    if (reached.has(url)) continue;
    reached.add(url);
    for (const next of graph.get(url) ?? []) if (built.has(next) && !reached.has(next)) queue.push(next);
  }
  for (const { loc, lastmod } of entries) {
    const time = lastmod ? Date.parse(lastmod) : NaN;
    if (Number.isNaN(time) || time > now + 24 * 3600 * 1000) fail('sitemap-lastmod-missing', loc, `lastmod ${lastmod ?? '(none)'}`);
    const path = loc.startsWith(SITE_URL) ? new URL(loc).pathname : loc;
    if (!reached.has(path)) fail('sitemap-unlinked', loc, 'no <a href> chain from a docs root reaches it');
  }

  return findings;
}

/* ------------------------------------------------------------- self-test -- */

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/**
 * A two-locale site that passes every rule: `docs` and `docs/a` translated to
 * `ja`, `docs/b` English-only, and the legal pages. Each case below changes one
 * thing and names the rules that change must trip — exactly those.
 */
function baseFixture() {
  const S = SITE_URL;
  const head = ({ robots, canonical, langs, path }) =>
    `<head>${robots ? `<meta name="robots" content="${robots}"/>` : ''}<link rel="canonical" href="${canonical}"/>${langs
      .map((l) => `<link rel="alternate" hrefLang="${l}" href="${S}${l === 'en' || l === 'x-default' ? '' : `/${l}`}/${path}"/>`)
      .join('')}</head>`;
  const nav = (prefix) =>
    `<a href="${prefix}/docs">Docs</a><a href="${prefix}/docs/a">A</a><a href="${prefix}/docs/b">B</a><a href="${prefix}/terms">T</a><a href="${prefix}/privacy">P</a><a href="https://github.com/x">gh</a><a href="#top">top</a>`;
  const page = (h, prefix, extra = '') => `<html>${h}<body>${nav(prefix)}${extra}</body></html>`;
  const files = {
    'apps/docs/lib/i18n.ts': "defineI18n({ defaultLanguage: 'en', languages: ['en', 'ja'] })",
    'apps/docs/next.config.mjs': "const moved = [['/docs/old', '/docs/a']];",
    'apps/docs/public/logo.svg': '<svg/>',
    'content/docs/index.mdx': '',
    'content/docs/index.ja.mdx': '',
    'content/docs/a.mdx': '',
    'content/docs/a.ja.mdx': '',
    'content/docs/b.mdx': '',
  };
  const out = `${APP_OUT}/`;
  const docs = { 'docs': ['en', 'ja'], 'docs/a': ['en', 'ja'], 'docs/b': ['en'], terms: ['en'], privacy: ['en'] };
  for (const [path, locales] of Object.entries(docs)) {
    const langs = [...locales, 'x-default'];
    files[`${out}en/${path}.html`] = page(head({ canonical: `${S}/${path}`, langs, path }), '');
    files[`${out}ja/${path}.html`] = locales.includes('ja')
      ? page(head({ canonical: `${S}/ja/${path}`, langs, path }), '/ja')
      : page(head({ robots: 'noindex, follow', canonical: `${S}/${path}`, langs, path }), '/ja');
  }
  for (const path of ['docs', 'docs/a', 'docs/b']) {
    files[`${out}llms.mdx/${path}.meta`] = JSON.stringify({
      headers: { 'x-robots-tag': 'noindex', link: `<${S}/${path}>; rel="canonical"` },
    });
  }
  const urls = ['/docs', '/ja/docs', '/docs/a', '/ja/docs/a', '/docs/b', '/terms', '/privacy'];
  files[`${out}sitemap.xml.body`] = `<urlset>${urls.map((u) => `<url><loc>${S}${u}</loc><lastmod>2026-11-01T00:00:00Z</lastmod></url>`).join('')}</urlset>`;
  // The legal pages' oracle is STATIC_PAGES; give the fixture's `ja` no copy of them.
  return files;
}

const CASES = [
  { name: 'clean fixture', mutate: () => {}, expect: [] },
  {
    name: 'no build output',
    mutate: (f) => {
      for (const k of Object.keys(f)) if (k.startsWith(APP_OUT)) delete f[k];
    },
    expect: ['artifact-missing'],
  },
  {
    name: 'link keeps its .mdx extension',
    mutate: (f) => (f[`${APP_OUT}/en/docs/a.html`] = f[`${APP_OUT}/en/docs/a.html`].replace('</body>', '<a href="b.mdx">b</a></body>')),
    expect: ['link-mdx'],
  },
  {
    name: 'locale-prefixed .mdx URL in the RSC payload (#211)',
    mutate: (f) =>
      (f[`${APP_OUT}/ja/docs/a.html`] = f[`${APP_OUT}/ja/docs/a.html`].replace('</body>', '<script>{"markdown":{"url":"/ja/docs/a.mdx"}}</script></body>')),
    expect: ['locale-mdx-url'],
  },
  {
    name: 'link to a page that does not exist',
    mutate: (f) => (f[`${APP_OUT}/ja/docs/a.html`] = f[`${APP_OUT}/ja/docs/a.html`].replace('</body>', '<a href="/ja/docs/configure/uploads">x</a></body>')),
    expect: ['link-missing'],
  },
  {
    name: 'redirect source, public file, .mdx route and dispatch root are valid targets',
    mutate: (f) =>
      (f[`${APP_OUT}/ja/docs/a.html`] = f[`${APP_OUT}/ja/docs/a.html`].replace(
        '</body>',
        '<a href="/ja/docs/old">o</a><a href="/logo.svg">l</a><a href="/ja">j</a><a href="/">r</a><a href="/llms.txt">t</a><a href="mailto:a@b.c">m</a></body>',
      )),
    expect: [],
  },
  {
    name: 'fallback page left indexable',
    mutate: (f) => (f[`${APP_OUT}/ja/docs/b.html`] = f[`${APP_OUT}/ja/docs/b.html`].replace('<meta name="robots" content="noindex, follow"/>', '')),
    expect: ['fallback-indexable'],
  },
  {
    name: 'fallback legal page self-canonical',
    mutate: (f) => (f[`${APP_OUT}/ja/terms.html`] = f[`${APP_OUT}/ja/terms.html`].replace(`href="${SITE_URL}/terms"`, `href="${SITE_URL}/ja/terms"`)),
    expect: ['fallback-canonical'],
  },
  {
    name: 'translated page marked noindex',
    mutate: (f) => (f[`${APP_OUT}/ja/docs/a.html`] = f[`${APP_OUT}/ja/docs/a.html`].replace('<head>', '<head><meta name="robots" content="noindex"/>')),
    expect: ['translated-noindex'],
  },
  {
    name: 'translated page canonical to English',
    mutate: (f) => (f[`${APP_OUT}/ja/docs/a.html`] = f[`${APP_OUT}/ja/docs/a.html`].replace(`canonical" href="${SITE_URL}/ja/docs/a"`, `canonical" href="${SITE_URL}/docs/a"`)),
    expect: ['translated-canonical'],
  },
  {
    name: 'fallback locale advertised in hreflang',
    mutate: (f) =>
      (f[`${APP_OUT}/en/docs/b.html`] = f[`${APP_OUT}/en/docs/b.html`].replace('</head>', `<link rel="alternate" hrefLang="ja" href="${SITE_URL}/ja/docs/b"/></head>`)),
    expect: ['hreflang-mismatch'],
  },
  {
    name: '.mdx route served without noindex',
    mutate: (f) => (f[`${APP_OUT}/llms.mdx/docs/a.meta`] = JSON.stringify({ headers: { 'content-type': 'text/markdown' } })),
    expect: ['mdx-indexable'],
  },
  {
    name: 'sitemap entry without lastmod (shallow clone)',
    mutate: (f) => (f[`${APP_OUT}/sitemap.xml.body`] = f[`${APP_OUT}/sitemap.xml.body`].replace('<lastmod>2026-11-01T00:00:00Z</lastmod>', '')),
    expect: ['sitemap-lastmod-missing'],
  },
  {
    name: 'sitemap entry no page links to',
    mutate: (f) => {
      for (const k of Object.keys(f)) if (k.endsWith('.html')) f[k] = f[k].replace(/<a href="(\/ja)?\/docs\/b">B<\/a>/, '');
    },
    expect: ['sitemap-unlinked'],
  },
];

function selfTest() {
  const failures = [];
  const fired = new Set();
  for (const { name, mutate, expect } of CASES) {
    const files = baseFixture();
    mutate(files);
    const root = mkdtempSync(join(tmpdir(), 'check-indexing-'));
    try {
      write(root, files);
      const rules = [...new Set(evaluate(root, { now: Date.parse('2026-11-14T00:00:00Z') }).map((f) => f.rule))].sort();
      rules.forEach((r) => fired.add(r));
      const want = [...expect].sort();
      const ok = rules.join(',') === want.join(',');
      console.log(`${ok ? '✓' : '✗'} ${name}: ${rules.join(', ') || '(no findings)'}`);
      if (!ok) failures.push(`${name}: fired [${rules.join(', ')}], expected [${want.join(', ')}]`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  for (const rule of RULES) if (!fired.has(rule)) failures.push(`rule "${rule}" has no fixture that makes it fail`);
  if (failures.length) {
    console.error(`\n✗ check-indexing self-test: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`\n✓ check-indexing self-test: ${CASES.length} cases, all ${RULES.length} rules able to fail`);
}

/* ------------------------------------------------------------------ main -- */

function main() {
  if (process.argv.slice(2).includes('--self-test')) return selfTest();
  const findings = evaluate(ROOT);
  if (findings.length === 0) {
    const pages = readBuiltPages(ROOT, readI18n(ROOT)).size;
    console.log(`✓ indexing: ${pages} prerendered pages — links, robots/canonical/hreflang, .mdx headers and sitemap lastmod/reachability all hold`);
    return;
  }
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  console.error(`✗ indexing: ${findings.length} finding(s)\n`);
  for (const [rule, list] of byRule) {
    console.error(`  ${rule} (${list.length})`);
    for (const f of list.slice(0, 20)) console.error(`    ${f.where}: ${f.detail}`);
    if (list.length > 20) console.error(`    … and ${list.length - 20} more`);
  }
  process.exit(1);
}

main();
