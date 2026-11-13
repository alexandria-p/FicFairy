import { Component, computed, inject, output, signal } from '@angular/core';
import { HelperConnection } from './helper-connection';
import { Jobs } from './jobs';
import {
  AO3_NAME_PATTERN,
  DEFAULT_NAME_PATTERN, NamePattern, NameToken, SEPARATOR_MAX, activePattern, parsePattern, patternText,
  useNamePattern,
} from './naming';

/** what each part of a name stands for, on its tile */
const TOKEN_LABELS: Record<NameToken, string> = { worknum: 'Work number', title: 'Title', author: 'Author', date: 'Date' };
/** the example name the editor shows - the helper's own example's parts */
const EXAMPLE: Record<NameToken, string> = {
  worknum: '34816549', title: 'No Paths Are Bound', author: 'Cataclysmic_Cal', date: '2026-08-23',
};

/**
 * settings.ini's FileNamePattern, edited as tiles: User settings' Advanced section, on a helper
 * on this computer (a hosted one's settings.ini comes from its deployment). Saving it reads the
 * library again and offers renames (`namePatternChanged`, `App.namePatternChanged`).
 */
@Component({
  selector: 'app-name-pattern',
  templateUrl: './name-pattern.html',
  styleUrl: './name-pattern.css',
})
export class NamePatternEditor {
  /** FileNamePattern saved: the old pattern, so the files named by it can be offered for renaming */
  readonly namePatternChanged = output<NamePattern>();

  private readonly jobs = inject(Jobs);
  private readonly helper = inject(HelperConnection);


  protected readonly tokenLabels = TOKEN_LABELS;
  protected readonly separatorMax = SEPARATOR_MAX;
  /** the parts in order, and the separator before each but the first - as being edited */
  protected readonly order = signal<NameToken[]>([...activePattern().order]);
  protected readonly separators = signal<string[]>([...activePattern().separators]);
  /** settings.ini can be written: a helper on this computer that says so */
  protected readonly patternEditable = signal<boolean | null>(null);
  protected readonly patternSaving = signal(false);
  protected readonly patternSaid = signal<{ text: string; problem: boolean } | null>(null);
  private dragging: number | null = null;

  protected readonly patternEdited = computed(() =>
    patternText({ order: this.order(), separators: this.separators() }),
  );
  /** why the pattern as edited cannot be used, or '' */
  protected readonly patternProblem = computed(() => {
    const parsed = parsePattern(this.patternEdited());
    return typeof parsed === 'string' ? parsed : '';
  });
  protected readonly patternChanged = computed(() => this.patternEdited() !== patternText(activePattern()));
  /** the example, as it reads in this order - untrimmed, for the look of it */
  protected readonly patternExample = computed(() => {
    const order = this.order();
    return order.map((t, i) => (i ? this.separators()[i - 1] : '') + EXAMPLE[t]).join('') + '.html';
  });

  constructor() {
    void this.loadEditable();
  }

  private async loadEditable(): Promise<void> {
    if (!this.helper.isLocal()) {
      this.patternEditable.set(false);
      return;
    }
    try {
      const response = await this.helper.call('/api/settings-file');
      this.patternEditable.set(response.ok && !!((await response.json()) as { editable?: boolean }).editable);
    } catch {
      this.patternEditable.set(false);
    }
  }

  protected dragStart(at: number): void {
    this.dragging = at;
  }

  /** a tile dropped on another: it moves to that place, the separators staying where they are */
  protected dropOn(at: number): void {
    const from = this.dragging;
    this.dragging = null;
    if (from === null || from === at) return;
    this.move(from, at);
  }

  /** by keyboard: one place earlier (-1) or later (1) */
  protected nudge(at: number, by: -1 | 1): void {
    const to = at + by;
    if (to < 0 || to >= this.order().length) return;
    this.move(at, to);
  }

  private move(from: number, to: number): void {
    this.order.update((order) => {
      const next = [...order];
      const [token] = next.splice(from, 1);
      next.splice(to, 0, token);
      return next;
    });
    this.patternSaid.set(null);
  }

  protected setSeparator(at: number, value: string): void {
    this.separators.update((all) => all.map((s, i) => (i === at ? value : s)));
    this.patternSaid.set(null);
  }

  protected readonly defaultPattern = DEFAULT_NAME_PATTERN;
  protected readonly ao3Pattern = AO3_NAME_PATTERN;

  /** fill the editor with a ready-made pattern - nothing is saved until Save */
  protected usePreset(text: string): void {
    const parsed = parsePattern(text) as NamePattern;
    this.order.set([...parsed.order]);
    this.separators.set([...parsed.separators]);
    this.patternSaid.set(null);
  }

  /** written to settings.ini; the library is then read again and renames offered */
  protected async savePattern(): Promise<void> {
    if (this.patternProblem() || !this.patternChanged() || !this.patternEditable()) return;
    const old = activePattern();
    this.patternSaving.set(true);
    try {
      const response = await this.helper.call('/api/settings-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { FileNamePattern: this.patternEdited() } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `the helper answered ${response.status}`);
      useNamePattern(this.patternEdited());
      await this.jobs.loadConfig();
      this.patternSaid.set({ text: `Saved to settings.ini: FileNamePattern=${this.patternEdited()}`, problem: false });
      this.namePatternChanged.emit(old);
    } catch (e) {
      this.patternSaid.set({ text: `Not saved: ${e instanceof Error ? e.message : String(e)}`, problem: true });
    } finally {
      this.patternSaving.set(false);
    }
  }

}
