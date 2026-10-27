import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type * as PageTree from 'fumadocs-core/page-tree';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { baseOptions } from '@/lib/layout.shared';
import { i18n } from '@/lib/i18n';
import { translatedLocales } from '@/lib/seo';
import { uiText } from '@/lib/ui-text';
import { EditionMark } from '@/components/editions';
import { type Edition, isEveryEdition } from '@/lib/editions';

/**
 * A page-tree name or description in the language it is really written in.
 *
 * The default language is the only one a page-tree entry can fall back to:
 * fumadocs seeds every locale's tree from the English files (see
 * `translatedLocales`), so an entry that is not in the route locale is English.
 */
function inDefaultLanguage(text: ReactNode): ReactNode {
  return <span lang={i18n.defaultLanguage}>{text}</span>;
}

/**
 * Whether a page entry in `lang`'s tree names a page `lang` has no source file
 * for — the English page, served as a fallback.
 *
 * The detection the docs page uses for its own body (#298), and deliberately
 * the same function: `translatedLocales` compares the page's AUTHORED file
 * (`operate/backup.ja.mdx` or the inherited `operate/backup.mdx`) with the
 * English one. The page `getNodePage` resolves is the page the entry was built
 * from — its `$ref` is the locale-independent storage key — so the sidebar,
 * the breadcrumb and the footer agree with the page body about which pages are
 * English, entry by entry, with no second rule to drift from the first.
 */
function isFallbackPage(node: PageTree.Item, lang: string): boolean {
  const page = source.getNodePage(node, lang);
  return page !== undefined && !translatedLocales(page.slugs).includes(lang);
}

/**
 * Whether a folder entry's name is English in `lang`'s tree.
 *
 * Fumadocs names a folder from its `meta` title, else from its index page,
 * else from the directory name. The same file-identity rule applies to the
 * first: a `meta.<lang>.json` is the locale's own, an inherited `meta.json` is
 * English. Every folder in `content/docs` has a `meta.<locale>.json` with a
 * title today, so this marks nothing on the current tree; it is here so a
 * folder added without one is marked rather than silently read as the locale.
 */
function isEnglishFolderName(node: PageTree.Folder, lang: string): boolean {
  const meta = source.getNodeMeta(node, lang);
  if (meta && typeof (meta.data as { title?: unknown }).title === 'string') {
    return meta.path === source.getNodeMeta(node, i18n.defaultLanguage)?.path;
  }
  if (node.index) return isFallbackPage(node.index, lang);
  return true;
}

function markItem(node: PageTree.Item, lang: string): PageTree.Item {
  if (!isFallbackPage(node, lang)) return node;
  return {
    ...node,
    name: inDefaultLanguage(node.name),
    ...(node.description ? { description: inDefaultLanguage(node.description) } : {}),
  };
}

function markNode(node: PageTree.Node, lang: string): PageTree.Node {
  if (node.type === 'page') return markItem(node, lang);
  if (node.type !== 'folder') return node;
  return {
    ...node,
    ...(isEnglishFolderName(node, lang) ? { name: inDefaultLanguage(node.name) } : {}),
    ...(node.index ? { index: markItem(node.index, lang) } : {}),
    children: node.children.map((child) => markNode(child, lang)),
  };
}

/**
 * `lang`'s page tree with every English entry marked `lang="en"` (#305).
 *
 * On a locale route the sidebar, the breadcrumb and the previous/next footer
 * all render names from this tree, inside `<html lang>` declaring the route
 * locale. A page the locale has no translation of is named by its English
 * title (and described by its English description, which the footer shows), so
 * without a mark a screen reader reads "Backup and Disaster Recovery" with
 * Chinese pronunciation rules — the language-of-parts defect (WCAG 3.1.2) the
 * page body already avoids. axe has no rule for it, so nothing else reports it.
 *
 * One transform here reaches all three, because all three read the tree this
 * layout hands to `DocsLayout`; the `llms` routes read `source.getPageTree`
 * for English directly and are not affected. Only the name and description
 * are wrapped: `url`, `$id` and `$ref` stay as they were, so active-item
 * matching and every lookup by node are untouched. An English route returns
 * the tree it was given.
 */
function treeWithLanguages(lang: string): PageTree.Root {
  const tree = source.pageTree[lang];
  if (lang === i18n.defaultLanguage || !tree) return tree;
  return { ...tree, children: tree.children.map((node) => markNode(node, lang)) };
}

/**
 * The `editions:` of the page a tree entry names, read from the English page
 * whatever `lang` is: the set is a fact about the page, and a translation is
 * not required to repeat it (`source.config.ts`).
 */
function editionsOf(node: PageTree.Item, lang: string): Edition[] | undefined {
  const page = source.getNodePage(node, lang);
  return page && source.getPage(page.slugs, i18n.defaultLanguage)?.data.editions;
}

function sameEditions(a: readonly Edition[], b: readonly Edition[]): boolean {
  return a.length === b.length && a.every((edition) => b.includes(edition));
}

/** Every page entry under `folder`, its index page included, at any depth. */
function pagesUnder(folder: PageTree.Folder): PageTree.Item[] {
  return [
    ...(folder.index ? [folder.index] : []),
    ...folder.children.flatMap((child) => {
      if (child.type === 'page') return [child];
      return child.type === 'folder' ? pagesUnder(child) : [];
    }),
  ];
}

/** The edition set every page under `folder` shares, or `undefined` when they differ. */
function sharedEditions(folder: PageTree.Folder, lang: string): Edition[] | undefined {
  const sets = pagesUnder(folder).map((page) => editionsOf(page, lang));
  const [first] = sets;
  if (!first || sets.some((set) => !set || !sameEditions(set, first))) return undefined;
  return first;
}

function withEditionMark(name: ReactNode, editions: readonly Edition[], label: string): ReactNode {
  return (
    <>
      {name}
      <EditionMark editions={editions} label={label} />
    </>
  );
}

function markEditionsItem(
  node: PageTree.Item,
  lang: string,
  label: string,
  scope: readonly Edition[] | undefined,
): PageTree.Item {
  const editions = editionsOf(node, lang);
  if (!editions || isEveryEdition(editions) || (scope && sameEditions(editions, scope))) return node;
  return { ...node, name: withEditionMark(node.name, editions, label) };
}

/**
 * Marks an entry that is not for every edition with the editions it is for.
 *
 * A group whose pages all share one set — Deploy and Operate are Community and
 * Enterprise throughout — carries the mark once, on the group, and its pages
 * carry none: seven identical marks down one group say less than one. A
 * page whose set differs from its group's, or whose group is mixed, is marked
 * on its own. `scope` is the set the nearest marked-or-uniform ancestor
 * already stated.
 */
function markEditions(
  node: PageTree.Node,
  lang: string,
  label: string,
  scope?: readonly Edition[],
): PageTree.Node {
  if (node.type === 'page') return markEditionsItem(node, lang, label, scope);
  if (node.type !== 'folder') return node;
  const shared = sharedEditions(node, lang);
  const mark = shared && !isEveryEdition(shared) && !(scope && sameEditions(shared, scope));
  const inner = shared ?? scope;
  return {
    ...node,
    ...(mark ? { name: withEditionMark(node.name, shared, label) } : {}),
    ...(node.index ? { index: markEditionsItem(node.index, lang, label, inner) } : {}),
    children: node.children.map((child) => markEditions(child, lang, label, inner)),
  };
}

const markedTrees = new Map<string, PageTree.Root>();

/**
 * The tree this layout hands to `DocsLayout`: `lang`'s tree with its English
 * entries marked (`treeWithLanguages`) and its edition marks added.
 *
 * Memoized per locale: the tree and the content are fixed for the life of the
 * build, and the layout renders once per page.
 */
function docsTree(lang: string): PageTree.Root {
  let marked = markedTrees.get(lang);
  if (!marked) {
    const tree = treeWithLanguages(lang);
    const label = uiText(lang).editionsLabel;
    marked = { ...tree, children: tree.children.map((node) => markEditions(node, lang, label)) };
    markedTrees.set(lang, marked);
  }
  return marked;
}

/**
 * Links to `/privacy` and `/terms`, at the foot of the docs sidebar (#299).
 *
 * Before this, nothing on the site linked to either page; only the sitemap
 * reached them. The app has no footer of its own, and every docs page renders
 * this layout's sidebar, on mobile as the drawer, so its `footer` slot reaches
 * both pages from every docs page in every locale.
 *
 * Each link stays in the reader's locale. A locale the page is not written in
 * renders the English text, and that route names the English URL as canonical.
 * The labels are interface copy, so they come from `lib/ui-text.ts` in the
 * reader's locale like the rest of the sidebar's chrome.
 */
function LegalLinks({ lang }: { lang: string }) {
  const prefix = lang === i18n.defaultLanguage ? '' : `/${lang}`;
  const text = uiText(lang);

  return (
    <nav aria-label={text.legalNav} className="flex gap-4 px-2 pt-3 text-xs text-fd-muted-foreground">
      <Link href={`${prefix}/privacy`} className="hover:text-fd-foreground">
        {text.privacy}
      </Link>
      <Link href={`${prefix}/terms`} className="hover:text-fd-foreground">
        {text.terms}
      </Link>
    </nav>
  );
}

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;

  return (
    <DocsLayout
      tree={docsTree(lang)}
      {...baseOptions(lang)}
      sidebar={{ footer: <LegalLinks lang={lang} /> }}
      i18n
    >
      {children}
    </DocsLayout>
  );
}
