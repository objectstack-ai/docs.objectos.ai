/**
 * The one place this site states what ObjectOS is.
 *
 * ## Source of truth
 *
 * `objectstack-ai/objectstack` `README.md` at `main`: line 7 carries the
 * headline, lines 9-10 the four promises, and lines 27-31 the sentence that
 * names ObjectOS's three editions (objectstack#26148, docs.objectos.ai#341).
 * The maintainer's ruling of 2026-10-05 (objectos#171, Q4) makes that README the
 * single source of the positioning. This repository and www.objectos.ai both
 * quote it, and neither paraphrases it: when the positioning changes, the README
 * changes first and the new words are copied here, byte for byte.
 *
 * ## Who reads it
 *
 * Three surfaces carry `POSITIONING`: the site-wide meta description
 * (`app/layout.tsx`), the `/llms.txt` summary line (`app/llms.txt/route.ts`) and
 * the opening paragraph of `content/docs/index.mdx`. The `/docs` meta
 * description carries `POSITIONING_SHORT` instead — the `description`
 * frontmatter of that same file. MDX cannot import, so both `index.mdx` copies
 * are literals, and `.github/scripts/check-positioning.mjs` compares each to its
 * constant on every pull request — a copy that differs fails CI. The same gate
 * reads the literals below, so keep each one on the shape it parses: one
 * `export const NAME =` followed by a single quoted string.
 *
 * ## The departures from the README's bytes
 *
 * `OBJECTOS_DEFINITION` starts mid-line, at "To run it," on README line 27; the
 * sentence before it is about coding agents, not ObjectOS. From there it keeps
 * every word in the README's order, with three changes, declared here so nobody
 * corrects them back:
 *
 * 1. "the ObjectStack repository" where the README reads "this repository".
 *    Inside the README the phrase has a referent; on this site it has none, so
 *    the referent is spelled out.
 * 2. The README's Markdown is dropped: the code spans around
 *    `ghcr.io/objectstack-ai/objectstack` and `os start`, and the link on
 *    "ObjectOS". This text ships as a meta description and a `/llms.txt` line,
 *    where Markdown would show as raw characters.
 * 3. "([Ship it](#ship-it))" after "free and self-hosted" is left out. It is a
 *    link to a section of the README, which has no target here.
 *
 * ## No imports
 *
 * A leaf module on purpose. `app/layout.tsx` imports it and sits on every
 * route's tree, so anything imported here ships in every bundle — `lib/site.ts`
 * measures what one careless import costs at that position. Never add an
 * `import` to this file.
 */

/** README line 7: the headline. */
export const ONTOLOGY_HEADLINE = 'The ontology is the software.';

/** README lines 9-10: the four promises as one sentence. */
export const ONTOLOGY_PROMISE =
  'One executable business ontology. AI writes it, the runtime runs it, agents operate it, you own it.';

/** README lines 27-31: the three editions, with the three changes declared above. */
export const OBJECTOS_DEFINITION =
  'To run it, the ObjectStack repository ships ObjectOS Community — the ghcr.io/objectstack-ai/objectstack image, os start and the Console, free and self-hosted — while ObjectOS Cloud is the hosted edition and ObjectOS Enterprise the self-managed, licensed one.';

/**
 * The export clause. Not in the README: fixed by the maintainer's ruling on
 * objectos#171, Q2, that a Cloud tenant can export its ontology and run it on
 * the open runtime. It keeps the words this constant carried before #341,
 * with "either edition" spelled out as the two editions it meant, because the
 * definition above now names three. Q1, that ObjectOS still ships a
 * self-managed edition, is now said by the README's sentence itself.
 */
export const OBJECTOS_EDITIONS =
  'On either ObjectOS Cloud or ObjectOS Enterprise, you can export your ontology and run it on the open-source ObjectStack runtime.';

/**
 * The positioning paragraph every machine-facing surface carries, in this order
 * and joined by single spaces. `check-positioning.mjs` composes the same four
 * literals the same way and compares the shipped `/llms.txt` summary against the
 * result, so the composition cannot drift from the parts without a red build.
 */
export const POSITIONING = [
  ONTOLOGY_HEADLINE,
  ONTOLOGY_PROMISE,
  OBJECTOS_DEFINITION,
  OBJECTOS_EDITIONS,
].join(' ');

/**
 * The positioning in 160 characters or fewer, for the `/docs` meta description
 * (objectos#299). `POSITIONING` is 517, and a search snippet cut it off inside
 * the headline, before the word "ObjectOS". So this one leads with ObjectOS and
 * its three editions. It is built from the words above: each edition's words
 * in the README's sentence, and "you own it" from the promise. It is not a
 * fifth README quote. The full paragraph stays the page's opening paragraph.
 */
export const POSITIONING_SHORT =
  'ObjectOS Community is free and self-hosted, ObjectOS Cloud the hosted edition, ObjectOS Enterprise the self-managed, licensed one. You own the ontology.';
