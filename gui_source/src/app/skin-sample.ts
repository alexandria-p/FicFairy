/**
 * The work a reading skin is previewed on, from User settings: the first made-up work in
 * `dummy-library.json` (the README's, debug mode's and guest mode's library - the owner's own
 * blurbs), laid out as AO3's HTML download is (`#preface`, `.meta`, `dl.tags`, `#chapters`,
 * `.userstuff`) so a skin lands on it as it does on a real download. Its tags, summary and stats
 * are the blurb's; its chapters are lorem ipsum. The library is read only when a preview is
 * asked for, so it stays out of the page's first download, as dummy data's does.
 */

/** what the sample says of itself, under its title */
const SAMPLE_NOTE = 'A sample work, shown to preview your reading skin. It was not downloaded from anywhere.';

/** the note on the work-skin Preview, saying what kind of work skin it shows */
export const SAMPLE_CHAT_NOTE =
  'A sample work, shown with an example creator work skin - a social media / group chat style, as some fics use for text messages. It was not downloaded from anywhere.';

export interface SampleReading {
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
export function sampleWorkHtml(work: SampleReading, chat = '', note = SAMPLE_NOTE): string {
  const chapters = Math.min(2, Math.max(1, work.chapters_published || 1));
  const body = Array.from({ length: chapters }, (_, i) => `
  <div class="meta group">
    <h2 class="heading">Chapter ${i + 1}</h2>
  </div>
  <div class="userstuff">
    ${LOREM.map((p) => `<p>${p}</p>`).join('\n    ')}
    ${i === 0 ? chat : ''}
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
    ${note}
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

/**
 * The first made-up work of the dummy library, as the sample - read when a preview is asked for -
 * with `chat` (the work skin Preview's `SAMPLE_CHAT`) in its first chapter.
 */
export async function skinSampleWork(chat = '', note = SAMPLE_NOTE): Promise<string> {
  const library = (await import('./dummy-library.json')).default as unknown as {
    works: { entry: { indexes: SampleReading[] } }[];
  };
  const readings = library.works[0].entry.indexes;
  return sampleWorkHtml(readings[readings.length - 1], chat, note);
}

/**
 * The work skin the *How to display creator/individual work skins* Preview shows, chosen by the
 * owner: a chat-app skin of the kind AO3 authors use for text-message fics (`.whatsapp`, with
 * `light` / `dark`), so how a site skin sits with a work's own plainly shows. Its pictures (the
 * chat background, the bars, the ticks) load from the image host the skin names - only when that
 * Preview is opened. The sample's chat (`SAMPLE_CHAT`) is the markup it styles. Kept as the owner
 * gave it, but for one stray `: 100%` line in `.preview p`, which no browser read.
 */
export const SAMPLE_WORK_SKIN = `
#workskin .reader {
  display: none;
}

#workskin .whatsapp {
  width: 320px;
  float: center;
  margin: 0 auto;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  line-height: 1;
}

#workskin .whatsapp table {
  border-collapse: collapse;
  border-spacing: 0;
}

#workskin .whatsapp div,
#workskin .whatsapp span,
#workskin .whatsapp p,
#workskin .whatsapp img,
#workskin .whatsapp table,
#workskin .whatsapp tbody,
#workskin .whatsapp thead,
#workskin .whatsapp tr,
#workskin .whatsapp th,
#workskin .whatsapp td {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 100%;
  font: inherit;
  vertical-align: baseline;
}

#workskin .whatsapp p {
  display: inline-block;
  line-height: 1.2;
}

#workskin .whatsapp p:empty {
  display: none;
}

#workskin .whatsapp p,
#workskin .whatsapp .img {
  margin: 0;
}

#workskin .whatsapp .link {
  color: #34b4eb;
  display: inline;
}

#workskin .whatsapp .topbar {
  padding: 3px;
  height: 60px;
  width: 320px;
  color: #dee5eb;
}

#workskin .whatsapp .topbar td {
  vertical-align: middle;
  overflow: hidden;
}

#workskin .whatsapp.light .topbar {
  background-color: #075e55;
}

#workskin .whatsapp.dark .topbar {
  background-color: #232d36;
}

#workskin .whatsapp .icons {
  width: 0;
}

#workskin .whatsapp .icons::after {
  background-image: url("https://i.ibb.co/FmXV1d2/icons.png");
  background-size: 30px 15px;
  display: inline-block;
  max-width: 30px;
  width: 30px;
  height: 15px;
  margin-right: 15px;
  content: "";
}

#workskin .whatsapp .members,
#workskin .whatsapp .groupname {
  margin-right: auto;
  min-width: 180px;
  white-space: nowrap;
  max-width: 180px;
  display: flex;
}

#workskin .whatsapp .members {
  font-size: 0.75rem;
}

#workskin .whatsapp .groupname {
  font-weight: bold;
  font-size: 1.5rem;
  padding-top: 10px;
}

#workskin .whatsapp .topbar p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 210px;
}

#workskin .whatsapp .pp img {
  min-width: 50px;
  width: 50px;
  border-radius: 50%;
  height: 50px;
  overflow: hidden;
  margin: 5px 0;
}

#workskin .whatsapp .backarrow::after {
  content: "\\2190";
  font-weight: bold;
  font-size: 1.5rem;
  position: relative;
}

#workskin .whatsapp .messages {
  background-repeat: repeat-y;
  background-size: 100%;
  padding: 10px;
  padding-top: 0px;
  overflow: auto;
  max-height: 530px;
  max-width: 320px;
  text-align: center;
}

#workskin .whatsapp.light .messages {
  background-image: url("https://i.ibb.co/YjT1qGH/1620176370792.jpg");
}

#workskin .whatsapp.dark .messages {
  background-image: url("https://i.ibb.co/7ksHgZs/1620176474989.jpg");
}

#workskin .whatsapp ::-webkit-scrollbar {
  width: 10px;
}

#workskin .whatsapp ::-webkit-scrollbar-track {
  background: none;
}

#workskin .whatsapp ::-webkit-scrollbar-thumb {
  background: rgba(0,0,0,0.5);
  border-radius: 10px;
}

#workskin .whatsapp ::-webkit-scrollbar-thumb:hover {
  background: rgba(0,0,0,0.7);
  border-radius: 10px;
}

#workskin .whatsapp .bottombar {
  background-repeat: repeat-y;
  background-size: 100%;
  width: auto;
  height: 50px;
  padding-left: 15px;
  padding-bottom: 0px;
}

#workskin .whatsapp .typearea {
  position: relative;
  display: inline-block;
  padding: 2px 2px 2px 0;
  border-right: 2px solid #007aff;
  overflow: hidden;
  max-width: 170px;
  white-space: nowrap;
  margin-left: 2em;
  margin-top: 1em;
}

#workskin .whatsapp.dark .typearea {
  color: #dee5eb;
}

#workskin .whatsapp .typearea .from {
  display: none;
}

#workskin .whatsapp.light .bottombar {
  background-image: url("https://i.ibb.co/pyCv9Bj/1620176397802.jpg");
}

#workskin .whatsapp.dark .bottombar {
  background-image: url("https://i.ibb.co/6Dxsfrr/barra-escuracd.png");
}

#workskin .whatsapp .in,
#workskin .whatsapp .out {
  text-align: left;
}

#workskin .whatsapp .text {
  margin: 0.1em 1em;
  max-width: 75%;
  clear: both;
  position: relative;
  border-radius: 0.5em;
}

#workskin .whatsapp.light .text {
  color: #000000;
}

#workskin .whatsapp.dark .text {
  color: #dee5eb;
}

#workskin .whatsapp.light .out .text {
  float: right;
  background: #E1FFC7;
}

#workskin .whatsapp.dark .out .text {
  float: right;
  background: #054640;
}

#workskin .whatsapp.light .in .text {
  float: left;
  background: #f6f6f6;
}

#workskin .whatsapp.dark .in .text {
  float: left;
  background: #232d36;
}

#workskin .whatsapp .out > div:first-of-type {
  margin-top: 0.3em;
  border-radius: 0.5em 0 0.5em 0.5em;
}

#workskin .whatsapp .in > div:first-of-type {
  margin-top: 0.3em;
  border-radius: 0 0.5em 0.5em 0.5em;
}

#workskin .whatsapp.light .out > div:first-of-type::before {
  content: "";
  position: absolute;
  right: -0.4em;
  top: 0;
  width: 0.5em;
  height: 1em;
  border-right: 0.5em solid #E1FFC7;
  border-bottom-right-radius: 0.5em 1em;
}

#workskin .whatsapp.light .in > div:first-of-type::before {
  content: "";
  position: absolute;
  left: -0.4em;
  top: 0;
  width: 0.5em;
  height: 1em;
  border-left: 0.5em solid #f6f6f6;
  border-bottom-left-radius: 0.5em 1em;
}

#workskin .whatsapp .text p {
  margin: 0.25em 7px 0.25em .45em;
}

#workskin .whatsapp.dark .out > div:first-of-type::before {
  content: "";
  position: absolute;
  right: -0.4em;
  top: 0;
  width: 0.5em;
  height: 1em;
  border-right: 0.5em solid #054640;
  border-bottom-right-radius: 0.5em 1em;
}

#workskin .whatsapp.dark .in > div:first-of-type::before {
  content: "";
  position: absolute;
  left: -0.4em;
  top: 0;
  width: 0.5em;
  height: 1em;
  border-left: 0.5em solid #232d36;
  border-bottom-left-radius: 0.5em 1em;
}

#workskin .whatsapp .img {
  border-radius: 3px;
  width: 100%;
  display: block;
}

#workskin .whatsapp .img img {
  width: 100%;
}

#workskin .whatsapp .time {
  font-size: 0.75rem;
  color: #999;
  display: inline-block;
  margin: 0;
  float: right;
  background-color: transparent;
  line-height: 1.7em;
}

#workskin .whatsapp .img .time {
  color: #ffffff;
  position: absolute;
  bottom: 5px;
  right: 6px;
}

#workskin .whatsapp .out .time::after {
  background-size: 15px 10px;
  display: inline-block;
  width: 15px;
  height: 10px;
  content: "";
  margin: 0 0 0 2px;
}

#workskin .whatsapp .out .time::after {
  background-image: url(https://i.ibb.co/SRHp95x/bluecheck.png);
}

#workskin .whatsapp .out .unread::after {
  background-image: url(https://i.ibb.co/q7thTHp/gray2.png);
}

#workskin .whatsapp .out .img .unread::after {
  background-image: url(https://i.ibb.co/mXFwkhD/white2.png);
}

#workskin .whatsapp .out .unsent::after {
  background-image: url(https://i.ibb.co/6F74Wr1/gray1.png);
}

#workskin .whatsapp .out .img .unsent::after {
  background-image: url(https://i.ibb.co/vqr7T8X/white1.png);
}

#workskin .whatsapp .info {
  font-size: 0.75rem;
  width: 100%;
  margin: 10px auto;
  text-align: center;
  display: inline-block;
  line-height: 1.3;
}

#workskin .whatsapp .info p {
  max-width: 75%;
  border-radius: 5px;
  padding: 5px;
  display: inline-block;
}

#workskin .whatsapp.light .info p {
  background: #e3e3e3;
}

#workskin .whatsapp.dark .info p {
  background: #232d36;
  color: #999;
}

#workskin .whatsapp .from {
  font-weight: bold;
  line-height: .5em;
  display: block;
  padding-top: 8px;
}

#workskin .whatsapp .text > .from {
  font-size: 0.85rem;
  padding-bottom: 4px;
}

#workskin .whatsapp .out .text > .from {
  display: none;
}

#workskin .whatsapp .quote,
#workskin .whatsapp .preview {
  font-size: 0.75rem;
  border-radius: 0.5em;
  margin: 4px;
}

#workskin .whatsapp .preview {
  overflow: hidden;
  max-height: 5em;
}

#workskin .whatsapp.light .in .quote,
#workskin .whatsapp.light .in .preview {
  background-color: #ececec;
  color: #757575;
}

#workskin .whatsapp.light .out .quote,
#workskin .whatsapp.light .out .preview {
  background-color: #daf7c1;
  color: #757575;
}

#workskin .whatsapp.dark .in .quote,
#workskin .whatsapp.dark .in .preview {
  background-color: #171e24;
  color: #c9c9c9;
}

#workskin .whatsapp.dark .out .quote,
#workskin .whatsapp.dark .out .preview {
  background-color: #0e4037;
  color: #c9c9c9;
}

#workskin .whatsapp.light .preview-title {
  font-weight: bold;
  color: black;
}

#workskin .whatsapp.dark .preview-title {
  font-weight: bold;
  color: #dee5eb;
}

#workskin .whatsapp .preview p {
  float: left;
  height: 100%;
  padding: 0;
  margin: 0;
  line-height: 1.5;
}

#workskin .whatsapp .preview img {
  margin-right: 4px;
  float: left;
  height: 100%;
  width: 60px;
  max-width: 30%;
}

#workskin .whatsapp .onemoji p,
#workskin .whatsapp .twomoji p,
#workskin .whatsapp .threemoji p {
  display: block;
}

#workskin .whatsapp .onemoji p:first-of-type {
  font-size: 2.5rem;
}

#workskin .whatsapp .twomoji p:first-of-type {
  font-size: 2rem;
}

#workskin .whatsapp .threemoji p:first-of-type {
  font-size: 1.5rem;
}

#workskin .whatsapp .quote.red1 {
  border-left: 3px solid #fe0200;
}

#workskin .whatsapp .quote.red2 {
  border-left: 3px solid #d9262a;
}

#workskin .whatsapp .quote.pink {
  border-left: 3px solid #ff3e73;
}

#workskin .whatsapp .quote.blue1 {
  border-left: 3px solid #0166ff;
}

#workskin .whatsapp .quote.blue2 {
  border-left: 3px solid #297dfa;
}

#workskin .whatsapp .quote.blue3 {
  border-left: 3px solid #5887cb;
}

#workskin .whatsapp .quote.blue4 {
  border-left: 3px solid #34deff;
}

#workskin .whatsapp .quote.brown {
  border-left: 3px solid #af593e;
}

#workskin .whatsapp .quote.orange {
  border-left: 3px solid #ff861e;
}

#workskin .whatsapp .quote.yellow {
  border-left: 3px solid #ffe53a;
}

#workskin .whatsapp .quote.purple {
  border-left: 3px solid #8359ae;
}

#workskin .whatsapp .quote.green1 {
  border-left: 3px solid #01a368;
}

#workskin .whatsapp .quote.green2 {
  border-left: 3px solid #c5e17a;
}

#workskin .whatsapp .quote.green3 {
  border-left: 3px solid #22af22;
}

#workskin .whatsapp .quote.green4 {
  border-left: 3px solid #096309;
}

#workskin .whatsapp .quote.green5 {
  border-left: 3px solid #054105;
}

#workskin .whatsapp .quote.red1 .from,
#workskin .whatsapp .from.red1 {
  color: #fe0200;
}

#workskin .whatsapp .quote.red2 .from,
#workskin .whatsapp .from.red2 {
  color: #d9262a;
}

#workskin .whatsapp .quote.pink .from,
#workskin .whatsapp .from.pink {
  color: #ff3e73;
}

#workskin .whatsapp .quote.blue1 .from,
#workskin .whatsapp .from.blue1 {
  color: #0166ff;
}

#workskin .whatsapp .quote.blue2 .from,
#workskin .whatsapp .from.blue2 {
  color: #297dfa;
}

#workskin .whatsapp .quote.blue3 .from,
#workskin .whatsapp .from.blue3 {
  color: #5887cb;
}

#workskin .whatsapp .quote.blue4 .from,
#workskin .whatsapp .from.blue4 {
  color: #34deff;
}

#workskin .whatsapp .quote.brown .from,
#workskin .whatsapp .from.brown {
  color: #af593e;
}

#workskin .whatsapp .quote.orange .from,
#workskin .whatsapp .from.orange {
  color: #ff861e;
}

#workskin .whatsapp .quote.yellow .from,
#workskin .whatsapp .from.yellow {
  color: #ffe53a;
}

#workskin .whatsapp .quote.purple .from,
#workskin .whatsapp .from.purple {
  color: #8359a3;
}

#workskin .whatsapp .quote.green1 .from,
#workskin .whatsapp .from.green1 {
  color: #01a368;
}

#workskin .whatsapp .quote.green2 .from,
#workskin .whatsapp .from.green2 {
  color: #c5e17a;
}

#workskin .whatsapp .quote.green3 .from,
#workskin .whatsapp .from.green3 {
  color: #22af22;
}

#workskin .whatsapp .quote.green4 .from,
#workskin .whatsapp .from.green4 {
  color: #096309;
}

#workskin .whatsapp .quote.green5 .from,
#workskin .whatsapp .from.green5 {
  color: #054105;
}
`;

/** a made-up group chat of lorem ipsum (Halloween Town: Jack - the reader's side - Sally and the Mayor), back and forth, in the markup the sample work skin styles - put in the first chapter */
export const SAMPLE_CHAT = `
<div class="whatsapp light">
  <table class="topbar"><tbody><tr>
    <td><span class="backarrow"></span></td>
    <td>
      <p class="groupname">Halloween Town</p><br />
      <p class="members">Jack, Sally, Mayor</p>
    </td>
    <td><span class="icons"></span></td>
  </tr></tbody></table>
  <div class="messages">
    <div class="info"><p>Today</p></div>
    <div class="in"><div class="text"><p class="from purple">Sally</p><p>Lorem ipsum dolor sit amet?</p><p class="time">21:04</p></div></div>
    <div class="out"><div class="text"><p>Consectetur adipiscing elit, sed do eiusmod tempor.</p><p class="time">21:04</p></div></div>
    <div class="in"><div class="text"><p class="from orange">Mayor</p><p>Incididunt ut labore et dolore magna aliqua.</p><p class="time">21:05</p></div></div>
    <div class="in"><div class="text"><p class="from orange">Mayor</p><p>Ut enim ad minim veniam!!</p><p class="time">21:05</p></div></div>
    <div class="out"><div class="text"><p>Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p><p class="time">21:06</p></div></div>
    <div class="in"><div class="text"><p class="from purple">Sally</p><p>Duis aute irure dolor?</p><p class="time">21:06</p></div></div>
    <div class="out"><div class="text"><p>In reprehenderit in voluptate velit esse.</p><p class="time">21:07</p></div></div>
    <div class="in"><div class="text"><p class="from orange">Mayor</p><p>Cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat.</p><p class="time">21:08</p></div></div>
    <div class="out"><div class="text"><p>Cupidatat non proident</p><p class="time">21:08</p></div></div>
    <div class="out"><div class="text"><p>sunt in culpa qui officia deserunt mollit anim id est laborum</p><p class="time">21:09</p></div></div>
    <div class="in"><div class="text"><p class="from purple">Sally</p><p>Sed ut perspiciatis 👀</p><p class="time">21:10</p></div></div>
    <div class="out"><div class="text"><p>Nemo enim ipsam voluptatem.</p><p class="time unread">21:10</p></div></div>
  </div>
  <div class="bottombar"><p class="typearea">Message</p></div>
</div>
`;
