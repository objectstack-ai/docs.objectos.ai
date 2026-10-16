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
    title: 'Privacy Policy',
    description: 'What ObjectStack AI LLC collects from its public websites and hosted accounts, and the data inside a self-managed deployment that it does not collect.',
    updated: 'Last updated: October 16, 2026',
    body: [
      {
        heading: 'Overview',
        text: 'ObjectOS runs hosted (ObjectOS Cloud) or self-managed on your own infrastructure (ObjectOS Enterprise). When you run ObjectOS self-managed inside your own infrastructure, ObjectStack AI LLC does not collect, store, or process the data flowing through your deployment. The data handling of ObjectOS Cloud is governed by its service agreement, presented at the time you sign up. This policy describes the limited information we collect when you interact with our public web properties (objectstack.ai, docs.objectstack.ai) and optional cloud services.',
      },
      {
        heading: 'What we collect',
        text: 'For our public websites we collect standard request logs (IP, user agent, referrer, requested URL) for security and operational purposes. If you create an account on a hosted service we operate, we collect the identifiers and credentials you provide to authenticate you.',
      },
      {
        heading: 'What we do not collect',
        text: 'We do not collect data that lives inside a self-managed ObjectOS deployment (ObjectOS Enterprise) or inside a deployment of the open-source ObjectStack runtime, and your application records never leave the perimeter you operate. Self-managed ObjectOS validates its license online (Enterprise air-gapped licenses are offline-validated); the open-source ObjectStack runtime has no telemetry, no license check, and no update ping.',
      },
      {
        heading: 'Contact',
        text: 'For privacy questions, contact privacy@objectstack.ai.',
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
  return staticPageMetadata('privacy', lang, content);
}

export default async function PrivacyPage({
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
