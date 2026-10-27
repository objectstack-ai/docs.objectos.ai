import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Globe } from 'lucide-react';
import Image from 'next/image';
import { i18n } from '@/lib/i18n';

export const gitConfig = {
  user: 'objectstack-ai',
  repo: 'docs.objectos.ai',
  branch: 'main',
};

const WEBSITE_URL = 'https://www.objectos.ai';

/**
 * The header shared by the docs and the legal pages.
 *
 * The logo goes to the docs home, in the reader's language (#301). It used to
 * go to the marketing site, which on a docs page reads as "start over" and
 * lands an English page under a reader who chose another language. The
 * marketing site keeps a place in the header as its own link, next to GitHub,
 * so it is still one click away. Its label is the host name, which needs no
 * translation.
 */
export function baseOptions(lang: string = 'en'): BaseLayoutProps {
  return {
    nav: {
      url: lang === i18n.defaultLanguage ? '/docs' : `/${lang}/docs`,
      title: (
        <div className="flex items-center gap-2 font-bold">
          <Image
            src="/logo.svg"
            alt=""
            aria-hidden="true"
            width={30}
            height={30}
          />
          ObjectOS
        </div>
      ),
      transparentMode: 'top',
    },
    links: [
      {
        type: 'icon',
        url: WEBSITE_URL,
        text: 'www.objectos.ai',
        label: 'www.objectos.ai',
        icon: <Globe />,
        external: true,
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
