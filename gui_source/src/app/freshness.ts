import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Jobs } from './jobs';
import { Library } from './library';
import type { LibraryStore } from './library-store';

/** the least time between two checks a page makes on its own (a tab coming back into view) */
export const CHECK_EVERY_MS = 20_000;

/**
 * The endings that bring the list up to date on their own: a run that got everything, or
 * some of it. A stopped, failed or abandoned run is left until the next read - at the user's
 * request, the list only refreshes itself for a run that did its work.
 */
export const REFRESHING_STATUSES = ['success', 'partial'];

/**
 * Whether a run has finished, as a success or a partial success, since the library on screen
 * was read, with changes this page did not take in - a background run (the helper writes to Dropbox itself), or a run from
 * another tab or device on the same library.
 *
 * **No clocks are compared.** A hosted helper's clock and the browser's need not agree, and a
 * local and a hosted helper can share one Dropbox library. So a read notes which run records
 * the library held (`runs/`, one listing) and which runs the helper said were going. A check
 * lists `runs/` again and reads only the records that are new since, or were going then -
 * usually none - and the library is behind once one of them has finished. A run whose
 * changes this page took in itself (`takenIn`, from the run window's `refreshAfterRun`) never
 * counts: those are already on screen.
 *
 * **In Dropbox nothing is listed at all**: the read takes a cursor for `runs/` alone
 * (`LibraryStore.changesCursor`, one request) and a check asks only which records were written
 * since (`changedSince`, one request, usually answering none). A run going at the read rewrites
 * its record when it ends, so it is among those - the helper need not be asked what was going.
 * A record that could not be read is asked about again next time; a cursor Dropbox refuses
 * counts as behind, since what changed can no longer be told - the refresh that follows is
 * itself only a request for the library's changes.
 */
@Injectable({ providedIn: 'root' })
export class LibraryFreshness {
  private readonly library = inject(Library);
  private readonly jobs = inject(Jobs);

  /** a run has finished since the library was read, and the listing does not show it */
  readonly behind = signal(false);

  private snapshot: {
    store: LibraryStore;
    names: Set<string>;
    going: Set<string>;
    /** Dropbox's cursor for runs/, where the store gives one: the check then lists nothing */
    cursor?: string;
  } | null = null;
  /** records a check could not read, under a cursor already past them - asked about again */
  private readonly unread = new Set<string>();
  private readonly taken = new Set<string>();
  /** records already read and found to have ended some other way - not read again */
  private readonly settled = new Set<string>();
  /** the refresh for this time behind has been asked for - one per read, so a failed one is not tried for ever */
  private refreshClaimed = false;
  private checking = false;
  private lastCheck = 0;

  constructor() {
    effect(() => {
      const read = this.library.lastRead();
      untracked(() => void this.noteRead(read?.store ?? null));
    });
  }

  /** a run whose every change went through this page and is on screen already */
  takenIn(jobId: string | null | undefined): void {
    if (jobId) this.taken.add(shortId(jobId));
  }

  /**
   * Look again. `soon` is a check the page made on its own (a tab coming back), at most one
   * per CHECK_EVERY_MS; a run just seen to end always looks.
   */
  async check(soon = false): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || this.checking || this.behind()) return;
    if (soon && Date.now() - this.lastCheck < CHECK_EVERY_MS) return;
    if (snapshot.store !== this.library.store()) return;
    this.checking = true;
    this.lastCheck = Date.now();
    try {
      let fresh: string[];
      if (snapshot.cursor && snapshot.store.changedSince) {
        const since = await snapshot.store.changedSince(snapshot.cursor);
        if (snapshot !== this.snapshot) return;
        if (!since) {
          this.behind.set(true);
          return;
        }
        snapshot.cursor = since.cursor;
        fresh = [...new Set([...this.unread, ...since.changed.map(nameOf).filter(isRecordName)])];
      } else {
        fresh = (await runNames(snapshot.store)).filter(
          (name) => !snapshot.names.has(name) || snapshot.going.has(idOf(name)),
        );
      }
      const candidates = fresh
        .filter((name) => !this.taken.has(idOf(name)) && !this.settled.has(name))
        .sort()
        .reverse();
      for (const name of candidates) {
        if (snapshot !== this.snapshot) return;
        const status = await statusOf(snapshot.store, `runs/${name}`);
        this.unread.delete(name);
        if (!status) this.unread.add(name);
        if (REFRESHING_STATUSES.includes(status)) {
          if (snapshot === this.snapshot) this.behind.set(true);
          return;
        }
        // ended, but not in a way that refreshes the list: known, and never read again
        if (status && status !== 'running') this.settled.add(name);
      }
    } catch {
      // a library that will not list says nothing about whether it is behind
    } finally {
      this.checking = false;
    }
  }

  /**
   * Whether the caller may refresh now: true once each time the list is behind, so a
   * refresh that fails (and so takes no new read) is not started again and again.
   */
  claimRefresh(): boolean {
    if (!this.behind() || this.refreshClaimed) return false;
    this.refreshClaimed = true;
    return true;
  }

  private async noteRead(store: LibraryStore | null): Promise<void> {
    this.behind.set(false);
    this.refreshClaimed = false;
    this.settled.clear();
    this.unread.clear();
    this.snapshot = null;
    if (!store) return;
    if (store.changesCursor) {
      try {
        const cursor = await store.changesCursor('runs');
        if (this.library.lastRead()?.store !== store) return;
        this.snapshot = { store, names: new Set(), going: new Set(), cursor };
        return;
      } catch {
        // no cursor (runs/ not made yet, say): look the way a folder on this computer is looked at
      }
    }
    try {
      const [names, going] = await Promise.all([
        runNames(store),
        this.jobs.refreshActiveRuns(),
      ]);
      // a later read, or another library, has taken over meanwhile
      if (this.library.lastRead()?.store !== store) return;
      this.snapshot = {
        store,
        names: new Set(names),
        going: new Set((going ?? this.jobs.activeRuns()).map((run) => shortId(run.id))),
      };
    } catch {
      this.snapshot = null;
    }
  }
}

/** the record files in runs/, by name alone - named `<started>-<first 8 of the run id>.json` */
async function runNames(store: LibraryStore): Promise<string[]> {
  return (await store.list('runs', false)).map(nameOf).filter(isRecordName);
}

function nameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function isRecordName(name: string): boolean {
  return /\.json$/i.test(name);
}

function idOf(name: string): string {
  return name.replace(/\.json$/i, '').split('-').pop() ?? '';
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

async function statusOf(store: LibraryStore, path: string): Promise<string> {
  try {
    const record = JSON.parse((await store.read(path)) ?? '');
    return typeof record?.status === 'string' ? record.status : '';
  } catch {
    return '';
  }
}
