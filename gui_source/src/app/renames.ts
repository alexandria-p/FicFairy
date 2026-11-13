/**
 * Files in `works/` this app cannot match to a work, because they are not named by the pattern
 * it reads names by (`naming.ts`): an older pattern's names after `FileNamePattern` changed, or
 * the names AO3's own site gives a download (`Title - Author - 12345678.epub`). The first step of
 * Resolve issues lists the formats they are named in (`nameFormats`) and renames those ticked to
 * the app's own pattern - the work number and title and author read out of each name, and its
 * date, however it was written, written the app's way.
 *
 * A date read here is only guessed out of a name (`findDate`); renaming writes it where the
 * pattern puts a date, so it is trusted from then on. That is the reader's choice, made by
 * ticking the format, as *Infer date* on the dates page is - it is never taken unasked.
 */

import { FoundDate, findDate, formatOf } from './imports';
import { WORKS_FOLDER } from './library-setup';
import { OpenableFormat } from './library';
import { NamePattern, workNumber } from './naming';

/** one file named another way, and what its name was read as */
export interface MisnamedFile {
  path: string;
  name: string;
  format: OpenableFormat;
  worknum: string;
  title: string;
  author: string;
  /** the date read out of its name, YYYY-MM-DD, or '' */
  date: string;
}

/** files named the same way: their format (`{worknum} {title} - {author} ({date: D Mon YYYY})`) */
export interface NameFormat {
  key: string;
  files: MisnamedFile[];
}

export interface Misnamed {
  formats: NameFormat[];
  /** files with no work number to be found in their name - left as they are */
  unreadable: string[];
}

const SEPARATORS = /[\s_.\-]+/;

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** a date in `text`, and how far it reaches with the brackets around it: `(14 Dec 2024)` */
function dateAround(text: string): (FoundDate & { start: number; end: number }) | null {
  const found = findDate(text);
  if (!found) return null;
  let start = found.index;
  let end = found.index + found.length;
  if (/[([{]/.test(text[start - 1] ?? '') && /[)\]}]/.test(text[end] ?? '')) {
    start -= 1;
    end += 1;
  }
  return { ...found, start, end };
}

/**
 * What a name is made of, when a work number can be found at its start or its end: its format,
 * and the parts read out of it - or null.
 */
export function readOtherName(name: string): { key: string; worknum: string; title: string; author: string; date: string } | null {
  const base = name.replace(/\.[^.]*$/, '').trim();
  // the parts in the order they are found: [kind, start, end]
  const spans: { kind: 'worknum' | 'title' | 'author' | 'date'; start: number; end: number }[] = [];
  let worknum = '';
  let style = '';
  let date = '';
  let from = 0;
  let to = base.length;

  const leading = /^(\d+)(?=[\s_.\-]|$)/.exec(base);
  if (leading) {
    worknum = leading[1];
    spans.push({ kind: 'worknum', start: 0, end: worknum.length });
    from = worknum.length;
  }
  // a date at the end (with the number before it, or not)
  const tail = base.slice(from);
  const found = dateAround(tail);
  const endsWithDate = !!found && /^[\s_.\-]*$/.test(tail.slice(found.end));
  if (!leading) {
    let head = base;
    if (found && endsWithDate) head = base.slice(0, from + found.start);
    const trailing = /(?:^|[\s_.\-])(\d+)[\s_.\-]*$/.exec(head);
    if (!trailing) return null;
    worknum = trailing[1];
    const start = head.lastIndexOf(worknum);
    spans.push({ kind: 'worknum', start, end: start + worknum.length });
    to = start;
  }
  if (found) {
    // the date itself is the part; brackets around it stay in the format as written
    const start = from + found.index;
    const end = from + found.index + found.length;
    const outerStart = from + found.start;
    const outerEnd = from + found.end;
    // only a date outside the title and author: at the end, or right after a leading number
    const rightAfterNumber = leading && SEPARATORS.test(base.slice(from, outerStart)) && !/[^\s_.\-]/.test(base.slice(from, outerStart));
    if (endsWithDate || rightAfterNumber) {
      date = found.date;
      style = found.style;
      spans.push({ kind: 'date', start, end });
      if (rightAfterNumber) from = outerEnd;
      else to = Math.min(to, outerStart);
    }
  }
  // what is left is the title, then the author after the last ' - '
  let middle = base.slice(from, to);
  const lead = /^[\s_.\-]*/.exec(middle)![0].length;
  const trail = /[\s_.\-]*$/.exec(middle)![0].length;
  const mStart = from + lead;
  const mEnd = to - trail;
  middle = base.slice(mStart, Math.max(mStart, mEnd));
  if (middle) {
    const split = middle.lastIndexOf(' - ');
    if (split > 0) {
      spans.push({ kind: 'title', start: mStart, end: mStart + split });
      spans.push({ kind: 'author', start: mStart + split + 3, end: mEnd });
    } else {
      spans.push({ kind: 'title', start: mStart, end: mEnd });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  // the format: each part as its name, the text between them as written
  let key = '';
  let at = 0;
  for (const span of spans) {
    key += base.slice(at, span.start) + (span.kind === 'date' ? `{date: ${style}}` : `{${span.kind}}`);
    at = span.end;
  }
  key += base.slice(at);
  const part = (kind: string) => {
    const span = spans.find((s) => s.kind === kind);
    return span ? base.slice(span.start, span.end) : '';
  };
  return { key, worknum, title: part('title'), author: part('author'), date };
}

/**
 * The files directly in `works/` whose work number the app's pattern cannot read, grouped by
 * the format they are named in - the most files first.
 */
export function misnamedFiles(paths: Iterable<string>, pattern?: NamePattern): Misnamed {
  const byKey = new Map<string, MisnamedFile[]>();
  const unreadable: string[] = [];
  for (const raw of paths) {
    const path = raw.replace(/^\/+/, '');
    const parts = path.split('/');
    if (parts.length !== 2 || parts[0].toLowerCase() !== WORKS_FOLDER) continue;
    const name = parts[1];
    const format = formatOf(name);
    if (!format || workNumber(name, pattern)) continue;
    const read = readOtherName(name);
    if (!read) {
      unreadable.push(path);
      continue;
    }
    const { key, ...rest } = read;
    byKey.set(key, [...(byKey.get(key) ?? []), { path, name, format, ...rest }]);
  }
  const formats = [...byKey.entries()]
    .map(([key, files]) => ({ key, files: files.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.files.length - a.files.length || a.key.localeCompare(b.key));
  return { formats, unreadable: unreadable.sort((a, b) => baseName(a).localeCompare(baseName(b))) };
}

/**
 * The formats a pattern's own names have, as `readOtherName` writes them - its dated names and
 * its undated ones - so the formats an old pattern left behind can be ticked to begin with.
 */
export function formatsOfPattern(pattern: NamePattern): string[] {
  const dated = pattern.order.map((t, i) => (i ? pattern.separators[i - 1] : '') + (t === 'date' ? '{date: YYYY-MM-DD}' : `{${t}}`)).join('');
  const at = pattern.order.indexOf('date');
  const order = pattern.order.filter((t) => t !== 'date');
  const separators = pattern.separators.filter((_, i) => i !== (at > 0 ? at - 1 : 0));
  const undated = order.map((t, i) => (i ? separators[i - 1] : '') + `{${t}}`).join('');
  return [dated, undated];
}
