import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DropboxError, DropboxFile, DropboxFolder, DropboxSession, DropboxStatus, LibraryChange, LibraryChanges,
} from './dropbox';
import { FolderStore } from './folder-store';
import { DropboxCopy, Library, ReadProgress, describeReadProgress } from './library';
import { LibrarySetup } from './library-setup';
import { unzip } from './unzip';
import { IndexCache } from './index-cache';
import { VisitLog } from './visit-log';
import { LibraryImports } from './imports';

// region building zips the way dropbox sends them

const encoder = new TextEncoder();

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** a zip of `files`, deflated unless told to store, with a folder entry as dropbox adds */
async function zipOf(files: Record<string, string>, stored = false): Promise<ArrayBuffer> {
  const locals: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  const entries: [string, Uint8Array, number, Uint8Array][] = [['indexing/', new Uint8Array(), 0, new Uint8Array()]];
  for (const [path, text] of Object.entries(files)) {
    const raw = encoder.encode(text);
    entries.push([path, stored ? raw : await deflate(raw), stored ? 0 : 8, raw]);
  }

  for (const [path, data, method, raw] of entries) {
    const name = encoder.encode(path);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, method, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    locals.push(new Uint8Array(local.buffer), name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(8, 0x0800, true); // utf-8 names
    central.setUint16(10, method, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    directory.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }

  const size = directory.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...directory, new Uint8Array(end.buffer)];
  const zip = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    zip.set(part, at);
    at += part.length;
  }
  return zip.buffer;
}

// endregion

describe('unzip', () => {
  it('reads deflated entries, names and all, and leaves folders out', async () => {
    const entries = await unzip(await zipOf({ 'indexing/111 Café.json': '{"id":"111"}' }));
    expect(entries.map((e) => e.path)).toEqual(['indexing/111 Café.json']);
    expect(new TextDecoder().decode(entries[0].data)).toBe('{"id":"111"}');
  });

  it('reads stored entries too', async () => {
    const entries = await unzip(await zipOf({ 'a.json': 'plain' }, true));
    expect(new TextDecoder().decode(entries[0].data)).toBe('plain');
  });

  it('refuses something that is not a zip, so the caller can fall back', async () => {
    await expect(unzip(encoder.encode('not a zip at all, just text').buffer)).rejects.toThrow();
  });
});

const SOURCE = 'https://archiveofourown.org/users/Someone/bookmarks';

function record(id: string, position: number): string {
  return JSON.stringify({ source: SOURCE, position, id, title: `Work ${id}` });
}

function collection(name: string): string {
  return JSON.stringify({
    name,
    link: `https://archiveofourown.org/collections/${name}`,
    last_indexed: '2026-09-10T12:00:00+00:00',
    indexes: [{ indexed_on: '2026-09-10T12:00:00+00:00', title: name, work_ids: ['111'] }],
  });
}

/** a dropbox folder in memory, reached through the session's own methods */
class FakeDropbox {
  readonly status = signal<DropboxStatus>('signed-in');
  // the app folder, as the real session hands it out; paths below it are rooted at ''
  readonly folder = signal<DropboxFolder | null>({ id: '', path: '', name: 'FicFairy' });
  files: Record<string, string> = {};
  zips: string[] = [];
  downloads: string[] = [];
  zipFails = false;

  listFilesCalls: string[] = [];
  async listFiles(path: string, _recursive = true, found?: (n: number) => void): Promise<DropboxFile[]> {
    this.listFilesCalls.push(path);
    const files = Object.keys(this.files)
      .filter((p) => p.toLowerCase().startsWith(path.toLowerCase() + '/'))
      .map((p, i) => ({ name: p.split('/').pop()!, path: p, modified: i, changed: 1000 + i }));
    found?.(files.length);
    return files;
  }

  /** the files whose change times the library handed over, by path */
  noted = new Map<string, number | undefined>();
  noteChanged(files: readonly DropboxFile[]): void {
    for (const file of files) this.noted.set(file.path, file.changed);
  }

  /** the parallel listing, which the fake answers as one; with `hashes`, as Dropbox's content_hash */
  hashes = false;
  listings = 0;
  async listLibrary(path: string, found?: (n: number) => void): Promise<DropboxFile[]> {
    await this.gate;
    this.listings++;
    const files = await this.listFiles(path, true, found);
    return this.hashes ? files.map((f) => ({ ...f, hash: `h:${this.files[f.path]}` })) : files;
  }

  /** set to a promise to hold every listing - full or changes - until it settles */
  gate: Promise<void> | null = null;
  /** Dropbox refusing every cursor, as its `reset` does */
  refuseCursors = false;
  cursorsGiven = 0;
  changeRequests = 0;
  /** what the library held when each cursor was given, so its changes are worked out as Dropbox would */
  private atCursor = new Map<string, Record<string, string>>();

  async latestCursor(_root: string): Promise<string> {
    const cursor = `cursor-${++this.cursorsGiven}`;
    this.atCursor.set(cursor, { ...this.files });
    return cursor;
  }

  async changesSince(cursor: string): Promise<LibraryChanges | null> {
    await this.gate;
    this.changeRequests++;
    const then = this.atCursor.get(cursor);
    if (this.refuseCursors || !then) return null;
    const changes: LibraryChange[] = [];
    for (const path of Object.keys(then)) if (!(path in this.files)) changes.push({ removed: path.toLowerCase() });
    Object.keys(this.files).forEach((path, i) => {
      if (then[path] === this.files[path]) return;
      changes.push({
        file: {
          name: path.split('/').pop()!,
          path,
          modified: i,
          ...(this.hashes ? { hash: `h:${this.files[path]}` } : {}),
        },
      });
    });
    const next = `cursor-${++this.cursorsGiven}`;
    this.atCursor.set(next, { ...this.files });
    return { changes, cursor: next };
  }

  async downloadZip(path: string, received?: (bytes: number, total: number | null) => void): Promise<ArrayBuffer> {
    this.zips.push(path);
    if (this.zipFails) throw new Error('too_many_files');
    received?.(0, null);
    const inside: Record<string, string> = {};
    const folder = path.split('/').pop()!;
    for (const [p, text] of Object.entries(this.files)) {
      if (p.startsWith(path + '/')) inside[`${folder}/${p.slice(path.length + 1)}`] = text;
    }
    const zip = await zipOf(inside);
    // as dropbox does: building the zip as it sends it, so with no size to say
    received?.(zip.byteLength, null);
    return zip;
  }

  unreadable = new Set<string>();

  async download(path: string): Promise<Blob> {
    this.downloads.push(path);
    if (this.unreadable.has(path)) throw new Error('gone');
    return new Blob([this.files[path]]);
  }

  /** a library already set up, unless a test says otherwise */
  folders = new Set(['indexing', 'collections', 'images', 'runs', 'works']);
  made: string[] = [];

  async topLevel(): Promise<{ folders: string[]; files: string[] }> {
    const files = Object.keys(this.files)
      .filter((p) => p.split('/').length === 2)
      .map((p) => p.slice(1));
    return { folders: [...this.folders], files };
  }

  async makeFolder(name: string): Promise<void> {
    this.made.push(name);
    this.folders.add(name);
  }

  async moveInto(folder: string, names: string[], progress: (done: number) => void) {
    let moved = 0;
    const notMoved: string[] = [];
    for (const name of names) {
      if (this.files[`/${folder}/${name}`] !== undefined) {
        notMoved.push(name); // dropbox refuses to write over it
        continue;
      }
      this.files[`/${folder}/${name}`] = this.files[`/${name}`];
      delete this.files[`/${name}`];
      moved++;
    }
    progress(names.length);
    return { moved, notMoved };
  }
}

describe('Library, reading a Dropbox folder', () => {
  let dropbox: FakeDropbox;
  let library: Library;

  beforeEach(() => {
    dropbox = new FakeDropbox();
    TestBed.configureTestingModule({
      providers: [
        { provide: DropboxSession, useValue: dropbox },
        // no local folder in any of these
        { provide: FolderStore, useValue: { supported: () => true, recall: async () => null } },
      ],
    });
    library = TestBed.inject(Library);
  });

  // region the index kept in this browser

  it('opens the library again downloading only the index files Dropbox says have changed', async () => {
    dropbox.hashes = true;
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/indexing/222 Two.json': record('222', 2),
      '/indexing/333 Three.json': record('333', 3),
      '/collections/yuletide.json': collection('yuletide'),
    };
    await library.showDropbox();
    expect(dropbox.zips).toEqual(['/indexing', '/collections']);

    // a run rewrote one entry, added one and removed one
    dropbox.files['/indexing/222 Two.json'] = JSON.stringify({ source: SOURCE, position: 2, id: '222', title: 'Two, updated' });
    dropbox.files['/indexing/444 Four.json'] = record('444', 4);
    delete dropbox.files['/indexing/333 Three.json'];
    dropbox.zips = [];
    dropbox.downloads = [];
    await TestBed.inject(IndexCache).listing('|'); // let the save land
    await library.showDropbox();

    expect(dropbox.zips).toEqual([]);
    expect(dropbox.downloads.sort()).toEqual(['/indexing/222 Two.json', '/indexing/444 Four.json']);
    expect(library.data()?.works.map((w) => [w.id, w.title]).sort()).toEqual([
      ['111', 'Work 111'], ['222', 'Two, updated'], ['444', 'Work 444'],
    ]);
    expect(library.collections().map((c) => c.name)).toEqual(['yuletide']);
    expect(library.fromCache()).toBeNull();
    // the second open listed nothing: it asked Dropbox once for what changed since the first
    expect(dropbox.listings).toBe(1);
    expect(dropbox.changeRequests).toBe(1);
  });

  it('opens again with one request to Dropbox when nothing changed, and no listing at all', async () => {
    dropbox.hashes = true;
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/works/111 One - A 2024-01-01.html': 'x',
    };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');
    expect(dropbox.listings).toBe(1);
    expect(dropbox.cursorsGiven).toBe(1);

    dropbox.zips = [];
    dropbox.downloads = [];
    for (let open = 0; open < 3; open++) {
      await library.showDropbox();
      await TestBed.inject(IndexCache).listing('|');
    }

    expect(dropbox.listings).toBe(1);
    expect(dropbox.changeRequests).toBe(3);
    expect(dropbox.zips).toEqual([]);
    expect(dropbox.downloads).toEqual([]);
    expect(library.data()?.works.map((w) => w.id)).toEqual(['111']);
    expect(library.htmlFiles().get('111')).toBeTruthy();
  });

  it('takes in a work file added, and one removed, from the changes alone', async () => {
    dropbox.hashes = true;
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/indexing/222 Two.json': record('222', 2),
      '/works/111 One - A 2024-01-01.html': 'x',
    };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    delete dropbox.files['/works/111 One - A 2024-01-01.html'];
    dropbox.files['/works/222 Two - B 2024-01-01.pdf'] = 'y';
    await library.showDropbox();

    expect(dropbox.listings).toBe(1);
    expect(library.htmlFiles().get('111')).toBeUndefined();
    expect(library.pdfFiles().get('222')).toBeTruthy();
  });

  it('takes a renamed index file and a renamed work file from the changes, downloading neither', async () => {
    dropbox.hashes = true;
    dropbox.files = {
      '/indexing/111 One - A.json': record('111', 1),
      '/works/111 One - A.html': 'x',
    };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    // renamed in Dropbox: the old paths gone, the same contents at the new ones
    dropbox.files['/indexing/111 One, renamed - A.json'] = dropbox.files['/indexing/111 One - A.json'];
    delete dropbox.files['/indexing/111 One - A.json'];
    dropbox.files['/works/111 One - A 2024-01-01.html'] = dropbox.files['/works/111 One - A.html'];
    delete dropbox.files['/works/111 One - A.html'];
    dropbox.zips = [];
    dropbox.downloads = [];
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    expect(dropbox.zips).toEqual([]);
    expect(dropbox.downloads).toEqual([]);
    expect(library.data()?.works.map((w) => w.id)).toEqual(['111']);
    expect(library.htmlFiles().get('111')).toMatchObject({ dropboxPath: '/works/111 One - A 2024-01-01.html' });

    // kept under its new path: the next open takes it from this browser by path
    const kept = await TestBed.inject(IndexCache).files('|');
    expect([...kept.keys()]).toEqual(['/indexing/111 one, renamed - a.json']);
    await library.showDropbox();
    expect(dropbox.downloads).toEqual([]);
  });

  it('lists the whole library again when Dropbox no longer accepts the saved bookmark', async () => {
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    dropbox.refuseCursors = true;
    dropbox.files['/indexing/222 Two.json'] = record('222', 2);
    dropbox.downloads = [];
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    expect(dropbox.changeRequests).toBe(1);
    expect(dropbox.listings).toBe(2);
    // still only what changed is downloaded - the fingerprints do that, not the bookmark
    expect(dropbox.downloads).toEqual(['/indexing/222 Two.json']);
    expect(library.data()?.works.map((w) => w.id).sort()).toEqual(['111', '222']);

    // and the bookmark taken with that listing is the one asked from next time
    dropbox.refuseCursors = false;
    await library.showDropbox();
    expect(dropbox.listings).toBe(2);
    expect(dropbox.changeRequests).toBe(2);
  });

  it('a Refresh lists the whole library, never asking only for changes', async () => {
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    await library.refresh({ fresh: true });

    expect(dropbox.changeRequests).toBe(0);
    expect(dropbox.listings).toBe(2);
  });

  it('hands the session the change times of files it kept, which no listing this visit named', async () => {
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1), '/works/111 One 2024-01-01.html': '<p>x</p>' };
    await library.showDropbox();
    const kept = dropbox.noted;
    // a full listing notes its own times in the real session - the library hands over nothing
    expect(kept.size).toBe(0);
    await TestBed.inject(IndexCache).listing('|');

    await library.showDropbox();
    expect(dropbox.listings).toBe(1);
    expect(dropbox.noted.get('/works/111 One 2024-01-01.html')).toBeGreaterThanOrEqual(1000);
  });

  it('shows the cached copy at once while Dropbox is checked, holding it as not yet checked', async () => {
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    let release!: () => void;
    const listed = new Promise<void>((resolve) => (release = resolve));
    dropbox.gate = listed;
    dropbox.files['/indexing/222 Two.json'] = record('222', 2);
    const reading = library.showDropbox();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // the copy saved last time, while the check is still going
    expect(library.data()?.works.map((w) => w.id)).toEqual(['111']);
    expect(library.fromCache()).not.toBeNull();
    expect(library.loading()).toBe(true);

    release();
    await reading;
    expect(library.data()?.works.map((w) => w.id).sort()).toEqual(['111', '222']);
    expect(library.fromCache()).toBeNull();
    expect(library.lastRead()).not.toBeNull();
  });

  it('switching to this computer mid-check leaves nothing of Dropbox, and switching back opens from the cache', async () => {
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    dropbox.gate = held;
    const checking = library.showDropbox();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(library.fromCache()).not.toBeNull();

    // to this computer while Dropbox is still being checked
    await library.showLocal();
    expect(library.fromCache()).toBeNull();
    expect(library.data()).toBeNull();
    release();
    await checking;
    // the Dropbox check finishing late changes nothing on screen
    expect(library.data()).toBeNull();
    expect(library.fromCache()).toBeNull();

    // and back: the cached copy shows, and nothing has changed in Dropbox, so nothing is downloaded
    dropbox.gate = null;
    dropbox.zips = [];
    dropbox.downloads = [];
    await library.showDropbox();
    expect(library.data()?.works.map((w) => w.id)).toEqual(['111']);
    expect(dropbox.zips).toEqual([]);
    expect(dropbox.downloads).toEqual([]);
  });

  it('downloads the hidden-works file only when Dropbox says it changed', async () => {
    dropbox.hashes = true;
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/hidden-works.json': JSON.stringify({ hidden: [{ key: 'work:111', kind: 'work', id: '111' }] }),
    };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');
    expect(dropbox.downloads).toEqual(['/hidden-works.json']);
    const hiddenFirst = [...library.hidden().keys()];
    expect(hiddenFirst).toEqual(['work:111']);

    dropbox.downloads = [];
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');
    expect(dropbox.downloads).toEqual([]);
    expect([...library.hidden().keys()]).toEqual(hiddenFirst);

    dropbox.files['/hidden-works.json'] = JSON.stringify({ hidden: [] });
    await library.showDropbox();
    expect(dropbox.downloads).toEqual(['/hidden-works.json']);
  });

  it('keeps the copy on screen rather than reading the index again when nothing changed', async () => {
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1), '/works/111 One - A 2024-01-01.html': 'x' };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    dropbox.gate = held;
    // a copy added in works/ only - no index file changed
    dropbox.files['/works/111 One - A 2024-01-01.pdf'] = 'y';
    const checking = library.showDropbox();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const shown = library.data();
    expect(shown?.works.map((w) => w.id)).toEqual(['111']);

    release();
    await checking;
    // the same works, not read again - but the copies follow the listing
    expect(library.data()).toBe(shown);
    expect(library.fromCache()).toBeNull();
    expect(library.pdfFiles().get('111')).toBeTruthy();
  });

  it('hands its works/ listing to the Resolve issues check, once, so the check lists nothing', async () => {
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/works/111 One - A 2024-01-01.html': 'x',
      '/works/222 Two - B 2024-01-01.html': 'unindexed',
      '/works/old/333 Three - C.html': 'in a folder of its own',
    };
    await library.showDropbox();
    const store = library.store()!;
    expect(library.takeWorksListing(store)?.paths.sort()).toEqual([
      'works/111 One - A 2024-01-01.html', 'works/222 Two - B 2024-01-01.html',
    ]);
    // taken once: a later check lists works/ afresh
    expect(library.takeWorksListing(store)).toBeNull();

    await library.showDropbox();
    dropbox.listFilesCalls = [];
    const imports = TestBed.inject(LibraryImports);
    await imports.check();
    expect(dropbox.listFilesCalls).toEqual([]);
    expect(imports.found().map((w) => w.id)).toEqual(['222']);
  });

  it('the Refresh button downloads the whole index again and replaces the cached copy', async () => {
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1), '/indexing/222 Two.json': record('222', 2) };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');

    dropbox.zips = [];
    await library.refresh({ fresh: true });
    expect(dropbox.zips).toEqual(['/indexing']);

    // an ordinary refresh - after a run elsewhere - still takes what has not changed from the copy
    dropbox.zips = [];
    await TestBed.inject(IndexCache).listing('|');
    await library.refresh();
    expect(dropbox.zips).toEqual([]);
  });

  it('notes in the visit log what came from this browser\'s copy and what from Dropbox', async () => {
    const visit = TestBed.inject(VisitLog);
    // each line is '[YYYY-MM-DD HH:MM:SS UTC] text'; only what this test has not seen yet
    let seen = 0;
    const all = () => visit.text().split('\n').map((l) => l.replace(/^\[[^\]]*\] /, ''));
    const notes = () => all().slice(seen).filter((t) => t.startsWith('Dropbox check'));
    const clear = () => (seen = all().length);
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1), '/indexing/222 Two.json': record('222', 2) };
    await library.showDropbox();
    await TestBed.inject(IndexCache).listing('|');
    expect(notes()).toContain("Dropbox check: nothing in this browser's cache - the file listing and every index file will be fetched from Dropbox");
    expect(notes().some((n) => n.includes("0 from this browser's cache, 2 fetched from Dropbox (1 folder as a zip)"))).toBe(true);

    clear();
    dropbox.files['/indexing/222 Two.json'] = record('222', 3);
    await library.showDropbox();
    expect(notes().some((n) => n.startsWith("Dropbox check: this browser's cache is from"))).toBe(true);
    expect(notes()).toContain("Dropbox check: showing the list from this browser's cache (nothing fetched from Dropbox yet) while Dropbox is asked what changed");
    expect(notes().some((n) => n.includes("1 from this browser's cache, 1 fetched from Dropbox"))).toBe(true);

    clear();
    await library.refresh({ fresh: true });
    expect(notes()[0]).toContain('Refresh pressed');
    // the line is written once the browser has answered the save
    await vi.waitFor(() =>
      expect(notes().some((n) => n.startsWith("Dropbox check: done - this browser's cache replaced"))).toBe(true),
    );
  });

  it('notes in the visit log when the browser will not save its copy - full storage, say', async () => {
    const visit = TestBed.inject(VisitLog);
    const cache = TestBed.inject(IndexCache);
    let refused!: () => void;
    const answered = new Promise<void>((done) => (refused = done));
    vi.spyOn(cache, 'save').mockImplementation(async () => {
      queueMicrotask(refused);
      return { kept: 'refused', reason: 'QuotaExceededError' };
    });
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    await answered;
    await Promise.resolve();

    const said = visit.text();
    expect(said).toContain("Dropbox check: done - but this browser would not save its cache (QuotaExceededError;");
    expect(said).toContain('the next open fetches what it needs from Dropbox');
    expect(said).not.toContain("cache updated");
    // the library is on screen all the same
    expect(library.data()?.works.map((w) => w.id)).toEqual(['111']);
  });

  it('keeps nothing for files Dropbox gives no hash for, so they are always downloaded', async () => {
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    dropbox.zips = [];
    await library.showDropbox();
    expect(dropbox.zips).toEqual(['/indexing']);
  });

  it('downloads the whole index again once the cache is cleared', async () => {
    dropbox.hashes = true;
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    const cache = TestBed.inject(IndexCache);
    await cache.listing('|');
    expect(await cache.count()).toBe(1);

    await cache.clear();
    dropbox.zips = [];
    await library.showDropbox();
    expect(dropbox.zips).toEqual(['/indexing']);
  });

  // endregion

  it('reads the index in one zip per folder rather than a request per fic', async () => {
    dropbox.files = {
      '/indexing/222 Two.json': record('222', 2),
      '/indexing/111 One.json': record('111', 1),
      '/collections/yuletide.json': collection('yuletide'),
      '/works/111 One - A 2024-01-01.html': '<p>one</p>',
    };

    await library.showDropbox();

    expect(library.error()).toBe('');
    expect(library.data()?.works.map((w) => w.id).sort()).toEqual(['111', '222']);
    expect(library.collections().map((c) => c.name)).toEqual(['yuletide']);
    expect(dropbox.zips).toEqual(['/indexing', '/collections']);
    expect(dropbox.downloads).toEqual([]);
  });

  it('knows which works have a copy without downloading any of them', async () => {
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/works/111 One - A 2024-01-01.html': '<p>new</p>',
      '/works/old/111 One - A.html': '<p>old</p>',
      '/images/111 picture.html': 'not a work',
    };

    await library.showDropbox();

    const copy = library.htmlFiles().get('111') as DropboxCopy;
    // the newest version by the date in its name - not the one dropbox saw change last,
    // which here is the undated copy
    expect(copy.dropboxPath).toBe('/works/111 One - A 2024-01-01.html');
    expect(dropbox.downloads).toEqual([]);
  });

  it('looks for works in works/ and nowhere else', async () => {
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/elsewhere/111 One - A.html': '<p>not here</p>',
    };
    await library.showDropbox();
    expect(library.htmlFiles().has('111')).toBe(false);
  });

  it("finds each work's newest PDF, and hands it over as a PDF", async () => {
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/works/111 One - A 2024-01-01.pdf': 'old',
      '/works/111 One - A 2025-06-01.pdf': 'new',
      '/works/111 One - A 2025-06-01.html': '<p>one</p>',
    };
    await library.showDropbox();

    const copy = library.pdfFiles().get('111') as DropboxCopy;
    expect(copy.dropboxPath).toBe('/works/111 One - A 2025-06-01.pdf');
    const blob = await library.readCopy(copy, 'pdf');
    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toBe('new');
    // and the html is still the html
    expect((library.htmlFiles().get('111') as DropboxCopy).dropboxPath).toBe(
      '/works/111 One - A 2025-06-01.html');
  });

  it('fetches a work only when it is opened, as html so a tab shows it', async () => {
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/works/111 One - A.html': '<p>the fic</p>',
    };
    await library.showDropbox();

    const blob = await library.readCopy(library.htmlFiles().get('111')!);

    expect(blob.type).toBe('text/html');
    expect(await blob.text()).toBe('<p>the fic</p>');
    expect(dropbox.downloads).toEqual(['/works/111 One - A.html']);
  });

  it('reads the files one at a time when dropbox will not zip the folder', async () => {
    dropbox.zipFails = true;
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/indexing/222 Two.json': record('222', 2),
    };

    await library.showDropbox();

    expect(library.data()?.works.map((w) => w.id)).toEqual(['111', '222']);
    expect(dropbox.downloads.sort()).toEqual(['/indexing/111 One.json', '/indexing/222 Two.json']);
  });

  it('shows a folder with nothing in it yet as empty, not as a mistake', async () => {
    await library.showDropbox();
    expect(library.error()).toBe('');
    expect(library.data()).toBeNull();
    expect(library.loading()).toBe(false);
  });

  // region how far it has got

  /** every progress the library showed while it read, in order */
  function watchProgress(): (ReadProgress | null)[] {
    const seen: (ReadProgress | null)[] = [];
    const set = library.readProgress.set.bind(library.readProgress);
    library.readProgress.set = (value) => {
      seen.push(value);
      set(value);
    };
    return seen;
  }

  it('shows how far it has got: listing, each folder downloading, then reading every entry', async () => {
    dropbox.files = {
      '/indexing/222 Two.json': record('222', 2),
      '/indexing/111 One.json': record('111', 1),
      '/collections/yuletide.json': collection('yuletide'),
    };
    const seen = watchProgress();
    await library.showDropbox();

    const stages = seen.filter((p) => p).map((p) => p!.stage);
    expect([...new Set(stages)]).toEqual(['listing', 'downloading', 'reading']);
    expect(seen).toContainEqual({ stage: 'listing', found: 3 });
    // which folder of how many is known; the zip's size is not
    expect(seen).toContainEqual(expect.objectContaining({ stage: 'downloading', folder: 1, folders: 2, total: null }));
    expect(seen).toContainEqual(expect.objectContaining({ stage: 'downloading', folder: 2, folders: 2 }));
    expect(seen).toContainEqual({ stage: 'reading', done: 3, total: 3 });
    // and gone once the library is on screen
    expect(library.readProgress()).toBeNull();
  });

  it('counts every entry when a folder has to come one entry at a time, unreadable ones too', async () => {
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/indexing/222 Two.json': record('222', 2),
    };
    dropbox.zipFails = true;
    dropbox.unreadable.add('/indexing/222 Two.json');
    const seen = watchProgress();
    await library.showDropbox();

    expect(seen).toContainEqual({ stage: 'fetching', done: 0, total: 2 });
    expect(seen).toContainEqual({ stage: 'fetching', done: 2, total: 2 });
    expect(library.data()?.works.map((w) => w.id)).toEqual(['111']);
  });

  it('puts no number on what it cannot know, and a true one on what it can', () => {
    expect(describeReadProgress({ stage: 'listing', found: 0 })).toEqual({
      percent: null, caption: 'Listing your library in Dropbox...',
    });
    expect(describeReadProgress({ stage: 'listing', found: 2400 }).caption).toContain('2,400 files so far');

    const unsized = describeReadProgress({ stage: 'downloading', folder: 1, folders: 2, bytes: 3 * 1024 * 1024, total: null });
    expect(unsized.percent).toBeNull();
    expect(unsized.caption).toBe('Downloading the index from Dropbox (folder 1 of 2) - 3.0 MB so far');

    const sized = describeReadProgress({ stage: 'downloading', folder: 1, folders: 1, bytes: 512, total: 2048 });
    expect(sized).toEqual({ percent: 25, caption: 'Downloading the index from Dropbox - 512 bytes of 2 KB' });

    expect(describeReadProgress({ stage: 'reading', done: 1200, total: 3400 })).toEqual({
      percent: 35, caption: 'Reading the index - 1,200 of 3,400 entries',
    });
    expect(describeReadProgress({ stage: 'fetching', done: 3, total: 3 }).percent).toBe(100);
  });

  // endregion

  it('reads nothing without a session', async () => {
    dropbox.status.set('signed-out');
    dropbox.folder.set(null);
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    expect(library.data()).toBeNull();
    expect(dropbox.zips).toEqual([]);
  });

  it('says which folder could not be read', async () => {
    dropbox.listFiles = async () => {
      throw new Error('Dropbox asked us to slow down.');
    };
    await library.showDropbox();
    expect(library.error()).toContain('/Apps/FicFairy');
    expect(library.error()).toContain('slow down');
  });

  it('does not leave dropbox works on screen after switching back to this computer', async () => {
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    await library.showDropbox();
    library.folderName.set('downloads');

    await library.showLocal();

    expect(library.data()).toBeNull();
    // the local folder is still the one remembered
    expect(library.folderName()).toBe('downloads');
  });

  it('throws away a read that finishes after the library was switched', async () => {
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    const reading = library.showDropbox();
    await library.showLocal();
    await reading;
    expect(library.data()).toBeNull();
  });

  // region setting the library up

  it('makes the folders a library needs when some are missing, before reading it', async () => {
    dropbox.folders = new Set(['indexing']);
    const setup = TestBed.inject(LibrarySetup);
    const seen: string[] = [];
    const makeFolder = dropbox.makeFolder.bind(dropbox);
    // what the overlay would be showing while each folder is made
    dropbox.makeFolder = async (name) => {
      seen.push(setup.state());
      await makeFolder(name);
    };

    await library.showDropbox();

    expect(dropbox.made).toEqual(['collections', 'images', 'runs', 'works']);
    expect(seen.every((state) => state === 'working')).toBe(true);
    expect(setup.state()).toBe('idle');
  });

  it('covers the page while it checks, and uncovers it when nothing needs doing', async () => {
    const setup = TestBed.inject(LibrarySetup);
    let whileChecking = '';
    const topLevel = dropbox.topLevel.bind(dropbox);
    dropbox.topLevel = async () => {
      // the cover is up before the first question is even asked of the folder
      whileChecking = setup.state();
      return topLevel();
    };

    await library.showDropbox();

    expect(whileChecking).toBe('working');
    expect(dropbox.made).toEqual([]);
    expect(setup.state()).toBe('idle');
  });

  it('asks before moving works out of the top level, and moves them when told to', async () => {
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/111 One - A 2024-01-01.html': '<p>one</p>',
      '/222 Two - B.epub': 'two',
      '/notes.txt': 'not a work',
    };
    const setup = TestBed.inject(LibrarySetup);
    const showing = library.showDropbox();
    await until(() => setup.state() === 'asking');

    expect(setup.looseWorks()).toBe(2);
    setup.choose(true);
    await showing;

    expect(Object.keys(dropbox.files).sort()).toEqual([
      '/indexing/111 One.json',
      '/notes.txt',
      '/works/111 One - A 2024-01-01.html',
      '/works/222 Two - B.epub',
    ]);
    expect(library.htmlFiles().has('111')).toBe(true);
    expect(setup.state()).toBe('idle');
  });

  it('leaves the works where they are when told to, and asks again next time', async () => {
    dropbox.files = {
      '/indexing/111 One.json': record('111', 1),
      '/111 One - A.html': '<p>one</p>',
    };
    const setup = TestBed.inject(LibrarySetup);

    for (let visit = 0; visit < 2; visit++) {
      const showing = library.showDropbox();
      await until(() => setup.state() === 'asking');
      setup.choose(false);
      await showing;
    }

    expect(dropbox.files['/111 One - A.html']).toBe('<p>one</p>');
    // not looked for outside works/, so not paired with the fic
    expect(library.htmlFiles().has('111')).toBe(false);
  });

  it('says which works it could not move, and why that usually is', async () => {
    dropbox.files = {
      '/111 One - A.html': 'top level',
      '/works/111 One - A.html': 'already moved once',
      '/222 Two - B.html': 'two',
    };
    const setup = TestBed.inject(LibrarySetup);
    const showing = library.showDropbox();
    await until(() => setup.state() === 'asking');
    setup.choose(true);
    await showing;

    expect(setup.report()).toContain('Moved 1 of 2');
    expect(setup.report()).toContain('111 One - A.html');
    // the copy already in works/ is untouched
    expect(dropbox.files['/works/111 One - A.html']).toBe('already moved once');
  });

  // endregion
});

/** wait for something the page does across a few awaits */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !condition(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(condition()).toBe(true);
}

describe('Library, switching between a local folder and Dropbox', () => {
  it('does not let a slow local read land on top of the Dropbox library', async () => {
    // switch to this computer, then straight back to Dropbox before the local folder has
    // finished reading - which takes seconds on a large one
    let finishLocalRead: () => void = () => {};
    const localRead = new Promise<void>((resolve) => (finishLocalRead = resolve));
    const localFolder = {
      supported: () => true,
      recall: async () => ({ kind: 'directory', name: 'downloads' }),
      permission: async () => 'granted',
      topLevel: async () => ({
        folders: ['indexing', 'collections', 'images', 'runs', 'works'],
        files: [],
      }),
      read: async () => {
        await localRead;
        return [new File([record('999', 1)], '999 Local.json')];
      },
      readSubfolder: async () => [],
    };
    const dropbox = new FakeDropbox();
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    TestBed.configureTestingModule({
      providers: [
        { provide: DropboxSession, useValue: dropbox },
        { provide: FolderStore, useValue: localFolder },
      ],
    });
    const library = TestBed.inject(Library);

    const local = library.showLocal();
    await new Promise((r) => setTimeout(r, 0));
    await library.showDropbox();
    finishLocalRead();
    await local;

    expect(library.data()?.works.map((w) => w.id)).toEqual(['111']);
    expect(library.store()?.label).toBe('Dropbox app folder');
  });

  it('is not left reading when it switches away from a Dropbox read still going', async () => {
    // Dropbox, this computer, Dropbox, this computer: the last switch lands while Dropbox is
    // still reading, and this computer has nothing to read - it was left saying 'Reading
    // files...' for ever, because only the read it replaced would have said it was done
    let finishListing: () => void = () => {};
    const listing = new Promise<void>((resolve) => (finishListing = resolve));
    const dropbox = new FakeDropbox();
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    const list = dropbox.listFiles.bind(dropbox);
    dropbox.listFiles = (async (...args: Parameters<FakeDropbox['listFiles']>) => {
      await listing;
      return list(...args);
    }) as FakeDropbox['listFiles'];
    TestBed.configureTestingModule({
      providers: [
        { provide: DropboxSession, useValue: dropbox },
        { provide: FolderStore, useValue: { supported: () => true, recall: async () => null } },
      ],
    });
    const library = TestBed.inject(Library);

    const reading = library.showDropbox();
    await until(() => library.loading());
    await library.showLocal();
    expect(library.loading()).toBe(false);
    expect(library.readProgress()).toBeNull();

    finishListing();
    await reading;
    expect(library.loading()).toBe(false);
    expect(library.data()).toBeNull();
  });

  it('offers a read that Dropbox slowed down again - by hand, after the wait it asked for', async () => {
    const dropbox = new FakeDropbox();
    dropbox.files = { '/indexing/111 One.json': record('111', 1) };
    const list = dropbox.listFiles.bind(dropbox);
    let limited = true;
    dropbox.listFiles = (async (...args: Parameters<FakeDropbox['listFiles']>) => {
      if (limited) throw new DropboxError('Dropbox asked us to slow down - try again in 10 seconds.', 429, '', 10);
      return list(...args);
    }) as FakeDropbox['listFiles'];
    TestBed.configureTestingModule({
      providers: [
        { provide: DropboxSession, useValue: dropbox },
        { provide: FolderStore, useValue: { supported: () => true, recall: async () => null } },
      ],
    });
    const library = TestBed.inject(Library);

    await library.showDropbox();
    expect(library.error()).toContain('Dropbox asked us to slow down');
    expect(library.readFailure()).toEqual({ waitSeconds: 10, slowDown: true });

    limited = false;
    await library.retryRead();
    expect(library.error()).toBe('');
    expect(library.readFailure()).toBeNull();
    expect(library.data()?.works.map((w) => w.id)).toEqual(['111']);
  });

  it('leaves a Dropbox read\'s failure behind on switching to this computer', async () => {
    const dropbox = new FakeDropbox();
    dropbox.listFiles = (async () => {
      throw new DropboxError('Dropbox asked us to slow down.', 429);
    }) as unknown as FakeDropbox['listFiles'];
    TestBed.configureTestingModule({
      providers: [
        { provide: DropboxSession, useValue: dropbox },
        { provide: FolderStore, useValue: { supported: () => true, recall: async () => null } },
      ],
    });
    const library = TestBed.inject(Library);
    await library.showDropbox();
    expect(library.error()).toContain('Could not read');

    await library.showLocal();
    expect(library.error()).toBe('');
    expect(library.readFailure()).toBeNull();
  });
});
