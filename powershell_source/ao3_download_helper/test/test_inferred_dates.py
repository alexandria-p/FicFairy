"""Replacing a file on a version check is only automatic for a date in the app's own form.

A file's version is the date ending its name, written ` YYYY-MM-DD` by this app. A date
written any other way - `(14 Dec 2024)`, `2024.12.14`, mid-name - can still be read out of the
name the way the Resolve issues window's *Infer date* reads one, but it is only inferred: the
run judges by it and **asks** before replacing, saying what it *thinks* and recommending, and
keeps the file if nobody answers. Six cases: from AO3 or FicHub, and the guessed date older,
the same or newer, or unreadable - each with its own default, and an answer you can choose to
always use.
"""

import json
import threading
import os
from unittest.mock import MagicMock

import pytest

from source_code import parse_text, server, strings
from source_code.actions import shared
from source_code.ao3 import Ao3

LINK = 'https://archiveofourown.org/works/75354806'

# region what counts as the app's own date

@pytest.mark.parametrize('name, date', [
    ('75354806 Wolfbird - OpalApparition 2026-04-27.epub', '2026-04-27'),
    ('75354806 Wolfbird - OpalApparition (27 Apr 2026).epub', None),
    ('75354806 Wolfbird - OpalApparition 2026.04.27.epub', None),
    # no space before it: not how this app writes one
    ('75354806 Wolfbird - OpalApparition_2026-04-27.epub', None),
    # not a real day
    ('75354806 Wolfbird - OpalApparition 2026-13-45.epub', None),
])
def test_only_a_date_written_the_apps_way_is_a_files_version(name, date):
    assert parse_text.get_date_from_filename(name) == date


def test_a_date_written_another_way_can_still_be_inferred():
    assert parse_text.infer_date_from_filename(
        '75354806 Wolfbird - OpalApparition (27 Apr 2026).epub') == '2026-04-27'

# endregion

# region asking, case by case

def answering_job(answer=None):
    job = server.Job(server.ACTION_BOOKMARKS, ['EPUB'], 'Someone')
    asked = []

    def ask(question, default):
        asked.append((question, default))
        return dict(default) if answer is None else {'choice': answer}
    job.ask = ask
    return job, asked


def a_plan(copies: dict, date='2026-04-27', overwrite=False):
    records = [{'id': '75354806', 'link': LINK, 'date_updated': date}]
    existing = {'75354806': {fmt: {'path': f'works/{name}',
                                   'date': parse_text.get_date_from_filename(name)}
                             for fmt, name in copies.items()}}
    plan = shared.plan_downloads(records, existing, list(copies), overwrite=overwrite)
    return records, existing, plan


@pytest.mark.parametrize('overwrite, name, scenario, recommended, why', [
    (False, '75354806 Wolfbird (14 Dec 2024).epub', 'ao3-older', 'yes',
     "looks dated 14 December 2024 (a guess), so we think AO3's version (27 April 2026) is newer - we recommend replacing it"),
    (False, '75354806 Wolfbird (27 Apr 2026).epub', 'ao3-newer', 'no',
     "looks dated 27 April 2026 (a guess), the same as AO3's version (27 April 2026) - we recommend keeping yours"),
    (False, '75354806 Wolfbird (1 Oct 2026).epub', 'ao3-newer', 'no',
     "so we think yours is newer than AO3's version (27 April 2026) - we recommend keeping yours"),
    # no date to read from AO3: probably safe to take AO3's own copy, on any run (kept by default)
    (False, '75354806 Wolfbird.epub', 'ao3-unknown', 'yes',
     "the incoming copy is AO3's own, so it is probably safe to replace it - we recommend replacing it"),
    # an overwriting run: older or the same is recommended for replacing, as a file with the
    # app's own date would be replaced
    (True, '75354806 Wolfbird (14 Dec 2024).epub', 'ao3-older', 'yes',
     "so we think AO3's version (27 April 2026) is newer - we recommend replacing it"),
    (True, '75354806 Wolfbird (27 Apr 2026).epub', 'ao3-older', 'yes',
     "the same as AO3's version (27 April 2026), and this run overwrites - we recommend replacing it"),
    (True, '75354806 Wolfbird (1 Oct 2026).epub', 'ao3-newer', 'no',
     "so we think yours is newer than AO3's version (27 April 2026) - we recommend keeping yours"),
    (True, '75354806 Wolfbird.epub', 'ao3-unknown', 'yes',
     "the incoming copy is AO3's own, so it is probably safe to replace it - we recommend replacing it"),
])
def test_a_file_without_the_apps_own_date_is_asked_about_by_its_case_and_kept_by_default(
        overwrite, name, scenario, recommended, why):
    records, existing, plan = a_plan({'EPUB': name}, overwrite=overwrite)
    job, asked = answering_job()

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'], overwriting=overwrite)

    [(question, default)] = asked
    assert question['name'] == server.INFERRED_DATE_QUESTION and question['scenario'] == scenario
    assert question['recommended'] == recommended and question['choices'] == ['yes', 'no', 'both']
    assert why in question['reasons']['EPUB']
    assert default == {'choice': 'no'}
    # nobody answering keeps the file, whatever was recommended, overwriting or not
    assert 'EPUB' not in plan['superseded'].get(LINK, {})
    assert plan['keep'] == {LINK: {'EPUB'}} and LINK not in plan['stale']
    assert LINK not in plan['undated']


def test_each_format_of_a_work_is_asked_about_on_its_own_even_in_the_same_case():
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub',
                                      'PDF': '75354806 Wolfbird (1 Jan 2025).pdf',
                                      'HTML': '75354806 Wolfbird.html'})
    job, asked = answering_job()

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB', 'PDF', 'HTML'])

    assert [(q['scenario'], q['formats']) for q, _ in asked] == \
        [('ao3-older', ['EPUB']), ('ao3-older', ['PDF']), ('ao3-unknown', ['HTML'])]


def test_with_no_copy_dated_the_apps_way_the_question_names_every_other_copy_and_keeps_them(capsys):
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'})
    existing['75354806']['EPUB']['older'] = [{'path': 'works/75354806 Wolfbird copy.epub', 'date': None}]
    job, asked = answering_job('yes')

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'])

    [(question, _)] = asked
    assert question['fileNames'] == {'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'}
    assert question['otherFiles'] == {'EPUB': ['75354806 Wolfbird copy.epub']}
    # only the copy asked about is replaced: the other is kept, never deleted
    assert plan['superseded'][LINK] == {'EPUB': 'works/75354806 Wolfbird (14 Dec 2024).epub'}
    assert ('you also have other EPUB copies of it - these will be kept for now, and can be cleaned '
            'up later: 75354806 Wolfbird copy.epub') in capsys.readouterr().out


def test_each_formats_answer_decides_that_format_alone():
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub',
                                      'PDF': '75354806 Wolfbird (1 Jan 2025).pdf'})
    job, asked = answering_job()
    job.ask = lambda q, d: asked.append((q, d)) or {'choice': 'yes' if q['formats'] == ['PDF'] else 'no'}

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB', 'PDF'])

    assert list(plan['superseded'][LINK]) == ['PDF']
    assert plan['keep'][LINK] == {'EPUB'}


@pytest.mark.parametrize('answer, replaced', [('no', False), ('yes', True)])
def test_the_answer_decides_whether_the_file_is_replaced(answer, replaced):
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'})
    job, asked = answering_job(answer)

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'])

    assert (LINK in plan['stale']) is replaced
    assert ('EPUB' in plan['superseded'].get(LINK, {})) is replaced


def test_an_overwriting_run_still_replaces_a_file_with_the_apps_own_date_unasked():
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird 2026-04-27.epub'}, overwrite=True)
    job, asked = answering_job()

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'], overwriting=True)

    assert asked == [] and 'EPUB' in plan['superseded'][LINK]

@pytest.mark.parametrize('name', ['75354806 Wolfbird (14 Dec 2024).epub',
                                  '75354806 Wolfbird (1 Oct 2026).epub',
                                  '75354806 Wolfbird.epub'])
def test_keep_both_is_offered_for_every_case_and_fetches_the_format_without_replacing_anything(name):
    records, existing, plan = a_plan({'EPUB': name})
    job, asked = answering_job('both')

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'])

    assert asked[0][0]['choices'] == ['yes', 'no', 'both']
    # fetched, with no older copy named to remove
    assert plan['superseded'][LINK] == {'EPUB': server.KEEP_BOTH}
    assert LINK in plan['stale']
    assert LINK not in plan.get('keep', {})


def test_keep_both_is_not_offered_without_an_incoming_date_to_name_the_new_file_by():
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'}, date='')
    job, asked = answering_job('both')

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'])

    assert asked[0][0]['choices'] == ['yes', 'no']
    # an answer it was not offered keeps the file
    assert LINK not in plan['stale']


def test_keep_both_leaves_your_file_and_saves_the_new_version_beside_it(fake_fileops):
    os.makedirs(os.path.join(fake_fileops.downloadfolder, strings.WORKS_FOLDER_NAME), exist_ok=True)
    yours = os.path.join(fake_fileops.downloadfolder, strings.WORKS_FOLDER_NAME,
                         '75354806 Wolfbird (14 Dec 2024).epub')
    with open(yours, 'w') as f: f.write('what you had')
    ao3 = Ao3(MagicMock(), fake_fileops, ['EPUB'], None, False, False)
    ao3.superseded = {LINK: {'EPUB': server.KEEP_BOTH}}

    ao3.save_download(LINK, 'EPUB', '75354806 Wolfbird - OpalApparition 2026-04-27.epub', b'new')

    assert sorted(os.listdir(os.path.dirname(yours))) == \
        ['75354806 Wolfbird (14 Dec 2024).epub', '75354806 Wolfbird - OpalApparition 2026-04-27.epub']


# endregion

# region the answer to always use, and each case's own default

def a_real_job():
    return server.Job(server.ACTION_BOOKMARKS, ['EPUB'], 'Someone')


def test_an_answer_chosen_to_always_use_is_taken_without_asking(capsys):
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'})
    job = a_real_job()
    job.always_answers = server.always_answers({'ao3-older': 'yes'})

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'])

    assert not [e for e in job.history if e['type'] == 'question']
    assert 'EPUB' in plan['superseded'][LINK]
    assert 'you chose to always answer this the same way: yes' in capsys.readouterr().out


def test_an_answer_to_always_use_reaches_only_its_own_case():
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'})
    job = a_real_job()
    job.always_answers = server.always_answers({'fichub-older': 'yes', 'ao3-newer': 'yes'})
    job.cancel.set()   # asked for real: a stop keeps the file

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'])

    assert [e['scenario'] for e in job.history if e['type'] == 'question'] == ['ao3-older']
    assert 'EPUB' not in plan['superseded'].get(LINK, {})


def test_ticking_always_during_a_run_answers_the_rest_of_that_case():
    job = a_real_job()
    threading.Timer(0.05, lambda: job.reply({'choice': 'yes', 'date': '', 'always': True})).start()
    question = {'name': server.INFERRED_DATE_QUESTION, 'scenario': 'ao3-older', 'count': 1}

    assert job.ask(question, {'choice': 'no'})['choice'] == 'yes'
    assert job.ask(question, {'choice': 'no'})['choice'] == 'yes'
    assert len([e for e in job.history if e['type'] == 'question']) == 1
    # another case is still asked
    job.cancel.set()
    job.ask({**question, 'scenario': 'ao3-unknown'}, {'choice': 'no'})
    assert len([e for e in job.history if e['type'] == 'question']) == 2


def test_each_case_takes_its_own_default_from_settings_ini(monkeypatch):
    monkeypatch.setattr(server, 'unsure_question_timeout_seconds', lambda: 0)
    monkeypatch.setattr(server, 'configured_answer',
                        lambda name, builtin, chosen=None:
                        {**builtin, 'choice': 'yes'} if name == 'ao3-older' else dict(builtin))
    job = a_real_job()
    job.question_timeout_minutes = 0

    older = job.ask({'name': server.INFERRED_DATE_QUESTION, 'scenario': 'ao3-older'}, {'choice': 'no'})
    unknown = job.ask({'name': server.INFERRED_DATE_QUESTION, 'scenario': 'ao3-unknown'}, {'choice': 'no'})

    assert older['choice'] == 'yes' and unknown['choice'] == 'no'


def test_every_case_has_a_default_setting_in_the_template():
    for scenario, key in server.SCENARIO_SETTINGS.items():
        assert strings.INI_ANSWER_CHOICES[key][0] == 'no', scenario


def test_keep_both_can_be_the_answer_to_always_use_and_a_cases_default():
    assert server.always_answers({'fichub-unknown': 'both'}) == {'fichub-unknown': {'choice': 'both'}}
    for key in server.SCENARIO_SETTINGS.values():
        assert 'both' in strings.INI_ANSWER_CHOICES[key]
    # not for the re-read question, which has no file to keep
    with pytest.raises(ValueError):
        server.always_answers({server.RETRY_REREAD_QUESTION: 'both'})


@pytest.mark.parametrize('raw, problem', [
    ({'ao3-sideways': 'yes'}, 'no case called'),
    ({'ao3-older': 'maybe'}, 'not an answer to always use'),
    (['ao3-older'], 'given by case'),
])
def test_answers_to_always_use_are_checked_before_a_run_starts(raw, problem):
    with pytest.raises(ValueError, match=problem):
        server.always_answers(raw)

# endregion

# region the long way round (a full scan writing no index)

@pytest.mark.parametrize('overwrite', [False, True])
@pytest.mark.parametrize('name, date, asks', [
    ('75354806 Wolfbird (14 Dec 2024).epub', None, True),
    ('75354806 Wolfbird.epub', None, True),
    # the app's own date: replaced unasked only when overwriting, or behind
    ('75354806 Wolfbird 2026-04-27.epub', '2026-04-27', False),
])
def test_the_long_way_asks_before_replacing_a_file_without_the_apps_own_date(
        fake_fileops, overwrite, name, date, asks):
    job, asked = answering_job()
    ao3 = Ao3(MagicMock(), fake_fileops, ['EPUB'], None, False, False)
    ao3.existing_copies = {'75354806': {'EPUB': {'path': f'works/{name}', 'date': date}}}
    ao3.overwriting = overwrite
    ao3.judge_copy = lambda *copy: server.judge_long_way(job, ao3, *copy)

    fetch = ao3.page_verdict(LINK, '75354806', 'EPUB', '2026-04-27')

    assert bool(asked) is asks
    if asks: assert asked[0][0]['name'] == server.INFERRED_DATE_QUESTION
    # nobody answering keeps it; an app-dated current copy is fetched only to overwrite it
    assert fetch is (overwrite and not asks)


def test_an_overwriting_long_way_asks_before_replacing_a_newer_copy(fake_fileops):
    job, asked = answering_job()
    ao3 = Ao3(MagicMock(), fake_fileops, ['EPUB'], None, False, False)
    ao3.existing_copies = {'75354806': {'EPUB': {'path': 'works/75354806 W 2026-10-01.epub',
                                                 'date': '2026-10-01'}}}
    ao3.overwriting = True
    ao3.judge_copy = lambda *copy: server.judge_long_way(job, ao3, *copy)

    assert ao3.page_verdict(LINK, '75354806', 'EPUB', '2026-04-27') is False
    assert [q['name'] for q, _ in asked] == [server.OVERWRITE_OLDER_QUESTION]

# endregion

# region in a scan

@pytest.fixture
def library(fake_fileops):
    for name in (strings.INDEXING_FOLDER_NAME, strings.WORKS_FOLDER_NAME):
        os.makedirs(os.path.join(fake_fileops.downloadfolder, name), exist_ok=True)
    return fake_fileops


def a_copy(library, name: str) -> None:
    with open(os.path.join(library.downloadfolder, strings.WORKS_FOLDER_NAME, name), 'w') as f:
        f.write('what you had')


def indexed(library, date: str) -> None:
    folder = os.path.join(library.downloadfolder, strings.INDEXING_FOLDER_NAME)
    with open(os.path.join(folder, '75354806 Wolfbird - OpalApparition.json'), 'w', encoding='utf-8') as f:
        json.dump({'id': '75354806', 'link': LINK, 'title': 'Wolfbird', 'date_updated': date}, f)


def test_a_scan_asks_about_a_guessed_date_and_a_missing_one_with_no_batch_question(library):
    indexed(library, '2026-01-01')
    a_copy(library, '75354806 Wolfbird - OpalApparition (14 Dec 2024).epub')
    a_copy(library, '1 Other.epub')
    folder = os.path.join(library.downloadfolder, strings.INDEXING_FOLDER_NAME)
    with open(os.path.join(folder, '1 Other.json'), 'w', encoding='utf-8') as f:
        json.dump({'id': '1', 'link': 'https://archiveofourown.org/works/1', 'date_updated': '2026-01-01'}, f)
    job, asked = answering_job()
    job.ao3 = Ao3(MagicMock(), library, ['EPUB'], None, False, False)
    records = [{'id': '75354806', 'link': LINK, 'date_updated': '2026-04-27'},
               {'id': '1', 'link': 'https://archiveofourown.org/works/1', 'date_updated': '2026-04-27'}]

    plan = server.plan_refresh(job, library, records, ['EPUB'], MagicMock())

    # one question per work and case; nobody answering keeps both
    assert [(q['ids'], q['scenario']) for q, _ in asked] == \
        [(['75354806'], 'ao3-older'), (['1'], 'ao3-unknown')]
    assert plan['stale'] == []

# endregion

# region from FicHub

def wolfbird() -> dict:
    path = os.path.join(os.path.dirname(__file__), 'fixtures', 'fichub', 'wolfbird.json')
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def a_rescue(library, monkeypatch, answer=None):
    fetched: list[str] = []
    monkeypatch.setattr(server.fichub, 'lookup', lambda repo, link: wolfbird())
    monkeypatch.setattr(server.fichub, 'download',
                        lambda repo, answer, filetype: fetched.append(filetype) or b'from fichub')
    job = server.Job(server.ACTION_BOOKMARKS, ['JSON', 'EPUB'], 'Someone')
    asked = []

    def ask(question, default):
        asked.append((question, default))
        if question['name'] == server.FICHUB_QUESTION: return {'choice': 'yes'}
        return dict(default) if answer is None else {'choice': answer}
    job.ask = ask
    ao3 = Ao3(MagicMock(), library, ['EPUB'], None, False, False)
    ao3.failures = [{'id': '75354806', 'link': LINK, 'error': 'not a work file (404)'}]
    server.rescue_with_fichub(job, library, ao3, MagicMock())
    return fetched, asked


@pytest.mark.fichub
@pytest.mark.parametrize('index_date', ['2026-04-27', '2026-05-10'])
@pytest.mark.parametrize('name', ['75354806 Wolfbird - OpalApparition (14 Dec 2024).epub',
                                  '75354806 Wolfbird - OpalApparition (1 Oct 2026).epub',
                                  '75354806 Wolfbird - OpalApparition.epub'])
@pytest.mark.parametrize('answer, replaced', [(None, False), ('yes', True)])
def test_fichub_always_asks_before_replacing_a_file_without_the_apps_own_date(
        library, monkeypatch, index_date, name, answer, replaced):
    # FicHub's copy is 2026-04-27: as new as the index, or older than it - asked either way,
    # whether the guessed date is older, newer, or cannot be read
    indexed(library, index_date)
    a_copy(library, name)

    fetched, asked = a_rescue(library, monkeypatch, answer)

    names = [q['name'] for q, _ in asked]
    assert names[-1] == server.INFERRED_DATE_QUESTION
    question, default = asked[-1]
    assert question['source'] == 'FicHub' and question['date'] == '2026-04-27'
    assert question['scenario'] == ('fichub-older' if '14 Dec' in name
                                    else 'fichub-newer' if '1 Oct' in name else 'fichub-unknown')
    assert question['recommended'] == ('yes' if '14 Dec' in name else 'no')
    assert default == {'choice': 'no'}
    assert fetched == (['EPUB'] if replaced else [])


@pytest.mark.fichub
@pytest.mark.parametrize('index_date', ['2026-04-27', '2026-05-10'])
def test_keep_both_saves_fichubs_copy_beside_yours_and_removes_nothing(library, monkeypatch, index_date):
    # as new as the index, or older than it: kept, with FicHub's copy saved beside it
    indexed(library, index_date)
    a_copy(library, '75354806 Wolfbird - OpalApparition (14 Dec 2024).epub')

    fetched, asked = a_rescue(library, monkeypatch, 'both')

    assert asked[-1][0]['choices'] == ['yes', 'no', 'both']
    assert fetched == ['EPUB']
    works = sorted(os.listdir(os.path.join(library.downloadfolder, strings.WORKS_FOLDER_NAME)))
    assert works[0] == '75354806 Wolfbird - OpalApparition (14 Dec 2024).epub'
    assert len(works) == 2 and works[1].endswith(' 2026-04-27.epub')

# endregion


# region what the question shows, and how long it waits

def test_the_question_names_each_file_whole_and_writes_dates_as_a_reader_would():
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'})
    job, asked = answering_job()

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'])

    [(question, _)] = asked
    assert question['fileNames'] == {'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'}
    assert '14 December 2024' in question['reasons']['EPUB']
    assert '27 April 2026' in question['reasons']['EPUB']


def test_the_history_keeps_the_file_its_dates_and_the_answer():
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub'})
    job, asked = answering_job('yes')
    job.record = MagicMock()

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB'])

    kept = job.record.choice.call_args.args[0]
    assert kept['fileNames'] == ['75354806 Wolfbird (14 Dec 2024).epub']
    assert kept['fileDates'] == {'EPUB': '2024-12-14'} and kept['date'] == '2026-04-27'
    assert kept['scenario'] == 'ao3-older' and kept['choice'] == 'yes'


def test_a_guessed_date_question_waits_one_minute_by_default_and_others_keep_theirs():
    assert server.unsure_question_timeout_seconds() == 60
    assert server.question_timeout_seconds() == 30 * 60


def test_a_guessed_date_question_takes_its_own_timeout_from_the_page():
    job = a_real_job()
    job.unsure_timeout_minutes = 0
    job.question_timeout_minutes = 30

    got = job.ask({'name': server.INFERRED_DATE_QUESTION, 'scenario': 'ao3-unknown'}, {'choice': 'no'})

    # 0 is at once: not asked, the default taken
    assert got == {'choice': 'no'}
    assert not [e for e in job.history if e['type'] == 'question']


@pytest.mark.parametrize('stamp, said', [
    ('2026-05-13', '13 May 2026'), ('2024-12-01', '1 December 2024'), ('', ''), ('soon', 'soon')])
def test_a_date_is_written_day_month_year(stamp, said):
    assert parse_text.written_date(stamp) == said

# endregion


# region the end of a run suggests dating them

def test_a_run_counts_every_file_it_judged_without_the_apps_own_date_and_says_so_at_the_end():
    records, existing, plan = a_plan({'EPUB': '75354806 Wolfbird (14 Dec 2024).epub',
                                      'HTML': '75354806 Wolfbird.html'})
    job, asked = answering_job()
    # an answer chosen to always use still counts: the file is still undated
    job.always_answers['ao3-unknown'] = {'choice': 'no'}
    emitted = []
    job.emit = emitted.append

    server.ask_about_unsure_copies(job, records, existing, plan, ['EPUB', 'HTML'])
    server.say_unsure_files(job)

    assert len(job.unsure_files) == 2
    assert emitted == [{'type': 'unsureFiles', 'count': 2}]


def test_a_run_that_met_none_says_nothing_about_them():
    job, _ = answering_job()
    emitted = []
    job.emit = emitted.append
    server.say_unsure_files(job)
    assert emitted == []

# endregion
