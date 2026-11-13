/**
 * A copy of a Dropbox library's index kept in this browser, so opening the library does not
 * download every index file again.
 *
 * What is kept, per library (the Dropbox account and the folder): the last listing of the
 * library - every file's path, when it changed and Dropbox's `content_hash` - the text of every
 * index file (`indexing/`, `collections/`), each with the hash it had when it was downloaded, and
 * the hidden-works file. Dropbox stays the only source of truth: every read lists the library
 * again and downloads only the index files whose hash is not the one kept (`Library.showDropbox`),
 * so the copy here cannot fall behind - it only saves the downloads. A file with no hash is never
 * taken from here.
 *
 * It lives in its own IndexedDB database, never the one the folder handle and the Dropbox
 * sign-in are kept in, so clearing it (User settings' *Clear cache*) can never sign anyone out.
 * Where IndexedDB is not there (a private window that blocks it, the test runner) it is kept in
 * memory for the visit, which is still right - just not kept.
 */

import { Injectable } from '@angular/core';
import type { DropboxFile } from './dropbox';

const DB_NAME = 'ficfairy-index-cache';
const LISTINGS = 'listings';
const FILES = 'files';

/** what a library looked like when it was last read */
/** how a save went: kept in this browser, only in memory for this visit (no IndexedDB), or refused */
export type CacheSaved = { kept: 'browser' } | { kept: 'memory' } | { kept: 'refused'; reason: string };

export interface CachedListing {
  files: DropboxFile[];
  /** the hidden-works file's text, '' when the library has none */
  hidden: string;
  /** when it was read, in ms - what *List refreshed* says while the cached copy is shown */
  savedAt: number;
  /**
   * Dropbox's cursor for the listing, as it stood when `files` was taken: the next open asks
   * Dropbox only for what changed since (`DropboxSession.changesSince`) rather than listing the
   * library again. Absent on a copy saved before cursors were kept, or when Dropbox gave none.
   */
  cursor?: string;
}

/** one index file as it was downloaded */
export interface CachedIndexFile {
  /** its path in Dropbox, as Dropbox writes it */
  path: string;
  hash: string;
  text: string;
}

interface FileRow extends CachedIndexFile {
  library: string;
}

function rowKey(library: string, path: string): string {
  return `${library}\n${path}`;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LISTINGS);
      request.result.createObjectStore(FILES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

@Injectable({ providedIn: 'root' })
export class IndexCache {
  /** where IndexedDB is not there: kept for this visit only */
  private readonly memoryListings = new Map<string, CachedListing>();
  private readonly memoryFiles = new Map<string, FileRow>();
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> | null {
    if (!hasIndexedDb()) return null;
    this.db ??= openDb().catch((error) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  /** the library as it was last read, or null - never an error: no cache is a full read */
  async listing(library: string): Promise<CachedListing | null> {
    try {
      const db = this.open();
      if (!db) return this.memoryListings.get(library) ?? null;
      const store = (await db).transaction(LISTINGS, 'readonly').objectStore(LISTINGS);
      return ((await result(store.get(library))) as CachedListing | undefined) ?? null;
    } catch {
      return null;
    }
  }

  /** every index file kept for the library, by its path lower-cased */
  async files(library: string): Promise<Map<string, CachedIndexFile>> {
    const out = new Map<string, CachedIndexFile>();
    try {
      const db = this.open();
      const rows: FileRow[] = db
        ? ((await result(
            (await db)
              .transaction(FILES, 'readonly')
              .objectStore(FILES)
              .getAll(IDBKeyRange.bound(rowKey(library, ''), rowKey(library, '￿'))),
          )) as FileRow[])
        : [...this.memoryFiles.values()].filter((row) => row.library === library);
      for (const row of rows) out.set(row.path.toLowerCase(), { path: row.path, hash: row.hash, text: row.text });
    } catch {
      out.clear();
    }
    return out;
  }

  /**
   * Keep what a read found: its listing, the index files it downloaded (`put`), and none of the
   * files no longer there (`remove`, lower-cased paths). One transaction, so a read cut short
   * leaves the cache as it was rather than half of each.
   */
  async save(library: string, listing: CachedListing, put: CachedIndexFile[], remove: string[]): Promise<CacheSaved> {
    try {
      const db = this.open();
      if (!db) {
        this.memoryListings.set(library, listing);
        for (const path of remove) this.memoryFiles.delete(rowKey(library, path));
        for (const file of put) this.memoryFiles.set(rowKey(library, file.path.toLowerCase()), { ...file, library });
        return { kept: 'memory' };
      }
      const transaction = (await db).transaction([LISTINGS, FILES], 'readwrite');
      transaction.objectStore(LISTINGS).put(listing, library);
      const files = transaction.objectStore(FILES);
      for (const path of remove) files.delete(rowKey(library, path));
      for (const file of put) files.put({ ...file, library } satisfies FileRow, rowKey(library, file.path.toLowerCase()));
      await done(transaction);
      return { kept: 'browser' };
    } catch (error) {
      // not kept: the next read downloads what it needs, as it would with no cache at all - and
      // the copy saved before stands, since one transaction is all or nothing. Only the error's
      // name is passed on (QuotaExceededError for a full store): never a message, which could
      // carry a path
      return { kept: 'refused', reason: error instanceof Error || error instanceof DOMException ? error.name : 'unknown' };
    }
  }

  /** forget every library's cached copy - the next read of each downloads its index again */
  async clear(): Promise<void> {
    this.memoryListings.clear();
    this.memoryFiles.clear();
    try {
      const db = this.open();
      if (!db) return;
      const transaction = (await db).transaction([LISTINGS, FILES], 'readwrite');
      transaction.objectStore(LISTINGS).clear();
      transaction.objectStore(FILES).clear();
      await done(transaction);
    } catch {
      // nothing more to clear
    }
  }

  /** how many index files are kept, across every library - for User settings */
  async count(): Promise<number> {
    try {
      const db = this.open();
      if (!db) return this.memoryFiles.size;
      return await result((await db).transaction(FILES, 'readonly').objectStore(FILES).count());
    } catch {
      return 0;
    }
  }
}
