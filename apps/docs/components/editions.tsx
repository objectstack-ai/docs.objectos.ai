import { Building2, Cloud, type LucideIcon, Users } from 'lucide-react';
import Link from 'next/link';
import { EDITION_NAMES, type Edition, inEditionOrder } from '@/lib/editions';

/**
 * One icon per edition, the same on the badge row and in the sidebar mark, so
 * the badge row — which spells the name beside the icon — is the legend for the
 * sidebar, which has room for the icon only.
 */
const EDITION_ICONS: Record<Edition, LucideIcon> = {
  community: Users,
  cloud: Cloud,
  enterprise: Building2,
};

/**
 * The editions a page applies to, under its description: one pill per edition,
 * each linking to the page that says what that edition includes.
 *
 * `label` is interface copy in the route locale (`ui-text`'s `editionsLabel`);
 * the edition names are product nouns and stay English on every route.
 */
export function EditionBadges({
  editions,
  label,
  href,
}: {
  editions: readonly Edition[];
  label: string;
  href: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm" data-editions="">
      <span className="text-fd-muted-foreground">{label}</span>
      <ul aria-label={label} className="flex flex-wrap gap-1.5">
        {inEditionOrder(editions).map((edition) => {
          const Icon = EDITION_ICONS[edition];
          return (
            <li key={edition}>
              <Link
                href={href}
                className="inline-flex items-center gap-1.5 rounded-full border bg-fd-secondary px-2.5 py-0.5 text-xs font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
              >
                <Icon aria-hidden="true" className="size-3.5" />
                {EDITION_NAMES[edition]}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The sidebar's mark on a page or group that is not for every edition: the
 * icons of the editions it is for. Sighted readers get the names as a tooltip,
 * screen readers as text.
 *
 * It is appended to the page-tree entry's name, and the breadcrumb and the
 * previous/next footer render that name too. `.edition-mark` is hidden
 * everywhere except inside the two sidebars (`app/global.css`), so it marks the
 * navigation without repeating itself under every page title.
 */
export function EditionMark({ editions, label }: { editions: readonly Edition[]; label: string }) {
  const ordered = inEditionOrder(editions);
  const names = ordered.map((edition) => EDITION_NAMES[edition]).join(', ');
  return (
    <span className="edition-mark ms-auto shrink-0 items-center gap-1 ps-2 text-fd-muted-foreground" title={names}>
      {ordered.map((edition) => {
        const Icon = EDITION_ICONS[edition];
        return <Icon key={edition} aria-hidden="true" className="size-3.5" />;
      })}
      <span className="sr-only">
        {label}: {names}
      </span>
    </span>
  );
}
