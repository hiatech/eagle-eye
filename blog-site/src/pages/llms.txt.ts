import { getCollection } from 'astro:content';

export async function GET() {
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  const lines = [
    '# Eagle Eye Blog',
    '',
    '> Analysis, practical guides, and methodology for real-time global intelligence, OSINT, geopolitics, markets, supply chains, and AI agents.',
    '',
    'Canonical blog index: https://www.eagle-eye.app/blog/',
    'RSS feed: https://www.eagle-eye.app/blog/rss.xml',
    'Author: https://www.eagle-eye.app/blog/authors/elie-habib/',
    '',
    '## Articles',
    '',
    ...posts.flatMap((post) => [
      `- [${post.data.title}](https://www.eagle-eye.app/blog/posts/${post.id}/): ${post.data.description}`,
      `  Published: ${post.data.pubDate.toISOString().slice(0, 10)}${post.data.modifiedDate ? `; updated: ${post.data.modifiedDate.toISOString().slice(0, 10)}` : ''}`,
    ]),
    '',
    '## Related machine-readable resources',
    '',
    '- [Eagle Eye overview](https://www.eagle-eye.app/llms.txt)',
    '- [Extended platform reference](https://www.eagle-eye.app/llms-full.txt)',
    '- [Developer and API reference](https://www.eagle-eye.app/api/llms.txt)',
    '- [Global intelligence glossary](https://www.eagle-eye.app/blog/glossary/)',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
