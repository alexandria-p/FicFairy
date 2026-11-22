"""Work skins: the CSS an author attaches to a work on AO3, which AO3's own download leaves out.

A run asked to (`skins`, a debug option for now) saves each work's skin beside the works as
`skins/<worknum>.css` - never in the html. A work page the run reads anyway gives the skin for
nothing; otherwise, for each work whose html it downloads, the work is noted and its page read
once, in a step of its own after every download (`fetch_pending_skins`).
"""

import os
from unittest.mock import MagicMock

import pytest
from bs4 import BeautifulSoup

from source_code import exceptions, parse_soup, server, strings
from source_code.fileio import FileOps
from source_code.storage import LocalStorage
from test.test_ao3 import saving_for_real

FIXTURES = os.path.join(os.path.dirname(__file__), 'fixtures')
DOWNLOADED_HTML = os.path.join(FIXTURES, 'ebook', '23009290', 'current', 'htmlTest.html')


def page(name: str) -> BeautifulSoup:
    with open(os.path.join(FIXTURES, name + '.html'), encoding='utf-8') as f:
        return BeautifulSoup(f.read(), 'html.parser')


def downloaded() -> bytes:
    with open(DOWNLOADED_HTML, 'rb') as f:
        return f.read()


SKIN = '#workskin .papyrus { font-family: papyrus, fantasy; }'


# region reading a skin off a work page

def test_a_work_page_with_a_skin_gives_its_css():
    css = parse_soup.get_work_skin(page('unlockedWork'))

    assert css.startswith('#workskin .centered')
    assert '</style' not in css


def test_a_work_page_without_a_skin_gives_none():
    assert parse_soup.get_work_skin(page('unlockedWorkNoSkin')) == ''

# endregion


# region a skin is never put into the html

def test_ao3s_downloaded_html_carries_no_skin_of_its_own():
    # the reason for fetching it at all: AO3's download leaves the author's css out
    text = downloaded().decode('utf-8')

    assert 'id="workskin"' not in text


def test_nothing_in_the_helper_writes_a_skin_into_html():
    # at the owner's instruction: a skin is saved as css beside the works, never put into html
    import inspect
    from source_code import ao3 as ao3_module
    for module in (ao3_module, server):
        source = inspect.getsource(module)
        assert 'with_skin' not in source
        assert 'id="workskin"' not in source



# region during a download

def skinning(tmp_path, pages: dict[str, BeautifulSoup]):
    ao3 = saving_for_real(tmp_path)
    ao3.skins = True
    ao3.filetypes = ['HTML', 'EPUB']
    ao3.repo.get_soup.side_effect = lambda url: pages[url]
    ao3.repo.last_status = 200
    ao3.repo.download_file.side_effect = lambda link, filetype: (
        downloaded() if filetype == 'HTML' else b'epub bytes')
    return ao3


RECORD = {'id': '41822007', 'link': 'https://archiveofourown.org/works/41822007',
          'title': 'A Work', 'author': ['Writer'], 'date_updated': '2024-12-14'}
WORK_PAGE = 'https://archiveofourown.org/works/41822007'


def saved(tmp_path, ext: str) -> bytes:
    found = [x for x in os.listdir(tmp_path / strings.WORKS_FOLDER_NAME) if x.endswith(ext)]
    assert len(found) == 1
    return (tmp_path / strings.WORKS_FOLDER_NAME / found[0]).read_bytes()


def the_skins_step(ao3, tmp_path, skip=False):
    """Run the step that reads the skins the downloads left for later, as `finish_run` does."""
    fileops = ao3.fileops
    fileops.worksfolder = str(tmp_path / strings.WORKS_FOLDER_NAME)
    fileops.storage = LocalStorage(str(tmp_path))
    fileops.list_files.side_effect = lambda folder: FileOps.list_files(fileops, folder)
    fileops.read_text.side_effect = lambda path: FileOps.read_text(fileops, path)
    job = MagicMock()
    job.skipping.return_value = skip
    job.steps.plan = [('skins', strings.STEP_SKINS_FOR_HTML)]
    reported = []
    server.fetch_pending_skins(job, fileops, ao3, reported.append)
    return job, reported


def test_an_indexed_download_leaves_the_skin_for_its_own_step_and_never_holds_up_the_download(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    # no work page read between downloads: the file is saved as AO3 sent it, the work noted
    ao3.repo.get_soup.assert_not_called()
    assert saved(tmp_path, '.html') == downloaded()
    assert ao3.skins_pending == ['41822007']


def test_the_skins_step_reads_each_page_once_and_saves_its_skin_as_css_only(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    job, _ = the_skins_step(ao3, tmp_path)

    assert ao3.repo.get_soup.call_count == 1
    # never put into the html - every file stays exactly as AO3 sent it
    assert saved(tmp_path, '.html') == downloaded()
    assert saved(tmp_path, '.epub') == b'epub bytes'
    css = (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').read_text(encoding='utf-8')
    assert css.startswith('#workskin .centered')
    job.steps.start.assert_called_once_with('skins')
    job.steps.done.assert_called_once_with('skins')
    assert ao3.skin_failures == []


def test_a_work_page_the_run_already_read_costs_no_second_request(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.fetch_page(WORK_PAGE, work=True)  # as a fic run's lookup or an update pass reads it

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    assert ao3.repo.get_soup.call_count == 1
    assert saved(tmp_path, '.html') == downloaded()
    assert (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').exists()
    # nothing left for the step, which then has nothing to do
    assert ao3.skins_pending == []
    job, _ = the_skins_step(ao3, tmp_path)
    assert ao3.repo.get_soup.call_count == 1
    job.steps.skip.assert_called_once_with('skins')


def test_ticked_a_work_page_the_run_read_anyway_has_its_skin_saved_as_css_for_free(tmp_path):
    # the fic runs and the update pass read each work's page anyway: its skin costs nothing
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})

    ao3.fetch_page(WORK_PAGE, work=True)

    assert ao3.repo.get_soup.call_count == 1
    css = (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').read_text(encoding='utf-8')
    assert css.startswith('#workskin .centered')


def test_unticked_a_work_page_the_run_read_saves_no_skin(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.skins = False
    ao3.fetch_page(WORK_PAGE, work=True)

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    assert not (tmp_path / strings.SKINS_FOLDER_NAME).exists()
    assert saved(tmp_path, '.html') == downloaded()
    assert ao3.skins_pending == []


def test_a_page_read_without_a_skin_is_noted_as_having_none(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWorkNoSkin')})

    ao3.fetch_page(WORK_PAGE, work=True)

    assert (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.none').exists()


def test_a_page_read_twice_in_a_run_saves_its_skin_once(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.fetch_page(WORK_PAGE, work=True)
    ao3.fetch_page(WORK_PAGE, work=True)

    skin_writes = [c for c in ao3.fileops.save_bytes.call_args_list if strings.SKINS_FOLDER_NAME in c.args[0]]
    assert len(skin_writes) == 1


def test_unticked_a_work_whose_page_was_not_read_gets_no_skin_and_no_request(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.skins = False
    ao3.fetch_page(WORK_PAGE, work=True)
    other = dict(RECORD, id='7', link='https://archiveofourown.org/works/7')

    ao3.download_one_indexed(other, 100, {}, 1, 1)

    assert ao3.repo.get_soup.call_count == 1  # only the page read for the other work
    assert ao3.skins_pending == []
    assert not (tmp_path / strings.SKINS_FOLDER_NAME / '7.css').exists()


def test_the_work_dates_pass_gives_the_skin_for_nothing_too(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.note_skin(WORK_PAGE, page('unlockedWork'))  # as any work page read does

    assert ao3.skin_css['41822007'].startswith('#workskin .centered')
    import inspect
    from source_code.ao3 import Ao3
    # every place that reads a work page notes its skin
    for name in ('index_one_work', 'refresh_one', 'try_download'):
        source = inspect.getsource(getattr(Ao3, name))
        assert 'note_skin' in source or 'work=True' in source, name


def test_a_work_without_a_skin_is_saved_as_ao3_sent_it_and_asked_about_once(tmp_path, capsys):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWorkNoSkin')})

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)
    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)
    the_skins_step(ao3, tmp_path)

    assert ao3.repo.get_soup.call_count == 1
    assert saved(tmp_path, '.html') == downloaded()
    # noted as having none, so the next run does not ask
    assert (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.none').exists()
    assert not (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').exists()
    assert strings.AO3_INFO_SKIN_NONE.format('41822007') in capsys.readouterr().out
    assert ao3.skin_failures == []


def test_no_work_page_is_read_when_the_run_writes_no_html(tmp_path):
    ao3 = skinning(tmp_path, {})
    ao3.filetypes = ['EPUB']

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)
    the_skins_step(ao3, tmp_path)

    ao3.repo.get_soup.assert_not_called()


def test_without_the_option_nothing_is_read_and_nothing_changed(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.skins = False

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)
    the_skins_step(ao3, tmp_path)

    ao3.repo.get_soup.assert_not_called()
    assert saved(tmp_path, '.html') == downloaded()
    assert not (tmp_path / strings.SKINS_FOLDER_NAME).exists()


def test_a_page_that_will_not_read_is_listed_and_costs_the_skin_and_nothing_else(tmp_path, capsys):
    ao3 = skinning(tmp_path, {})
    ao3.repo.get_soup.side_effect = exceptions.InvalidStatusCodeException('503')

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)
    the_skins_step(ao3, tmp_path)

    assert saved(tmp_path, '.html') == downloaded()
    assert ao3.failures == []
    assert 'could not read the work skin of work 41822007' in capsys.readouterr().out
    assert [x['id'] for x in ao3.skin_failures] == ['41822007']
    assert '503' in ao3.skin_failures[0]['error']


def test_a_stop_in_the_skins_step_still_ends_the_run(tmp_path):
    ao3 = skinning(tmp_path, {})
    ao3.repo.get_soup.side_effect = exceptions.CancelledException()
    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    with pytest.raises(exceptions.CancelledException):
        the_skins_step(ao3, tmp_path)


def test_skip_this_step_leaves_the_rest_without_skins(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    job, _ = the_skins_step(ao3, tmp_path, skip=True)

    ao3.repo.get_soup.assert_not_called()
    assert saved(tmp_path, '.html') == downloaded()
    job.steps.skip.assert_called_once_with('skins')
    job.steps.done.assert_not_called()


OTHER = {'id': '7', 'link': 'https://archiveofourown.org/works/7',
         'title': 'Another', 'author': ['Writer'], 'date_updated': '2024-12-14'}


def recorded_job(ao3):
    """A run whose record is in memory, handed the downloader as a runner hands it."""
    job = server.Job(server.ACTION_BOOKMARKS, ['HTML'], 'Someone', server.resolve_options({'skins': True}))
    job.record = MagicMock()
    job.record.data = {}
    job.ao3 = ao3
    return job


def test_the_record_lists_each_work_waiting_for_its_skin_as_it_is_added(tmp_path):
    ao3 = skinning(tmp_path, {})
    job = recorded_job(ao3)

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 2)
    assert job.record.data['skinsPending'] == ['41822007']
    ao3.download_one_indexed(dict(OTHER), 100, {}, 2, 2)
    assert job.record.data['skinsPending'] == ['41822007', '7']


def test_the_skins_step_takes_each_work_off_the_list_as_it_is_dealt_with(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    job = recorded_job(ao3)
    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 2)
    ao3.download_one_indexed(dict(OTHER), 100, {}, 2, 2)
    seen = []
    real = ao3.skin_for

    def stop_on_the_second(work, saving_only=False):
        seen.append(list(job.record.data['skinsPending']))
        if work == '7': raise exceptions.CancelledException()
        return real(work, saving_only)

    ao3.skin_for = stop_on_the_second
    with pytest.raises(exceptions.CancelledException):
        the_skins_step(ao3, tmp_path)

    # the first was had and taken off; a stop leaves the second listed in the record
    assert seen == [['41822007', '7'], ['7']]
    assert job.record.data['skinsPending'] == ['7']


def test_a_work_whose_skin_failed_leaves_the_waiting_list_for_the_failures(tmp_path):
    ao3 = skinning(tmp_path, {})
    ao3.repo.get_soup.side_effect = exceptions.InvalidStatusCodeException('503')
    job = recorded_job(ao3)
    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    the_skins_step(ao3, tmp_path)

    assert job.record.data['skinsPending'] == []
    assert [x['id'] for x in ao3.skin_failures] == ['41822007']


def test_the_skins_saved_are_kept_with_the_run_in_order_and_none_are_left_out(tmp_path):
    from source_code import runs
    other = 'https://archiveofourown.org/works/7'
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork'), other: page('unlockedWorkNoSkin')})
    ao3.fetch_page(WORK_PAGE, work=True)
    ao3.fetch_page(other, work=True)
    ao3.fetch_page(WORK_PAGE, work=True)  # read again: saved once, listed once

    assert ao3.skins_found == ['41822007']
    record = runs.RunRecord.__new__(runs.RunRecord)
    record.data = {}
    record.collect(ao3)
    assert record.data['skinsSaved'] == ['41822007']


def test_skins_still_waiting_are_reported_and_kept_with_the_run():
    from source_code import progress, runs
    ao3 = MagicMock()
    ao3.failures, ao3.skipped_works, ao3.skin_failures = [], [], []
    ao3.skins = True
    ao3.skins_pending = ['1', '2']
    reported = []
    server.report_failures(ao3, reported.append)

    assert {'type': progress.SKINS_PENDING, 'skinsPending': ['1', '2']} in reported
    record = runs.RunRecord.__new__(runs.RunRecord)
    record.data = {}
    record.collect(ao3)
    assert record.data['skinsPending'] == ['1', '2']
    # a run not fetching skins keeps no such list
    ao3.skins = False
    record.collect(ao3)
    assert record.data['skinsPending'] == []


def test_the_skins_step_comes_after_the_downloads_and_before_fichub():
    job = MagicMock()
    job.action = server.ACTION_BOOKMARKS
    job.filetypes = ['HTML', 'JSON']
    job.options = server.resolve_options({'skins': True})
    steps = [x for x, _ in server.step_plan(job)]

    assert steps.index('skins') == steps.index('fichub') - 1
    assert steps.index('skins') > steps.index('download')
    job.options = server.resolve_options({})
    assert 'skins' not in [x for x, _ in server.step_plan(job)]
    job.options = server.resolve_options({'skins': True})
    job.filetypes = ['EPUB', 'JSON']
    assert 'skins' not in [x for x, _ in server.step_plan(job)]


@pytest.mark.parametrize('options', [
    {},                                              # all bookmarks
    {'pages': 3},                                    # a page range
    {'dates': True, 'dateFrom': '2026-01-01'},       # a date range
    {'reindex': False, 'recheck': True},             # existing works, against AO3
    {'reindex': False},                              # existing works, against the index
], ids=['all', 'pages', 'dates', 'existing-ao3', 'existing-index'])
def test_every_custom_run_but_the_skins_only_one_lists_the_skins_step_when_asked(options):
    job = MagicMock()
    job.action = server.ACTION_CUSTOM
    job.filetypes = ['HTML', 'JSON'] if options.get('reindex', True) else ['HTML']
    job.options = server.resolve_options({'skins': True, **options})

    steps = [x for x, _ in server.step_plan(job)]

    assert 'skins' in steps
    assert steps.index('skins') == steps.index('fichub') - 1
    assert dict(server.step_plan(job))['skins'] == strings.STEP_SKINS_FOR_HTML


def test_skins_that_failed_are_reported_and_kept_with_the_run():
    from source_code import progress, runs
    ao3 = MagicMock()
    ao3.failures, ao3.skipped_works = [], []
    ao3.skin_failures = [{'id': '1', 'link': 'https://archiveofourown.org/works/1', 'error': 'x'}]
    reported = []
    server.report_failures(ao3, reported.append)

    assert {'type': progress.SKIN_FAILURES, 'skinFailures': ao3.skin_failures} in reported
    record = runs.RunRecord.__new__(runs.RunRecord)
    record.data = {}
    record.collect(ao3)
    assert record.data['skinFailures'] == ao3.skin_failures


def test_ficHubs_html_is_never_given_an_ao3_skin(tmp_path):
    ao3 = skinning(tmp_path, {})

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1, fetch=lambda filetype: downloaded())

    ao3.repo.get_soup.assert_not_called()
    assert saved(tmp_path, '.html') == downloaded()

# endregion


# region a work whose html is already current

def current_html(tmp_path, pages, works=('41822007',)):
    """A run that fetches skins, over works whose html is on disk and up to date - so none of
    them is downloaded."""
    ao3 = skinning(tmp_path, pages)
    fileops = ao3.fileops
    fileops.worksfolder = str(tmp_path / strings.WORKS_FOLDER_NAME)
    fileops.storage = LocalStorage(str(tmp_path))
    fileops.list_files.side_effect = lambda folder: FileOps.list_files(fileops, folder)
    for work in works:
        (tmp_path / strings.WORKS_FOLDER_NAME / f'{work} A Work - Writer 2024-12-14.html').write_bytes(downloaded())
    ao3.reindexed = set(works)
    job = MagicMock()
    job.progress.return_value = {}
    job.earlier_progress.return_value = None
    return ao3, job


def test_a_work_whose_html_is_current_is_never_looked_at_for_a_skin(tmp_path):
    ao3, job = current_html(tmp_path, {WORK_PAGE: page('unlockedWork')})

    # nothing downloaded, so nothing waits for the skins step
    the_skins_step(ao3, tmp_path)
    ao3.repo.get_soup.assert_not_called()

# endregion


# region an update brings the saved skin up to date

def test_an_update_overwrites_the_saved_skin_with_the_latest(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    (tmp_path / strings.SKINS_FOLDER_NAME).mkdir()
    (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').write_text('#workskin .old {}', encoding='utf-8')

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)
    the_skins_step(ao3, tmp_path)

    css = (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').read_text(encoding='utf-8')
    assert css.startswith('#workskin .centered')


def test_a_skin_the_author_dropped_is_dropped_from_the_saved_one_too(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWorkNoSkin')})
    (tmp_path / strings.SKINS_FOLDER_NAME).mkdir()
    (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').write_text('#workskin .old {}', encoding='utf-8')

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)
    the_skins_step(ao3, tmp_path)

    assert not (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').exists()
    assert (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.none').exists()


def test_a_run_not_fetching_skins_leaves_a_saved_skin_alone(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.skins = False
    (tmp_path / strings.SKINS_FOLDER_NAME).mkdir()
    (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.none').write_text('', encoding='utf-8')

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    ao3.repo.get_soup.assert_not_called()
    assert (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.none').exists()


def test_no_skin_is_fetched_for_a_download_with_no_html(tmp_path):
    ao3 = skinning(tmp_path, {})
    ao3.filetypes = ['EPUB']

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    ao3.repo.get_soup.assert_not_called()

# endregion


# region a custom run that only fetches work skins

def skins_only(tmp_path, pages, options=None, works=('41822007',)):
    ao3, job = current_html(tmp_path, pages, works)
    job.options = {'skinsOnly': True, 'skinScope': 'unchecked', 'skinWorks': [], **(options or {})}
    job.cancel.is_set.return_value = False
    made = []

    def build(*args, **kwargs):
        ao3.skins = False
        made.append(ao3)
        return ao3

    return ao3, job, build


def run_only(monkeypatch, ao3, job, build, reported=None):
    monkeypatch.setattr(server, 'Ao3', build)

    def never(*a, **k):
        raise AssertionError('a skins-only run reached a step that indexes or downloads')

    # FicHub, cleanup (collection links written into index entries) and the skins-for-html step
    # are for runs that index or download: this one never reaches them
    for name in ('finish_run', 'rescue_with_fichub', 'cleanup', 'fetch_pending_skins',
                 'write_collection_links'):
        monkeypatch.setattr(server, name, never)
    server.run_custom(job, ao3.fileops, ao3.repo,
                      reported.append if reported is not None else (lambda event: None))


def test_fetching_skins_only_saves_each_skin_and_downloads_nothing(tmp_path, monkeypatch):
    ao3, job, build = skins_only(tmp_path, {WORK_PAGE: page('unlockedWork')})

    run_only(monkeypatch, ao3, job, build)

    ao3.repo.download_file.assert_not_called()
    ao3.fileops.save_json.assert_not_called()
    css = (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').read_text(encoding='utf-8')
    assert css.startswith('#workskin .centered')
    assert saved(tmp_path, '.html') == downloaded()


@pytest.mark.parametrize('scope, fetched', [
    ('unchecked', ['3']),
    ('saved', ['1']),
    ('none', ['2']),
    ('all', ['1', '2', '3']),
])
def test_fetching_skins_only_takes_the_works_whose_saved_skin_fits_the_scope(tmp_path, monkeypatch, scope, fetched):
    pages = {f'https://archiveofourown.org/works/{n}': page('unlockedWorkNoSkin') for n in '123'}
    ao3, job, build = skins_only(tmp_path, pages, {'skinScope': scope}, works=('1', '2', '3'))
    ao3.fileops.list_files.side_effect = lambda f: os.listdir(f) if os.path.isdir(f) else []
    (tmp_path / strings.SKINS_FOLDER_NAME).mkdir()
    (tmp_path / strings.SKINS_FOLDER_NAME / '1.css').write_text('#workskin .old {}', encoding='utf-8')
    (tmp_path / strings.SKINS_FOLDER_NAME / '2.none').write_text('', encoding='utf-8')

    run_only(monkeypatch, ao3, job, build)

    asked = [c.args[0].rsplit('/', 1)[-1] for c in ao3.repo.get_soup.call_args_list]
    assert asked == fetched


def test_works_picked_are_always_fetched_whatever_is_saved(tmp_path, monkeypatch):
    other = 'https://archiveofourown.org/works/7'
    ao3, job, build = skins_only(tmp_path, {other: page('unlockedWork')}, {'skinWorks': ['7']})
    ao3.fileops.list_files.side_effect = lambda f: os.listdir(f) if os.path.isdir(f) else []
    (tmp_path / strings.SKINS_FOLDER_NAME).mkdir()
    (tmp_path / strings.SKINS_FOLDER_NAME / '7.none').write_text('', encoding='utf-8')

    run_only(monkeypatch, ao3, job, build)

    assert (tmp_path / strings.SKINS_FOLDER_NAME / '7.css').exists()
    assert not (tmp_path / strings.SKINS_FOLDER_NAME / '7.none').exists()


def test_fetching_skins_only_takes_the_works_picked(tmp_path, monkeypatch):
    other = 'https://archiveofourown.org/works/7'
    ao3, job, build = skins_only(tmp_path, {other: page('unlockedWorkNoSkin')}, {'skinWorks': ['7']})

    run_only(monkeypatch, ao3, job, build)

    assert [c.args[0] for c in ao3.repo.get_soup.call_args_list] == [other]
    assert (tmp_path / strings.SKINS_FOLDER_NAME / '7.none').exists()


def files_in(folder) -> dict[str, bytes]:
    found = {}
    for root, _, names in os.walk(folder):
        for name in names:
            path = os.path.join(root, name)
            with open(path, 'rb') as f:
                found[os.path.relpath(path, folder)] = f.read()
    return found


@pytest.mark.parametrize('picked', [['41822007'], ['41822007', '7']])
def test_fetching_skins_for_works_picked_writes_nothing_but_their_skins(tmp_path, monkeypatch, picked):
    # the Works tab's [DEBUG] Download work skin, for one work or several: only each skin saved -
    # no index entry, collection, downloaded file or run of anything else touched
    pages = {f'https://archiveofourown.org/works/{n}': page('unlockedWork') for n in picked}
    ao3, job, build = skins_only(tmp_path, pages, {'skinWorks': picked})
    ao3.fileops.save_bytes.side_effect = lambda n, c: FileOps.save_bytes(ao3.fileops, n, c)
    for folder, name, text in ((strings.INDEXING_FOLDER_NAME, '41822007 A Work - Writer.json', '{"id": "41822007"}'),
                               (strings.COLLECTIONS_FOLDER_NAME, 'c.json', '{"name": "c", "work_ids": ["41822007"]}')):
        (tmp_path / folder).mkdir(exist_ok=True)
        (tmp_path / folder / name).write_text(text, encoding='utf-8')
    before = files_in(tmp_path)
    reported = []

    run_only(monkeypatch, ao3, job, build, reported)

    after = files_in(tmp_path)
    changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
    assert changed == {os.path.join(strings.SKINS_FOLDER_NAME, f'{n}.css') for n in picked}
    assert [c.args[0] for c in ao3.repo.get_soup.call_args_list] == list(pages)
    ao3.repo.download_file.assert_not_called()
    ao3.fileops.save_json.assert_not_called()
    ao3.fileops.rename_file.assert_not_called()
    assert all(strings.SKINS_FOLDER_NAME in c.args[0] for c in ao3.fileops.save_bytes.call_args_list)
    assert all(strings.SKINS_FOLDER_NAME in c.args[0] for c in ao3.fileops.delete_file.call_args_list)
    # its one step is done, and stays done
    job.steps.done.assert_called_once_with('skins')
    job.steps.skip.assert_not_called()


def test_a_skin_a_picked_work_will_not_give_is_reported_and_nothing_else_happens(tmp_path, monkeypatch):
    ao3, job, build = skins_only(tmp_path, {}, {'skinWorks': ['7']})
    ao3.repo.get_soup.side_effect = exceptions.InvalidStatusCodeException('503')
    reported = []

    run_only(monkeypatch, ao3, job, build, reported)

    assert [x['id'] for x in ao3.skin_failures] == ['7']
    assert any(e.get('type') == 'skinFailures' for e in reported)
    assert not (tmp_path / strings.SKINS_FOLDER_NAME).exists()


def test_fetching_skins_only_lists_only_its_own_steps():
    job = MagicMock()
    job.action = server.ACTION_CUSTOM
    job.filetypes = []
    job.options = {'skinsOnly': True}

    assert [x[0] for x in server.step_plan(job)] == ['login', 'skins', 'report']


def test_only_a_custom_run_can_fetch_skins_only():
    options = server.resolve_options({'skinsOnly': True, 'skinScope': 'none', 'skinWorks': ['12', 'x', 3]})
    assert options['skinsOnly'] and options['skinScope'] == 'none'
    assert options['skinWorks'] == ['12', '3']
    assert server.resolve_options({'skinScope': 'nonsense'})['skinScope'] == 'unchecked'
    # an older page's overwrite box: every work
    assert server.resolve_options({'overwriteSkins': True})['skinScope'] == 'all'

# endregion


# region which runs offer it

def test_every_run_offers_the_option():
    assert set(server.SKIN_ACTIONS) == set(server.ACTIONS)


def test_the_option_reaches_the_runs_downloader():
    job = server.Job(server.ACTION_QUICK, ['HTML'], 'reader')
    job.options = server.resolve_options({'skins': True})
    ao3 = server.Ao3(MagicMock(), MagicMock(), ['HTML'], None, False, False)

    job.ao3 = ao3

    assert ao3.skins is True


def test_the_option_is_off_unless_sent():
    assert server.resolve_options({})['skins'] is False

# endregion


# region the run start keeps it to those runs

from test.test_server import started_options  # noqa: E402


def test_a_run_fetching_skins_alone_sets_the_option_aside():
    assert started_options(server.ACTION_CUSTOM, {'skins': True, 'skinsOnly': True})['skins'] is False


@pytest.mark.parametrize('action', [server.ACTION_BOOKMARKS, server.ACTION_QUICK, server.ACTION_CUSTOM,
                                    server.ACTION_SYNC, server.ACTION_NEW, server.ACTION_UPDATE])
def test_a_run_is_taken_at_its_word(action):
    assert started_options(action, {'skins': True})['skins'] is True


@pytest.mark.parametrize('options', [
    {'pages': 3}, {'dates': True, 'dateFrom': '2026-01-01'},
    {'reindex': False, 'recheck': True}, {'reindex': False},
], ids=['pages', 'dates', 'existing-ao3', 'existing-index'])
def test_a_custom_run_keeps_work_skins_whatever_it_covers(options):
    sent = started_options(server.ACTION_CUSTOM, {'skins': True, **options})
    assert sent['skins'] is True and sent['skinsOnly'] is False

COLLECTION_URL = 'https://archiveofourown.org/collections/somename'


@pytest.mark.parametrize('action, url', [(server.ACTION_COLLECTIONS, ''),
                                         (server.ACTION_COLLECTION, COLLECTION_URL)])
def test_a_collection_run_indexing_its_works_keeps_work_skins_and_lists_the_step(action, url):
    sent = started_options(action, {'skins': True, 'collectionWorks': True}, url)
    assert sent['skins'] is True

    job = MagicMock()
    job.action = action
    job.filetypes = ['JSON', 'HTML']
    job.options = server.resolve_options({'skins': True, 'collectionWorks': True})
    steps = [x for x, _ in server.step_plan(job)]
    assert steps.index('skins') == steps.index('fichub') - 1


@pytest.mark.parametrize('action, url', [(server.ACTION_COLLECTIONS, ''),
                                         (server.ACTION_COLLECTION, COLLECTION_URL)])
def test_a_collection_run_not_indexing_its_works_saves_no_skins(action, url):
    # it downloads nothing - json only - so there is no html for a skin to go with
    assert started_options(action, {'skins': True}, url)['skins'] is False
    assert started_options(action, {'skins': True, 'collectionWorks': True}, url,
                           filetypes=['JSON'])['skins'] is False


# endregion


# region resolve issues (an import)

def test_an_import_keeps_work_skins_whatever_its_formats():
    # every work it takes in is read on AO3 to index it, so the skin is free with or without html
    for filetypes in (['JSON'], ['JSON', 'EPUB'], ['JSON', 'HTML']):
        assert started_options(server.ACTION_IMPORT, {'skins': True}, '1 2',
                               filetypes=filetypes)['skins'] is True
    assert started_options(server.ACTION_IMPORT, {}, '1 2', filetypes=['JSON'])['skins'] is False


def test_only_an_import_keeps_work_skins_without_html():
    assert started_options(server.ACTION_WORKS, {'skins': True}, '1 2', filetypes=['JSON'])['skins'] is False


def test_an_import_looking_works_up_only_saves_their_skins_and_lists_no_skins_step():
    job = MagicMock()
    job.action = server.ACTION_IMPORT
    job.filetypes = ['JSON']
    job.options = server.resolve_options({'skins': True, 'indexOnly': ['1']})
    # nothing waits for a step of its own: each skin was saved as its page was read
    assert 'skins' not in [x for x, _ in server.step_plan(job)]


def test_an_import_fetching_skins_hands_the_option_to_its_downloader():
    job = server.Job(server.ACTION_IMPORT, ['JSON', 'HTML'], '')
    job.options = server.resolve_options({'skins': True})
    ao3 = server.Ao3(MagicMock(), MagicMock(), ['JSON', 'HTML'], None, False, False)
    job.ao3 = ao3
    assert ao3.skins is True


def test_every_work_an_import_looks_up_has_its_skin_saved_for_free(tmp_path):
    # an import reads each work's page to index it - a work only looked up included - so its
    # skin costs nothing, and is saved as css alone
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})

    ao3.index_one_work(WORK_PAGE)

    assert ao3.repo.get_soup.call_count == 1
    assert os.listdir(tmp_path / strings.SKINS_FOLDER_NAME) == ['41822007.css']
    assert ao3.skins_pending == []


def test_an_import_not_fetching_skins_saves_none_while_looking_works_up(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.skins = False

    ao3.index_one_work(WORK_PAGE)

    assert not (tmp_path / strings.SKINS_FOLDER_NAME).exists()


# endregion


# region retrying a run with skins

def test_the_skins_a_run_missed_are_its_failures_then_the_ones_still_waiting_each_once():
    record = {'skinFailures': [{'id': '5', 'link': 'x', 'error': 'e'}], 'skinsPending': ['6', '5', '7']}

    assert server.missed_skins(record) == ['5', '6', '7']
    assert server.missed_skins({}) == []
    assert server.missed_skins(None) == []


def test_a_retry_fetching_skins_goes_back_for_the_ones_its_earlier_attempt_missed(tmp_path):
    ao3 = skinning(tmp_path, {})
    job = server.Job(server.ACTION_QUICK, ['HTML'], 'Someone', server.resolve_options({'skins': True}))
    job.record = MagicMock()
    job.record.data = {}
    job.resume = {'missedSkins': ['5', '6']}

    job.ao3 = ao3

    assert ao3.skins_pending == ['5', '6']
    assert job.record.data['skinsPending'] == ['5', '6']


def test_a_retry_not_fetching_skins_leaves_the_missed_ones_alone(tmp_path):
    ao3 = skinning(tmp_path, {})
    job = server.Job(server.ACTION_QUICK, ['HTML'], 'Someone', server.resolve_options({}))
    job.resume = {'missedSkins': ['5']}

    job.ao3 = ao3

    assert ao3.skins_pending == []


@pytest.mark.parametrize('action', [server.ACTION_WORKS, server.ACTION_WORK, server.ACTION_UPDATE,
                                    server.ACTION_CUSTOM, server.ACTION_QUICK])
def test_work_skins_go_only_with_html_on_every_run_even_the_ones_reading_pages_anyway(action):
    options = {'skins': True, **({'reindex': False, 'recheck': True} if action == server.ACTION_CUSTOM else {})}
    url = {server.ACTION_WORK: '1', server.ACTION_WORKS: '1 2'}.get(action, '')
    assert started_options(action, options, url, filetypes=['JSON'])['skins'] is False
    assert started_options(action, options, url, filetypes=['JSON', 'HTML'])['skins'] is True

    job = MagicMock()
    job.action = action
    job.filetypes = ['JSON']
    job.options = server.resolve_options({'skins': True})
    job.resume = {'missedSkins': ['5']}
    assert 'skins' not in [x for x, _ in server.step_plan(job)]


def test_the_skins_step_of_a_retry_reads_the_missed_works_and_saves_their_skins(tmp_path):
    other = 'https://archiveofourown.org/works/7'
    ao3 = skinning(tmp_path, {other: page('unlockedWork')})
    ao3.skins_pending = ['7']  # missed by the earlier attempt; its html is not downloaded again

    the_skins_step(ao3, tmp_path)

    assert (tmp_path / strings.SKINS_FOLDER_NAME / '7.css').exists()
    assert ao3.skins_pending == []


SKINS_ONLY = {'id': 'r1', 'action': server.ACTION_CUSTOM, 'status': 'stopped',
              'options': {'skinsOnly': True, 'skinWorks': ['1', '2', '3']}, 'filetypes': [],
              'skinFailures': [{'id': '1', 'link': 'x', 'error': 'e'}], 'skinsPending': ['3']}


def test_a_skins_only_run_offers_two_ways_to_retry_it():
    choices = server.retry_choices(SKINS_ONLY, set())

    assert [m['mode'] for m in choices['modes']] == [server.RETRY_TOP, server.RETRY_FAILED]
    assert all(m['available'] for m in choices['modes'])
    assert choices['default'] == server.RETRY_FAILED
    assert choices['skinsOnly'] is True and choices['missedSkins'] == 2


def test_a_skins_only_run_that_missed_nothing_retries_from_the_top():
    record = dict(SKINS_ONLY, skinFailures=[], skinsPending=[], status='success')
    choices = server.retry_choices(record, set())

    failed = next(m for m in choices['modes'] if m['mode'] == server.RETRY_FAILED)
    assert not failed['available'] and failed['reason'] == strings.RETRY_NO_SKINS_MISSED
    assert choices['default'] == server.RETRY_TOP


@pytest.mark.parametrize('mode, picked', [(server.RETRY_FAILED, ['1', '3']), (server.RETRY_TOP, ['1', '2', '3'])])
def test_retrying_a_skins_only_run_takes_just_the_missed_works_or_all_of_them(monkeypatch, mode, picked):
    monkeypatch.setattr(server.runs, 'find_run', lambda fileops, run_id: dict(SKINS_ONLY))
    job = server.Job(server.ACTION_CUSTOM, [], 'Someone', server.resolve_options({'resume': 'r1', 'retryMode': mode}))

    server.prepare_resume(job, MagicMock())

    assert job.options['skinsOnly'] is True
    assert job.options['skinWorks'] == picked


def test_a_skins_only_run_keeps_the_works_it_never_reached_with_the_run(tmp_path, monkeypatch):
    pages = {f'https://archiveofourown.org/works/{n}': page('unlockedWork') for n in '12'}
    ao3, job, build = skins_only(tmp_path, pages, {'skinWorks': ['1', '2']})
    seen = []
    ao3.on_skins_pending = lambda works: seen.append(list(works))
    real = ao3.skin_for

    def stop_on_the_second(work, saving_only=False):
        if work == '2': raise exceptions.CancelledException()
        return real(work, saving_only)

    ao3.skin_for = stop_on_the_second
    monkeypatch.setattr(server, 'Ao3', build)
    with pytest.raises(exceptions.CancelledException):
        server.run_custom(job, ao3.fileops, ao3.repo, lambda event: None)

    assert seen[0] == ['1', '2']
    assert ao3.skins_pending == ['2']

# endregion


# region a skin uploaded in the page

def test_a_skin_uploaded_in_the_page_is_never_taken_for_one_a_run_saved(tmp_path):
    skins = tmp_path / strings.SKINS_FOLDER_NAME
    skins.mkdir()
    (skins / '12.css').write_text('#workskin p { color: red; }')
    (skins / '12_submittedbyuser.css').write_text('#workskin p { color: blue; }')
    (skins / '34_submittedbyuser.css').write_text('#workskin p { color: green; }')
    (skins / 'work-skin-choices.json').write_text('{"12": "ao3"}')
    fileops = MagicMock()
    fileops.downloadfolder = str(tmp_path)
    fileops.list_files = lambda folder: os.listdir(folder)
    # work 34 has only an uploaded skin: a run fetching skins still counts it as never checked
    assert server.saved_skin_states(fileops) == {'12': 'css'}
    assert server.skin_scope_takes('unchecked', server.saved_skin_states(fileops).get('34'))

# endregion
