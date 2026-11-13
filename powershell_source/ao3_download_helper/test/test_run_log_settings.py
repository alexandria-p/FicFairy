"""How long a run's log may grow, and whether only the most recent runs keep theirs.

`RunLogMaxLines` and `KeepLogsOfRecentRunsOnly` in settings.ini, or a hosted page's own
choices sent with the run (`runLogMaxLines`, `trimOldRunLogs`), which come first.
"""

import json
import os
from unittest.mock import MagicMock

import pytest

from source_code import runs, server, strings
from source_code.fileio import FileOps
from test.test_runs import fake_fileops, some_runs


def settings(**values) -> None:
    lines = '\n'.join(f'{key}={value}' for key, value in values.items())
    with open(FileOps().inifile, 'w', encoding='utf-8') as f:
        f.write(f'[settings]\n{lines}\n')


def a_job() -> server.Job:
    return server.Job(server.ACTION_BOOKMARKS, ['JSON'], 'Someone')


def test_without_settings_a_run_log_keeps_5000_lines_and_old_logs_are_taken_out():
    job = a_job()
    assert server.run_log_lines(job) == runs.LOG_MAX_LINES == 5000
    assert server.keeps_recent_logs_only(job) is True


def test_settings_ini_sets_both():
    settings(**{strings.INI_RUN_LOG_MAX_LINES: '20000', strings.INI_TRIM_OLD_RUN_LOGS: 'false'})
    job = a_job()
    assert server.run_log_lines(job) == 20000
    assert server.keeps_recent_logs_only(job) is False


def test_a_hosted_page_s_choices_come_before_settings_ini_s():
    settings(**{strings.INI_RUN_LOG_MAX_LINES: '20000', strings.INI_TRIM_OLD_RUN_LOGS: 'true'})
    job = a_job()
    job.run_log_max_lines, job.trim_old_run_logs = server.run_log_settings(8000, False)
    assert server.run_log_lines(job) == 8000
    assert server.keeps_recent_logs_only(job) is False


@pytest.mark.parametrize('lines, trim', [(10, None), (10 ** 7, None), ('5000', None), (True, None),
                                         (None, 'yes')])
def test_a_choice_out_of_range_is_refused_before_the_run_starts(lines, trim):
    with pytest.raises(ValueError):
        server.run_log_settings(lines, trim)


def test_a_run_ending_takes_the_logs_out_of_older_runs_and_says_so(tmp_path):
    some_runs(tmp_path, 102)
    fileops = fake_fileops(tmp_path)
    job = a_job()
    job.record = runs.RunRecord(fileops, 'ffffffff99', job.action, 'A Button', ['JSON'], {})
    job.ao3 = None
    server.close_record(job, runs.STATUS_STOPPED)

    folder = tmp_path / 'runs'
    records = [json.loads((folder / name).read_text(encoding='utf-8')) for name in sorted(os.listdir(folder))]
    assert [r for r in records if 'logPruned' in r] == records[:3]
    said = strings.AO3_INFO_OLD_RUN_LOGS_REMOVED.format(3, runs.RECENT_RUN_LOGS)
    assert any(line.endswith(said) for line in records[-1]['log'])


def test_turned_off_every_run_keeps_its_log(tmp_path):
    some_runs(tmp_path, 102)
    job = a_job()
    job.trim_old_run_logs = False
    job.record = runs.RunRecord(fake_fileops(tmp_path), 'ffffffff99', job.action, 'A Button', ['JSON'], {})
    job.ao3 = None
    server.close_record(job, runs.STATUS_STOPPED)
    folder = tmp_path / 'runs'
    assert not any('logPruned' in json.loads((folder / n).read_text(encoding='utf-8')) for n in os.listdir(folder))
