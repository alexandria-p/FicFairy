/**
 * The work a reading skin is previewed on, from User settings: the first made-up work in
 * `dummy-library.json` (the README's, debug mode's and guest mode's library - the owner's own
 * blurbs), laid out as AO3's HTML download is (`#preface`, `.meta`, `dl.tags`, `#chapters`,
 * `.userstuff`) so a skin lands on it as it does on a real download. Its tags, summary and stats
 * are the blurb's; its chapters are lorem ipsum. The library is read only when a preview is
 * asked for, so it stays out of the page's first download, as dummy data's does.
 */

interface SampleReading {
  title: string;
  authors: string[];
  fandoms: string[];
  warnings: string[];
  tags: { rating?: string; categories?: string[]; relationships?: string[]; characters?: string[]; additional?: string[] };
  summary: string;
  words: number;
  chapters_published: number;
  chapters_total: number | null;
  date_updated: string;
}

const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.',
];

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const tagLinks = (tags: string[] | undefined) => (tags ?? []).map((t) => `<a href="#">${escape(t)}</a>`).join(', ');

/** one `dt`/`dd` pair of the tags box, or nothing for a kind the work has none of */
function line(label: string, tags: string[] | undefined): string {
  return tags?.length ? `<dt>${label}:</dt>\n<dd>${tagLinks(tags)}</dd>\n` : '';
}

/** the sample work's html, built from a made-up blurb */
export function sampleWorkHtml(work: SampleReading): string {
  const chapters = Math.min(2, Math.max(1, work.chapters_published || 1));
  const body = Array.from({ length: chapters }, (_, i) => `
  <div class="meta group">
    <h2 class="heading">Chapter ${i + 1}</h2>
  </div>
  <div class="userstuff">
    ${LOREM.map((p) => `<p>${p}</p>`).join('\n    ')}
    ${i === 0 ? '<hr />' : ''}
  </div>`).join('\n');
  const total = work.chapters_total ?? '?';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escape(work.title)} - ${escape(work.authors.join(', '))}</title>
  <style type="text/css">
    p.message { text-align: center; }
    .meta h1 { font-size: 1.5em; text-align: center; }
    .meta h2 { font-size: 1.25em; text-align: center; }
    .meta .byline { text-align: center; }
    .meta dl.tags { border: 1px solid; padding: 1em; }
    .meta dd { margin: -1em 0 0 10em; }
    #chapters { font-family: "Nimbus Roman No9 L", "Times New Roman", serif; padding: 1em; }
    .userstuff { font-family: "Nimbus Roman No9 L", "Times New Roman", serif; padding: 1em; }
    .toc-heading { display: none; }
  </style>
</head>
<body>
<div id="preface">
  <h2 class="toc-heading">Preface</h2>
  <p class="message">
    <b>${escape(work.title)}</b><br />
    A sample work, shown to preview your reading skin. It was not downloaded from anywhere.
  </p>
  <div class="meta">
    <dl class="tags">
${line('Rating', work.tags.rating ? [work.tags.rating] : [])}${line('Archive Warning', work.warnings)}${line('Category', work.tags.categories)}${line('Fandom', work.fandoms)}${line('Relationship', work.tags.relationships)}${line('Characters', work.tags.characters)}${line('Additional Tags', work.tags.additional)}<dt>Language:</dt>
<dd>English</dd>
<dt>Stats:</dt>
<dd>Updated: ${escape(work.date_updated)} Words: ${work.words.toLocaleString('en')} Chapters: ${work.chapters_published}/${total}</dd>
    </dl>
    <h1>${escape(work.title)}</h1>
    <div class="byline">by ${work.authors.map((a) => `<a rel="author" href="#">${escape(a)}</a>`).join(', ')}</div>
    <p>Summary</p>
    <blockquote class="userstuff"><p>${escape(work.summary)}</p></blockquote>
  </div>
</div>
<div id="chapters" class="userstuff">${body}
</div>
</body>
</html>
`;
}

/** the first made-up work of the dummy library, as the sample - read when a preview is asked for */
export async function skinSampleWork(): Promise<string> {
  const library = (await import('./dummy-library.json')).default as unknown as {
    works: { entry: { indexes: SampleReading[] } }[];
  };
  const readings = library.works[0].entry.indexes;
  return sampleWorkHtml(readings[readings.length - 1]);
}

/**
 * A made-up work skin, for previewing how your site skin sits with a work's own: it styles only
 * what an author typically would (a coloured heading, a message-bubble opening paragraph, a
 * rule), and leaves the fonts and the tags box alone - so layering a site skin under it, or not,
 * plainly shows.
 */
export const SAMPLE_WORK_SKIN = `
#workskin h2.heading { color: #8e3b8e; letter-spacing: 0.04em; }
#workskin .userstuff p:first-child {
  max-width: 28em;
  padding: 0.6em 1em;
  border-radius: 1.2em 1.2em 1.2em 0.2em;
  background: #e7f0fd;
  color: #17324d;
}
#workskin .userstuff hr { border: 0; border-top: 2px dashed #c58bc5; }
`;
