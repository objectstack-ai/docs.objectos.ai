/**
 * The three ObjectOS editions a docs page can apply to, as its `editions:`
 * frontmatter spells them.
 *
 * ObjectOS is one product in three editions: Community (open source,
 * self-managed), Cloud (hosted; its Free and Team plans are plans of this one
 * edition, not editions of their own) and Enterprise (licensed, self-managed;
 * Business and Business Self-Managed are contract options under it). A page
 * declares the subset it is true for, so a reader on ObjectOS Cloud can tell a
 * Deploy page is not theirs before reading it.
 *
 * Declared once here because three consumers have to agree on it: the
 * frontmatter schema in `source.config.ts` (which rejects any other value and
 * any English page without the key), the badge row under each page title, and
 * the mark the sidebar puts on a page or group that is not for every edition.
 *
 * Data only, no React: `source.config.ts` imports this module, and it is
 * bundled for the MDX compiler rather than for the app.
 */
export const EDITIONS = ['community', 'cloud', 'enterprise'] as const;

export type Edition = (typeof EDITIONS)[number];

/**
 * How each edition is named to a reader. Product nouns: the translation guide
 * (`docs/TRANSLATION.md`, Glossary) keeps them in English in every locale, so
 * these are the same strings on every route and never go through `ui-text`.
 */
export const EDITION_NAMES: Record<Edition, string> = {
  community: 'Community',
  cloud: 'Cloud',
  enterprise: 'Enterprise',
};

/** The page that explains what each edition includes; every badge links to it. */
export const EDITIONS_PAGE_SLUGS = ['editions', 'compare'];

export function isEdition(value: string): value is Edition {
  return (EDITIONS as readonly string[]).includes(value);
}

/**
 * `editions` in the canonical order — Community, Cloud, Enterprise — whatever
 * order the frontmatter listed them in, so every badge row and sidebar mark
 * reads the same way.
 */
export function inEditionOrder(editions: readonly Edition[]): Edition[] {
  return EDITIONS.filter((edition) => editions.includes(edition));
}

/** Whether a page is for every edition: such a page carries no sidebar mark. */
export function isEveryEdition(editions: readonly Edition[]): boolean {
  return EDITIONS.every((edition) => editions.includes(edition));
}
