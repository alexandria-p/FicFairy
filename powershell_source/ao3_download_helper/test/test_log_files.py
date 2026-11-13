"""The helper's log file and the update logs drop their oldest lines past a size.

`LogFileMaxMB` (logs/log.jsonl, 100 by default) and `UpdateLogMaxMB` (update/update.log and
update/swap-output.txt, 10 by default); 0 for no limit.
"""

import json

from source_code import fileio, strings, updater
from source_code.fileio import FileOps, megabytes, trim_file


def lines_in(path) -> list[str]:
    return path.read_text(encoding='utf-8').splitlines()


def test_a_file_under_its_limit_is_left_as_it_is(tmp_path):
    log = tmp_path / 'a.log'
    log.write_text('one\ntwo\n', encoding='utf-8')
    assert trim_file(log, 1000) is False
    assert lines_in(log) == ['one', 'two']


def test_a_file_over_its_limit_keeps_its_newest_whole_lines(tmp_path):
    log = tmp_path / 'a.log'
    log.write_text(''.join(f'line {n:04d}\n' for n in range(1000)), encoding='utf-8')
    assert trim_file(log, 2000) is True
    kept = lines_in(log)
    assert log.stat().st_size <= 2000
    assert kept[-1] == 'line 0999'
    # whole lines only, from where it was cut
    assert all(line.startswith('line ') and len(line) == 9 for line in kept)


def test_no_limit_never_trims(tmp_path):
    log = tmp_path / 'a.log'
    log.write_text('x' * 5000, encoding='utf-8')
    assert trim_file(log, 0) is False
    assert megabytes(0) == 0 and megabytes('nonsense') == 0 and megabytes(2) == 2 * 1024 * 1024


def test_the_helper_s_log_file_drops_its_oldest_lines_as_new_ones_are_written(tmp_path):
    fileops = FileOps()
    fileops.logfile = str(tmp_path / 'log.jsonl')
    fileops.log_max_bytes = 4000
    for n in range(500):
        fileops.write_log({'message': f'entry {n}'})
    entries = [json.loads(line) for line in lines_in(tmp_path / 'log.jsonl')]
    assert (tmp_path / 'log.jsonl').stat().st_size <= 4000
    assert entries[-1]['message'] == 'entry 499'
    assert entries[0]['message'] != 'entry 0'


def test_the_log_file_limit_is_read_from_settings_ini(tmp_path):
    with open(FileOps().inifile, 'w', encoding='utf-8') as f:
        f.write(f'[settings]\n{strings.INI_LOG_FILE_MAX_MB}=3\n')
    fileops = FileOps()
    fileops.logfile = str(tmp_path / 'log.jsonl')
    fileops.write_log({'message': 'hello'})
    assert fileops.log_max_bytes == 3 * 1024 * 1024


def test_the_update_logs_are_trimmed_as_the_app_starts(tmp_path):
    folder = tmp_path / updater.UPDATE_FOLDER
    folder.mkdir()
    for name in (updater.LOG_NAME, updater.OUTPUT_NAME):
        (folder / name).write_text(''.join(f'2026-01-01 line {n}\n' for n in range(2000)), encoding='utf-8')
    updater.Updater(str(tmp_path), '1.0.0', 'someone/somewhere', log_limit=lambda: 5000)
    for name in (updater.LOG_NAME, updater.OUTPUT_NAME):
        assert (folder / name).stat().st_size <= 5000
        assert lines_in(folder / name)[-1] == '2026-01-01 line 1999'
