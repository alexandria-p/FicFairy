import { Injectable, computed, inject, signal } from '@angular/core';
import { HelperConnection } from './helper-connection';
import { safeGet, safeSet } from './storage';

/** where the library lives: a folder on this computer, or a folder in Dropbox */
export type StorageMode = 'local' | 'dropbox';

const MODE_KEY = 'ao3.storageMode';

/**
 * Which of the two the page is working with.
 *
 * Kept in localStorage because it is a per-browser convenience: losing it only means the
 * page opens on the local folder, and both choices stay remembered underneath - switching
 * back and forth never forgets a folder or signs anybody out.
 *
 * **A guest is always on This computer** (`guest.ts`): the tour is of the one dummy library,
 * and the switch is locked. What this browser chose is kept, and comes back with guest mode's end.
 */
@Injectable({ providedIn: 'root' })
export class StorageChoice {
  private readonly helper = inject(HelperConnection);
  /** what this browser chose */
  readonly chosen = signal<StorageMode>(safeGet(MODE_KEY) === 'dropbox' ? 'dropbox' : 'local');
  /** what is in use: the choice, or This computer for a guest */
  readonly mode = computed<StorageMode>(() => (this.helper.guest() ? 'local' : this.chosen()));

  set(mode: StorageMode): void {
    if (this.helper.guest()) return;
    this.chosen.set(mode);
    safeSet(MODE_KEY, mode);
  }
}
