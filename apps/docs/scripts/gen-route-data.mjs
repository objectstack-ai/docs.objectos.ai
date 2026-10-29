#!/usr/bin/env node
/**
 * Writes what the route handlers read instead of the compiled pages:
 * `apps/docs/.route-data/` (#393, #395).
 *
 * ## Search text (#393)
 *
 * `/api/search` used to read each page's `structuredData` (its headings and
 * paragraphs) through `page.data.load()`, which imports the page's compiled
 * MDX module. That is the whole rendered page, highlighted code included, and
 * a module once imported stays in the module registry for the life of the
 * isolate. Building one locale's index therefore left every page module of
 * that locale resident after the index was gone. Measured on the built route
 * at `09784e7`, with only one index kept: 58 MB after English, 86 MB after all
 * eight locales, about 94 MB with ja fully translated, against a Worker
 * isolate's 128 MB.
 *
 * So the same `structuredData` is computed here and written as one module per
 * locale, `search-<locale>.ts`, which `search.ts` maps to a lazy import. The
 * route imports the locale it is asked for, unzips and parses it.
 *
 * ## The route handlers' collection (#395)
 *
 * Every page's compiled module was in the Worker twice. Turbopack compiles the
 * page routes and the route handlers as two separate module graphs, and six
 * route handlers (search, og, sitemap, `llms.txt`, `llms-full.txt`,
 * `llms.mdx`) import `lib/source.ts`, whose collection holds a lazy
 * `import()` of every page. A lazy import is still bundled, so the handlers'
 * graph carried a second copy of all of them: 19,847 KiB of a 61,529 KiB
 * upload with #388's PR 3 applied, which is what put that PR over the budget.
 * Only the page route renders a page body, and only at build time.
 *
 * So `collection.ts` is the collection fumadocs-mdx writes to
 * `.source/server.ts`, with every page's lazy body import replaced by a
 * function that reads this directory instead. The frontmatter and `meta.json`
 * imports are kept as they are, so the page tree, URLs and frontmatter are the
 * ones `fumadocs-mdx` built. `lib/source.ts` builds its loader on it; the page
 * route loads bodies from the full collection itself.
 *
 * What the handlers read from a body is the processed Markdown
 * (`getText('processed')`, for the `llms` routes), and only for English pages:
 * `/llms.mdx/docs/...` and `/llms-full.txt` serve English. That is
 * `markdown.ts`. A translation's Markdown is read by the page route, from the
 * module it already loaded.
 *
 * With `--dev`, `collection.ts` re-exports `.source/server.ts` instead:
 * `next dev` regenerates that file when a page is added, and a copy taken at
 * startup would not see the new page.
 *
 * ## How the text is made
 *
 * It is the same text, not a lookalike. The processor is fumadocs-mdx's own
 * remark chain, built with the public `applyMdxPreset` from the compiled
 * `source.config` (`.source/source.config.mjs`, written by the `fumadocs-mdx`
 * CLI), plus `remarkInclude`, which `buildMDX` puts first, and `remarkLLMs`,
 * which its postprocess step runs last for `includeProcessedMarkdown`.
 * `remarkStructure` runs in the remark phase too, so the rehype plugins, which
 * run after both and only shape the rendered HTML, are left out: that is
 * `rehypeCode`, and it is most of the cost.
 *
 * Every string is JSON, gzipped, in base64 (`lib/packed.ts` unpacks it),
 * because it is Worker upload too: as plain JSON the English, zh-Hans and
 * zh-Hant search modules were about 1 MB each.
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
import { remarkLLMs } from 'fumadocs-core/mdx-plugins/remark-llms';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = resolve(APP, '../../content/docs');
const CONFIG = join(APP, '.source/source.config.mjs');
const COLLECTION = join(APP, '.source/server.ts');
const OUT = join(APP, '.route-data');
const DEV = process.argv.includes('--dev');

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

/**
 * `.source/server.ts` with each page's `() => import("…?collection=docs")`
 * replaced by `() => body("<file>")`. Throws unless every page's import was
 * replaced and no other `import(` is left, so a change in what fumadocs-mdx
 * writes fails the build here instead of putting the bodies back.
 */
function lightCollection(source, pages) {
  const BODY = /("[^"]+\.mdx"): \(\) => import\("[^"]+\?collection=docs"\)/g;
  const replaced = source.match(BODY)?.length ?? 0;
  const light = source.replace(BODY, (_, key) => `${key}: () => body(${key})`);
  const left = light.match(/\bimport\(\s*["'][^"']*\?collection=/g)?.length ?? 0;
  if (replaced !== pages || left) {
    throw new Error(
      `.source/server.ts: replaced ${replaced} page body import(s) of ${pages} pages and ${left} are left. ` +
        'fumadocs-mdx changed what it writes; update lightCollection() in scripts/gen-route-data.mjs.',
    );
  }
  return `${light}
import { unpack } from '../lib/packed';

/**
 * What a route handler reads from a page body (scripts/gen-route-data.mjs): the
 * processed Markdown of an English page. The page route renders bodies from the
 * full collection, so nothing else is asked for here.
 */
let markdown: Promise<Record<string, string>> | undefined;
async function body(file: string) {
  markdown ??= import('./markdown').then((m) => unpack<Record<string, string>>(m.default));
  const text = (await markdown)[file];
  if (text === undefined) {
    throw new Error(\`\${file}: the route handlers' collection has no body for it; only English pages' processed Markdown is generated (scripts/gen-route-data.mjs)\`);
  }
  return { _markdown: text };
}
`;
}

if (!existsSync(CONFIG) || !existsSync(COLLECTION)) {
  console.error(`✗ route data: ${relative(process.cwd(), CONFIG)} or ${relative(process.cwd(), COLLECTION)} does not exist. Run \`fumadocs-mdx\` first.`);
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
  remarkPlugins: [remarkInclude, ...(mdx.remarkPlugins ?? []), [remarkLLMs, { _data: true }]],
  rehypePlugins: [],
  format: 'mdx',
});

const search = new Map(languages.map((l) => [l, {}]));
const markdown = {};
const files = walk(CONTENT);
for (const path of files) {
  const file = relative(CONTENT, path).split('\\').join('/');
  const locale = languages.find((l) => l !== defaultLanguage && file.endsWith(`.${l}.mdx`)) ?? defaultLanguage;
  const vfile = await processor.process({
    path,
    value: frontmatter(readFileSync(path, 'utf8')).content,
    data: { frontmatter: {}, _getProcessor: () => processor },
  });
  if (!vfile.data.structuredData) throw new Error(`${file}: remarkStructure wrote no structuredData`);
  if (typeof vfile.data.markdown !== 'string') throw new Error(`${file}: remarkLLMs wrote no Markdown`);
  search.get(locale)[file] = vfile.data.structuredData;
  if (locale === defaultLanguage) markdown[file] = vfile.data.markdown;
}

const banner = '// Generated by scripts/gen-route-data.mjs before every build. Do not edit.\n';
const pack = (value) => gzipSync(JSON.stringify(value), { level: 9 }).toString('base64');
const write = (name, text) => writeFileSync(join(OUT, name), `${banner}${text}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, '.gitignore'), '*\n');
for (const [locale, pages] of search) {
  // A string, not an object literal: the route parses it when it builds the
  // index, and the parsed copy is garbage once the index holds the text.
  write(`search-${locale}.ts`, `export default ${JSON.stringify(pack(pages))};\n`);
}
const loaders = languages.map((l) => `  ${JSON.stringify(l)}: () => import(${JSON.stringify(`./search-${l}`)}),`).join('\n');
write('search.ts', `/** Each locale's \`structuredData\`, keyed by file path under content/docs, packed (lib/packed.ts). */\nexport const searchData = {\n${loaders}\n} as const;\n`);
write('markdown.ts', `/** Each English page's processed Markdown, keyed by file path under content/docs, packed (lib/packed.ts). */\nexport default ${JSON.stringify(pack(markdown))};\n`);
write(
  'collection.ts',
  DEV
    ? "/** `next dev`: the full collection, which fumadocs-mdx keeps current as pages are added. */\nexport { docs } from '../.source/server';\n"
    : lightCollection(readFileSync(COLLECTION, 'utf8'), files.length),
);
const sizes = [...search].map(([l, pages]) => `${l} ${Object.keys(pages).length}`).join(', ');
console.log(`✓ route data: wrote .route-data/${DEV ? ' for next dev' : ''} (pages per locale: ${sizes}; English Markdown: ${Object.keys(markdown).length})`);
