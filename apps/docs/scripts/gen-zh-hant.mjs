#!/usr/bin/env node
/**
 * Generate the Traditional Chinese (`zh-Hant`) docs surface from the Simplified
 * (`zh-Hans`) one.
 *
 * ## Why this locale is generated rather than translated
 *
 * Every other locale in `apps/docs/lib/i18n.ts` is a translation OF ENGLISH,
 * produced by the pass in `docs/TRANSLATION.md`. `zh-Hant` is not: Simplified
 * and Traditional Chinese are one language in two orthographies, so the
 * Traditional text is a deterministic transliteration of the Simplified text
 * and re-translating it from English would only introduce a second, divergent
 * Chinese voice. `www.objectos.ai` reached the same conclusion first and ships
 * its Traditional marketing pages this way (`scripts/gen-zh-hant.mjs` there,
 * converter in `src/lib/zhconvert.ts`); this is the docs site matching it,
 * including the converter and the conversion preset.
 *
 * ## Why the output is committed rather than converted at request time
 *
 * `lib/seo.ts`'s `translatedLocales()` tells a real translation from an
 * inherited English fallback by the IDENTITY OF THE SOURCE FILE — a real
 * Japanese page is `operate/backup.ja.mdx`, a fallback is the English
 * `operate/backup.mdx` under a `ja` lookup. A conversion performed while
 * rendering produces no `zh-Hant` file, so every Traditional page would be
 * classified as a fallback: the locale would render and switch correctly and
 * appear in no sitemap entry and no hreflang alternate. Invisible to search,
 * which is the entire reason the locale is being added.
 *
 * `.github/scripts/check-locale-surface.mjs` derives its oracle from the same
 * files, so the two agree by construction.
 *
 * ## What is converted, and what is not
 *
 * Fenced code blocks are copied through BYTE FOR BYTE, fence markers and info
 * strings included. `check-translation-output.mjs`'s `fence` rule pins a
 * translation's code samples to the English source's bytes, and a converter
 * rewriting a Han character inside a sample would break that on every page
 * carrying one. Everything outside a fence — frontmatter values, prose, table
 * cells, inline code — is converted. The fence machine below is deliberately
 * the same one that validator uses, so the two cannot disagree about where a
 * fence starts.
 *
 * The `translation:` stamp is carried across unchanged, and that is correct
 * rather than convenient: it records the sha256 of the ENGLISH sibling the
 * Simplified page was derived from, and the Traditional page is derived from
 * exactly that same English revision. So `check-translations.mjs` judges the
 * two together — when Simplified goes stale, Traditional goes stale with it,
 * and refreshing Simplified plus a regeneration clears both.
 *
 * ## The interface copy is the same conversion
 *
 * `apps/docs/lib/ui-text/zh-Hans.json` holds the Simplified strings for the
 * site's chrome — the search box, "On this page", Copy Markdown, the notice on
 * an untranslated page — and `apps/docs/lib/ui-text/zh-Hant.json` is produced
 * from it here, by the same converter and preset, and committed. One generator
 * for the locale rather than a second hand-kept Chinese voice for the chrome:
 * the rule above holds for a button label exactly as it holds for a page.
 * Converted whole, like `meta.<locale>.json` — the keys are ASCII, which the
 * converter never touches — and checked by the same byte comparison. Unlike
 * the content pair it is not discovered by walking a tree: it is one fixed
 * pair, so a missing Simplified file is an error rather than nothing to do.
 *
 * The legal pages' copy is converted the same way (#312). `privacy` and `terms`
 * are app routes, not `content/docs/` pages: each keeps its English entry in its
 * `page.tsx` and its Simplified entry in `zh-Hans.json` beside it, and the
 * `zh-Hant.json` there is produced here. A fixed pair each, like the interface
 * copy, and the reason the Simplified entry is JSON rather than TypeScript.
 *
 * ## Hand-editing is a gate, not a convention
 *
 * `--check` regenerates every file in memory and compares bytes. A hand edit to
 * a generated file, a `zh-Hant` file whose Simplified source has been deleted,
 * and a stale file left behind by a converter upgrade are all one failure with
 * one fix: edit the Simplified source (or, better, the English one) and re-run
 * the generator. `.github/workflows/ci.yml` runs `--check` on every pull
 * request.
 *
 * ## Usage
 *
 *   pnpm --filter @objectos/docs gen:zh-hant          # write the Traditional set
 *   pnpm --filter @objectos/docs gen:zh-hant --check  # gate: exit 1 on any drift
 */
import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OpenCC from 'opencc-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const DOCS = join(ROOT, 'content/docs');

const SOURCE = 'zh-Hans';
const TARGET = 'zh-Hant';

/**
 * The fixed pairs: in each directory, `zh-Hans.json` generates `zh-Hant.json`.
 * The interface copy (see "The interface copy is the same conversion") and the
 * two legal pages' copy.
 */
const FIXED_PAIRS = ['apps/docs/lib/ui-text', 'apps/docs/app/[lang]/privacy', 'apps/docs/app/[lang]/terms'].map(
  (dir) => join(ROOT, dir),
);

/**
 * Simplified (mainland) -> Traditional (Taiwan, with phrase conversion).
 *
 * `twp` and not `tw`: the `p` adds the vocabulary layer, so `软件` becomes
 * `軟體` rather than `軟件` and `打印机` becomes `印表機`. A character-only
 * conversion produces text a Taiwanese reader parses as mainland Chinese in
 * Traditional dress, which is the reason a Traditional page ranks for a
 * Traditional query in the first place. Identical to the preset
 * `www.objectos.ai` runs in production (`src/lib/zhconvert.ts`), and the
 * dependency is pinned to one exact version in `package.json` for the same
 * reason: the dictionaries decide the bytes, so a floating range would rewrite
 * the whole committed corpus on some future install. The one difference is the
 * `OVERRIDES` layer below, which `www.objectos.ai` does not have yet.
 */
const opencc = OpenCC.Converter({ from: 'cn', to: 'twp' });

/**
 * Corrections applied to the converter's output, in this order (#366).
 *
 * Simplified 签 is two Traditional characters: 簽 (sign, approve) and 籤 (slip,
 * tag). `twp` picks 籤 where a Taiwan reader expects 簽 in two ways. It lacks
 * the phrase (签核 → 籤核, 会签 → 會籤), and it segments across a word boundary:
 * 请求签名 is read as 请 + 求签 (draw a lot) + 名, and 中签发 as 中签 (win a
 * lottery) + 发. No upstream phrase fixes the second kind, because the wrong
 * word is a real word, so the fix is exact string pairs on the output.
 *
 * Every pair is applied to every converted run, so the output stays a function
 * of the Simplified text alone. Fences never reach this, as they never reach
 * the converter.
 */
const OVERRIDES = [
  ['籤核', '簽核'], // 签核 sign off
  ['會籤', '會簽'], // 会签 countersign
  ['籤名', '簽名'], // 请求签名 request signature, not 求签 + 名
  ['籤發', '簽發'], // 中签发 / 上签发 issue (a key), not 中签 + 发
];

/**
 * Nouns where 籤 is right, set aside while the pairs run so that no pair can
 * reach into them: 标签名 (tag name) converts to 標籤名, which the 籤名 pair
 * would otherwise turn into 標簽名. They are swapped for private-use code
 * points and swapped back after.
 */
const KEEP = ['標籤', '書籤'];
const KEEP_BASE = 0xe000;

function convert(text) {
  if (/[-]/.test(text)) {
    // A private-use character in the source would collide with the stand-ins.
    throw new Error('source contains a private-use code point (U+E000..U+F8FF)');
  }
  let out = opencc(text);
  KEEP.forEach((word, i) => {
    out = out.replaceAll(word, String.fromCharCode(KEEP_BASE + i));
  });
  for (const [wrong, right] of OVERRIDES) out = out.replaceAll(wrong, right);
  KEEP.forEach((word, i) => {
    out = out.replaceAll(String.fromCharCode(KEEP_BASE + i), word);
  });
  return out;
}

/**
 * Pure ASCII on purpose: the converter never touches it, so it survives its own
 * regeneration, and `includes()` on it is exact. It sits inside the frontmatter
 * block as a YAML comment, which every reader of these files already tolerates
 * — `check-translations.mjs` and `check-translation-output.mjs` read
 * frontmatter as `key:` lines and a comment matches none of them.
 */
const MARKER =
  '# @generated zh-Hant from zh-Hans -- do not edit. Edit the English source, ' +
  'then regenerate: pnpm --filter @objectos/docs gen:zh-hant';

const rel = (p) => relative(ROOT, p);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Convert a document, leaving fenced code blocks exactly as they arrived.
 *
 * The fence state machine is the one in `check-translation-output.mjs`'s
 * `split()`: an opener is a run of three or more backticks or tildes at up to
 * three columns of indent, and it closes on a run of the same character at
 * least as long with nothing after it. Prose is converted in CONTIGUOUS RUNS
 * rather than line by line — OpenCC's `twp` preset matches multi-character
 * phrases, and a phrase split across a soft-wrapped line would convert
 * differently from the same phrase on one line, which would make the output a
 * function of how the Simplified file happens to be wrapped.
 */
function convertDocument(text) {
  const lines = text.split('\n');
  const out = [];
  let prose = [];
  let open = null;

  const flush = () => {
    if (prose.length) {
      out.push(convert(prose.join('\n')));
      prose = [];
    }
  };

  for (const line of lines) {
    if (open) {
      out.push(line);
      const close = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === open.char && close[1].length >= open.len) open = null;
      continue;
    }
    const m = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
    if (m) {
      flush();
      open = { char: m[1][0], len: m[1].length };
      out.push(line);
      continue;
    }
    // A prose run is emitted only when a fence interrupts it (`flush()` above)
    // or the file ends (`flush()` below), so `out` ends up holding converted
    // runs and verbatim fence lines in file order.
    prose.push(line);
  }
  flush();
  return out.join('\n');
}

/** The generated `.mdx`, with the marker stamped as the first frontmatter line. */
function generateMdx(sourceText) {
  const converted = convertDocument(sourceText);
  if (!converted.startsWith('---\n')) {
    // Every page in `content/docs` has frontmatter — `title` is required by the
    // fumadocs schema — so this is a corrupt source rather than a shape to
    // support. Failing here beats emitting a file with no marker on it.
    throw new Error('source has no leading frontmatter block to stamp');
  }
  return `---\n${MARKER}\n${converted.slice('---\n'.length)}`;
}

/**
 * `meta.<locale>.json` carries the sidebar labels for a locale. It gets no
 * marker: JSON has no comments, and inventing a `$generated` key would put a
 * value into a file fumadocs parses against a schema. `--check` covers these
 * files by the same byte comparison, which is the guarantee the marker only
 * advertises.
 */
const generateMeta = (sourceText) => convert(sourceText);

/** Every (source, target, generated bytes) triple this generator owns. */
function plan() {
  const items = [];
  for (const file of walk(DOCS)) {
    const name = file.slice(file.lastIndexOf('/') + 1);
    if (name.endsWith(`.${SOURCE}.mdx`)) {
      const target = `${file.slice(0, -`.${SOURCE}.mdx`.length)}.${TARGET}.mdx`;
      items.push({ source: file, target, text: generateMdx(readFileSync(file, 'utf8')) });
    } else if (name === `meta.${SOURCE}.json`) {
      const target = join(dirname(file), `meta.${TARGET}.json`);
      items.push({ source: file, target, text: generateMeta(readFileSync(file, 'utf8')) });
    }
  }
  // Read unconditionally: `readFileSync` throws on a missing source, which is
  // the point — the pages import both files, so a deleted Simplified table is
  // a broken build, not an empty plan.
  for (const dir of FIXED_PAIRS) {
    const source = join(dir, `${SOURCE}.json`);
    items.push({
      source,
      target: join(dir, `${TARGET}.json`),
      text: generateMeta(readFileSync(source, 'utf8')),
    });
  }
  return items.sort((a, b) => (a.target < b.target ? -1 : 1));
}

/**
 * Generated files on disk that the plan does not claim — a page whose Simplified
 * source was retired, or a file someone added by hand. Deleting the Simplified
 * sibling has to take the Traditional one with it: an orphaned translation is
 * blocking in `check-translations.mjs` and is worse than a missing one, because
 * it renders content the source no longer claims.
 */
function strays(claimed) {
  const owned = new Set(claimed.map((i) => i.target));
  return walk(DOCS).filter(
    (f) => !owned.has(f) && (f.endsWith(`.${TARGET}.mdx`) || f.endsWith(`meta.${TARGET}.json`)),
  );
}

function main() {
  const check = process.argv.slice(2).includes('--check');
  const items = plan();
  const extra = strays(items);

  if (!check) {
    let written = 0;
    for (const { target, text } of items) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
        writeFileSync(target, text, 'utf8');
        written += 1;
      }
    }
    for (const f of extra) rmSync(f);
    console.log(
      `✓ zh-Hant: ${items.length} file(s) generated from ${SOURCE} ` +
        `(${written} written, ${items.length - written} already current` +
        `${extra.length ? `, ${extra.length} stray file(s) removed` : ''})`,
    );
    return;
  }

  const drifted = items.filter(
    ({ target, text }) => !existsSync(target) || readFileSync(target, 'utf8') !== text,
  );

  if (drifted.length === 0 && extra.length === 0) {
    console.log(`✓ zh-Hant: ${items.length} generated file(s) match the ${SOURCE} sources byte for byte.`);
    return;
  }

  console.error('✗ the generated zh-Hant surface does not match what the generator produces.\n');
  for (const { source, target } of drifted) {
    console.error(
      `    ${existsSync(target) ? 'differs from generator output' : 'missing'}: ${rel(target)}`,
    );
    console.error(`      source: ${rel(source)}`);
  }
  for (const f of extra) {
    console.error(`    no zh-Hans source, so nothing generates it: ${rel(f)}`);
  }
  console.error(
    '\n  zh-Hant is generated, not authored. Edit the English source (the Simplified\n' +
      '  page is derived from it, and the Traditional page from that) — or, for the\n' +
      '  interface copy, apps/docs/lib/ui-text/zh-Hans.json, and for the legal pages,\n' +
      '  the zh-Hans.json beside app/[lang]/privacy and terms page.tsx — then run:\n' +
      '      pnpm --filter @objectos/docs gen:zh-hant\n' +
      '  See docs/TRANSLATION.md and the header of this script.',
  );
  process.exit(1);
}

main();
