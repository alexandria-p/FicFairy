import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_NAME_PATTERN, parsePattern, useNamePattern, NamePattern } from './naming';
import { formatsOfPattern, misnamedFiles, readOtherName } from './renames';

describe('files named another way', () => {
  afterEach(() => useNamePattern(DEFAULT_NAME_PATTERN));

  it("reads AO3's own download names, the number at the end", () => {
    expect(readOtherName('My Favorite Fic - AuthorName - 12345678.epub')).toEqual({
      key: '{title} - {author} - {worknum}', worknum: '12345678', title: 'My Favorite Fic', author: 'AuthorName', date: '',
    });
  });

  it('reads a date however it is written, and says how in the format', () => {
    expect(readOtherName('12345678 My Fic - Author (14 Dec 2024).html')).toEqual({
      key: '{worknum} {title} - {author} ({date: D Mon YYYY})', worknum: '12345678', title: 'My Fic', author: 'Author', date: '2024-12-14',
    });
  });

  it('finds nothing to rename in a name with no work number at its start or end', () => {
    expect(readOtherName('My Fic - Author.epub')).toBeNull();
  });

  it('lists only what the pattern cannot read, grouped by format, the most files first', () => {
    useNamePattern('{title} - {author} - {worknum} {date}');
    const found = misnamedFiles([
      'works/A - X - 1 2026-01-01.epub',                 // already the pattern
      'works/1 A - X 2026-01-01.epub',                   // the old default, dated
      'works/2 B - Y 2026-02-02.html',
      'works/3 C - Z.pdf',                               // the old default, undated
      'works/Nothing to go by.epub',
      'indexing/1 A - X.json',
    ]);
    expect(found.formats.map((f) => [f.key, f.files.length])).toEqual([
      ['{worknum} {title} - {author} {date: YYYY-MM-DD}', 2],
      ['{worknum} {title} - {author}', 1],
    ]);
    expect(found.unreadable).toEqual(['works/Nothing to go by.epub']);
  });

  it("names the formats an old pattern left behind, so they can be ticked to begin with", () => {
    expect(formatsOfPattern(parsePattern(DEFAULT_NAME_PATTERN) as NamePattern)).toEqual([
      '{worknum} {title} - {author} {date: YYYY-MM-DD}',
      '{worknum} {title} - {author}',
    ]);
  });
});
