/**
 * What this device and browser can do with a library in a folder.
 *
 * Writing to a folder you pick needs the File System Access API, which only Chromium browsers
 * on a computer have (Chrome, Edge, Opera, Arc). Elsewhere - Firefox, Safari, any phone or
 * tablet - a folder can only be handed over as a list of files, to read: nothing can be written
 * back, so no run can work on it. Dropbox needs none of this.
 *
 * So with a library from this device open on one of those (`blocked`), every run button and
 * History's Retry are shown held, saying why on hover (`title`), and a click explains in a
 * small window (`explain`) rather than doing nothing. A phone on the hosted copy is not held.
 * A guest's library is the dummy one and
 * its runs are pretend, so a guest is never held by this.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { supportsDirectoryPicker } from './folder-store';
import { HelperConnection } from './helper-connection';
import { Library } from './library';
import { StorageChoice } from './storage-choice';

/** a phone or tablet: what the browser says of itself, an iPad passing as a Mac included */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const said = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  if (said) return true;
  const agent = navigator.userAgent ?? '';
  if (/Android|iPhone|iPad|iPod|Mobi/i.test(agent)) return true;
  return /Macintosh/.test(agent) && (navigator.maxTouchPoints ?? 0) > 1;
}

@Injectable({ providedIn: 'root' })
export class DeviceSupport {
  private readonly helper = inject(HelperConnection);
  private readonly storage = inject(StorageChoice);
  private readonly library = inject(Library);

  /**
   * What the specs say this browser is, before anything asks - jsdom has no folder picker, so
   * without it every spec would run as though on Firefox. Read once, as the service is made.
   */
  static assume: { writesFolders: boolean; mobile: boolean } | null = null;

  /** a phone or tablet - a signal so the specs can change it */
  readonly mobile = signal(DeviceSupport.assume?.mobile ?? isMobileDevice());
  /** can write to a folder it is given - a Chromium browser on a computer */
  readonly writesFolders = signal(DeviceSupport.assume?.writesFolders ?? (supportsDirectoryPicker() && !isMobileDevice()));

  /**
   * a library from this device is open where nothing can be written to it: runs are held. Not
   * on a phone using the hosted copy - at the owner's request it is left free to run, unwarned;
   * a phone is held only with a helper on this computer (the downloaded app).
   */
  readonly blocked = computed(
    () =>
      !this.writesFolders() &&
      !this.helper.guest() &&
      !(this.mobile() && !this.helper.isLocal()) &&
      this.storage.mode() === 'local' &&
      (!!this.library.data() || this.library.collections().length > 0),
  );

  /** on hover, over a held button: whichever is true - a phone first, since no browser there can */
  readonly title = computed(() => (this.mobile() ? 'Unavailable on mobile' : 'Only available in a Chromium browser'));
  /** the small window a click on a held button opens */
  readonly message = computed(() =>
    this.mobile()
      ? 'This function is not available on mobile.'
      : 'This function is only available in a Chromium browser (Chrome, Edge, Opera or Arc).',
  );
  readonly explaining = signal(false);

  explain(): void {
    this.explaining.set(true);
  }
}
