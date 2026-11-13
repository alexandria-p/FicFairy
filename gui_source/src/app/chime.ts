/**
 * A short ding when the page stops and waits for an answer - a question during a run, or
 * Resolve issues asking which copy to keep - so someone in another tab or away from the screen
 * knows to come back. Made with the browser's own Web Audio, so there is no sound file to ship.
 * On to begin with; this browser can turn it off (User settings, Appearance).
 */
import { Injectable, inject, signal } from '@angular/core';
import { safeGet, safeRemove, safeSet } from './storage';

/** `off` when this browser turned the ding off; nothing stored means on */
export const CHIME_KEY = 'ao3.waitChime';

/**
 * Plays the ding. A seam of its own so the specs can count dings: jsdom has no Web Audio, and
 * a test should never make a sound.
 */
@Injectable({ providedIn: 'root' })
export class ChimePlayer {
  private context: AudioContext | null = null;

  play(): void {
    try {
      const Context = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.context ??= new Context();
      const audio = this.context;
      // a browser holds a context made before any click; the page has had clicks by the time
      // anything waits on one, so this lets it sound
      void audio.resume().catch(() => {});
      const start = audio.currentTime;
      // two soft bell notes, a fifth apart, each fading out
      for (const [frequency, offset] of [[880, 0], [1318.5, 0.12]] as const) {
        const tone = audio.createOscillator();
        const level = audio.createGain();
        tone.type = 'sine';
        tone.frequency.value = frequency;
        level.gain.setValueAtTime(0.0001, start + offset);
        level.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.01);
        level.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.6);
        tone.connect(level).connect(audio.destination);
        tone.start(start + offset);
        tone.stop(start + offset + 0.65);
      }
    } catch {
      // a ding that will not play is no reason for anything else to fail
    }
  }
}

@Injectable({ providedIn: 'root' })
export class Chime {
  private readonly player = inject(ChimePlayer);
  /** whether the page dings when it waits for an answer - this browser's choice */
  readonly on = signal(safeGet(CHIME_KEY) !== 'off');
  private last = 0;

  set(on: boolean): void {
    this.on.set(on);
    if (on) safeRemove(CHIME_KEY);
    else safeSet(CHIME_KEY, 'off');
  }

  /** The page is waiting for an answer: ding, unless turned off or it dinged a moment ago. */
  waiting(): void {
    if (!this.on()) return;
    const now = Date.now();
    // two waits arriving together (or one asked again at once) ding once
    if (now - this.last < CHIME_GAP_MS) return;
    this.last = now;
    this.player.play();
  }

  /** the ding itself, whatever the setting - User settings' *Play it* */
  sample(): void {
    this.player.play();
  }
}

/** no second ding within this long of the first */
export const CHIME_GAP_MS = 1500;
