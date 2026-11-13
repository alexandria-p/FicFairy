import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { LibraryFreshness } from './freshness';
import { ActiveRun, Jobs } from './jobs';
import { Library } from './library';
import { LibraryStore } from './library-store';

/** what each library was asked, to hold the Dropbox one to its one request a check */
let calls: { lists: number; reads: number; cursors: number; changes: number };
/** Dropbox refusing every cursor, as its `reset` does */
let refuseCursors = false;

/**
 * A library holding run records, by name, each with its status. `cursors` makes it a Dropbox
 * one: a cursor for runs/, and the records written since it, worked out as Dropbox would.
 */
function aStore(records: Record<string, string>, cursors = false): LibraryStore {
  const nothing = async () => {
    throw new Error('not used here');
  };
  const atCursor = new Map<string, Record<string, string>>();
  let given = 0;
  const cursorNow = () => {
    const cursor = `c${++given}`;
    atCursor.set(cursor, { ...records });
    return cursor;
  };
  return {
    label: 'a library',
    check: async () => undefined,
    list: async (path: string) => {
      calls.lists++;
      return path === 'runs' ? Object.keys(records).map((n) => `runs/${n}`) : [];
    },
    read: async (path: string) => {
      calls.reads++;
      const status = records[path.replace(/^runs\//, '')];
      return status === undefined ? null : JSON.stringify({ status });
    },
    write: nothing,
    size: nothing,
    delete: nothing,
    rename: nothing,
    mkdir: nothing,
    ...(cursors
      ? {
          changesCursor: async (path: string) => {
            expect(path).toBe('runs');
            calls.cursors++;
            return cursorNow();
          },
          changedSince: async (cursor: string) => {
            calls.changes++;
            const then = atCursor.get(cursor);
            if (refuseCursors || !then) return null;
            const changed = Object.keys(records)
              .filter((name) => then[name] !== records[name])
              .map((name) => `runs/${name}`);
            return { changed, cursor: cursorNow() };
          },
        }
      : {}),
  };
}

const RUN_A = '2026-11-01T100000-aaaaaaaa.json';
const RUN_B = '2026-11-03T090000-bbbbbbbb.json';

let records: Record<string, string>;
let store: LibraryStore;
let going: ActiveRun[];
let library: { lastRead: ReturnType<typeof signal<{ store: LibraryStore; at: number } | null>>; store: ReturnType<typeof signal<LibraryStore | null>> };
let freshness: LibraryFreshness;

function aRun(id: string): ActiveRun {
  return { id, action: 'bookmarks', actionName: 'Full scan', background: true,
    started: '2026-11-03T09:00:00', paused: false, step: '' };
}

async function read(): Promise<void> {
  library.lastRead.set({ store, at: Date.now() });
  TestBed.tick();
  // the snapshot is taken after a listing and the helper's answer
  await new Promise((done) => setTimeout(done, 0));
}

describe.each([
  ['a folder on this computer', false],
  ['Dropbox', true],
])('LibraryFreshness, for %s', (_kind, cursors) => {
  beforeEach(() => {
    calls = { lists: 0, reads: 0, cursors: 0, changes: 0 };
    refuseCursors = false;
    records = { [RUN_A]: 'success' };
    store = aStore(records, cursors);
    going = [];
    library = { lastRead: signal(null), store: signal(store) };
    const jobs = { activeRuns: signal<ActiveRun[]>([]), refreshActiveRuns: async () => going };
    TestBed.configureTestingModule({
      providers: [{ provide: Library, useValue: library }, { provide: Jobs, useValue: jobs }],
    });
    freshness = TestBed.inject(LibraryFreshness);
  });

  it('is not behind when no run has finished since the library was read', async () => {
    await read();
    await freshness.check();
    expect(freshness.behind()).toBe(false);
  });

  it('is behind once a run that started after the read has finished', async () => {
    await read();
    records[RUN_B] = 'success';
    await freshness.check();
    expect(freshness.behind()).toBe(true);
  });

  it('is behind once a run going at the read has finished, though its record was already there', async () => {
    records[RUN_B] = 'running';
    going = [aRun('bbbbbbbb-1111')];
    await read();

    await freshness.check();
    expect(freshness.behind()).toBe(false);

    records[RUN_B] = 'partial';
    await freshness.check();
    expect(freshness.behind()).toBe(true);
  });

  it('is behind only for a run that succeeded or partly succeeded, never one stopped or failed', async () => {
    await read();
    records[RUN_B] = 'stopped';
    records['2026-11-03T100000-cccccccc.json'] = 'failed';
    await freshness.check();
    expect(freshness.behind()).toBe(false);

    records['2026-11-03T110000-dddddddd.json'] = 'partial';
    await freshness.check();
    expect(freshness.behind()).toBe(true);
  });

  it('lets a refresh be asked for once each time it is behind', async () => {
    await read();
    expect(freshness.claimRefresh()).toBe(false);
    records[RUN_B] = 'success';
    await freshness.check();
    expect(freshness.claimRefresh()).toBe(true);
    // a refresh that failed took no new read: not started again
    expect(freshness.claimRefresh()).toBe(false);

    await read();
    records['2026-11-03T120000-eeeeeeee.json'] = 'success';
    await freshness.check();
    expect(freshness.claimRefresh()).toBe(true);
  });

  it('is not behind for a run still going', async () => {
    await read();
    records[RUN_B] = 'running';
    await freshness.check();
    expect(freshness.behind()).toBe(false);
  });

  it('never counts a run whose changes this page took in itself', async () => {
    await read();
    freshness.takenIn('bbbbbbbb-2222');
    records[RUN_B] = 'success';
    await freshness.check();
    expect(freshness.behind()).toBe(false);
  });

  it('is up to date again once the library is read again', async () => {
    await read();
    records[RUN_B] = 'success';
    await freshness.check();
    expect(freshness.behind()).toBe(true);

    await read();
    expect(freshness.behind()).toBe(false);
    await freshness.check();
    expect(freshness.behind()).toBe(false);
  });

  it('says nothing about a library no longer on screen', async () => {
    await read();
    records[RUN_B] = 'success';
    library.store.set(aStore({}));
    await freshness.check();
    expect(freshness.behind()).toBe(false);
  });

  it('in Dropbox lists nothing, and asks one question a check, reading only records written since', async () => {
    if (!cursors) return;
    await read();
    await freshness.check();
    await freshness.check();
    expect(calls).toEqual({ lists: 0, reads: 0, cursors: 1, changes: 2 });

    records[RUN_B] = 'success';
    await freshness.check();
    expect(freshness.behind()).toBe(true);
    expect(calls.lists).toBe(0);
    // RUN_A was there before, unchanged: never read
    expect(calls.reads).toBe(1);
  });

  it('in Dropbox counts as behind when Dropbox no longer accepts the cursor', async () => {
    if (!cursors) return;
    await read();
    refuseCursors = true;
    await freshness.check();
    expect(freshness.behind()).toBe(true);
  });
});
