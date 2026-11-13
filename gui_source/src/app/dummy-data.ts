/**
 * Dummy data: debug mode's stand-in for a real library, and the library guest mode shows.
 *
 * With debug mode on, the DEBUG tab can switch the page to a made-up library - works,
 * collections and run history - instead of reading the real one; a guest always sees it. **It is
 * the README screenshots' library** (`dummy-library.json`, which `make-screenshots.js` reads
 * too), so the tour, debug mode and the README all show the same works. Each storage choice gets
 * its own copy of it, so what is changed under one is not seen under the other.
 *
 * **Nothing real is touched.** Each copy is a `MemoryStore`, built once and kept while dummy
 * data stays on, so hiding a work or making a collection shows as it would and is forgotten when
 * dummy data is turned off. Runs are held while it is on: a run would reach AO3 for real and
 * write its results into a library that does not exist.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { DebugMode } from './debug-mode';
import { HelperConnection } from './helper-connection';
import { MemoryStore } from './memory-store';
import { safeGet, safeRemove, safeSet } from './storage';

export const DUMMY_DATA_KEY = 'ao3.dummyData';

export type DummyKind = 'local' | 'dropbox';

@Injectable({ providedIn: 'root' })
export class DummyData {
  private readonly debug = inject(DebugMode);
  private readonly helper = inject(HelperConnection);
  /** what User settings says - only in force while debug mode is on (`active`) */
  readonly chosen = signal(safeGet(DUMMY_DATA_KEY) === 'on');
  /** a guest always sees it (`guest.ts`): the tour is of a library that is nobody's */
  readonly active = computed(() => this.helper.guest() || (this.debug.on() && this.chosen()));
  private readonly built = new Map<DummyKind, Promise<MemoryStore>>();

  set(on: boolean): void {
    this.chosen.set(on);
    if (on) safeSet(DUMMY_DATA_KEY, 'on');
    else {
      safeRemove(DUMMY_DATA_KEY);
      // what was changed in them goes with them
      this.built.clear();
    }
  }

  /** the dummy library for one storage choice, the same one each time while dummy data is on */
  library(kind: DummyKind): Promise<MemoryStore> {
    let store = this.built.get(kind);
    if (!store) {
      store = dummyLibrary(kind);
      this.built.set(kind, store);
    }
    return store;
  }
}

/** where each file of the library was last changed: a fixed moment, so it is the same every time */
const NOW = Date.UTC(2026, 10, 5, 10, 0);
const DAY = 24 * 60 * 60 * 1000;

interface LibraryFile {
  works: { indexFile: string; files: string[]; entry: { indexes: { title: string; date_updated: string }[] } }[];
  collections: { name: string }[];
  customCollections: { name: string }[];
  runs: { file: string; run: { started?: string } }[];
}

/**
 * The dummy library, for one storage choice: index, works, collections and runs. Its data is
 * loaded only when it is first wanted - a guest or debug mode - so the page everyone else opens
 * does not carry it.
 */
export async function dummyLibrary(kind: DummyKind): Promise<MemoryStore> {
  const LIBRARY = (await import('./dummy-library.json')).default as unknown as LibraryFile;
  const store = new MemoryStore([], {}, kind === 'local' ? 'dummy library - this computer' : 'dummy library - Dropbox');
  const put = (path: string, value: unknown, changed: number) => {
    store.files.set(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    store.changed.set(path, changed);
  };
  LIBRARY.works.forEach((work, n) => {
    put(`indexing/${work.indexFile}`, work.entry, NOW);
    const reading = work.entry.indexes[0];
    const updated = Date.parse(reading.date_updated) || NOW - n * DAY;
    for (const file of work.files) {
      const format = file.slice(file.lastIndexOf('.') + 1);
      put(
        `works/${file}`,
        format === 'html' ? workHtml({ title: reading.title, n }) : `A made-up ${format} of ${reading.title}`,
        updated,
      );
    }
  });
  for (const collection of LIBRARY.collections) put(`collections/${collection.name}.json`, collection, NOW);
  for (const collection of LIBRARY.customCollections) put(`collections/custom/${collection.name}.json`, collection, NOW);
  for (const { file, run } of LIBRARY.runs) put(`runs/${file}`, run, Date.parse(run.started ?? '') || NOW);
  return store;
}

/** the text of every dummy work: lorem ipsum, and nothing that reads as anybody's story */
const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
];

/** a dummy work's html: its title, then lorem ipsum - so opening one shows it opened, and nothing more */
function workHtml(work: { title: string; n: number }): string {
  const paragraphs = Array.from({ length: 6 }, (_, p) => `<p>${LOREM[(work.n + p) % LOREM.length]}</p>`).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${work.title}</title>
<style>body{font:16px/1.6 Georgia,serif;max-width:40em;margin:2em auto;padding:0 1em;color:#222}</style></head>
<body>
<h1>${work.title}</h1>
${paragraphs}
</body></html>`;
}
