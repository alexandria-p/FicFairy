import { Component, computed, inject, signal } from '@angular/core';
import { ReadingSkin, ReadingSkins, skinId } from './reading-skins';
import { skinSampleWork } from './skin-sample';
import { withReadingSkin } from './skin-html';

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
      : skin.place === 'browser' ? 'this browser' : 'library';
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
    const tab = window.open('', '_blank');
    if (!tab) return;
    tab.opener = null;
    const sample = await skinSampleWork();
    const url = URL.createObjectURL(new Blob([withReadingSkin(sample, css)], { type: 'text/html' }));
    tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** the row it is on is coloured, so nothing more is said */
  protected setDefault(id: string): void {
    this.skins.setDefault(id);
    this.problem.set('');
    this.outcome.set('');
  }

  protected setLayer(on: boolean): void {
    this.skins.setLayer(on);
    this.problem.set('');
    this.outcome.set(on
      ? 'Your reading skin now goes under a work\'s own skin.'
      : 'A work with its own skin now shows that skin alone.');
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
