#!/usr/bin/env node
/**
 * Live-site smoke check for the published docs Worker.
 *
 * ## Why this exists
 *
 * Nothing in this repository's CI ever touched the website. `build`, the Node
 * floor, the locale surface, the translation gates and the half-state sweeper
 * all judge the tree; the deploy published a Worker and no check anywhere asked
 * whether the result rendered. On 2026-09-04 a deploy was accepted, the site
 * broke, and a human found it (#261). This script is the check that was
 * missing, and `ci.yml` runs it after every deploy (#269).
 *
 * ## A 200 is not the assertion
 *
 * The failure this exists to catch returns 200. A Next.js app whose render path
 * is broken still serves a document — a shell with the scripts, the styles and
 * no content. So status is one rule out of eleven, and the ones that carry the
 * weight are structural:
 *
 *   - an `h1` element with text, matching what that page is supposed to be
 *     called;
 *   - visible text above a floor, measured after `script` and `style` are
 *     removed. An empty shell is mostly script: it is large in bytes and close
 *     to empty in prose, which is why a byte floor alone would pass it;
 *   - a minimum number of same-site links, which is the docs sidebar. A shell
 *     has none;
 *   - the document language, and the path the request finally landed on after
 *     redirects — `/en/docs` must normalise to `/docs`, and a redirect loop or
 *     a 404-to-negotiation loop shows up here rather than as a 200 somewhere
 *     unexpected.
 *
 * ## The negative control is part of every run
 *
 * This lane has had three same-day instances of a probe that could not fail:
 * a port check reading a command that prints nothing in that container, an
 * ablation that returned 500 because the server never started, and a scan whose
 * script exited before it scanned. A green from this script means nothing
 * unless the same code path is able to produce a red against the same host in
 * the same run.
 *
 * So every run also fetches a path that must NOT render — `/docs/` plus a slug
 * no page claims — and requires it to produce findings. If the negative control
 * comes back clean, `negative-control-passed` fires and the run fails: whatever
 * that means, it means this check is not currently able to tell a rendered page
 * from an unrendered one, and its green is worthless.
 *
 * That is a live demonstration, not a fixture one, and it costs one request.
 * `--self-test` is the offline half: every rule below has a fixture that trips
 * it, and the runner asserts that the set of rules with a red fixture is the
 * whole set. Weaken a rule and the self-test exits 1.
 *
 * ## Search is checked too, in every locale
 *
 * `/api/search` is dynamic, so no build output records whether it works, and
 * on 2026-10-06 it answered 500 in four locales while every page rendered
 * (#296). `check-search-locales.mjs` now asks the BUILT route under Node; this
 * asks the deployed Worker (#301). One request per locale declared in
 * `apps/docs/lib/i18n.ts` — read as text from this checkout, because the
 * script is zero-dependency — for `permissions`, which must answer 200 with a
 * non-empty JSON array. A query no page contains is the search's own negative
 * control: it must come back empty, or a cache that ignores the query string
 * (every query answered with the same list) would read as green.
 *
 * The locale list is the tree's, not the serving version's. A locale added on
 * a commit whose deploy was rejected is not on the live site yet, and its
 * search request reads `search-no-results` — which is what that site does.
 *
 * ## Usage
 *
 *   node .github/scripts/smoke-docs.mjs                      # default targets
 *   node .github/scripts/smoke-docs.mjs --base https://host   # another origin
 *   node .github/scripts/smoke-docs.mjs --paths /a,/b         # ad-hoc targets
 *   node .github/scripts/smoke-docs.mjs --self-test           # prove the rules
 *
 * Exit 0 only when every target passed every rule AND the negative control
 * failed at least one. Any other outcome exits 1.
 *
 * ## What the expectations may and may not assume
 *
 * The expectations below are deliberately generic — an `h1` noun, a language,
 * a normalised path — and never a sentence out of a page body. This script has
 * to be runnable against whatever version is currently serving, which is not
 * necessarily built from the commit it runs on: for the whole of 2026-08-25 to
 * 2026-09-04 the live site was pinned to a version 36 rejected deploys older
 * than `main`. An expectation derived from the working tree would have been a
 * gate on content drift wearing a smoke check's name.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The origin the checks run against unless `--base` says otherwise. */
const DEFAULT_BASE = 'https://docs.objectos.ai';

/**
 * Every rule this script enforces. The self-test asserts each one has a fixture
 * that makes it fire; a rule added here without a fixture fails the self-test,
 * which is what keeps this list from growing decorative entries.
 */
const RULES = [
  'fetch-failed',
  'status',
  'not-html',
  'error-shell',
  'too-little-text',
  'no-title',
  'no-h1',
  'h1-mismatch',
  'few-links',
  'lang-mismatch',
  'final-path',
  'negative-control-passed',
  'search-status',
  'search-not-json',
  'search-no-results',
  'search-negative-control-passed',
];

/**
 * Strings that mean the response is an error surface rather than a page.
 *
 * Matched against the document title and the first heading only, never the
 * whole body: `content/docs/` is documentation about running a server, and a
 * page that explains what a 500 means must not be read as one. None of these
 * occurs in the corpus today, and scoping the match to the title and heading is
 * what keeps that from becoming a maintenance trap.
 */
const ERROR_MARKERS = [
  'this page could not be found',
  'internal server error',
  'application error',
  'worker threw exception',
  'error 1101',
  'error 1102',
  'exceeded its cpu time limit',
  '502 bad gateway',
  '503 service temporarily unavailable',
];

/**
 * Defaults every target inherits unless it overrides them.
 *
 * The two floors are set against MEASURED values, in both directions, because
 * a false red here now dispatches a rollback. Taken from the live site on
 * 2026-09-04: the four targets carried 4639 to 9101 visible characters and 14
 * to 22 same-site links; the 404 shell carried 8 characters and 0 links in
 * 37962 bytes. So the floors sit an order of magnitude below the smallest real
 * page and far above the shell — and that shell is also why the text floor is
 * measured on prose rather than bytes.
 */
const TARGET_DEFAULTS = {
  status: 200,
  lang: 'en',
  minText: 500,
  minLinks: 8,
};

/**
 * The pages this checks, and why each one is here.
 *
 * `/` and `/en/docs` are both required by #269 and both are also redirect
 * assertions: `/` is rewritten to `/en` by `middleware.ts` and then redirected
 * to `/docs` by `app/[lang]/page.tsx`, and `/en/docs` is 307'd to `/docs` by
 * the default-locale strip. Landing anywhere else means the locale routing is
 * broken even if a page rendered.
 *
 * The deep page is three segments down and behind a `next.config.mjs` redirect
 * table, so it exercises the part of the route tree a shallow check misses.
 * `/docs/quickstart` is a redirect assertion too since the page moved to
 * `/docs/start/community`: the old URL is the one every link outside this site
 * still carries, so it has to land on the page that replaced it. Against a
 * version from before that move it reads `final-path` and `h1-mismatch`, which
 * is correct for the same reason as the index H1 below: the list describes the
 * site this tree ships.
 *
 * The index H1 is `Introduction` since #171 gave `content/docs/index.mdx` a
 * real title instead of the bare brand. A version from before that change
 * renders `ObjectOS` there and reads as `h1-mismatch` against this list —
 * which is what a rollback to such a version would show, and is correct: the
 * list describes the site this tree ships, not every version ever served.
 */
const TARGETS = [
  { path: '/', finalPath: '/docs', h1: /^Introduction$/i },
  { path: '/en/docs', finalPath: '/docs', h1: /^Introduction$/i },
  { path: '/docs/quickstart', finalPath: '/docs/start/community', h1: /^Run ObjectOS Community locally$/i },
  {
    path: '/docs/build/interface/views',
    finalPath: '/docs/build/interface/views',
    h1: /^Views$/i,
  },
];

/**
 * The path the negative control asks for.
 *
 * `dynamicParams = false` on the docs route rejects an unknown slug at the
 * routing level, so this is answered by the root `_not-found` entry: 404, an
 * `h1` reading "404", almost no prose and no sidebar. Several rules therefore
 * fire on it, which is the point — a live red from the same code path that
 * produced the greens.
 */
const NEGATIVE_CONTROL_PATH = '/docs/objectos-smoke-negative-control-269';

/**
 * What the search requests ask. `permissions` finds pages in every locale,
 * because an English fallback page carries it wherever a translation does not;
 * the nonce is in no page, and prefix matching cannot reach a real word from
 * it. `check-search-locales.mjs` asks the built route the same two.
 */
const SEARCH = { query: 'permissions', nonce: 'qzxvjwkq' };

/** `languages` out of `apps/docs/lib/i18n.ts`. Throws rather than guessing, so a smoke run never silently skips search. */
function searchLocales(text) {
  const list = /languages:\s*\[([^\]]+)\]/.exec(text)?.[1];
  const languages = list?.split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean) ?? [];
  if (!languages.length) throw new Error('could not read languages[] out of apps/docs/lib/i18n.ts');
  return languages;
}

const searchPath = (locale, query) =>
  `/api/search?locale=${encodeURIComponent(locale)}&query=${encodeURIComponent(query)}`;

/* ------------------------------------------------------------- extraction -- */

const stripTags = (html) => html.replace(/<[^>]*>/g, '');

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'");

const collapse = (text) => decodeEntities(stripTags(text)).replace(/\s+/g, ' ').trim();

/** The document's declared language, or null when there is no `html` element. */
function htmlLang(body) {
  const m = /<html[^>]*\slang=["']([^"']*)["']/i.exec(body);
  return m ? m[1].trim() : null;
}

/** The `title` element's text, or null. */
function titleText(body) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  return m ? collapse(m[1]) : null;
}

/** The FIRST `h1` element's text, or null. */
function h1Text(body) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body);
  return m ? collapse(m[1]) : null;
}

/**
 * Visible prose length, with `script` and `style` bodies removed first.
 *
 * This is the measurement a byte floor cannot make. A broken Next.js render
 * still ships every bundle in the document, so an empty shell is tens of
 * kilobytes of `script` and a handful of visible characters.
 */
function visibleText(body) {
  const withoutCode = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return collapse(withoutCode);
}

/** Distinct same-site link targets in the document — in practice, the sidebar. */
function internalLinks(body) {
  const found = new Set();
  for (const m of body.matchAll(/<a\b[^>]*\shref=["'](\/[^"'#?]*)["']/gi)) found.add(m[1]);
  return found;
}

/* ----------------------------------------------------------------- rules -- */

/**
 * Judge one response against one target. Pure: takes a already-fetched
 * response shape, returns findings and the measurements behind them.
 *
 * The response shape is `{ error, status, url, contentType, body }` so the
 * self-test can drive every rule without a network.
 */
function evaluate(target, res) {
  const spec = { ...TARGET_DEFAULTS, ...target };
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });

  if (res.error) {
    add('fetch-failed', `${spec.path}: ${res.error}`);
    return { findings, measured: { error: res.error } };
  }

  const body = res.body ?? '';
  const measured = {
    status: res.status,
    finalPath: res.url ? new URL(res.url).pathname : null,
    contentType: res.contentType ?? null,
    bytes: Buffer.byteLength(body, 'utf8'),
    lang: htmlLang(body),
    title: titleText(body),
    h1: h1Text(body),
    text: visibleText(body).length,
    links: internalLinks(body).size,
  };

  if (measured.status !== spec.status) {
    add('status', `${spec.path}: HTTP ${measured.status}, expected ${spec.status}`);
  }

  if (spec.finalPath && measured.finalPath !== spec.finalPath) {
    add('final-path', `${spec.path}: landed on ${measured.finalPath}, expected ${spec.finalPath}`);
  }

  if (!/^text\/html\b/i.test(measured.contentType ?? '')) {
    add('not-html', `${spec.path}: content-type ${measured.contentType ?? '(none)'}`);
  }

  const errorSurface = `${measured.title ?? ''} ${measured.h1 ?? ''}`.toLowerCase();
  const marker = ERROR_MARKERS.find((m) => errorSurface.includes(m));
  if (marker) add('error-shell', `${spec.path}: title/heading carries "${marker}"`);

  if (measured.text < spec.minText) {
    add(
      'too-little-text',
      `${spec.path}: ${measured.text} visible characters in ${measured.bytes} B, floor ${spec.minText}`,
    );
  }

  if (!measured.title) add('no-title', `${spec.path}: no non-empty title element`);

  if (!measured.h1) {
    add('no-h1', `${spec.path}: no non-empty h1 element`);
  } else if (spec.h1 && !spec.h1.test(measured.h1)) {
    add('h1-mismatch', `${spec.path}: h1 is "${measured.h1}", expected ${spec.h1}`);
  }

  if (measured.links < spec.minLinks) {
    add('few-links', `${spec.path}: ${measured.links} same-site links, floor ${spec.minLinks}`);
  }

  if (spec.lang && measured.lang !== spec.lang) {
    add('lang-mismatch', `${spec.path}: html lang="${measured.lang}", expected "${spec.lang}"`);
  }

  return { findings, measured };
}

/**
 * Judge one search response. `expectHits` is true for the real query and
 * false for the nonce. Same response shape as `evaluate`.
 */
function evaluateSearch({ locale, query, expectHits }, res) {
  const findings = [];
  const label = `search ${locale} ${JSON.stringify(query)}`;
  const add = (rule, detail) => findings.push({ rule, detail: `${label}: ${detail}` });
  if (res.error) {
    add('fetch-failed', res.error);
    return { findings, measured: { error: res.error } };
  }
  let hits;
  try {
    hits = JSON.parse(res.body ?? '');
  } catch {
    hits = undefined;
  }
  const measured = {
    status: res.status,
    contentType: res.contentType ?? null,
    hits: Array.isArray(hits) ? hits.length : null,
  };
  if (res.status !== 200) add('search-status', `HTTP ${res.status}, expected 200`);
  if (!/^application\/json\b/i.test(measured.contentType ?? '') || !Array.isArray(hits)) {
    add('search-not-json', `content-type ${measured.contentType ?? '(none)'}, body ${Array.isArray(hits) ? 'an array' : 'not a JSON array'}`);
  } else if (expectHits && hits.length === 0) {
    add('search-no-results', 'found nothing');
  } else if (!expectHits && hits.length > 0) {
    add(
      'search-negative-control-passed',
      `matches no page yet found ${hits.length} hits — this check cannot tell a working search from one that ignores the query`,
    );
  }
  return { findings, measured };
}

/* --------------------------------------------------------------- fetching -- */

/**
 * Fetch one target, following redirects.
 *
 * Retries only a transport error or a 5xx, and only to absorb a flake: a page
 * that is genuinely broken is still broken on the last attempt, and the last
 * attempt is what gets judged. `Accept-Language: en` is sent because the site
 * negotiates: without it the answer depends on what the runner's client
 * happens to send, and a smoke check whose expectations move with the caller
 * is not a check.
 */
async function fetchTarget(base, path, { attempts, timeoutMs, fetchImpl }) {
  const url = new URL(path, base).toString();
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'objectos-smoke-docs (+https://github.com/objectstack-ai/docs.objectos.ai)',
        },
      });
      const body = await response.text();
      last = {
        status: response.status,
        url: response.url || url,
        contentType: response.headers.get('content-type'),
        body,
        attempt,
      };
      if (response.status < 500) return last;
    } catch (error) {
      last = { error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`, attempt };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

/* ------------------------------------------------------------------- run -- */

function report(label, target, result) {
  const m = result.measured;
  const head = `${label} ${target.path}`;
  if (m.error) {
    console.log(`${head}\n    transport: ${m.error}`);
    return;
  }
  console.log(
    `${head}\n` +
      `    http ${m.status}  final ${m.finalPath}  ${m.contentType ?? '(no content-type)'}\n` +
      `    lang=${m.lang}  h1=${JSON.stringify(m.h1)}  title=${JSON.stringify(m.title)}\n` +
      `    ${m.bytes} B  ${m.text} visible chars  ${m.links} same-site links`,
  );
}

async function run(options) {
  const {
    base,
    targets,
    negativeControlPath,
    search = null,
    attempts = 3,
    timeoutMs = 20000,
    fetchImpl = fetch,
  } = options;

  console.log(`smoke: ${base}`);
  console.log('');

  let failures = 0;

  for (const target of targets) {
    const res = await fetchTarget(base, target.path, { attempts, timeoutMs, fetchImpl });
    const result = evaluate(target, res);
    report(result.findings.length ? '✗' : '✓', target, result);
    for (const f of result.findings) {
      console.error(`    [${f.rule}] ${f.detail}`);
      failures += 1;
    }
    console.log('');
  }

  if (negativeControlPath) {
    const control = { path: negativeControlPath, finalPath: negativeControlPath, h1: /\S/ };
    const res = await fetchTarget(base, negativeControlPath, { attempts: 1, timeoutMs, fetchImpl });
    const result = evaluate(control, res);
    report(result.findings.length ? '✓ (control, expected red)' : '✗ (control)', control, result);
    if (result.findings.length === 0) {
      console.error(
        `    [negative-control-passed] ${negativeControlPath} produced no findings — ` +
          'this check cannot currently tell a rendered page from an unrendered one, ' +
          'so its greens above mean nothing',
      );
      failures += 1;
    } else {
      console.log(
        `    control tripped [${[...new Set(result.findings.map((f) => f.rule))].join(' ')}] — ` +
          'the live path is demonstrably able to fail',
      );
    }
    console.log('');
  }

  // One request per locale, then the nonce once. The nonce is a control, so
  // it gets one attempt, like the page control above.
  const asks = search
    ? [
        ...search.locales.map((locale) => ({ locale, query: search.query, expectHits: true })),
        { locale: search.locales[0], query: search.nonce, expectHits: false },
      ]
    : [];
  for (const ask of asks) {
    const started = Date.now();
    const res = await fetchTarget(base, searchPath(ask.locale, ask.query), {
      attempts: ask.expectHits ? attempts : 1,
      timeoutMs,
      fetchImpl,
    });
    const result = evaluateSearch(ask, res);
    const m = result.measured;
    const ok = result.findings.length === 0;
    const mark = ask.expectHits ? (ok ? '✓' : '✗') : ok ? '✓ (control, expected empty)' : '✗ (control)';
    console.log(
      `${mark} search ${ask.locale} ${JSON.stringify(ask.query)}  ` +
        (m.error ? `transport: ${m.error}` : `http ${m.status}  ${m.contentType ?? '(no content-type)'}  ${m.hits ?? '-'} hits  ${Date.now() - started} ms`),
    );
    for (const f of result.findings) {
      console.error(`    [${f.rule}] ${f.detail}`);
      failures += 1;
    }
  }
  if (asks.length) console.log('');

  if (failures) {
    console.error(`✗ smoke: ${failures} finding(s) against ${base}`);
    return 1;
  }
  console.log(
    `✓ smoke: ${targets.length} page(s) rendered against ${base}` +
      (negativeControlPath ? ', negative control demonstrated red' : '') +
      (search ? `, search answered in ${search.locales.length} locale(s) and found nothing for a nonce` : ''),
  );
  return 0;
}

/* ------------------------------------------------------------- self-test -- */

/** A document with enough prose and enough sidebar to satisfy every floor. */
function goodPage({
  lang = 'en',
  title = 'Quickstart | ObjectOS',
  h1 = 'Quickstart',
  links = 20,
  prose = 'The ontology is the software, and this fixture carries enough prose to clear the floor. '.repeat(20),
} = {}) {
  const nav = Array.from({ length: links }, (_, i) => `<a href="/docs/page-${i}">Page ${i}</a>`).join('');
  return (
    `<!doctype html><html lang="${lang}"><head><title>${title}</title>` +
    `<script>window.__NEXT_DATA__={};${'x'.repeat(4000)}</script></head>` +
    `<body><nav>${nav}</nav><main><h1>${h1}</h1><p>${prose}</p></main></body></html>`
  );
}

/** The empty shell this whole script exists for: 200, big, and not a page. */
function emptyShell() {
  return (
    '<!doctype html><html lang="en"><head><title>ObjectOS</title>' +
    `<script>${'x'.repeat(40000)}</script></head><body><div id="__next"></div></body></html>`
  );
}

const OK_RES = (body, over = {}) => ({
  status: 200,
  url: 'https://docs.objectos.ai/docs/quickstart',
  contentType: 'text/html; charset=utf-8',
  body,
  ...over,
});

const BASE_TARGET = {
  path: '/docs/quickstart',
  finalPath: '/docs/quickstart',
  h1: /^Quickstart$/i,
};

const CASES = [
  { name: 'a rendered page trips nothing', res: OK_RES(goodPage()), expect: [] },
  {
    name: 'transport error',
    res: { error: 'TypeError: fetch failed' },
    expect: ['fetch-failed'],
  },
  {
    name: 'not 200',
    res: OK_RES(goodPage(), { status: 503 }),
    expect: ['status'],
  },
  {
    name: 'served as plain text',
    res: OK_RES(goodPage(), { contentType: 'text/plain; charset=utf-8' }),
    expect: ['not-html'],
  },
  {
    name: 'the Next.js 404 surface',
    res: OK_RES(
      goodPage({ title: '404: This page could not be found.', h1: '404', links: 0, prose: '' }),
      { status: 404 },
    ),
    expect: ['status', 'error-shell', 'too-little-text', 'h1-mismatch', 'few-links'],
  },
  {
    name: 'a 200 empty shell',
    res: OK_RES(emptyShell()),
    expect: ['too-little-text', 'no-h1', 'few-links'],
  },
  {
    name: 'no title element',
    res: OK_RES(goodPage().replace(/<title>[\s\S]*?<\/title>/, '')),
    expect: ['no-title'],
  },
  {
    name: 'the wrong page under the right URL',
    res: OK_RES(goodPage({ h1: 'Architecture' })),
    expect: ['h1-mismatch'],
  },
  {
    name: 'body without the sidebar',
    res: OK_RES(goodPage({ links: 3 })),
    expect: ['few-links'],
  },
  {
    name: 'wrong document language',
    res: OK_RES(goodPage({ lang: 'zh-Hans' })),
    expect: ['lang-mismatch'],
  },
  {
    name: 'redirected somewhere else',
    res: OK_RES(goodPage(), { url: 'https://docs.objectos.ai/zh-Hans/docs/quickstart' }),
    expect: ['final-path'],
  },
];

const JSON_RES = (body, over = {}) => ({
  status: 200,
  url: 'https://docs.objectos.ai/api/search',
  contentType: 'application/json',
  body: JSON.stringify(body),
  ...over,
});
const HIT = { id: '/docs/a', type: 'page', url: '/docs/a', content: 'Permissions' };
const ASK = { locale: 'ja', query: 'permissions', expectHits: true };
const NONCE_ASK = { locale: 'en', query: 'qzxvjwkq', expectHits: false };

const SEARCH_CASES = [
  { name: 'a search with hits trips nothing', ask: ASK, res: JSON_RES([HIT]), expect: [] },
  { name: 'an empty nonce search trips nothing', ask: NONCE_ASK, res: JSON_RES([]), expect: [] },
  { name: 'search transport error', ask: ASK, res: { error: 'TypeError: fetch failed' }, expect: ['fetch-failed'] },
  { name: 'search answers 500 (#296)', ask: ASK, res: JSON_RES({}, { status: 500, contentType: 'text/plain', body: 'Internal Server Error' }), expect: ['search-status', 'search-not-json'] },
  { name: 'search answers an HTML page', ask: ASK, res: JSON_RES([], { contentType: 'text/html', body: '<html></html>' }), expect: ['search-not-json'] },
  { name: 'search answers an object', ask: ASK, res: JSON_RES({ hits: [HIT] }), expect: ['search-not-json'] },
  { name: 'search finds nothing', ask: ASK, res: JSON_RES([]), expect: ['search-no-results'] },
  { name: 'the nonce finds something', ask: NONCE_ASK, res: JSON_RES([HIT]), expect: ['search-negative-control-passed'] },
];

/** Whole-run cases, driven through `run()` with an injected fetch. */
async function runCases() {
  const results = [];

  // A negative control that renders is the failure `negative-control-passed`
  // names: every target came back clean AND so did the page that must not.
  const alwaysGood = async (url) => ({
    status: 200,
    url,
    headers: new Map([['content-type', 'text/html; charset=utf-8']]),
    text: async () => goodPage({ h1: url.includes('control') ? 'Anything' : 'Quickstart' }),
  });
  const asResponse = (impl) => async (url, init) => {
    const r = await impl(url, init);
    return { ...r, headers: { get: (k) => r.headers.get(k) } };
  };
  const quiet = () => {};
  const logs = { log: console.log, error: console.error };
  console.log = quiet;
  console.error = quiet;
  const code = await run({
    base: 'https://example.invalid',
    targets: [BASE_TARGET],
    negativeControlPath: '/docs/control',
    attempts: 1,
    fetchImpl: asResponse(alwaysGood),
  });
  const codeTransport = await run({
    base: 'https://example.invalid',
    targets: [BASE_TARGET],
    negativeControlPath: null,
    attempts: 1,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  // A search that answers every query with the same list — a cache keyed
  // without the query string — passes every per-locale request and is caught
  // only by the nonce.
  const pagesFine = async (url) => {
    if (url.includes('/api/search')) {
      return {
        status: 200,
        url,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify([HIT]),
      };
    }
    return alwaysGood(url);
  };
  const codeSearch = await run({
    base: 'https://example.invalid',
    targets: [BASE_TARGET],
    negativeControlPath: null,
    search: { ...SEARCH, locales: ['en', 'ja'] },
    attempts: 1,
    fetchImpl: asResponse(pagesFine),
  });
  // The same run with a search that does read the query passes, so the red
  // above is the nonce's and nothing else's.
  const searchWorks = async (url) => {
    if (url.includes('/api/search')) {
      const nonce = new URL(url).searchParams.get('query') === SEARCH.nonce;
      return {
        status: 200,
        url,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify(nonce ? [] : [HIT]),
      };
    }
    return alwaysGood(url);
  };
  const codeSearchWorks = await run({
    base: 'https://example.invalid',
    targets: [BASE_TARGET],
    negativeControlPath: null,
    search: { ...SEARCH, locales: ['en', 'ja'] },
    attempts: 1,
    fetchImpl: asResponse(searchWorks),
  });
  console.log = logs.log;
  console.error = logs.error;

  results.push({
    name: 'a search that ignores the query fails the run; one that reads it passes',
    ok: codeSearch === 1 && codeSearchWorks === 0,
    rule: 'search-negative-control-passed',
  });
  results.push({
    name: 'a negative control that renders fails the run',
    ok: code === 1,
    rule: 'negative-control-passed',
  });
  results.push({
    name: 'a transport error fails the run',
    ok: codeTransport === 1,
    rule: 'fetch-failed',
  });
  return results;
}

async function selfTest() {
  let failed = 0;

  for (const c of CASES) {
    const { findings } = evaluate(BASE_TARGET, c.res);
    const fired = [...new Set(findings.map((f) => f.rule))].sort();
    const want = [...c.expect].sort();
    const ok = fired.join(',') === want.join(',');
    if (!ok) failed += 1;
    console.log(
      `${ok ? '✓' : '✗'} ${c.name.padEnd(38)} fired [${fired.join(' ') || '—'}]` +
        (ok ? '' : `  expected [${want.join(' ') || '—'}]`),
    );
    if (!ok) for (const f of findings) console.error(`      [${f.rule}] ${f.detail}`);
  }

  for (const c of SEARCH_CASES) {
    const { findings } = evaluateSearch(c.ask, c.res);
    const fired = [...new Set(findings.map((f) => f.rule))].sort();
    const want = [...c.expect].sort();
    const ok = fired.join(',') === want.join(',');
    if (!ok) failed += 1;
    console.log(
      `${ok ? '✓' : '✗'} ${c.name.padEnd(38)} fired [${fired.join(' ') || '—'}]` +
        (ok ? '' : `  expected [${want.join(' ') || '—'}]`),
    );
    if (!ok) for (const f of findings) console.error(`      [${f.rule}] ${f.detail}`);
  }

  console.log('');
  const runResults = await runCases();
  for (const r of runResults) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
  }

  console.log('');
  const covered = new Set([
    ...CASES.flatMap((c) => c.expect),
    ...SEARCH_CASES.flatMap((c) => c.expect),
    ...runResults.map((r) => r.rule),
  ]);
  for (const rule of RULES) {
    if (!covered.has(rule)) {
      console.error(`✗ rule "${rule}" has no fixture that trips it`);
      failed += 1;
    }
  }
  // A rule that fires on the clean fixture would make every run red for the
  // wrong reason, so silence on a rendered page is asserted, not assumed.
  const cleanCase = CASES.find((c) => c.expect.length === 0);
  if (!cleanCase) {
    console.error('✗ no fixture asserts that a rendered page trips nothing');
    failed += 1;
  }
  if (!SEARCH_CASES.some((c) => c.expect.length === 0 && c.ask.expectHits)) {
    console.error('✗ no fixture asserts that a working search trips nothing');
    failed += 1;
  }
  // The locale list is read off the checkout; an unreadable one must throw, not
  // shrink the search check to nothing.
  const read = searchLocales("defineI18n({ defaultLanguage: 'en', languages: ['en', 'zh-Hans'] })");
  let refused = false;
  try {
    searchLocales('defineI18n({})');
  } catch {
    refused = true;
  }
  const i18nOk = read.join() === 'en,zh-Hans' && refused;
  if (!i18nOk) failed += 1;
  console.log(`${i18nOk ? '✓' : '✗'} i18n.ts locales are read, and an unreadable list is refused`);

  if (failed) {
    console.error(`\n✗ self-test: ${failed} case(s) did not behave as declared`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `✓ self-test: ${CASES.length} page case(s), ${SEARCH_CASES.length} search case(s) and ` +
      `${runResults.length} run case(s) — all ${RULES.length} rules demonstrated able to fail`,
  );
}

/* ------------------------------------------------------------------ main -- */

function parseArgs(argv) {
  const opts = { base: process.env.SMOKE_BASE_URL || DEFAULT_BASE, paths: null, control: NEGATIVE_CONTROL_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') opts.base = argv[++i];
    else if (a === '--paths') opts.paths = argv[++i];
    else if (a === '--negative-control') opts.control = argv[++i];
    else if (a === '--no-negative-control') opts.control = null;
    else if (a === '--self-test') opts.selfTest = true;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((a) => a === '--self-test')) return selfTest();

  const opts = parseArgs(argv);
  const targets = opts.paths
    ? opts.paths
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => ({ path: p, finalPath: p, h1: /\S/ }))
    : TARGETS;

  if (targets.length === 0) {
    console.error('✗ smoke: no targets — refusing to report a green on an empty check');
    process.exitCode = 1;
    return;
  }

  const i18nPath = fileURLToPath(new URL('../../apps/docs/lib/i18n.ts', import.meta.url));
  process.exitCode = await run({
    base: opts.base.replace(/\/+$/, ''),
    targets,
    negativeControlPath: opts.control,
    search: { ...SEARCH, locales: searchLocales(readFileSync(i18nPath, 'utf8')) },
  });
}

await main();
