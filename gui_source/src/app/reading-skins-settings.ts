import { Component, computed, inject, signal } from '@angular/core';
import { BUILT_IN_SKINS, ReadingSkin, ReadingSkins, skinId } from './reading-skins';
import { SAMPLE_CHAT, SAMPLE_CHAT_NOTE, SAMPLE_WORK_SKIN, skinSampleWork } from './skin-sample';
import { shownWork, withReadingSkin, withSavedSkin } from './skin-html';

/**
 * User settings' *Reading skins* section (inside its `details`, which User settings draws): one
 * line saying what a reading skin is (the rest folded away), the skins as radios - picking one
 * makes it the default, so each is listed once - each with a Preview on a made-up work, the
 * layering choice, and a form to add one, folded behind *+ Add a skin* until asked for.
 */
@Component({
  selector: 'app-reading-skins-settings',
  templateUrl: './reading-skins-settings.html',
  styleUrl: './reading-skins-settings.css',
})
export class ReadingSkinsSettings {
  protected readonly skins = inject(ReadingSkins);
  protected readonly id = skinId;

  protected readonly name = signal('');
  protected readonly css = signal('');
  protected readonly place = signal<'browser' | 'library'>('browser');
  protected readonly saving = signal(false);
  /** whether the add form is open - it is folded behind *+ Add a skin* to begin with */
  protected readonly adding = signal(false);
  /** what the last add or remove did, or what went wrong */
  protected readonly outcome = signal('');
  protected readonly problem = signal('');
  /** a skin asked to be removed, until the second press */
  protected readonly confirmingRemove = signal('');

  protected readonly canSave = computed(
    () => !this.saving() && !!this.name().trim() && !!this.css().trim() &&
      (this.place() === 'browser' || this.skins.libraryWritable()),
  );

  protected placeWords(skin: ReadingSkin): string {
    return skin.place === 'builtin' ? 'built in'
      : skin.place === 'browser' ? 'saved to this browser' : 'saved to my library';
  }

  protected placeTitle(skin: ReadingSkin): string {
    return skin.place === 'builtin' ? 'Comes with FicFairy, and cannot be removed'
      : skin.place === 'browser' ? 'Saved to this browser only'
      : `Saved in your library, as skins/custom/${skin.name}.css`;
  }

  protected openAdd(): void {
    this.adding.set(true);
    this.outcome.set('');
    this.problem.set('');
  }

  /** the section opened or shut by its own heading */
  protected toggled(open: boolean): void {
    if (open === this.adding()) return;
    if (open) this.openAdd();
    else this.closeAdd();
  }

  protected closeAdd(): void {
    this.adding.set(false);
    this.name.set('');
    this.css.set('');
    this.problem.set('');
  }

  /**
   * A made-up work from the dummy library (`skinSampleWork`: the owner's own blurb, lorem ipsum
   * inside) shown with this CSS, in a tab of its own - opened at once, as a tab opened after
   * waiting is blocked as a pop-up, and filled once the sample is built - so a skin can be tried
   * without making it the active one. Nothing is saved.
   */
  protected async preview(css: string): Promise<void> {
    const tab = this.openTab();
    if (!tab) return;
    this.show(tab, withReadingSkin(await skinSampleWork(), css));
  }

  /**
   * The sample work with a made-up work skin (`SAMPLE_WORK_SKIN`), shown as a work with its own
   * skin is opened: with your active site skin layered under it, or with the work skin alone - so
   * the two choices can be compared. With no active site skin, AO3's stands in, or the two would
   * look the same. Nothing is saved.
   */
  protected async previewWorkSkin(layer: boolean): Promise<void> {
    const tab = this.openTab();
    if (!tab) return;
    const site = this.skins.defaultSkin()?.css ?? BUILT_IN_SKINS[0].css;
    this.show(tab, shownWork(withSavedSkin(await skinSampleWork(SAMPLE_CHAT, SAMPLE_CHAT_NOTE), SAMPLE_WORK_SKIN), site, layer));
  }

  /** a tab opened at once - one opened after waiting is blocked as a pop-up - and filled after */
  private openTab(): Window | null {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    return tab;
  }

  private show(tab: Window, html: string): void {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** the row it is on is coloured, so nothing more is said */
  protected setDefault(id: string): void {
    this.skins.setDefault(id);
    this.problem.set('');
    this.outcome.set('');
  }

  /** the radio picked says it, so nothing more is said */
  protected setLayer(on: boolean): void {
    this.skins.setLayer(on);
    this.problem.set('');
    this.outcome.set('');
  }

  /** a `.css` file chosen: its text goes in the box, and its name in the name box if that is empty */
  protected async chooseFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.css.set(await file.text());
      if (!this.name().trim()) this.name.set(file.name.replace(/\.css$/i, ''));
      this.problem.set('');
    } catch {
      this.problem.set('That file could not be read.');
    }
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.outcome.set('');
    const name = this.name().trim();
    const problem = await this.skins.add(name, this.css(), this.place());
    this.saving.set(false);
    if (problem) {
      this.problem.set(problem);
      return;
    }
    this.problem.set('');
    this.outcome.set(`"${name}" saved ${this.place() === 'browser' ? 'to this browser' : 'in your library'}.`);
    this.name.set('');
    this.css.set('');
    this.adding.set(false);
  }

  /**
   * Your own skin's CSS, as text in a tab of its own - opened at once, as View index history and
   * the saved work skins are, so the browser shows it rather than offering to save it
   */
  protected exportSkin(skin: ReadingSkin): void {
    const tab = window.open('', '_blank');
    if (!tab) return;
    tab.opener = null;
    const url = URL.createObjectURL(new Blob([skin.css], { type: 'text/plain' }));
    tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  protected async remove(skin: ReadingSkin): Promise<void> {
    if (this.confirmingRemove() !== skinId(skin)) {
      this.confirmingRemove.set(skinId(skin));
      return;
    }
    this.confirmingRemove.set('');
    const problem = await this.skins.remove(skin);
    this.problem.set(problem ?? '');
    this.outcome.set(problem ? '' : `"${skin.name}" removed.`);
  }
}
