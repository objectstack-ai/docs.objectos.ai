import type { Metadata } from 'next';
import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Callout } from 'fumadocs-ui/components/callout';
import { baseOptions } from '@/lib/layout.shared';
import { staticPageMetadata } from '@/lib/seo';
import { i18n } from '@/lib/i18n';
import { uiText } from '@/lib/ui-text';
import zhHans from './zh-Hans.json';
import zhHant from './zh-Hant.json';

/**
 * This page's copy, one entry per locale it is written in. English is written
 * here. The Simplified entry is `zh-Hans.json`, and `zh-Hant.json` is GENERATED
 * from it by `scripts/gen-zh-hant.mjs` (OpenCC `s2twp`, the converter behind
 * every other zh-Hant string on this site), so never edit it by hand: CI runs
 * `gen-zh-hant --check`. Both are JSON because that generator converts a data
 * file, the same reason `lib/ui-text/` is JSON.
 */
const content = {
  en: {
    title: 'Terms of Service',
    description: "How ObjectOS editions are licensed, the Apache-2.0 license of this site's content, the ObjectOS trademark, and responsibility for self-managed deployments.",
    updated: 'Last updated: October 26, 2026',
    body: [
      {
        heading: 'License',
        text: 'ObjectOS is one product in three editions. ObjectOS Community, the open-source runtime and Console, is licensed under the Apache License 2.0 in the objectstack-ai/objectstack repository, together with the ObjectStack framework it is built on. Your use of ObjectOS Cloud or ObjectOS Enterprise is governed by the service agreement or license of that edition. The contents of the repository behind this documentation site (the documentation and the site code) are licensed under the Apache License 2.0. The "ObjectOS" name and logo are trademarks of ObjectStack AI LLC and are not granted under the Apache 2.0 license — see TRADEMARK.md in the repository.',
      },
      {
        heading: 'Self-hosted deployments',
        text: 'When you run ObjectOS self-managed inside your own infrastructure (ObjectOS Enterprise), you are solely responsible for the operation, security, availability, backups, and compliance of that deployment, and ObjectStack AI LLC provides no warranty for it beyond what your commercial agreement specifies. When you self-host ObjectOS Community instead, it is licensed under the Apache License 2.0, and ObjectStack AI LLC provides no warranty beyond what that license specifies.',
      },
      {
        heading: 'Hosted services',
        text: 'Any hosted services operated by ObjectStack AI LLC (for example, ObjectOS Cloud) are subject to a separate service agreement that will be presented at the time you sign up. Nothing on this site constitutes such an agreement.',
      },
      {
        heading: 'Changes',
        text: 'We may update these terms from time to time. Material changes will be reflected in the "Last updated" date above.',
      },
      {
        heading: 'Contact',
        text: 'For questions about these terms, contact legal@objectstack.ai.',
      },
    ],
    back: '← Back to home',
  },
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
};

/**
 * The locales this page is actually written in: the keys of the `content`
 * record above, which is where this page's copy lives.
 *
 * `app/sitemap.ts` reads this rather than restating the pair, so a translation
 * added to `content` is advertised to crawlers by that edit alone. The renderer
 * below still serves English for any other locale, but that fallback is not a
 * translation and must not be advertised as one — which is why this is derived
 * from `content`, not from `i18n.languages`.
 *
 * A named export next to a page's default is valid App Router: Next's generated
 * route validator (`.next/types/validator.ts`) constrains the *known* page
 * exports and ignores additional ones.
 */
export const contentLocales = Object.keys(content);

/** Title, description, canonical and hreflang from `content`; see `staticPageMetadata`. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  return staticPageMetadata('terms', lang, content);
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  // Any other locale is served the English entry. That text is English inside
  // `<html lang="LOCALE">`, so it is marked `lang="en"` and introduced by the
  // notice docs pages show on a fallback (#298), in the route locale and before
  // the English it describes. An English or written page is unchanged.
  const isFallback = !Object.hasOwn(content, lang);
  const t = isFallback ? content.en : content[lang as keyof typeof content];
  const contentLang = isFallback ? i18n.defaultLanguage : undefined;

  return (
    <HomeLayout {...baseOptions(lang)} i18n>
      {/* An article, not a main: HomeLayout already renders main#nd-home-layout
          around this, and a second main nested in it is a duplicate landmark. */}
      <article className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-24">
        {isFallback && (
          <Callout type="info" role="note" className="mt-0 mb-8" data-untranslated-notice="">
            {uiText(lang).notTranslated}
          </Callout>
        )}
        <h1 lang={contentLang} className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">{t.title}</h1>
        <p lang={contentLang} className="text-sm text-foreground/60 mb-12">{t.updated}</p>
        <div lang={contentLang} className="space-y-8">
          {t.body.map((s) => (
            <section key={s.heading}>
              <h2 className="text-xl font-semibold mb-3">{s.heading}</h2>
              <p className="text-foreground/80 leading-relaxed">{s.text}</p>
            </section>
          ))}
        </div>
        <div lang={contentLang} className="mt-16 pt-8 border-t border-border/60">
          <Link href={`/${lang}`} className="text-sm text-primary hover:underline">
            {t.back}
          </Link>
        </div>
      </article>
    </HomeLayout>
  );
}
