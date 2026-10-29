#!/usr/bin/env node
/**
 * Writes the text `/api/search` indexes, one module per locale (#393).
 *
 * The route used to read each page's `structuredData` (its headings and
 * paragraphs) through `page.data.load()`, which imports the page's compiled
 * MDX module. That is the whole rendered page, highlighted code included, and
 * a module once imported stays in the module registry for the life of the
 * isolate. Building one locale's index therefore left every page module of
 * that locale resident after the index was gone. Measured on the built route
 * at `09784e7`, with only one index kept: 58 MB after English, 86 MB after all
 * eight locales, about 94 MB with ja fully translated, against a Worker
 * isolate's 128 MB.
 *
 * So the same `structuredData` is computed here, before `next build`, and
 * written as one string per locale to `.search/<locale>.ts`: the JSON,
 * gzipped, in base64. The route imports the locale it is asked for, unzips and
 * parses it. What stays resident is that string, not the page modules.
 *
 * Gzipped because the string is also Worker upload, which has a budget the
 * `Worker bundle fits the size budget` CI step holds: as plain JSON the
 * English, zh-Hans and zh-Hant modules were about 1 MB each, 3.5 MB of the
 * 6 MB headroom main had at `09784e7`; gzipped and in base64, about a third.
 *
 * It is the same `structuredData`, not a lookalike. The processor is
 * fumadocs-mdx's own remark chain, built with the public `applyMdxPreset` from
 * the compiled `source.config` (`.source/source.config.mjs`, written by the
 * `fumadocs-mdx` CLI), plus `remarkInclude`, which `buildMDX` puts first.
 * `remarkStructure` runs in the remark phase, so the rehype plugins, which run
 * after it and only shape the rendered HTML, are left out: that is
 * `rehypeCode`, and it is most of the cost.
 *
 * A file's locale is its suffix, as `source.config.ts` reads it: `foo.ja.mdx`
 * is `ja`, `foo.mdx` is the default language. A locale whose page falls back
 * to English reads that page from the default language's module, so English
 * text is written once.
 *
 * The output directory carries its own `.gitignore`, because it is a build
 * product. Run from `apps/docs`, after `fumadocs-mdx`, as the `build`,
 * `type-check` and `dev` scripts do.
 */
import { applyMdxPreset, remarkInclude } from 'fumadocs-mdx/config';
import { frontmatter } from 'fumadocs-core/content/md/frontmatter';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = resolve(APP, '../../content/docs');
const CONFIG = join(APP, '.source/source.config.mjs');
const OUT = join(APP, '.search');

/** `languages` and `defaultLanguage` out of `lib/i18n.ts`, read as text. Throws rather than guessing. */
function readI18n() {
  const text = readFileSync(join(APP, 'lib/i18n.ts'), 'utf8');
  const languages = /languages:\s*\[([^\]]+)\]/.exec(text)?.[1]?.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) ?? [];
  const defaultLanguage = /defaultLanguage:\s*['"]([^'"]+)['"]/.exec(text)?.[1];
  if (!languages.length || !languages.includes(defaultLanguage)) {
    throw new Error('could not read languages[] and defaultLanguage out of apps/docs/lib/i18n.ts');
  }
  return { languages, defaultLanguage };
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.mdx') ? [join(dir, e.name)] : []))
    .sort();
}

if (!existsSync(CONFIG)) {
  console.error(`✗ search data: ${relative(process.cwd(), CONFIG)} does not exist. Run \`fumadocs-mdx\` first.`);
  process.exit(1);
}

const { languages, defaultLanguage } = readI18n();
// @mdx-js/mdx is fumadocs-mdx's dependency, not this app's, so it is resolved from there: the copy buildMDX uses.
const { createProcessor } = await import(
  pathToFileURL(createRequire(import.meta.resolve('fumadocs-mdx')).resolve('@mdx-js/mdx')).href
);
const config = (await import(pathToFileURL(CONFIG).href)).default;
const mdx = await applyMdxPreset({ ...config.mdxOptions, rehypeCodeOptions: false })('bundler');
const processor = createProcessor({
  outputFormat: 'program',
  ...mdx,
  remarkPlugins: [remarkInclude, ...(mdx.remarkPlugins ?? [])],
  rehypePlugins: [],
  format: 'mdx',
});

const byLocale = new Map(languages.map((l) => [l, {}]));
for (const path of walk(CONTENT)) {
  const file = relative(CONTENT, path).split('\\').join('/');
  const locale = languages.find((l) => l !== defaultLanguage && file.endsWith(`.${l}.mdx`)) ?? defaultLanguage;
  const vfile = await processor.process({
    path,
    value: frontmatter(readFileSync(path, 'utf8')).content,
    data: { frontmatter: {}, _getProcessor: () => processor },
  });
  if (!vfile.data.structuredData) throw new Error(`${file}: remarkStructure wrote no structuredData`);
  byLocale.get(locale)[file] = vfile.data.structuredData;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, '.gitignore'), '*\n');
const banner = '// Generated by scripts/gen-search-data.mjs before every build. Do not edit.\n';
for (const [locale, pages] of byLocale) {
  // A string, not an object literal: the route parses it when it builds the
  // index, and the parsed copy is garbage once the index holds the text.
  const packed = gzipSync(JSON.stringify(pages), { level: 9 }).toString('base64');
  writeFileSync(join(OUT, `${locale}.ts`), `${banner}export default ${JSON.stringify(packed)};\n`);
}
const loaders = languages.map((l) => `  ${JSON.stringify(l)}: () => import(${JSON.stringify(`./${l}`)}),`).join('\n');
writeFileSync(
  join(OUT, 'index.ts'),
  `${banner}/** Each locale's \`structuredData\`, keyed by file path under content/docs, as gzipped JSON in base64. */\nexport const searchData = {\n${loaders}\n} as const;\n`,
);
const sizes = [...byLocale].map(([l, pages]) => `${l} ${Object.keys(pages).length}`).join(', ');
console.log(`✓ search data: wrote .search/ (pages per locale: ${sizes})`);
