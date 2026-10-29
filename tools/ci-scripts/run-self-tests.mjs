#!/usr/bin/env node
/**
 * Runs every self-test the repository's CI scripts declare.
 *
 * This exists because `pnpm turbo run test` — the last of the three steps in
 * the required `build` job — executed zero tasks. No package declared a `test`
 * script, so the step passed by having nothing to do. A green that cannot go
 * red is indistinguishable in CI from a green that is protecting something,
 * and it is read as the latter.
 *
 * What it runs is a real test, not a placeholder that asserts `true`.
 * `check-translation-output.mjs` carries a table of fixtures with the rules
 * each one must trip, and its `--self-test` mode asserts both that every case
 * fires exactly the rules it declares and that every rule the script enforces
 * has a fixture able to make it fail. Weaken a rule and the self-test exits 1;
 * this runner propagates that, and so does the CI step.
 *
 * ## Why the runner lives here and the scripts do not
 *
 * The scripts stay at `.github/scripts/` — the workflows invoke them by that
 * path. Turbo only discovers tasks in workspace packages, so the runner needs
 * a package of its own: a `test` script on `apps/docs` would claim to test the
 * docs site, which is the same species of misleading signal this card is
 * about. Hence this package, reaching across to the scripts it runs.
 *
 * That reach has one consequence worth naming. Turbo hashes a package's own
 * directory by default, so an edit under `.github/scripts/` would replay a
 * cached green from before the edit. `turbo.json` names the dependency
 * explicitly on the `test` task: `$TURBO_ROOT$/.github/scripts/**`, plus
 * `$TURBO_ROOT$/apps/docs/lib/i18n.ts`, which the translation-output self-test
 * reads for the locale list.
 *
 * ## Keeping the step from going inert again
 *
 * Two guards, both of which fail loudly rather than skip quietly:
 *
 *   - `SELF_TESTED` empty → failure. Removing the last entry cannot silently
 *     restore the zero-task pass this runner exists to end.
 *   - a script under `.github/scripts/` that dispatches `--self-test` but is
 *     not listed → failure, naming the file. A new self-test joins the CI step
 *     by being written, not by someone remembering this list.
 *
 * Deliberately NOT run here: the GATE mode of `check-translations.mjs`, which
 * would make the required `build` job fail on the corpus's translation debt —
 * the `Translations` workflow's job, and reported-not-blocking there by design
 * — and the gate mode of `check-translation-ownership.mjs`, which judges a pull
 * request's diff and author, neither of which exists here.
 *
 * `check-translation-ownership.mjs` is listed for its `--self-test` only
 * (#291). Its fixtures are change lists written to a temporary directory, so
 * they never read git or `content/docs/`. They run the gate's real entry point
 * with the variable set and unset, and prove that a human deletion of a locale
 * sibling still passes while an addition or modification still fails.
 *
 * `check-translations.mjs` is listed for its `--self-test` only, on the same
 * footing as `check-locale-surface.mjs` below: the fixtures run against
 * temporary trees and never read `content/docs/`, so they cost milliseconds and
 * cannot fail on corpus debt. What they prove is that its derived-locale
 * scoping — the rule keeping generated `zh-Hant` pages off a translation
 * worklist — is still able to go red.
 *
 * ## Self-test here, gate in the workflow
 *
 * `check-locale-surface.mjs` is listed here for its `--self-test` only. Its
 * gate mode reads `apps/docs/.next/`, another package's build output, which
 * this task's inputs do not and should not hash — a locale gate replaying a
 * cached green is the exact failure it exists to end. So `ci.yml` invokes the
 * gate itself as a step after `pnpm turbo run build`, and what runs here is
 * the fixture-driven proof that its rules can still go red.
 *
 * `check-deploy-version.mjs` and `smoke-docs.mjs` are here on the same footing
 * and for a sharper reason (#269). Their gate modes need a Cloudflare
 * credential and a live website respectively, so on a pull request neither one
 * can run for real — and the deploy path they guard is currently REJECTED at
 * Cloudflare, so on `main` they may not run for real either. What keeps them
 * from being decoration in the meantime is exactly this: their fixtures assert
 * that every rule they enforce still produces a red, and that runs on every PR.
 *
 * `check-prerender-cache.mjs` joins them on identical footing (#261). Its gate
 * mode reads a `.open-next` bundle that only exists in the deploy job, so on a
 * pull request it can never run for real; its fixtures are what prove it can
 * still refuse a bundle whose prerender cache is incomplete — the bundle shape
 * that publishes a Worker returning 404 for every page while the deploy step
 * exits 0.
 *
 * `check-positioning.mjs` is listed for its `--self-test` only (#171). Its gate
 * mode reads `apps/docs/.next/` the way `check-locale-surface.mjs` does and is
 * a `ci.yml` step after the build for the same reason. Its fixtures are inline
 * strings, one good and one bad per rule; they prove that each of its three
 * rules — the copies of the positioning constant agreeing with it, the one
 * brand spelling in shipped output, the stale sentences staying gone — can
 * still go red, and stays silent on the shapes the rulings on #171 accepted.
 *
 * `check-search-locales.mjs` is listed for its `--self-test` only (#296). Its
 * gate mode loads the built `/api/search` handler out of `apps/docs/.next/`
 * and is a `ci.yml` step after the build, like the two gates above. Its
 * fixtures are fake handlers. They prove that each rule (a throw, a non-200,
 * a non-array, no hits, a page its own title cannot find, a negative control
 * that matches) can still go red.
 *
 * `check-doc-samples.mjs` is listed for its `--self-test` only (#316). Its gate
 * mode reads every English page under `content/docs/`, which this task's inputs
 * do not hash, so it is a `ci.yml` step of its own, like the gates above. Its
 * fixtures are inline pages parsed against the pinned `@objectstack/spec`, the
 * one self-test here with a dependency: it needs
 * `npm ci --prefix .github/scripts/doc-samples` first, and says so rather than
 * passing when the install is missing. That package's `package-lock.json` sits
 * under `.github/scripts/`, so a spec bump moves this task's hash.
 *
 * `bump-upstream-pin.mjs` is listed for its `--self-test` only. Its bump mode
 * fetches an upstream repository and opens nothing by itself; it runs in
 * `bump-upstream-docs.yml`, which is dispatched, never run on a pull request.
 * Its fixtures are inline pin files and commit lists. They prove that a
 * malformed pin or SHA is refused, that the same commit bumps nothing, and that
 * the pull-request body stays inside GitHub's size limit with every upstream
 * reference inside a fence.
 *
 * `check-search-heap.mjs` is listed for its `--self-test` only (#393), on the
 * footing of `check-search-locales.mjs`: its gate mode loads the built search
 * route out of `apps/docs/.next/`, so it is a `ci.yml` step after the build.
 * Its fixtures are fake handlers and fake heap readings. They prove that a
 * failed request, a reading above the budget, and a heap still growing on the
 * second pass each go red.
 *
 * `check-worker-page-cost.mjs` is listed for its `--self-test` only (#395). Its
 * gate mode reads the packaged Worker's metafile, so it runs inside `ci.yml`'s
 * `Worker bundle fits the size budget` step. Its fixtures are fake metafiles:
 * they prove the per-page cost and the pages left are computed from the
 * costliest locale, and that a missing metafile or renamed page chunks fail
 * rather than print nothing.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SCRIPTS = join(ROOT, '.github/scripts');

/** Scripts whose `--self-test` mode this step runs. Never let this go empty. */
const SELF_TESTED = [
  'check-translation-output.mjs',
  'check-translations.mjs',
  'check-node-floor.mjs',
  'check-locale-surface.mjs',
  'check-deploy-version.mjs',
  'smoke-docs.mjs',
  'check-prerender-cache.mjs',
  'check-translation-ownership.mjs',
  'check-positioning.mjs',
  'check-search-locales.mjs',
  'check-search-heap.mjs',
  'check-worker-page-cost.mjs',
  'check-doc-samples.mjs',
  'bump-upstream-pin.mjs',
];

/**
 * The argv dispatch, in the two shapes the scripts here use: a quoted
 * `'self-test'` or `'--self-test'` literal — as in `has('self-test')` or
 * `argv.includes('--self-test')`. Not the words "self-test" in a comment or
 * inside a longer error message, which is why the quotes must sit against the
 * flag.
 *
 * Best-effort by construction: a script that spells its flag some third way
 * goes unnoticed here. This check narrows the gap, it does not close it — the
 * guarantee that this step never silently executes nothing is the empty-list
 * check above, not this one.
 *
 * The scan is also TOP LEVEL only — `readdirSync` without `recursive`, plus an
 * `isFile()` filter — so `.github/scripts/lib/` is outside it by construction.
 * That is what lets shared leaf modules live there without tripping this rule,
 * and it is the reason a self-test belonging to one of them has to be reached
 * through the script that imports it rather than added to `SELF_TESTED` on its
 * own: a `lib/` entry here would run, but nothing would notice if it stopped.
 */
const DISPATCH = /(['"`])(?:--)?self-test\1/;

const rel = (p) => relative(ROOT, p);
const problems = [];

if (SELF_TESTED.length === 0) {
  problems.push(
    'SELF_TESTED is empty — this step would execute nothing, which is the failure it exists to prevent',
  );
}

for (const name of SELF_TESTED) {
  const path = join(SCRIPTS, name);
  if (!existsSync(path)) {
    problems.push(`listed in SELF_TESTED but does not exist: ${rel(path)}`);
  } else if (!DISPATCH.test(readFileSync(path, 'utf8'))) {
    problems.push(`listed in SELF_TESTED but declares no --self-test dispatch: ${rel(path)}`);
  }
}

const listed = new Set(SELF_TESTED);
for (const entry of readdirSync(SCRIPTS, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.mjs') || listed.has(entry.name)) continue;
  const path = join(SCRIPTS, entry.name);
  if (DISPATCH.test(readFileSync(path, 'utf8'))) {
    problems.push(`declares --self-test but is not listed in SELF_TESTED: ${rel(path)}`);
  }
}

if (problems.length) {
  console.error('✗ self-test runner: the list of self-tested scripts does not match the scripts\n');
  for (const p of problems) console.error(`    ${p}`);
  console.error(`\n  fix the list in ${rel(join(HERE, 'run-self-tests.mjs'))}`);
  process.exit(1);
}

let failed = 0;
for (const name of SELF_TESTED) {
  const path = join(SCRIPTS, name);
  console.log(`\n── ${rel(path)} --self-test`);
  const run = spawnSync(process.execPath, [path, '--self-test'], { stdio: 'inherit' });
  if (run.error) {
    console.error(`✗ ${rel(path)} could not be run: ${run.error.message}`);
    failed += 1;
  } else if (run.status !== 0) {
    console.error(`✗ ${rel(path)} --self-test exited ${run.status ?? `on signal ${run.signal}`}`);
    failed += 1;
  }
}

console.log('');
if (failed) {
  console.error(`✗ ${failed} of ${SELF_TESTED.length} self-test(s) failed`);
  process.exit(1);
}
console.log(`✓ ${SELF_TESTED.length} self-test(s) passed`);
