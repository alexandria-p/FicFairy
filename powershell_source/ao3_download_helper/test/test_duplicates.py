"""More than one file of a work's format: which one a run judges by, and what it keeps.

The run judges a format by its newest copy dated the app's way - a guessed date counts for
nothing - and with none dated so, asks about one copy naming every other. It never deletes a
copy it did not replace: every other is kept, and the end of the run says how many works still
have more than one, for Resolve issues to sort. The run no longer asks to drop older copies
('duplicates' is retired). The cleanup step's removal machinery is still tested below, marking
files by hand, since a run's history can still hold removals from before.
"""

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from source_code import progress, runs, server, strings
from source_code.actions import shared
from source_code.fileio import FileOps


def make(folder, *names: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name in names: (folder / name).write_bytes(b'x')


def record(work: str) -> dict:
    return {'id': work, 'link': f'https://archiveofourown.org/works/{work}'}


# region finding them

def test_the_copy_dated_the_apps_way_is_judged_by_over_a_newer_guess(tmp_path):
    make(tmp_path, '1 A 2024-01-01.epub', '1 A (2 May 2026).epub')
    found = shared.scan_downloaded_works(str(tmp_path), ['EPUB'])
    assert found['1']['EPUB']['path'].endswith('1 A 2024-01-01.epub')
    assert [os.path.basename(x['path']) for x in found['1']['EPUB']['older']] == ['1 A (2 May 2026).epub']


def test_with_none_dated_the_apps_way_the_newest_guessed_date_is_nominated(tmp_path):
    make(tmp_path, '1 A (14 Aug 2026).epub', '1 A Aug 20 2026.epub', '1 A.epub')
    found = shared.scan_downloaded_works(str(tmp_path), ['EPUB'])
    assert found['1']['EPUB']['path'].endswith('1 A Aug 20 2026.epub')
    assert len(found['1']['EPUB']['older']) == 2


@pytest.mark.parametrize('order', [('1 B.epub', '1 A.epub'), ('1 A.epub', '1 B.epub')])
def test_with_no_date_at_all_the_first_name_alphabetically_is_nominated(tmp_path, order):
    make(tmp_path, *order)
    found = shared.scan_downloaded_works(str(tmp_path), ['EPUB'])
    assert found['1']['EPUB']['path'].endswith('1 A.epub')


def test_the_scan_keeps_the_older_copies_it_passes_over(tmp_path):
    make(tmp_path, '111 A 2024-01-01.pdf', '111 A 2025-06-01.pdf', '111 A.pdf')

    found = shared.scan_downloaded_works(str(tmp_path), ['PDF'])

    newest = found['111']['PDF']
    assert newest['date'] == '2025-06-01'
    assert sorted(x['date'] or '' for x in newest['older']) == ['', '2024-01-01']


def test_only_strictly_older_copies_count(tmp_path):
    # the same date twice cannot say which one to keep, so neither is offered for removal
    make(tmp_path, '111 A 2025-06-01.pdf', '111 A renamed 2025-06-01.pdf', '111 A.pdf')
    existing = shared.scan_downloaded_works(str(tmp_path), ['PDF'])

    older = shared.older_copies(existing, {'111'}, ['PDF'])

    assert [x['file'] for x in older] == ['111 A.pdf']


def test_only_the_runs_own_works_are_looked_at(tmp_path):
    make(tmp_path, '111 A 2024-01-01.pdf', '111 A 2025-06-01.pdf',
         '222 B 2024-01-01.pdf', '222 B 2025-06-01.pdf')
    existing = shared.scan_downloaded_works(str(tmp_path), ['PDF'])

    older = shared.older_copies(existing, {'111'}, ['PDF'])

    assert [(x['id'], x['file'], x['keeping']) for x in older] == [
        ('111', '111 A 2024-01-01.pdf', '111 A 2025-06-01.pdf')]


def test_different_formats_of_a_work_are_not_duplicates(tmp_path):
    make(tmp_path, '111 A 2024-01-01.pdf', '111 A 2025-06-01.html')
    existing = shared.scan_downloaded_works(str(tmp_path), ['PDF', 'HTML'])
    assert shared.older_copies(existing, {'111'}, ['PDF', 'HTML']) == []

# endregion


# region asking, and marking

@pytest.fixture
def library(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    fileops = FileOps()
    fileops.downloadfolder = str(tmp_path / 'library')
    fileops.initialize()
    make(tmp_path / 'library' / 'works', '111 A 2024-01-01.pdf', '111 A 2025-06-01.pdf')
    return fileops


def a_job(fileops: FileOps, answer: str | None) -> server.Job:
    job = server.Job(server.ACTION_BOOKMARKS, ['JSON', 'PDF'], 'Someone')
    job.record = runs.RunRecord(fileops, job.id, job.action, 'Full scan', job.filetypes, {})
    asked = []
    job.ask = lambda question, default: (asked.append(question),
                                         {'choice': answer} if answer else default)[1]
    job.asked = asked
    events: list[dict] = []
    job.steps = server.Steps(events.append, server.step_plan(job))
    job.events_seen = events
    return job


def on_record(fileops: FileOps) -> dict:
    folder = os.path.join(fileops.downloadfolder, strings.RUNS_FOLDER_NAME)
    [name] = os.listdir(folder)
    with open(os.path.join(folder, name), encoding='utf-8') as f:
        return json.load(f)


def settled(fileops: FileOps, job: server.Job) -> dict:
    """Mark the older copy for removal by hand - no run does so any more."""
    existing = shared.scan_downloaded_works(fileops.worksfolder, ['PDF'])
    older = shared.older_copies(existing, {'111'}, ['PDF'])
    for item in older: item['status'] = 'pending'
    job.removals.extend(older)
    if job.record: job.record.removals(job.removals)
    return existing


def noted(fileops: FileOps, job: server.Job) -> dict:
    existing = shared.scan_downloaded_works(fileops.worksfolder, ['PDF'])
    server.note_duplicate_copies(job, [record('111')], existing, ['PDF'])
    return existing


def test_a_run_asks_nothing_about_duplicates_and_marks_nothing(library):
    job = a_job(library, 'newest')
    noted(library, job)
    assert job.asked == []
    assert job.removals == []
    assert sorted(os.listdir(library.worksfolder)) == ['111 A 2024-01-01.pdf', '111 A 2025-06-01.pdf']


def test_the_run_notes_each_format_with_more_than_one_file_and_says_so_at_the_end(library):
    job = a_job(library, None)
    noted(library, job)
    assert job.duplicate_copies == {'111:PDF': 1}

    events: list[dict] = []
    job.emit = events.append
    server.say_duplicate_copies(job)
    assert events == [{'type': progress.DUPLICATE_COPIES, 'works': 1, 'files': 1}]


def test_nothing_is_said_when_no_work_has_more_than_one_file(library):
    os.remove(os.path.join(library.worksfolder, '111 A 2024-01-01.pdf'))
    job = a_job(library, None)
    noted(library, job)
    events: list[dict] = []
    job.emit = events.append
    server.say_duplicate_copies(job)
    assert job.duplicate_copies == {} and events == []


def test_a_page_from_before_still_sending_the_duplicates_answer_is_not_refused():
    assert server.background_answers({'duplicates': {'choice': 'newest'}}) == {}
    assert server.run_question_settings({'duplicates': 'newest'}, None) == ({}, None)

# endregion


# region the cleanup step

def test_cleanup_removes_what_was_marked_and_records_it(library):
    job = a_job(library, 'newest')
    settled(library, job)

    server.cleanup(job, library, MagicMock(written=[]))

    assert sorted(os.listdir(library.worksfolder)) == ['111 A 2025-06-01.pdf']
    assert job.removals[0]['status'] == 'removed'
    assert on_record(library)['removals'][0]['status'] == 'removed'
    marks = [(e['id'], e['status']) for e in job.events_seen if e['type'] == progress.STEP]
    assert marks == [('cleanup', progress.STEP_RUNNING), ('cleanup', progress.STEP_DONE)]


def test_cleanup_with_nothing_marked_is_skipped(library):
    job = a_job(library, None)
    server.cleanup(job, library, None)
    marks = [(e['id'], e['status']) for e in job.events_seen if e['type'] == progress.STEP]
    assert marks == [('cleanup', progress.STEP_SKIPPED)]


def test_a_stopped_run_removes_nothing_and_reports_what_it_had_marked(library):
    job = a_job(library, 'newest')
    settled(library, job)
    job.cancel.set()
    reported: list[dict] = []

    server.finish_run(job, library, MagicMock(written=[], failures=[], skipped_works=[],
                                              kept_copies=[]), reported.append)

    assert len(os.listdir(library.worksfolder)) == 2
    [left] = [e for e in reported if e['type'] == progress.NOT_REMOVED]
    assert left['notRemoved'][0]['file'] == '111 A 2024-01-01.pdf'
    assert left['notRemoved'][0]['error'] == strings.CLEANUP_STOPPED
    assert on_record(library)['removals'][0]['status'] == 'kept'


def test_a_file_this_run_downloaded_over_is_never_removed(library):
    # the older copy's name is the one a fresh download was just written to
    job = a_job(library, 'newest')
    settled(library, job)
    fresh = os.path.join(library.worksfolder, '111 A 2024-01-01.pdf')

    server.cleanup(job, library, MagicMock(written=[fresh]))

    assert os.path.exists(fresh)
    assert job.removals[0]['status'] == 'kept'
    assert job.removals[0]['error'] == strings.CLEANUP_WROTE_OVER


def test_a_file_that_will_not_delete_is_reported(library, monkeypatch):
    job = a_job(library, 'newest')
    settled(library, job)
    monkeypatch.setattr(library, 'delete_file', lambda path: False)
    reported: list[dict] = []

    server.finish_run(job, library, MagicMock(written=[], failures=[], skipped_works=[],
                                              kept_copies=[]), reported.append)

    [left] = [e for e in reported if e['type'] == progress.NOT_REMOVED]
    assert left['notRemoved'][0]['error'] == strings.CLEANUP_NOT_DELETED


def test_a_run_that_fails_still_says_what_it_had_marked(library):
    # marked during the check, then the run dies before the cleanup step
    job = server.Job(server.ACTION_BOOKMARKS, ['JSON', 'PDF'], 'Someone')
    job.ask = lambda question, default: {'choice': 'newest'}
    repo = MagicMock()
    repo.__enter__ = MagicMock(return_value=repo)
    repo.__exit__ = MagicMock(return_value=False)

    def marks_then_fails(job, fileops, repo, report):
        settled(fileops, job)
        raise RuntimeError('the connection dropped')

    with patch.object(server, 'FileOps', return_value=library),          patch.object(server, 'Repository', return_value=repo),          patch.object(server, 'run_bookmarks', marks_then_fails):
        server.run_job(job, 'a-password')

    assert len(os.listdir(library.worksfolder)) == 2
    [left] = [e for e in job.history if e['type'] == progress.NOT_REMOVED]
    assert left['notRemoved'][0]['file'] == '111 A 2024-01-01.pdf'
    assert left['notRemoved'][0]['error'] == strings.CLEANUP_FAILED_RUN
    assert job.history[-1]['type'] == progress.FAILED
    # and the history file says so, not just the modal
    written = on_record(library)
    assert written['removals'][0]['status'] == 'kept'
    assert written['removals'][0]['error'] == strings.CLEANUP_FAILED_RUN


def test_every_plan_cleans_up_just_before_it_reports():
    for action in server.ACTIONS:
        job = server.Job(action, ['JSON', 'HTML'], 'Someone', server.resolve_options(
            {'dates': True} if action == server.ACTION_CUSTOM else None))
        ids = [step for step, _ in server.step_plan(job)]
        assert ids[-2:] == ['cleanup', 'report'], action

# endregion
