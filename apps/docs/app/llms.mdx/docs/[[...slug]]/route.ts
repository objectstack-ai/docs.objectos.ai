import { getLLMText, source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { SITE_URL } from '@/lib/seo';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  // Served at `/docs/<path>.mdx` (the `next.config.mjs` rewrite) for LLMs and
  // the page's Copy Markdown button, and it stays crawlable for them. To a
  // search engine it is a duplicate of the HTML page: ~40 of these sat in
  // "Crawled - currently not indexed" (#469). So it names the HTML page as
  // canonical and asks not to be indexed. Headers, because Markdown has no
  // <head>. Prerendered with the body: Next stores them in the route's `.meta`,
  // which `check-indexing.mjs` reads.
  const htmlUrl = `${SITE_URL}${page.url}`;
  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown',
      'X-Robots-Tag': 'noindex',
      Link: `<${htmlUrl}>; rel="canonical"`,
    },
  });
}

export function generateStaticParams() {
  return source.generateParams();
}
