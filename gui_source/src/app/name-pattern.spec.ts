import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { NamePatternEditor } from './name-pattern';
import { DEFAULT_NAME_PATTERN, useNamePattern } from './naming';

describe('the file name pattern editor', () => {
  afterEach(() => useNamePattern(DEFAULT_NAME_PATTERN));

  it('edits the file name pattern: parts moved, separators typed, and a pattern that cannot be read refused', async () => {
    const fixture = TestBed.createComponent(NamePatternEditor);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const text = () => element.querySelector('.pattern-text code')?.textContent;
    expect(text()).toBe('{worknum} {title} - {author} {date}');
    // the work number moved one place later, after the title
    element.querySelector<HTMLButtonElement>('[aria-label="Move Work number later"]')!.click();
    await fixture.whenStable();
    expect(text()).toBe('{title} {worknum} - {author} {date}');
    expect(element.querySelector('.pattern-example code')?.textContent).toBe('No Paths Are Bound 34816549 - Cataclysmic_Cal 2026-08-23.html');
    // a separator holding a digit would be read as part of a number
    const box = element.querySelector<HTMLInputElement>('.pattern-separator input')!;
    box.value = ' 2 ';
    box.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(element.querySelector('.pattern-problem')?.textContent).toContain('digit');
    expect(element.querySelector<HTMLButtonElement>('.pattern-actions .primary')!.disabled).toBe(true);
  });

  it('fills the editor from a ready-made pattern above the parts, apart from Save, saving nothing', async () => {
    const fixture = TestBed.createComponent(NamePatternEditor);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const text = () => element.querySelector('.pattern-text code')?.textContent;
    const preset = (label: string) =>
      [...element.querySelectorAll<HTMLButtonElement>('.pattern-presets button')].find((b) => b.textContent?.trim() === label)!;
    // the presets, then the parts, then the pattern and its example as a preview, then Save; neither preset is beside Save
    expect(element.querySelector('.pattern-presets')!.previousElementSibling?.classList).toContain('hint');
    expect(element.querySelector('.pattern-presets')!.nextElementSibling?.classList).toContain('pattern-parts');
    expect(element.querySelector('.pattern-parts')!.nextElementSibling?.classList).toContain('pattern-text');
    expect(element.querySelector('.pattern-example')!.compareDocumentPosition(element.querySelector('.pattern-actions')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(element.querySelector('.pattern-actions')!.textContent).not.toContain('default');

    preset('Set to AO3 default (with a date)').click();
    await fixture.whenStable();
    expect(text()).toBe('{title} - {author} - {worknum} {date}');
    expect(element.querySelector('.pattern-example code')?.textContent).toBe('No Paths Are Bound - Cataclysmic_Cal - 34816549 2026-08-23.html');

    preset('Reset to app default').click();
    await fixture.whenStable();
    expect(text()).toBe('{worknum} {title} - {author} {date}');
    expect(element.querySelector('.pattern-said')).toBeNull();
  });


  it('says there are unsaved changes once the parts differ from what is in force, and not before', async () => {
    const fixture = TestBed.createComponent(NamePatternEditor);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.pattern-unsaved')).toBeNull();

    element.querySelector<HTMLButtonElement>('[aria-label="Move Work number later"]')!.click();
    await fixture.whenStable();
    expect(element.querySelector('.pattern-unsaved')?.textContent).toContain('Unsaved changes');

    // back to what is in force: nothing left unsaved
    element.querySelector<HTMLButtonElement>('[aria-label="Move Work number earlier"]')!.click();
    await fixture.whenStable();
    expect(element.querySelector('.pattern-unsaved')).toBeNull();
  });
});
