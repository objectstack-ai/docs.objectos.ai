#!/usr/bin/env node
/**
 * The search heap gate for #393: the BUILT `/api/search` route stays under a
 * heap budget while it is asked in every locale `apps/docs/lib/i18n.ts`
 * declares.
 *
 * #390 added eleven ja pages, every gate was green, and after the deploy
 * `/api/search` answered 503 in two or three locales per smoke run, so the site
 * rolled back twice. A Cloudflare Worker isolate has 128 MB. The route kept
 * every locale's Orama index (30–40 MB each) in one map, so the second or third
 * locale an isolate served pushed it over. Nothing measured that before the
 * deploy: the route is dynamic, and `check-search-locales.mjs` asks the right
 * questions but not how much memory the answers cost. Measured on the built
 * route at `09784e7`, heap after a forced GC: 58 MB after the first locale,
 * 283 MB after all eight.
 *
 * So this gate asks the way an isolate is asked. It loads the route handler out
 * of `apps/docs/.next/`, calls its `GET` in-process with `?query=permissions`
 * in each locale in turn, and then once more in each, and reads `heapUsed`
 * after a forced GC after every request:
 *
 *   - `threw`, `status`: a request that throws or answers anything but 200.
 *     A heap reading after a failed request measures nothing.
 *   - `over-budget`: the heap after any request is above `BUDGET`. 100 MB
 *     leaves 28 MB of the isolate's 128 MB for what Node's `heapUsed` does not
 *     count (code, the Worker runtime) and for the peak while an index builds.
 *   - `still-growing`: the second round settles more than `GROWTH` above the
 *     first round's highest reading. Whatever the route keeps per locale has to
 *     stop growing once every locale has been asked; a leak under the budget
 *     today is the next content PR's 503.
 *
 * Run it after `pnpm turbo run build`, because a missing build fails it. It
 * needs `--expose-gc` and re-runs itself with the flag when started without it.
 * `--self-test` runs every rule against fake handlers and fake heap readings,
 * and needs no build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROUTE = 'apps/docs/.next/server/app/api/search/route.js';
const QUERY = 'permissions';
const MB = 1024 * 1024;
const BUDGET = 100 * MB; // `over-budget`: of a Worker isolate's 128 MB
const GROWTH = 8 * MB; // `still-growing`: how far round two may settle above round one

const RULES = ['threw', 'status', 'over-budget', 'still-growing'];

/** `languages` out of `i18n.ts`. Throws rather than guessing. */
function readLanguages(text) {
  const list = /languages:\s*\[([^\]]+)\]/.exec(text)?.[1];
  const languages = list?.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) ?? [];
  if (!languages.length) throw new Error('could not read languages[] out of apps/docs/lib/i18n.ts');
  return languages;
}

/** One request. A rejection is recorded, because Next turns it into a 500. */
async function ask(GET, locale) {
  const url = `http://localhost/api/search?locale=${encodeURIComponent(locale)}&query=${QUERY}`;
  try {
    const res = await GET(new Request(url));
    await res.arrayBuffer();
    return { status: res.status };
  } catch (err) {
    return { threw: err?.code ?? String(err?.message ?? err).split('\n')[0] };
  }
}

const mb = (bytes) => `${(bytes / MB).toFixed(1)} MB`;

/** Two rounds over `languages`; `heap()` reads `heapUsed` after a forced GC. */
async function evaluate(GET, languages, heap) {
  const findings = [];
  const rows = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  const peaks = [0, 0];
  const settled = [0, 0];
  rows.push(['route loaded', mb(heap())]);
  for (const round of [0, 1]) {
    for (const locale of languages) {
      const r = await ask(GET, locale);
      const label = `${round ? 'again ' : ''}${locale}`;
      if (r.threw) add('threw', `${label}: the handler threw ${r.threw}, which Next serves as a 500`);
      else if (r.status !== 200) add('status', `${label}: HTTP ${r.status}`);
      if (r.threw || r.status !== 200) return { findings, rows };
      const used = heap();
      rows.push([label, mb(used)]);
      if (used > BUDGET) add('over-budget', `${label}: ${mb(used)} after GC, above the ${mb(BUDGET)} budget`);
      peaks[round] = Math.max(peaks[round], used);
      settled[round] = used;
    }
  }
  if (settled[1] - peaks[0] > GROWTH) {
    add('still-growing', `round two settled at ${mb(settled[1])}, ${mb(settled[1] - peaks[0])} above round one's highest ${mb(peaks[0])}, more than ${mb(GROWTH)}`);
  }
  return { findings, rows };
}

async function gate() {
  if (typeof globalThis.gc !== 'function') {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    return child.status ?? 1;
  }
  const route = join(ROOT, ROUTE);
  if (!existsSync(route)) {
    console.error(`✗ search heap: ${ROUTE} does not exist. Run pnpm turbo run build first.`);
    return 1;
  }
  const languages = readLanguages(readFileSync(join(ROOT, 'apps/docs/lib/i18n.ts'), 'utf8'));
  const GET = (await createRequire(import.meta.url)(route))?.routeModule?.userland?.GET;
  if (typeof GET !== 'function') {
    console.error(`✗ search heap: ${ROUTE} exposes no routeModule.userland.GET, so nothing was measured.`);
    return 1;
  }
  const heap = () => {
    globalThis.gc();
    globalThis.gc();
    return process.memoryUsage().heapUsed;
  };
  const { findings, rows } = await evaluate(GET, languages, heap);
  console.log(['| after | heapUsed after GC |', '|:--|--:|', ...rows.map(([a, b]) => `| ${a} | ${b} |`)].join('\n'));
  for (const f of findings) console.error(`  (${f.rule}) ${f.detail}`);
  if (findings.length) {
    console.error(`\n✗ search heap: ${findings.length} finding(s). The rules are in this script's header.`);
    return 1;
  }
  console.log(`\n✓ search heap: every locale asked twice, heap stayed under ${mb(BUDGET)} and stopped growing`);
  return 0;
}

/* Self-test: one clean fake, then one fake per rule that must break exactly that rule. */
const LANGS = ['en', 'ja', 'de'];
const ok = async () => new Response('[]');
/** Heap readings in order: route loaded, then one per request across both rounds. */
const readings = (...values) => {
  const queue = values.map((v) => v * MB);
  return () => queue.shift() ?? queue.at(-1) ?? 0;
};
const CASES = [
  ['clean: levels off under the budget', ok, readings(18, 60, 85, 86, 86, 85, 86), []],
  ['ja throws', async (req) => (new URL(req.url).searchParams.get('locale') === 'ja' ? Promise.reject(new Error('x')) : new Response('[]')), readings(18, 60), ['threw']],
  ['ja answers 503, as the Worker did', async (req) => new Response('', { status: new URL(req.url).searchParams.get('locale') === 'ja' ? 503 : 200 }), readings(18, 60), ['status']],
  ['every index kept: over the budget', ok, readings(18, 58, 98, 137, 137, 137, 137), ['over-budget', 'over-budget', 'over-budget', 'over-budget']],
  ['a slow leak under the budget', ok, readings(18, 60, 64, 68, 72, 76, 80), ['still-growing']],
  ['round two at round one\'s peak is level', ok, readings(18, 60, 90, 70, 90, 70, 90), []],
];

async function selfTest() {
  let failed = 0;
  const fired = new Set();
  for (const [name, GET, heap, want] of CASES) {
    const got = (await evaluate(GET, LANGS, heap)).findings.map((f) => f.rule).sort();
    got.forEach((r) => fired.add(r));
    const pass = JSON.stringify(got) === JSON.stringify([...want].sort());
    if (!pass) failed += 1;
    console.log(`${pass ? '✓' : '✗'} ${name}: ${got.length ? got.join(', ') : 'no findings'}`);
  }
  const silent = RULES.filter((r) => !fired.has(r));
  if (silent.length) {
    failed += 1;
    console.log(`✗ rules no fixture makes fire: ${silent.join(', ')}`);
  }
  const langsOk = readLanguages("defineI18n({ languages: ['en', 'zh-Hans'] })").join() === 'en,zh-Hans';
  let unreadable = false;
  try {
    readLanguages('defineI18n({})');
  } catch {
    unreadable = true;
  }
  if (!langsOk || !unreadable) failed += 1;
  console.log(`${langsOk ? '✓' : '✗'} i18n.ts is read; ${unreadable ? '✓' : '✗'} an unreadable one is rejected`);
  console.log(failed ? `\n✗ search heap self-test: ${failed} failure(s)` : `\n✓ search heap self-test: ${CASES.length} cases, all ${RULES.length} rules can fire`);
  return failed ? 1 : 0;
}

process.exitCode = process.argv.includes('--self-test') ? await selfTest() : await gate();
