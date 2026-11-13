/**
 * Guest mode: the hosted copy, shown to anyone who has not given its passcode.
 *
 * The hosted copy is its owner's. Everyone else who opens it gets a tour instead of a passcode
 * window: the dummy library, pretend runs that go through every step and touch nothing, and
 * the settings they can change for themselves (time zone and appearance) - and nothing that
 * reaches the owner's helper, AO3, FicHub or anyone's Dropbox.
 *
 * - **Only a hosted copy that needs a passcode** opens as a guest (`HelperConnection.guest`,
 *   set by `loadPageConfig`). A copy on this computer never does.
 * - **Every request to the helper is answered in the page** (`GuestHelper`), so a visitor never
 *   reaches it - not even the owner's, until their passcode has been checked.
 * - **A saved passcode is checked before guest mode ends** (`checkSaved`): opening the page
 *   starts as a guest, asks the helper whether the saved passcode is still the one, and leaves
 *   guest mode only on a yes - the page then reads the real library and the real helper.
 * - **The owner logs in from the footer** (`openLogin`), which opens the passcode window; a
 *   guest can close it again.
 * - **Anyone with the DEBUG tab can preview it** (`startPreview`) - on the hosted copy logged in,
 *   or on a downloaded app - to see exactly what a visitor sees. The DEBUG tab is a guest's to
 *   lose, so the banner offers the way back (`endPreview`) - on a hosted copy that asks for a
 *   passcode, only once the helper accepts the saved one; otherwise the preview becomes real guest
 *   mode and asks for it.
 * - **A preview lasts until it is left** (`PREVIEW_KEY`): this browser remembers it, and the next
 *   visit opens in it again (`resumePreview`, an app initializer, so nothing reaches the helper
 *   first). Only **Leave guest preview** forgets it - whatever that then finds. Resuming needs no
 *   passcode and opens nothing real: a preview is guest mode, and leaving it needs a passcode saved
 *   in this browser, as above - a browser with none is asked for it.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { HelperConnection } from './helper-connection';
import { VisitLog } from './visit-log';

/** this browser was left in a guest mode preview, so the next visit opens in one */
export const PREVIEW_KEY = 'ao3.guestPreview';

function remembered(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) === 'on';
  } catch {
    return false;
  }
}

function remember(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREVIEW_KEY, 'on');
    else localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // a browser that keeps nothing simply ends the preview on a reload, as it used to
  }
}

@Injectable({ providedIn: 'root' })
export class GuestMode {
  private readonly helper = inject(HelperConnection);
  private readonly visit = inject(VisitLog);
  /** in guest mode now */
  readonly active = this.helper.guest;
  /** the passcode window, opened from the footer's login */
  readonly loginOpen = signal(false);
  /** a passcode saved in this browser is being checked with the helper */
  readonly checking = signal(false);
  /** said only while there is a saved passcode to check - never for a browser that has none */
  readonly checkingSaved = computed(() => this.checking() && !!this.helper.passcode());
  /** why a saved passcode could not take this browser out of guest mode, if it could not */
  readonly note = signal('');
  /** guest mode turned on from the DEBUG tab, by someone who is not a guest */
  readonly preview = signal(false);

  /** what a visitor sees, on any copy - and the real helper and library left alone meanwhile */
  startPreview(): void {
    if (this.active()) return;
    this.visit.note('Guest mode preview started, from the DEBUG tab');
    remember(true);
    this.preview.set(true);
    this.helper.guest.set(true);
  }

  /**
   * As the page starts: back into the preview this browser was left in, before any request is
   * sent - so a hosted copy's helper is not asked even for the saved passcode. Leaving it later
   * checks the passcode as any preview does (`endPreview`).
   */
  resumePreview(): void {
    if (!remembered() || this.preview()) return;
    this.visit.note('Guest mode preview resumed - this browser was left in one; Leave guest preview ends it');
    this.preview.set(true);
    this.helper.guest.set(true);
  }

  /**
   * Back from a preview, at once, wherever this browser may already use the helper: a copy on
   * this computer (no passcode at all), a hosted copy that asks for none, or a hosted copy whose
   * passcode is saved here - the owner, logged in. The helper is not asked: the owner toggles the
   * preview freely, asleep helper or not, and every request after it carries the saved passcode
   * anyway, so one the helper no longer takes still puts the passcode window up (a 401). With no
   * passcode saved, the preview becomes real guest mode and the passcode window opens: only a
   * passcode the helper accepts ends it after that.
   */
  async endPreview(): Promise<void> {
    if (!this.preview()) return;
    // turned off by the person who turned it on - whatever it then finds
    remember(false);
    if (this.helper.isLocal() || !this.helper.settings().requirePasscode || this.helper.passcode()) {
      this.visit.note('Guest mode preview ended');
      this.preview.set(false);
      this.note.set('');
      this.helper.guest.set(false);
      return;
    }
    this.visit.note('Guest mode preview could not be left - no passcode is saved in this browser');
    // a real guest from here: only an accepted passcode ends it
    this.preview.set(false);
    this.note.set('Log in with the passcode to leave guest mode.');
    this.openLogin();
  }

  /**
   * The passcode this browser saved, put to the helper: guest mode ends only once the helper has
   * said it is still the one. One it refuses is forgotten; one it cannot be asked about (asleep,
   * offline) is kept, and the guest can log in to try again.
   */
  async checkSaved(): Promise<void> {
    const saved = this.helper.passcode();
    if (!this.active() || this.preview() || !saved || this.checking()) return;
    this.checking.set(true);
    try {
      switch (await this.helper.tryPasscode(saved)) {
        case 'accepted':
          this.leave();
          return;
        case 'refused':
          this.helper.forgetPasscode();
          this.note.set('The passcode saved in this browser is no longer accepted - log in again to leave guest mode.');
          return;
        case 'blocked':
          this.note.set(`Too many wrong passcodes have been tried from this network. Try again in ${this.helper.blockedMinutes()} minutes.`);
          return;
        case 'unreachable':
          this.note.set('Your saved passcode could not be checked - the helper did not answer. Log in to try again.');
          return;
      }
    } finally {
      this.checking.set(false);
    }
  }

  /**
   * The owner's way in (User settings, Advanced): only a real guest of a hosted copy that asks for
   * a passcode - a downloaded copy has no passcode to enter, and a preview needs none to leave.
   */
  readonly loginOffered = computed(
    () => this.active() && !this.preview() && !this.helper.isLocal() && this.helper.settings().requirePasscode,
  );

  openLogin(): void {
    if (!this.loginOffered()) return;
    this.visit.note('Guest mode: log in opened');
    this.loginOpen.set(true);
  }

  closeLogin(): void {
    this.loginOpen.set(false);
  }

  /** the passcode was accepted: out of guest mode, onto the real helper and library */
  leave(): void {
    if (!this.active()) return;
    this.visit.note('Guest mode ended - the passcode was accepted');
    this.note.set('');
    this.preview.set(false);
    this.loginOpen.set(false);
    this.helper.passcodeWanted.set(false);
    this.helper.guest.set(false);
  }
}
