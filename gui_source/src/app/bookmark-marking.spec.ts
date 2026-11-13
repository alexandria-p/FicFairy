import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Bookmark, flattenRecord, isBookmarkEntry } from './bookmarks';
import { Library, emptyCopies, markedBookmarked } from './library';
import { LibraryStore } from './library-store';
import { Jobs } from './jobs';
import { WorkList } from './work-list';

/**
 * Marking an entry as one of your bookmarks, or not, by hand from the Works tab: a new reading
 * in its index file that changes only `bookmarked` - the bookmark's notes, tags and date carry
 * on, and are only kept out of sight while it is not a bookmark.
 */

const DETAILS = {
  date_bookmarked: '02 Feb 2021',
  bookmark_notes: 'loved it',
  bookmark_tags: ['comfort'],
  bookmark_collections: [],
  bookmark_private: false,
  bookmark_rec: true,
};

function reading(id: string, extra: Record<string, unknown> = {}) {
  return {
    indexed_on: '2026-01-01T00:00:00+00:00',
    title: `Work ${id}`,
    authors: ['Writer'],
    date_updated: '01 Jan 2020',
    fandoms: [],
    warnings: [],
    tags: { rating: '', categories: [], relationships: [], characters: [], additional: [] },
    summary: '',
    chapters_published: 1,
    chapters_total: 1,
    ...DETAILS,
    ...extra,
  };
}

function file(id: string, extra: Record<string, unknown> = {}, root: Record<string, unknown> = {}) {
  const link = `https://archiveofourown.org/works/${id}`;
  return JSON.stringify({ id, link, ...root, last_indexed: '2026-01-01T00:00:00+00:00', indexes: [reading(id, extra)] });
}

/** a library held in memory, listing a folder's own files as a real store does */
class MemoryStore implements LibraryStore {
  readonly label = 'memory';
  readonly files = new Map<string, string>();
  async check() {}
  async list(path: string, recursive: boolean) {
    const prefix = path ? `${path}/` : '';
    return [...this.files.keys()].filter(
      (p) => p.startsWith(prefix) && (recursive || !p.slice(prefix.length).includes('/')),
    );
  }
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, body: Response) {
    const text = await body.text();
    this.files.set(path, text);
    return text.length;
  }
  async size() {
    return null;
  }
  async delete() {}
  async rename() {}
  async mkdir() {}
}

function entryOf(text: string): Bookmark {
  return flattenRecord(JSON.parse(text)) as Bookmark;
}

describe('a new reading saying whether it is a bookmark', () => {
  it('changes only bookmarked, and keeps the bookmark details', () => {
    const before = JSON.parse(file('1', { bookmarked: true }));
    const after = markedBookmarked(before, false, '2026-11-11T00:00:00.000Z');

    expect(after['indexes']).toHaveLength(2);
    const newest = (after['indexes'] as Record<string, unknown>[])[1];
    expect(newest['bookmarked']).toBe(false);
    expect(newest['indexed_on']).toBe('2026-11-11T00:00:00.000Z');
    expect(newest['bookmark_notes']).toBe('loved it');
    expect(newest['bookmark_tags']).toEqual(['comfort']);
    expect(after['last_indexed']).toBe('2026-11-11T00:00:00.000Z');
    // the earlier reading is history, left as it was
    expect((after['indexes'] as Record<string, unknown>[])[0]['bookmarked']).toBe(true);
  });

  it('changes it at the top of the file too, where a file says it there', () => {
    const before = { ...JSON.parse(file('1')), bookmarked: true };
    const after = markedBookmarked(before, false, 'now');
    expect(after['bookmarked']).toBe(false);
    expect(entryOf(JSON.stringify(after)).bookmarked).toBe(false);
  });

  it('sets the field where it is in a file from before the history', () => {
    expect(markedBookmarked({ id: '1', title: 'T', bookmark_notes: 'n' }, true, 'now')).toEqual({
      id: '1', title: 'T', bookmark_notes: 'n', bookmarked: true,
    });
  });
});

describe('Library.setBookmarked', () => {
  let library: Library;
  let store: MemoryStore;

  beforeEach(() => {
    library = TestBed.inject(Library);
    store = new MemoryStore();
    store.files.set('indexing/1 Work 1 - Writer.json', file('1'));
    store.files.set('indexing/2 Work 2 - Writer.json', file('2', { bookmarked: true }));
    store.files.set('indexing/external/3 Elsewhere - Writer.json',
      file('3', { bookmarked: false, bookmark_type: 'external work' }));
    store.files.set('indexing/series/4 A Series - Writer.json',
      file('4', { bookmarked: false, bookmark_type: 'series bookmark' }));
    library.store.set(store);
    const entries = [...store.files.values()].map(entryOf);
    (library as unknown as { publish(w: Bookmark[], c: [], k: ReturnType<typeof emptyCopies>): void })
      .publish(entries, [], emptyCopies());
  });

  const shown = (id: string) => library.data()!.works.find((w) => w.id === id);

  it('marks works, external works and series in their own folders, and the listing takes it in', async () => {
    // a series you have not bookmarked is not listed on its own, so these come from the files
    const entries = [
      'indexing/1 Work 1 - Writer.json',
      'indexing/external/3 Elsewhere - Writer.json',
      'indexing/series/4 A Series - Writer.json',
    ].map((path) => entryOf(store.files.get(path)!));
    expect(entries.map(isBookmarkEntry)).toEqual([false, false, false]);

    expect(await library.setBookmarked(entries, true)).toBe(3);

    for (const [path, id] of [
      ['indexing/1 Work 1 - Writer.json', '1'],
      ['indexing/external/3 Elsewhere - Writer.json', '3'],
      ['indexing/series/4 A Series - Writer.json', '4'],
    ]) {
      const entry = entryOf(store.files.get(path)!);
      expect(entry.bookmarked, id).toBe(true);
      expect(entry.bookmark_notes, id).toBe('loved it');
      expect(shown(id)!.bookmarked, id).toBe(true);
    }
  });

  it('unmarks a bookmark, keeping its details in the file', async () => {
    await library.setBookmarked(shown('2')!, false);
    const entry = entryOf(store.files.get('indexing/2 Work 2 - Writer.json')!);
    expect(entry.bookmarked).toBe(false);
    expect(entry.bookmark_notes).toBe('loved it');
    expect(entry.date_bookmarked).toBe('02 Feb 2021');
  });

  it('writes nothing for an entry already as asked', async () => {
    const before = store.files.get('indexing/2 Work 2 - Writer.json');
    expect(await library.setBookmarked(shown('2')!, true)).toBe(0);
    expect(store.files.get('indexing/2 Work 2 - Writer.json')).toBe(before);
  });

  it('finds the file by its number when the title has changed since', async () => {
    const renamed = { ...shown('1')!, title: 'A New Title' };
    await library.setBookmarked(renamed, true);
    expect(entryOf(store.files.get('indexing/1 Work 1 - Writer.json')!).bookmarked).toBe(true);
    expect([...store.files.keys()].filter((p) => p.startsWith('indexing/1 '))).toHaveLength(1);
  });
});

describe('marking from the Works tab', () => {
  let library: Library;
  let store: MemoryStore;
  let fixture: ComponentFixture<WorkList>;
  let element: HTMLElement;

  async function settle() {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
  }

  async function listing(works: Bookmark[]) {
    fixture = TestBed.createComponent(WorkList);
    fixture.componentRef.setInput('works', works);
    fixture.componentRef.setInput('selectable', true);
    await settle();
    element = fixture.nativeElement as HTMLElement;
  }

  function blurb(title: string): HTMLElement {
    return [...element.querySelectorAll<HTMLElement>('li.blurb')].find(
      (li) => li.querySelector('a.title')?.textContent?.trim() === title,
    )!;
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  }

  async function tickAll() {
    for (const box of element.querySelectorAll<HTMLInputElement>('li.blurb input[type="checkbox"]')) {
      box.click();
      await settle();
    }
  }

  beforeEach(() => {
    localStorage.clear();
    library = TestBed.inject(Library);
    store = new MemoryStore();
    library.store.set(store);
  });

  it("shows a bookmark's details only while it is one", async () => {
    await listing([entryOf(file('1', { bookmarked: true })), entryOf(file('2', { bookmarked: false }))]);
    expect(blurb('Work 1').querySelector('.user')?.textContent).toContain('loved it');
    expect(blurb('Work 2').querySelector('.user')).toBeNull();
  });

  it('offers Mark and Unmark for a mix ticked, each for the ones it names', async () => {
    await listing([entryOf(file('1', { bookmarked: true })), entryOf(file('2'))]);
    await tickAll();
    expect(button('Mark all as bookmarks')).toBeTruthy();
    expect(button('Unmark all as bookmarks')).toBeTruthy();
  });

  it('marks the ticked works and says how many', async () => {
    store.files.set('indexing/2 Work 2 - Writer.json', file('2'));
    store.files.set('indexing/5 Work 5 - Writer.json', file('5', { bookmarked: false }));
    const works = [entryOf(file('2')), entryOf(file('5', { bookmarked: false }))];
    (library as unknown as { publish(w: Bookmark[], c: [], k: ReturnType<typeof emptyCopies>): void })
      .publish(works, [], emptyCopies());
    await listing(works);
    await tickAll();

    button('Mark all as bookmarks')!.click();
    await settle();

    expect(entryOf(store.files.get('indexing/2 Work 2 - Writer.json')!).bookmarked).toBe(true);
    expect(entryOf(store.files.get('indexing/5 Work 5 - Writer.json')!).bookmarked).toBe(true);
    expect(element.querySelector('.selection-outcome')?.textContent).toContain('Marked 2 works as bookmarks');
  });

  it('holds marking while a run is going, saying why', async () => {
    TestBed.inject(Jobs).activeRuns.set([{ id: 'r' } as never]);
    await listing([entryOf(file('2'))]);
    await tickAll();
    const mark = button('Mark as bookmark')!;
    expect(mark.disabled).toBe(true);
    expect(mark.title).toContain('active run');
  });
});

describe('a work known only by its number', () => {
  it("offers to download it now, asking for the single-fic run with that number", async () => {
    const fixture = TestBed.createComponent(WorkList);
    fixture.componentRef.setInput('works', [{ ...entryOf(file('7654321')), placeholder: true } as Bookmark]);
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.not-indexed')?.textContent).toContain('Not in your index, so only its work number is known');
    (element.querySelector('button.download-now') as HTMLButtonElement).click();
    expect(TestBed.inject(Jobs).fetchWorksAsked()).toEqual(['7654321']);
  });
});

describe('downloading or updating from the Works tab', () => {
  let fixture: ComponentFixture<WorkList>;
  let element: HTMLElement;

  async function settle() {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
  }

  async function listing(works: Bookmark[]) {
    TestBed.inject(Library).store.set(new MemoryStore());
    fixture = TestBed.createComponent(WorkList);
    fixture.componentRef.setInput('works', works);
    fixture.componentRef.setInput('selectable', true);
    await settle();
    element = fixture.nativeElement as HTMLElement;
  }

  async function menuOf(title: string): Promise<HTMLElement> {
    const entry = [...element.querySelectorAll<HTMLElement>('li.blurb')].find(
      (li) => li.querySelector('a.title')?.textContent?.trim() === title,
    )!;
    (entry.querySelector('button.entry-menu-toggle') as HTMLButtonElement).click();
    await settle();
    return entry.querySelector('.entry-menu-items') as HTMLElement;
  }

  const work = (id: string, extra: Record<string, unknown> = {}) => entryOf(file(id, { bookmarked: true, ...extra }));
  const series = work('500', { bookmark_type: 'series bookmark', title: 'Work 500', work_ids: ['11', '12'] });
  const external = work('600', { bookmark_type: 'external work', title: 'Work 600' });

  beforeEach(() => localStorage.clear());

  it("asks for a work's own number from its menu", async () => {
    await listing([work('11')]);
    ((await menuOf('Work 11')).querySelector('button.fetch-now') as HTMLButtonElement).click();
    expect(TestBed.inject(Jobs).fetchWorksAsked()).toEqual(['11']);
  });

  it('offers no download/update item for a series or an external work', async () => {
    await listing([series, external]);
    expect((await menuOf('Work 500')).querySelector('button.fetch-now')).toBeNull();
    expect((await menuOf('Work 600')).querySelector('button.fetch-now')).toBeNull();
  });

  it('downloads every ticked work, leaving series and external works out', async () => {
    await listing([work('11'), series, external]);
    for (const box of element.querySelectorAll<HTMLInputElement>('li.blurb input[type="checkbox"]')) {
      box.click();
      await settle();
    }
    const bar = element.querySelector('button.fetch-ticked') as HTMLButtonElement;
    expect(bar.textContent?.trim()).toBe('Download/update 1 work now');
    expect(bar.title).toContain('the series is left out');
    expect(bar.title).toContain('the external work is left out');
    bar.click();
    expect(TestBed.inject(Jobs).fetchWorksAsked()).toEqual(['11']);
  });

  it('says the actions are unavailable while a run is going', async () => {
    TestBed.inject(Jobs).activeRuns.set([{ id: 'r' } as never]);
    await listing([work('11')]);
    const item = (await menuOf('Work 11')).querySelector('button.fetch-now') as HTMLButtonElement;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.title).toBe('Unavailable while a run is already in progress');
    item.click();
    expect(TestBed.inject(Jobs).fetchWorksAsked()).toBeNull();

    (element.querySelector('li.blurb input[type="checkbox"]') as HTMLInputElement).click();
    await settle();
    const bar = element.querySelector('button.fetch-ticked') as HTMLButtonElement;
    expect(bar.disabled).toBe(true);
    expect(bar.title).toBe('Unavailable while a run is already in progress');
  });
});
