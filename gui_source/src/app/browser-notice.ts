import { Component, inject, output, signal } from '@angular/core';
import { safeGet, safeSet } from './storage';
import { DeviceSupport } from './device-support';
import { BROWSER_NOTICE_KEY as SEEN_KEY, PROMPTS, askedAlways } from './preferences';

const PROMPT = PROMPTS.find((p) => p.key === SEEN_KEY)!;

/** whether this browser has already been told, once, what it needs */
export function browserNoticeSeen(): boolean {
  return safeGet(SEEN_KEY) === 'true';
}

/**
 * Said once, on the first visit: where a library can be kept, and what each way needs.
 *
 * A library in Dropbox needs nothing special - the page reaches it over Dropbox's own api,
 * in any browser on any device. A folder on this device is the demanding one: the page writes into it itself, which takes the
 * File System Access API (Chromium on a computer - Firefox, Safari and mobile browsers do not
 * have it), and the page has to stay open for the whole run, because it is the page that does
 * the writing. A large library can take hours, and that is worth knowing before starting.
 * The warning is worded for what is true here (`DeviceSupport`): a phone, or another browser.
 *
 * Shown on the first visit rather than at the moment it bites, because the moment it bites
 * is after someone has picked a folder and started a run - too late to be useful. Dismissing
 * it is the whole interaction - unless *Ask always* was chosen in User settings, which keeps
 * it coming back on every visit and puts a "Don't show this again" box on it to stop that.
 */
@Component({
  selector: 'app-browser-notice',
  templateUrl: './browser-notice.html',
  styleUrl: './browser-notice.css',
})
export class BrowserNotice {
  readonly dismissed = output<void>();

  /** whether this device and browser can save to a folder, which turns a line into a warning */
  protected readonly device = inject(DeviceSupport);

  /** set to show on every visit, from User settings: then only its own box turns it off */
  protected readonly always = askedAlways(PROMPT);
  protected readonly dontShowAgain = signal(false);

  protected dismiss(): void {
    if (!this.always || this.dontShowAgain()) safeSet(SEEN_KEY, 'true');
    this.dismissed.emit();
  }
}
