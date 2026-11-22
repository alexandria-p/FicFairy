/**
 * The one reading skin that comes with FicFairy: a downloaded work laid out much as AO3's own
 * work page is - its fonts, its grey-bordered tags box, Georgia headings, AO3's dark links and
 * its line spacing. It styles the page `shapeLikeAo3` has already given AO3's own elements and
 * classes (`dl.work.meta.group`, `.preface .title.heading`, `.module .heading` and so on), and
 * goes in after `AO3_BASICS` and the download's own styles, so where they say the same thing this
 * wins. Written from AO3's look, not copied from AO3's stylesheets.
 */
export const AO3_READING_SKIN = `
/* AO3 - comes with FicFairy */
html { background: #fff; }
body {
  margin: 0 auto;
  padding: 1em 2.5em 2.5em;
  max-width: 64em;
  background: #fff;
  color: #2a2a2a;
  font-family: 'Lucida Grande', 'Lucida Sans Unicode', 'GNU Unifont', Verdana, Helvetica, sans-serif;
  font-size: 0.875em;
  line-height: 1.286;
}
a, a:link { color: #111; text-decoration: none; border-bottom: 1px solid #999; }
a:visited { color: #666; }
a:hover, a:focus { color: #999; border-bottom-color: #ccc; }

/* where the work was posted - AO3's own page has none, so it is kept small */
p.message { margin: 0.5em 0 1em; text-align: center; font-size: 0.857em; color: #555; }

/* the tags box */
dl.work.meta {
  margin: 0.643em 0 1.5em;
  padding: 0.643em 0.857em;
  border: 1px solid #ddd;
  box-shadow: 1px 1px 3px #eee;
  background: #fff;
  line-height: 1.5;
}
dl.work.meta dt {
  float: left;
  clear: left;
  width: 25%;
  margin: 0;
  padding: 0 0.5em 0.286em 0;
  box-sizing: border-box;
  font-weight: normal;
}
dl.work.meta dd { margin: 0 0 0.429em 25%; }
dl.work.meta dt.warning, dl.work.meta dd.warning { font-weight: bold; }
dl.work.meta a, dl.work.meta a.tag { color: #2a2a2a; border-bottom: 1px solid #bbb; }
dl.work.meta a:hover { color: #900; }

/* the title, author, summary and notes */
.preface .title.heading {
  margin: 0.75em 0 0.25em;
  font-family: Georgia, serif;
  font-size: 1.714em;
  font-weight: 400;
  text-align: center;
}
.preface .byline.heading {
  margin: 0 0 1.5em;
  font-family: Georgia, serif;
  font-size: 1.143em;
  font-weight: 400;
  text-align: center;
}
.preface .module .heading, #chapters .meta > p, #afterword .meta > p {
  margin: 1.286em 0 0.429em;
  padding-bottom: 0.143em;
  border-bottom: 1px solid #ccc;
  font-family: Georgia, serif;
  font-size: 1.143em;
  font-weight: 400;
}
blockquote.userstuff, .preface .module blockquote { margin: 0.643em 0 0.643em 1.5em; }

/* each chapter's heading and notes */
#chapters h2.heading, #chapters .meta h2 {
  margin: 1.5em 0 0.75em;
  font-family: Georgia, serif;
  font-size: 1.286em;
  font-weight: 400;
  text-align: center;
}

/* the work itself */
#chapters, .userstuff {
  padding: 0;
  font-family: 'Lucida Grande', 'Lucida Sans Unicode', 'GNU Unifont', Verdana, Helvetica, sans-serif;
  font-size: 1.071em;
  line-height: 1.5;
}
/* one step up, not two, for the userstuff inside #chapters */
#chapters .userstuff { font-size: 1em; }
.userstuff p { margin: 1.286em auto; }
hr { border: 0; border-top: 1px solid #ddd; margin: 2em auto; }

@media (max-width: 42em) {
  body { padding: 0.75em 1em 2em; }
  dl.work.meta dt { float: none; width: auto; padding: 0.429em 0 0; }
  dl.work.meta dd { margin: 0 0 0 1em; }
}
`;
