/**
 * How long a run's log may grow, and whether only the most recent runs keep theirs.
 *
 * On a copy whose helper is on this computer these are settings.ini's `RunLogMaxLines` and
 * `KeepLogsOfRecentRunsOnly`, changed from User settings' Advanced section like any other key
 * there. A hosted copy's settings.ini cannot be edited from the page, so there they are this
 * browser's own, sent with every run (`runLogMaxLines`, `trimOldRunLogs`) - only once changed
 * from the default, as the question settings are. The helper checks the range again.
 */

import { safeGet, safeRemove, safeSet } from './storage';

export const RUN_LOG_LINES_DEFAULT = 5000;
export const RUN_LOG_LINES_MIN = 500;
export const RUN_LOG_LINES_MAX = 50000;
/** how many of the newest runs keep their logs when old ones are taken out */
export const RECENT_RUN_LOGS = 100;

export const RUN_LOG_LINES_KEY = 'ao3.runLogMaxLines';
export const TRIM_OLD_RUN_LOGS_KEY = 'ao3.trimOldRunLogs';
export const RUN_LOG_LINES_SETTING = 'RunLogMaxLines';
export const TRIM_OLD_RUN_LOGS_SETTING = 'KeepLogsOfRecentRunsOnly';

/** a typed or stored length, kept in range; anything unreadable is the default */
export function runLogLines(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return RUN_LOG_LINES_DEFAULT;
  return Math.min(RUN_LOG_LINES_MAX, Math.max(RUN_LOG_LINES_MIN, n));
}

/** this browser's own length, or null to leave it to the helper */
export function savedRunLogLines(): number | null {
  const raw = safeGet(RUN_LOG_LINES_KEY);
  return raw ? runLogLines(raw) : null;
}

export function saveRunLogLines(value: number | null): number {
  const lines = value === null ? RUN_LOG_LINES_DEFAULT : runLogLines(value);
  if (value === null || lines === RUN_LOG_LINES_DEFAULT) safeRemove(RUN_LOG_LINES_KEY);
  else safeSet(RUN_LOG_LINES_KEY, String(lines));
  return lines;
}

/** this browser's own choice, or null to leave it to the helper */
export function savedTrimOldRunLogs(): boolean | null {
  const raw = safeGet(TRIM_OLD_RUN_LOGS_KEY);
  return raw === 'false' ? false : raw === 'true' ? true : null;
}

export function saveTrimOldRunLogs(value: boolean | null): void {
  if (value === null || value) safeRemove(TRIM_OLD_RUN_LOGS_KEY);
  else safeSet(TRIM_OLD_RUN_LOGS_KEY, 'false');
}
