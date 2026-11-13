"""A retry carrying on from its earlier attempt asks once whether to read its works again.

The works it takes from the earlier attempt's index entries without reading AO3 again - a walk
or collection that attempt finished, or the works it had settled on for downloading - would be
downloaded and named with the older date that index holds, if AO3 updated them in between. So
the retry asks, once per run and never per file, whether to read each again first
(`reread_carried`, from `plan_refresh`). No is the default, and the answer can be kept for good.
"""

from unittest.mock import MagicMock

import pytest

from source_code import exceptions, server, strings

pytestmark = pytest.mark.retry_reread


def records():
    return [{'id': '1', 'link': 'https://archiveofourown.org/works/1', 'title': 'One',
             'date_updated': '2026-01-01'},
            {'id': '2', 'link': 'https://archiveofourown.org/works/2', 'title': 'Two',
             'date_updated': '2026-01-01'}]


def a_retry(answer=None, mode='downloads', read=()):
    job = server.Job(server.ACTION_BOOKMARKS, ['JSON', 'HTML', 'EPUB'], 'Someone')
    job.resume = {'progress': {'scope': ['1', '2']}}
    job.options['retryMode'] = mode
    asked = []

    def ask(question, default):
        asked.append((question, default))
        return {'choice': answer} if answer else dict(default)

    job.ask = ask
    ao3 = MagicMock()
    ao3.reindexed = set(read)
    ao3.refresh_one.side_effect = lambda record: {**record, 'date_updated': '2026-05-10'}
    job._ao3 = ao3
    return job, ao3, asked


# region asking

def test_it_asks_once_for_the_run_not_once_a_work_or_a_file():
    job, ao3, asked = a_retry()

    server.reread_carried(job, ao3, records())
    server.reread_carried(job, ao3, records())

    assert [q['name'] for q, _ in asked] == [server.RETRY_REREAD_QUESTION]
    assert asked[0][0]['count'] == 2


def test_no_is_the_default_and_downloads_from_the_index_as_it_was_left():
    job, ao3, asked = a_retry()
    works = records()

    assert server.reread_carried(job, ao3, works) == []

    assert asked[0][1] == {'choice': server.RETRY_REREAD_NO}
    ao3.refresh_one.assert_not_called()
    assert [r['date_updated'] for r in works] == ['2026-01-01', '2026-01-01']


def test_yes_reads_each_work_again_once_and_updates_the_entries_the_run_downloads_from():
    job, ao3, _ = a_retry('yes')
    works = records()

    server.reread_carried(job, ao3, works)

    assert ao3.refresh_one.call_count == 2
    # the same dictionaries, so the caller's list now names each file with AO3's date now
    assert [r['date_updated'] for r in works] == ['2026-05-10', '2026-05-10']


def test_a_yes_stands_for_a_later_batch_of_the_same_run():
    job, ao3, asked = a_retry('yes')
    server.reread_carried(job, ao3, records()[:1])
    later = records()[1:]

    server.reread_carried(job, ao3, later)

    assert len(asked) == 1
    assert later[0]['date_updated'] == '2026-05-10'


def test_a_work_that_will_not_read_is_a_failure_and_handed_back_to_be_left_out():
    job, ao3, _ = a_retry('yes')
    ao3.refresh_one.side_effect = lambda record: (
        (_ for _ in ()).throw(exceptions.Ao3DownloaderException('gone'))
        if record['id'] == '1' else {**record, 'date_updated': '2026-05-10'})

    unread = server.reread_carried(job, ao3, records())

    assert [r['id'] for r in unread] == ['1']
    ao3.record_failure.assert_called_once()


def test_a_stop_while_re_reading_unwinds():
    job, ao3, _ = a_retry('yes')
    ao3.refresh_one.side_effect = exceptions.CancelledException()

    with pytest.raises(exceptions.CancelledException):
        server.reread_carried(job, ao3, records())

# endregion

# region which works, on which retries

@pytest.mark.parametrize('mode', ['index', 'redownload', 'downloads', 'failed'])
def test_every_way_that_carries_on_takes_the_works_this_attempt_has_not_read(mode):
    # carrying on from where indexing stopped: the walk this attempt did read work 2 again,
    # but work 1 came from a walk the earlier attempt finished
    job, _, _ = a_retry(mode=mode, read={'2'})

    assert [r['id'] for r in server.carried_records(job, records())] == ['1']


@pytest.mark.parametrize('mode', ['top', 'reindex'])
def test_a_retry_that_reads_every_listing_again_carries_nothing(mode):
    job, _, _ = a_retry(mode=mode)

    assert server.carried_records(job, records()) == []


def test_a_first_attempt_carries_nothing():
    job, _, _ = a_retry()
    job.resume = None

    assert server.carried_records(job, records()) == []


def test_the_check_step_asks_and_leaves_out_a_work_that_would_not_read(monkeypatch):
    job, ao3, asked = a_retry('yes', mode='index', read={'2'})
    ao3.refresh_one.side_effect = exceptions.Ao3DownloaderException('gone')
    monkeypatch.setattr(server.shared, 'scan_downloaded_works', lambda *a, **k: {})
    works = records()

    server.plan_refresh(job, MagicMock(), works, ['HTML'], MagicMock())

    assert [q['name'] for q, _ in asked] == [server.RETRY_REREAD_QUESTION]
    # work 1 could not be read again: it is not downloaded from its old entry
    assert [r['id'] for r in works] == ['2']

# endregion

# region always, and the setting

def test_an_answer_kept_for_good_is_taken_without_asking():
    job = server.Job(server.ACTION_BOOKMARKS, ['HTML'], 'Someone')
    job.always_answers = server.always_answers({server.RETRY_REREAD_QUESTION: 'yes'})
    ao3 = MagicMock()
    ao3.refresh_one.side_effect = lambda record: dict(record)
    job.emit = MagicMock()

    server.reread_carried(job, ao3, records())

    job.emit.assert_not_called()
    assert ao3.refresh_one.call_count == 2


def test_ticking_always_keeps_the_answer_for_the_rest_of_the_run():
    job = server.Job(server.ACTION_BOOKMARKS, ['HTML'], 'Someone')
    job.emit = lambda event: (setattr(job, 'answer', {'choice': 'yes', 'always': True}),
                              job.answered.set())

    job.ask({'name': server.RETRY_REREAD_QUESTION, 'choices': ['no', 'yes']}, {'choice': 'no'})

    assert job.always_answers[server.RETRY_REREAD_QUESTION] == {'choice': 'yes'}


def test_its_default_is_a_setting_and_starts_as_no():
    assert server.ANSWER_SETTING_FOR[server.RETRY_REREAD_QUESTION] == strings.INI_RETRY_REREAD_ANSWER
    assert strings.INI_ANSWER_CHOICES[strings.INI_RETRY_REREAD_ANSWER][0] == 'no'

# endregion
