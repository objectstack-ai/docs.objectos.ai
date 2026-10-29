#!/usr/bin/env node
/**
 * The Worker's cost per docs page, and how many more pages the budget holds
 * (#395). It runs in `Worker bundle fits the size budget`, after the size
 * itself is measured.
 *
 * #390's eleven ja pages and #388's PR 3 showed how a content batch finds out
 * it is too big: the budget step goes red after the batch is written. A
 * translated page costs its compiled module, its search text and a little
 * routing data, and nothing said how much up front. So this prints, from the
 * bundle just packaged:
 *
 *   - the KiB each locale's page modules and search text take, per page;
 *   - what one more translated page costs: the most expensive locale's
 *     module and search text per page, plus `OVERHEAD_KIB`;
 *   - how many more such pages fit under the budget;
 *   - what one more fully translated locale (one page per English page) would
 *     cost, and whether it fits.
 *
 * `OVERHEAD_KIB` is what a page adds outside its module and search text:
 * frontmatter, the route manifests, the prerender entry. Measured on #395:
 * filling ja from 43 to 98 pages added 4,791 KiB of upload, of which 4,019
 * were page modules and 238 search text, so 534 KiB over 55 pages, about 10
 * KiB each. The projection is within about 2% of that measured growth.
 *
 * It reads the esbuild metafile OpenNext writes next to the bundled handler
 * (`handler.mjs.meta.json`). Turbopack names a page's chunk after its file,
 * `content_docs_<path>_<locale>_mdx_<hash>.js`, and an English page's chunk
 * has no locale part, so `bytesInOutput` per chunk is the bytes each page puts
 * in the upload. A chunk under `content_docs_` that names no `_mdx_` file is
 * shared between pages and is counted as such, not as a page. A locale's
 * search text is the chunk of `.route-data/search-<locale>.ts`.
 *
 * The projection is a mean, not a promise: a page with long code samples costs
 * more. It never fails the step on a number; the budget check above does that.
 * It fails when it cannot read what it projects from (`unreadable`,
 * `no-pages`), because a projection that silently prints nothing is the
 * state #395 exists to end.
 *
 * Usage: `check-worker-page-cost.mjs --meta <handler.mjs.meta.json> --size <KiB>
 * --budget <KiB>`, from anywhere. `--self-test` runs every rule against fake
 * metafiles and needs no build.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KIB = 1024;
const OVERHEAD_KIB = 10; // per page, outside its module and search text (header)
const RULES = ['unreadable', 'no-pages'];

/** `languages` and `defaultLanguage` out of `i18n.ts`. Throws rather than guessing. */
function readI18n(text) {
  const languages = /languages:\s*\[([^\]]+)\]/.exec(text)?.[1]?.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) ?? [];
  const defaultLanguage = /defaultLanguage:\s*['"]([^'"]+)['"]/.exec(text)?.[1];
  if (!languages.length || !languages.includes(defaultLanguage)) {
    throw new Error('could not read languages[] and defaultLanguage out of apps/docs/lib/i18n.ts');
  }
  return { languages, defaultLanguage };
}

/** Per-locale page bytes out of a parsed metafile. */
function pageBytes(meta, { languages, defaultLanguage }) {
  const locales = new Map(languages.map((l) => [l, { pages: 0, bytes: 0, search: 0 }]));
  let shared = 0;
  for (const output of Object.values(meta?.outputs ?? {})) {
    for (const [path, input] of Object.entries(output.inputs ?? {})) {
      const name = basename(path);
      const search = languages.find((l) => name.includes(`route-data_search-${l}_ts`));
      if (search) locales.get(search).search += input.bytesInOutput;
      if (!name.startsWith('content_docs_')) continue;
      if (!name.includes('_mdx_')) {
        shared += input.bytesInOutput;
        continue;
      }
      const locale = languages.find((l) => l !== defaultLanguage && name.includes(`_${l}_mdx_`)) ?? defaultLanguage;
      const row = locales.get(locale);
      row.pages += 1;
      row.bytes += input.bytesInOutput;
    }
  }
  return { locales, shared };
}

/** The summary, as Markdown lines, plus findings. */
function project({ meta, size, budget, i18n }) {
  const findings = [];
  if (!meta || !Number.isFinite(size) || !Number.isFinite(budget)) {
    findings.push({ rule: 'unreadable', detail: 'no metafile, size or budget to project from' });
    return { findings, lines: [] };
  }
  const { locales, shared } = pageBytes(meta, i18n);
  const english = locales.get(i18n.defaultLanguage);
  const translated = [...locales].filter(([l, r]) => l !== i18n.defaultLanguage && r.pages > 0);
  if (!english.pages) {
    findings.push({ rule: 'no-pages', detail: 'the metafile names no `content_docs_*_mdx_*` chunk, so the page modules were not found' });
    return { findings, lines: [] };
  }
  // A translated page is what the next batch adds; English stands in when no locale has one yet.
  // The most expensive locale sets the cost, so the projection errs towards less room.
  const cost = (r) => (r.bytes + r.search) / r.pages / KIB;
  const [costliest, worst] = (translated.length ? translated : [[i18n.defaultLanguage, english]]).reduce((a, b) => (cost(b[1]) > cost(a[1]) ? b : a));
  const perPage = cost(worst) + OVERHEAD_KIB;
  const headroom = budget - size;
  const left = Math.max(0, Math.floor(headroom / perPage));
  const locale = english.pages * perPage;
  const lines = [
    '#### Per-page cost',
    '',
    '| locale | page modules | module KiB | search KiB | KiB per page |',
    '|:--|--:|--:|--:|--:|',
    ...[...locales]
      .filter(([, r]) => r.pages)
      .map(([l, r]) => `| ${l} | ${r.pages} | ${(r.bytes / KIB).toFixed(2)} | ${(r.search / KIB).toFixed(2)} | ${cost(r).toFixed(2)} |`),
    `| shared | — | ${(shared / KIB).toFixed(2)} | — | — |`,
    '',
    `A translated page costs about **${perPage.toFixed(2)} KiB**: ${costliest}'s ${cost(worst).toFixed(2)} KiB per page, the most of any locale, plus ${OVERHEAD_KIB} KiB of routing data.`,
    `The budget holds **${left}** more such pages (${headroom.toFixed(2)} KiB of headroom).`,
    `One more fully translated locale (${english.pages} pages) would add about ${locale.toFixed(0)} KiB: ${
      locale <= headroom ? `it fits, leaving ${(headroom - locale).toFixed(0)} KiB` : `it does NOT fit, by ${(locale - headroom).toFixed(0)} KiB`
    }.`,
  ];
  return { findings, lines };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

function gate() {
  const i18n = readI18n(readFileSync(join(ROOT, 'apps/docs/lib/i18n.ts'), 'utf8'));
  let meta;
  try {
    meta = JSON.parse(readFileSync(arg('--meta') ?? '', 'utf8'));
  } catch {
    meta = undefined;
  }
  const { findings, lines } = project({ meta, size: Number(arg('--size')), budget: Number(arg('--budget')), i18n });
  if (lines.length) console.log(lines.join('\n'));
  for (const f of findings) console.error(`  (${f.rule}) ${f.detail}`);
  if (findings.length) {
    console.error(`\n✗ Worker page cost: NOT MEASURED. The rules are in this script's header.`);
    return 1;
  }
  return 0;
}

/* Self-test: fake metafiles, each case checked for its findings and, where it projects, its numbers. */
const I18N = { languages: ['en', 'ja', 'de'], defaultLanguage: 'en' };
const chunk = (name, kib) => [`.next/server/chunks/ssr/${name}`, { bytesInOutput: kib * KIB }];
const metafile = (...chunks) => ({ outputs: { 'handler.mjs': { inputs: Object.fromEntries([chunk('next_dist_x.js', 900), ...chunks]) } } });
const CASES = [
  [
    'ja pages set the per-page cost; en and shared are listed, not averaged',
    { meta: metafile(chunk('content_docs_a_mdx_1.js', 50), chunk('content_docs_b_mdx_2.js', 70), chunk('content_docs_a_ja_mdx_3.js', 100), chunk('content_docs_x._.js', 30)), size: 1000, budget: 1450, i18n: I18N },
    [],
    ['**110.00 KiB**', 'ja\'s 100.00', '**4** more', '2 pages) would add about 220 KiB: it fits, leaving 230 KiB', '| shared | — | 30.00 |'],
  ],
  [
    'no translation yet: English sets the cost',
    { meta: metafile(chunk('content_docs_a_mdx_1.js', 40), chunk('content_docs_b_mdx_2.js', 60)), size: 1000, budget: 1100, i18n: I18N },
    [],
    ['**60.00 KiB**', '**1** more', 'about 120 KiB: it does NOT fit, by 20 KiB'],
  ],
  [
    'over the budget: no page left, and a locale does not fit',
    { meta: metafile(chunk('content_docs_a_mdx_1.js', 40), chunk('content_docs_a_de_mdx_9.js', 80)), size: 1200, budget: 1100, i18n: I18N },
    [],
    ['**0** more', 'it does NOT fit, by 190 KiB'],
  ],
  [
    'search text counts, and the costliest locale sets the cost',
    { meta: metafile(chunk('content_docs_a_mdx_1.js', 40), chunk('content_docs_a_ja_mdx_3.js', 60), chunk('content_docs_b_ja_mdx_4.js', 60), chunk('apps_docs__route-data_search-ja_ts_0xv.js', 20), chunk('content_docs_a_de_mdx_9.js', 50)), size: 1000, budget: 1400, i18n: I18N },
    [],
    ['| ja | 2 | 120.00 | 20.00 | 70.00 |', 'about **80.00 KiB**: ja\'s 70.00', '**5** more'],
  ],
  ['no metafile', { meta: undefined, size: 1, budget: 2, i18n: I18N }, ['unreadable'], []],
  ['no size', { meta: metafile(chunk('content_docs_a_mdx_1.js', 40)), size: NaN, budget: 2, i18n: I18N }, ['unreadable'], []],
  ['the chunks were renamed', { meta: metafile(chunk('pages_a.js', 40)), size: 1, budget: 2, i18n: I18N }, ['no-pages'], []],
];

function selfTest() {
  let failed = 0;
  const fired = new Set();
  for (const [name, input, wantRules, wantText] of CASES) {
    const { findings, lines } = project(input);
    const got = findings.map((f) => f.rule).sort();
    got.forEach((r) => fired.add(r));
    const text = lines.join('\n');
    const missing = wantText.filter((t) => !text.includes(t));
    const pass = JSON.stringify(got) === JSON.stringify([...wantRules].sort()) && !missing.length;
    if (!pass) failed += 1;
    console.log(`${pass ? '✓' : '✗'} ${name}: ${got.length ? got.join(', ') : 'no findings'}${missing.length ? ` — missing ${JSON.stringify(missing)}` : ''}`);
  }
  const silent = RULES.filter((r) => !fired.has(r));
  if (silent.length) {
    failed += 1;
    console.log(`✗ rules no fixture makes fire: ${silent.join(', ')}`);
  }
  let unreadable = false;
  try {
    readI18n('defineI18n({})');
  } catch {
    unreadable = true;
  }
  if (!unreadable) failed += 1;
  console.log(`${unreadable ? '✓' : '✗'} an unreadable i18n.ts is rejected`);
  console.log(failed ? `\n✗ Worker page cost self-test: ${failed} failure(s)` : `\n✓ Worker page cost self-test: ${CASES.length} cases, all ${RULES.length} rules can fire`);
  return failed ? 1 : 0;
}

process.exitCode = process.argv.includes('--self-test') ? selfTest() : gate();
