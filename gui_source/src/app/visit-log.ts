/**
 * What someone did on this visit - for a bug report about something that is not a run.
 *
 * A run keeps its own account; nothing else did, so a report about a tab, a library read or a
 * setting arrived with nothing to go on. This keeps a short list of what happened on this
 * visit: tabs opened, the storage switched, library reads and how they ended, windows opened,
 * runs started and ended, settings changed **and the values chosen**, and every page error.
 *
 * **It lives in this page's memory alone**: nothing is written anywhere, it is gone when the
 * tab closes or reloads, and it leaves only as the feedback form's optional *Attach what I did
 * on this visit*, through the same `redactLog` the run log goes through. **Never note what
 * someone typed into the username or password boxes** - a setting's value, yes; a credential,
 * never. Fic titles and folder names are left out too: they say nothing about a bug.
 */

import { ErrorHandler, Injectable, inject, signal } from '@angular/core';
import { safeGet, safeRemove, safeSet } from './storage';

/**
 * How many entries are kept unless this browser chose otherwise - the oldest go first, since a
 * bug is near the end. Only the newest part is ever attached to feedback
 * (`VISIT_ATTACH_LIMIT` in `feedback.ts`); the whole log is downloaded from User settings.
 */
export const VISIT_LOG_LIMIT = 2000;
/** the range User settings offers: a short log is little use, and a huge one is held in memory */
export const VISIT_LOG_MIN = 100;
export const VISIT_LOG_MAX = 20000;
/** this browser's own choice of how many entries to keep */
export const VISIT_LOG_LIMIT_KEY = 'ao3.visitLogLimit';

/** a stored or typed limit, kept in range; anything unreadable is the default */
export function visitLogLimit(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return VISIT_LOG_LIMIT;
  return Math.min(VISIT_LOG_MAX, Math.max(VISIT_LOG_MIN, n));
}
/** no one entry may run longer than this, so an error with a huge message cannot crowd out the rest */
const ENTRY_LIMIT = 4000;

export interface VisitEntry {
  /** UTC, as every time the app keeps */
  at: string;
  text: string;
}

@Injectable({ providedIn: 'root' })
export class VisitLog {
  private readonly entries: VisitEntry[] = [];
  /** how many were dropped off the start for the cap */
  private dropped = 0;
  /** how many entries are kept before the oldest start to go */
  /** how many entries it holds now, for User settings to say */
  readonly count = signal(0);
  readonly limit = signal(visitLogLimit(safeGet(VISIT_LOG_LIMIT_KEY) ?? VISIT_LOG_LIMIT));

  constructor() {
    // errors nobody caught reach it through Angular: provideBrowserGlobalErrorListeners hands
    // the window's errors and unhandled rejections to the ErrorHandler, which is VisitErrorHandler
    this.note('Page opened');
    if (typeof document === 'undefined') return;
    // every click on something that does anything, and every choice made in a box or list -
    // read as they happen, before the page acts on them (capture), so a click that closes a
    // window is still noted with the window it was in
    document.addEventListener('click', (event) => this.noteClick(event), { capture: true, passive: true });
    document.addEventListener('change', (event) => this.noteChange(event), { capture: true, passive: true });
  }

  /** a click on a button, link, tab or folding section, said with its name and where it was */
  private noteClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    const hit = target?.closest('button, a, summary, [role="button"], [role="tab"]');
    if (!hit) return;
    const name = nameOf(hit);
    const where = placeOf(hit);
    if (hit.tagName === 'SUMMARY') {
      // the click toggles it: open now means it was closed
      const open = !(hit.parentElement as HTMLDetailsElement | null)?.open;
      this.note(`${open ? 'Opened' : 'Closed'} "${name}"${where}`);
    } else if (hit.tagName === 'A') {
      const href = (hit as HTMLAnchorElement).getAttribute('href') ?? '';
      const work = /\/works\/(\d+)/.exec(href)?.[1];
      const copy = hit.classList.contains('local') ? ', your downloaded copy' : '';
      this.note(`Clicked link "${name}"${work ? ` (work ${work}${copy})` : ''}${where}`);
    } else {
      const off = (hit as HTMLButtonElement).disabled ? ' (disabled)' : '';
      this.note(`Clicked "${name}"${off}${where}`);
    }
  }

  /**
   * A tick, a radio or a dropdown choice, with what was chosen. **Never a text box**: what
   * someone types - a password above all - is not noted, only the choices the page offers.
   */
  private noteChange(event: Event): void {
    const el = event.target;
    const where = el instanceof Element ? placeOf(el) : '';
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') this.note(`${el.checked ? 'Ticked' : 'Unticked'} "${labelOf(el)}"${where}`);
      else if (el.type === 'radio' && el.checked) this.note(`Chose "${labelOf(el)}"${where}`);
    } else if (el instanceof HTMLSelectElement) {
      const chosen = el.selectedOptions[0]?.textContent?.trim() ?? el.value;
      this.note(`Chose "${short(chosen)}" in "${labelOf(el)}"${where}`);
    }
  }

  /** note something that happened */
  note(text: string): void {
    this.entries.push({ at: new Date().toISOString(), text: String(text).slice(0, ENTRY_LIMIT) });
    this.trim();
  }

  /** empty it - kept only in memory, so this is all there is to clear - and note that it was */
  clear(): void {
    this.entries.length = 0;
    this.dropped = 0;
    this.count.set(0);
    this.note('Visit log cleared');
  }

  /** keep this many entries from now on (null: the default), dropping the oldest at once if over */
  setLimit(value: number | null): number {
    const limit = value === null ? VISIT_LOG_LIMIT : visitLogLimit(value);
    if (value === null || limit === VISIT_LOG_LIMIT) safeRemove(VISIT_LOG_LIMIT_KEY);
    else safeSet(VISIT_LOG_LIMIT_KEY, String(limit));
    this.limit.set(limit);
    this.trim();
    return limit;
  }

  private trim(): void {
    const over = this.entries.length - this.limit();
    if (over > 0) {
      this.entries.splice(0, over);
      this.dropped += over;
    }
    this.count.set(this.entries.length);
  }

  /** note an error, with its message and the first lines of where it came from */
  error(error: unknown, what = 'Error'): void {
    if (error instanceof Error) {
      const where = (error.stack ?? '').split('\n').slice(1, 4).map((line) => line.trim()).join(' | ');
      this.note(`${what}: ${error.name}: ${error.message}${where ? ` (${where})` : ''}`);
    } else {
      this.note(`${what}: ${String(error)}`);
    }
  }

  /** everything noted, one line each, oldest first, stamped in UTC */
  text(): string {
    const lines = this.entries.map((e) => `[${e.at.slice(0, 19).replace('T', ' ')} UTC] ${e.text}`);
    if (this.dropped) lines.unshift(`(${this.dropped} earlier entries dropped - only the last ${this.limit()} are kept)`);
    return lines.join('\n');
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Angular's errors go to the console as before, and into the visit log too. */
@Injectable()
export class VisitErrorHandler implements ErrorHandler {
  private readonly visit = inject(VisitLog);

  handleError(error: unknown): void {
    this.visit.error(error);
    console.error(error);
  }
}

/** at most this long, for a name read off the page */
function short(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

/** what a button or link is called: its label for screen readers, its title, or its text */
function nameOf(el: Element): string {
  return short(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.tagName.toLowerCase());
}

/** what a tick box, radio or dropdown is for: its label's words, or its own name */
function labelOf(el: HTMLInputElement | HTMLSelectElement): string {
  const label = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
  return short(label?.textContent || el.getAttribute('aria-label') || el.name || el.type);
}

/** ' in "<window title>"' when the element is inside a window, else nothing */
function placeOf(el: Element): string {
  const dialog = el.closest('.dialog, [role="dialog"]');
  const title = dialog?.querySelector('h2, h3')?.textContent;
  return title ? ` in "${short(title, 60)}"` : '';
}
