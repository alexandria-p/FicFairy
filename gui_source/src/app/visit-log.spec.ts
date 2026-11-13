import { TestBed } from '@angular/core/testing';
import { VISIT_LOG_LIMIT, VISIT_LOG_LIMIT_KEY, VISIT_LOG_MAX, VisitErrorHandler, VisitLog, visitLogLimit } from './visit-log';

describe('VisitLog', () => {
  let visit: VisitLog;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [VisitErrorHandler] });
    visit = TestBed.inject(VisitLog);
  });

  it('starts with the page opening, and stamps every line in UTC', () => {
    visit.note('Tab opened: history');
    const lines = visit.text().split('\n');
    expect(lines[0]).toMatch(/^\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\] Page opened$/);
    expect(lines[1]).toMatch(/UTC\] Tab opened: history$/);
  });

  it('keeps only the last entries, and says the earlier ones went', () => {
    for (let i = 0; i < VISIT_LOG_LIMIT + 5; i++) visit.note(`entry ${i}`);
    expect(visit.size).toBe(VISIT_LOG_LIMIT);
    const text = visit.text();
    expect(text.split('\n')[0]).toContain('earlier entries dropped');
    expect(text).toContain(`entry ${VISIT_LOG_LIMIT + 4}`);
    expect(text).not.toContain('Page opened');
  });

  it('keeps as many entries as this browser chose, dropping the oldest at once when lowered', () => {
    for (let i = 0; i < 300; i++) visit.note(`entry ${i}`);
    visit.setLimit(150);
    expect(visit.size).toBe(150);
    expect(visit.count()).toBe(150);
    expect(localStorage.getItem(VISIT_LOG_LIMIT_KEY)).toBe('150');
    expect(visit.text().split('\n')[0]).toContain('only the last 150 are kept');
    expect(visit.text()).toContain('entry 299');
    // the default is not stored
    visit.setLimit(null);
    expect(localStorage.getItem(VISIT_LOG_LIMIT_KEY)).toBeNull();
    expect(visit.limit()).toBe(VISIT_LOG_LIMIT);
  });

  it('reads a stored limit, kept in range', () => {
    expect(visitLogLimit('500')).toBe(500);
    expect(visitLogLimit('999999')).toBe(VISIT_LOG_MAX);
    expect(visitLogLimit('nonsense')).toBe(VISIT_LOG_LIMIT);
    expect(visitLogLimit('')).toBe(VISIT_LOG_LIMIT);
  });

  it('notes an error with its name, message and where it came from', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    TestBed.inject(VisitErrorHandler).handleError(new TypeError('cannot read the folder'));
    expect(visit.text()).toMatch(/Error: TypeError: cannot read the folder/);
  });

  it('notes every click with its name and the window it was in, and every choice made', () => {
    document.body.innerHTML = `
      <div class="dialog"><h2>Quick Scan</h2>
        <button type="button">Continue</button>
        <label><input type="checkbox" name="series" /> Get all works from encountered series</label>
        <a href="https://archiveofourown.org/works/123">A made-up work</a>
        <details><summary>See exactly what will be sent</summary></details>
        <input type="password" name="password" />
      </div>`;
    document.querySelector('button')!.click();
    const box = document.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.querySelector('summary')!.click();
    const password = document.querySelector<HTMLInputElement>('input[type=password]')!;
    password.value = 'hunter2';
    password.dispatchEvent(new Event('change', { bubbles: true }));

    const text = visit.text();
    expect(text).toContain('Clicked "Continue" in "Quick Scan"');
    expect(text).toContain('Ticked "Get all works from encountered series" in "Quick Scan"');
    expect(text).toContain('Clicked link "A made-up work" (work 123) in "Quick Scan"');
    expect(text).toContain('Opened "See exactly what will be sent" in "Quick Scan"');
    // what is typed is never noted
    expect(text).not.toContain('hunter2');
    expect(text).not.toMatch(/password/i);
    document.body.innerHTML = '';
  });
});
