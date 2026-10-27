#!/usr/bin/env node
/**
 * Every page's frontmatter, validated by the schema `source.config.ts` declares,
 * through the loader the build itself uses — the last step of `type-check`.
 *
 * Why this exists: the docs collection is `async: true`, so frontmatter is read
 * by fumadocs-mdx's bundler loader (`?collection=docs&only=frontmatter`, one
 * import per page in `.source/server.ts`) and validated there, while the
 * bundle is being built. Nothing in `next typegen && fumadocs-mdx && tsc` runs
 * that loader: the `fumadocs-mdx` CLI only writes the import list, and
 * `.source/server.ts` is `@ts-nocheck`. Measured: with the `editions:` rule in
 * place and no page declaring the key, all three exited 0, and only
 * `next build` would have said anything. So `type-check` was green over a tree
 * whose every English page broke the schema.
 *
 * This runs the same loader, from `fumadocs-mdx/node`, over the same query, so
 * the rule it applies is the schema itself — there is no second copy of it
 * here to drift. It reads every `.mdx` under `content/docs`, translations
 * included: they are held to the same shape, and a translation's schema is a
 * different branch of the same function, so it is exercised too.
 *
 * A probe that cannot fail is indistinguishable from one that passed, so every
 * run also validates one synthetic English page with no `editions:` and
 * requires it to be refused. If the loader stopped validating — a fumadocs
 * upgrade that moves validation, a config that fails to load — that control
 * passes and this script exits 1 as NOT MEASURED instead of reporting green.
 *
 *   node scripts/check-frontmatter.mjs     (cwd: apps/docs, where source.config.ts is)
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'fumadocs-mdx/node';

const APP = process.cwd();
const DOCS = resolve(APP, '../../content/docs');

/** Every `.mdx` under `dir`, sorted. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith('.mdx') ? [path] : [];
    })
    .sort();
}

/** The loader's verdict on one file: `null` when it validates, else the message. */
async function verdict(file) {
  try {
    await import(`${pathToFileURL(file).href}?collection=docs&only=frontmatter`);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

register();

const control = mkdtempSync(join(tmpdir(), 'check-frontmatter-'));
const controlPage = join(control, 'negative-control.mdx');
writeFileSync(controlPage, '---\ntitle: Negative control\n---\n\nNo `editions:` key.\n');
const controlVerdict = await verdict(controlPage);
rmSync(control, { recursive: true, force: true });

if (controlVerdict === null) {
  console.error(
    'NOT MEASURED: an English page with no `editions:` validated. The loader is not applying ' +
      "source.config.ts's schema, so a green result here would mean nothing.",
  );
  process.exit(1);
}

const files = walk(DOCS);
const failures = [];
for (const file of files) {
  const message = await verdict(file);
  if (message !== null) failures.push({ file: relative(resolve(APP, '../..'), file), message });
}

if (failures.length) {
  for (const { file, message } of failures) console.error(`✗ ${file}\n  ${message.replace(/\n/g, '\n  ')}`);
  console.error(`\n${failures.length} of ${files.length} pages have invalid frontmatter.`);
  process.exit(1);
}

console.log(`✓ frontmatter valid on ${files.length} pages (negative control refused, as it must be)`);
