// Makes the README's screenshots: the built page against a made-up, safe-for-work library.
//
//   cd gui_source && npx ng build
//   node docs/screenshots/make-screenshots.js            (from the repository root)
//
// The library is written into the browser's private storage (OPFS), in a folder named
// LIBRARY_NAME, and handed to the page as if picked with the folder picker. A stand-in helper
// answers what the page asks before a run starts, so nothing ever reaches AO3. The data below is
// the set chosen for the README - change it here, not in a one-off script, so the next set of
// screenshots shows the same library. No real AO3 username: Example_* and made-up names only.
// The library itself is gui_source/src/app/dummy-library.json, which debug mode's dummy data and
// guest mode show too - change it there, and every one of them shows the change.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'gui_source', 'dist', 'ao3-bookmarks', 'browser');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;
const PORT = 4200;
const URL_ = `http://localhost:${PORT}/`;
const LIBRARY_NAME = 'library';
// how every screenshot looks, but for the customisation strip, which shows three looks of its own
const LOOK = { palette: 'strawberry-milk', font: 'lexend' };

// region the library

// the made-up library, shared with debug mode's dummy data and guest mode - change it there
const LIBRARY = require(path.join(ROOT, 'gui_source', 'src', 'app', 'dummy-library.json'));

// endregion

// region the page

/** serves the built page, as the app does, on localhost:4200 */
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf',
    '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    let file = path.join(PAGE, decodeURIComponent(new URL(req.url, URL_).pathname));
    if (!file.startsWith(PAGE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PAGE, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function setUp(page, { issues }) {
  await page.evaluate(async ({ name, works, collections, customs, runs, issues }) => {
    const top = await navigator.storage.getDirectory();
    for await (const old of top.keys()) await top.removeEntry(old, { recursive: true });
    const root = await top.getDirectoryHandle(name, { create: true });
    const write = async (dir, file, text) => {
      const w = await (await dir.getFileHandle(file, { create: true })).createWritable();
      await w.write(text); await w.close();
    };
    const indexing = await root.getDirectoryHandle('indexing', { create: true });
    const worksDir = await root.getDirectoryHandle('works', { create: true });
    for (const w of works) {
      await write(indexing, w.indexFile, JSON.stringify(w.entry));
      for (const file of w.files) await write(worksDir, file, '<p>A made-up work.</p>');
    }
    if (issues) {
      // files you already had: two works with no index entry, and one with no date in the name
      await write(worksDir, '80000101 Moonlit Market - Paper_Moth.html', '<p>x</p>');
      await write(worksDir, '80000102 Snowbound Bakery - Lantern_Fox.epub', 'x');
      await write(worksDir, '80000002 Pizza time! - extra_cheese_please.epub', 'x');
    }
    const collectionsDir = await root.getDirectoryHandle('collections', { create: true });
    for (const c of collections) await write(collectionsDir, `${c.name}.json`, JSON.stringify(c));
    const customDir = await collectionsDir.getDirectoryHandle('custom', { create: true });
    for (const c of customs) await write(customDir, `${c.name}.json`, JSON.stringify(c));
    const runsDir = await root.getDirectoryHandle('runs', { create: true });
    for (const { file, run } of runs) await write(runsDir, file, JSON.stringify(run));
    await root.getDirectoryHandle('images', { create: true });
  }, {
    name: LIBRARY_NAME, works: LIBRARY.works, collections: LIBRARY.collections, customs: LIBRARY.customCollections,
    runs: LIBRARY.runs, issues,
  });
}

async function open(browser, o = {}) {
  const page = await browser.newPage({
    viewport: o.viewport || { width: 1100, height: 760 }, deviceScaleFactor: 2,
    ...(o.windows ? { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36' } : {}),
  });
  await page.addInitScript(([palette, font, windows, name]) => {
    if (palette) localStorage.setItem('ao3.palette', palette);
    if (font) localStorage.setItem('ao3.font', font);
    if (windows) {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ platform: 'Windows' }) });
    }
    localStorage.setItem('ao3.browserNoticeSeen', 'true');
    localStorage.setItem('ao3.folderWarningDismissed', 'true');
    localStorage.setItem('ao3.ao3TimeZone', 'UTC');
    const grant = async () => 'granted';
    FileSystemHandle.prototype.queryPermission = grant;
    FileSystemHandle.prototype.requestPermission = grant;
    // the folder picker hands over the made-up library, so the top bar names it
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  }, ['palette' in o ? o.palette : LOOK.palette, 'font' in o ? o.font : LOOK.font, !!o.windows, LIBRARY_NAME]);
  // a stand-in helper: only what the page asks before a run starts, so nothing reaches AO3
  await page.route('http://127.0.0.1:4400/**', async (route) => {
    if (o.noHelper) return route.abort('connectionrefused');
    const u = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body),
      headers: { 'Access-Control-Allow-Origin': '*' } });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (u.pathname === '/api/config') return json({ username: 'Example_Reader', filetypes: ['AZW3', 'EPUB', 'MOBI', 'PDF', 'HTML', 'JSON'],
      forced: ['JSON'], defaults: ['JSON', 'HTML'], zoneLookup: true });
    if (u.pathname === '/api/jobs') return json({ jobs: [] });
    if (u.pathname === '/api/runs/floors') {
      const all = (JSON.parse(route.request().postData() || '{}').runs || []).filter((r) => r.action === 'bookmarks' && r.status === 'success');
      return json({ runs: all });
    }
    return json({});
  });
  await page.goto(URL_);
  await setUp(page, { issues: !!o.issues });
  await page.reload();
  const pick = page.getByRole('button', { name: /choose.*folder/i }).first();
  if (await pick.count()) await pick.click();
  await page.waitForTimeout(2500);
  return page;
}

const tab = (page, name) => page.locator('nav.views button', { hasText: name }).first().click();

/** the three looks, cut into strips and stacked into one picture */
async function stack(browser, files, name) {
  const page = await browser.newPage({ viewport: { width: 2200, height: 1984 }, deviceScaleFactor: 1 });
  const strips = files.map((f) => `<div style="height:660px;overflow:hidden"><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="display:block;width:2200px"></div>`);
  await page.setContent(`<body style="margin:0;background:#fff;display:flex;flex-direction:column;gap:2px">${strips.join('')}</body>`);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.close();
}

// endregion

(async () => {
  if (!fs.existsSync(path.join(PAGE, 'index.html'))) {
    console.error(`No built page at ${PAGE} - run "npx ng build" in gui_source first.`);
    process.exit(1);
  }
  const server = await serve();
  const browser = await chromium.launch();
  const shot = (page, file) => page.screenshot({ path: path.join(OUT, file) });
  try {
    let page = await open(browser);
    await shot(page, 'works.png');

    await page.getByRole('button', { name: 'Quick Scan' }).first().click();
    await page.waitForTimeout(1500);
    await shot(page, 'quick-scan.png');
    for (const label of ['Cancel', 'Close']) {
      const b = page.locator('app-download-dialog').getByRole('button', { name: label, exact: true });
      if (await b.count()) { await b.first().click(); break; }
    }
    await page.waitForTimeout(400);

    await tab(page, 'Collections'); await page.waitForTimeout(600);
    await shot(page, 'collections.png');
    await tab(page, 'History'); await page.waitForTimeout(1500);
    await shot(page, 'history.png');
    await page.close();

    page = await open(browser, { issues: true });
    await page.waitForTimeout(1000);
    await shot(page, 'import.png');
    await page.close();

    const looks = [];
    for (const [file, o] of [
      ['custom-strawberry-milk.png', { palette: 'strawberry-milk', font: '' }],
      ['custom-charcoal-typewriter.png', { palette: 'charcoal', font: 'mono' }],
      ['custom-lavender-gaegu.png', { palette: 'lavender', font: 'gaegu' }],
    ]) {
      page = await open(browser, o);
      await page.waitForTimeout(800);
      const where = path.join(require('os').tmpdir(), file);
      await page.screenshot({ path: where });
      looks.push(where);
      await page.close();
    }
    await stack(browser, looks, 'customisation.png');

    page = await open(browser, { viewport: { width: 420, height: 860 } });
    await page.waitForTimeout(800);
    await shot(page, 'custom-narrow.png');
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
})();
