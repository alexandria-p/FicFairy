"""Work skins: the CSS an author attaches to a work on AO3, which AO3's own download leaves out.

A run asked to (`skins`, a debug option for now) puts each work's skin into the html it
downloads, and keeps it beside the works as `skins/<worknum>.css`. A work page the run reads
anyway gives the skin for nothing; otherwise the work's own page is read once, and only when an
html file is about to be written.
"""

import os
from unittest.mock import MagicMock

import pytest
from bs4 import BeautifulSoup

from source_code import exceptions, parse_soup, server, strings
from source_code.ao3 import with_skin
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


# region putting a skin into AO3's downloaded html

def test_ao3s_downloaded_html_carries_no_skin_of_its_own():
    # the reason for all of this: no author css, and no #workskin for its rules to match
    text = downloaded().decode('utf-8')

    assert 'id="workskin"' not in text


def test_the_skin_goes_after_ao3s_own_styles_and_the_body_inside_workskin():
    dressed = with_skin(downloaded(), SKIN).decode('utf-8')

    head, body = dressed.split('</head>')
    assert head.rindex(SKIN) > head.index('.toc-heading')
    assert '<body>\n<div id="workskin">' in body
    assert body.rstrip().endswith('</div>\n</body>\n</html>')
    # nothing of AO3's own file is lost
    original = downloaded().decode('utf-8')
    assert BeautifulSoup(dressed, 'html.parser').get_text().count('My Aim Is Steady And True') == \
        BeautifulSoup(original, 'html.parser').get_text().count('My Aim Is Steady And True')


@pytest.mark.parametrize('content, css', [
    (b'\xff\xfe not utf-8', SKIN),
    (b'<html><body>no head</body></html>', SKIN),
    (b'<html><head></head>no body</html>', SKIN),
    (b'<html><head></head><body><div id="workskin">x</div></body></html>', SKIN),
    (b'<html><head></head><body>x</body></html>', '.a{} </style><script>'),
])
def test_a_file_that_cannot_take_a_skin_as_it_is_is_left_alone(content, css):
    assert with_skin(content, css) is None

# endregion


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


def test_an_indexed_download_reads_the_work_page_once_and_puts_its_skin_in_the_html(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    assert ao3.repo.get_soup.call_count == 1
    html = saved(tmp_path, '.html').decode('utf-8')
    assert '<div id="workskin">' in html and '#workskin .centered' in html
    # only the html: an epub is left exactly as AO3 sent it
    assert saved(tmp_path, '.epub') == b'epub bytes'
    css = (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').read_text(encoding='utf-8')
    assert css.startswith('#workskin .centered')


def test_a_work_page_the_run_already_read_costs_no_second_request(tmp_path):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.fetch_page(WORK_PAGE, work=True)  # as a fic run's lookup or an update pass reads it

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    assert ao3.repo.get_soup.call_count == 1
    assert '<div id="workskin">' in saved(tmp_path, '.html').decode('utf-8')


def test_a_work_without_a_skin_is_saved_as_ao3_sent_it_and_asked_about_once(tmp_path, capsys):
    ao3 = skinning(tmp_path, {WORK_PAGE: page('unlockedWorkNoSkin')})

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)
    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    assert ao3.repo.get_soup.call_count == 1
    assert saved(tmp_path, '.html') == downloaded()
    assert not (tmp_path / strings.SKINS_FOLDER_NAME).exists()
    assert strings.AO3_INFO_SKIN_NONE.format('41822007') in capsys.readouterr().out


def test_no_work_page_is_read_when_the_run_writes_no_html(tmp_path):
    ao3 = skinning(tmp_path, {})
    ao3.filetypes = ['EPUB']

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    ao3.repo.get_soup.assert_not_called()


def test_without_the_option_nothing_is_read_and_nothing_changed(tmp_path):
    ao3 = skinning(tmp_path, {})
    ao3.skins = False

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    ao3.repo.get_soup.assert_not_called()
    assert saved(tmp_path, '.html') == downloaded()


def test_a_page_that_will_not_read_costs_the_skin_and_nothing_else(tmp_path, capsys):
    ao3 = skinning(tmp_path, {})
    ao3.repo.get_soup.side_effect = exceptions.InvalidStatusCodeException('503')

    ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)

    assert saved(tmp_path, '.html') == downloaded()
    assert ao3.failures == []
    assert 'could not read the work skin of work 41822007' in capsys.readouterr().out


def test_a_stop_while_reading_the_skin_still_ends_the_run(tmp_path):
    ao3 = skinning(tmp_path, {})
    ao3.repo.get_soup.side_effect = exceptions.CancelledException()

    with pytest.raises(exceptions.CancelledException):
        ao3.download_one_indexed(dict(RECORD), 100, {}, 1, 1)


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


def test_a_current_html_gets_its_skin_saved_without_being_downloaded_again(tmp_path, capsys):
    ao3, job = current_html(tmp_path, {WORK_PAGE: page('unlockedWork')})

    server.skins_for_current_html(job, ao3.fileops, ao3)

    ao3.repo.download_file.assert_not_called()
    css = (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').read_text(encoding='utf-8')
    assert css.startswith('#workskin .centered')
    # the file itself is left exactly as it was
    assert saved(tmp_path, '.html') == downloaded()
    assert strings.AO3_INFO_SKIN_FOUND_SAVED.format('41822007') in capsys.readouterr().out


def test_a_skin_already_saved_is_not_asked_for_again(tmp_path):
    ao3, job = current_html(tmp_path, {WORK_PAGE: page('unlockedWork')})
    (tmp_path / strings.SKINS_FOLDER_NAME).mkdir()
    (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').write_text('#workskin p {}', encoding='utf-8')

    server.skins_for_current_html(job, ao3.fileops, ao3)

    ao3.repo.get_soup.assert_not_called()


def test_a_work_with_no_skin_is_noted_so_it_is_not_asked_about_on_every_run(tmp_path):
    ao3, job = current_html(tmp_path, {WORK_PAGE: page('unlockedWorkNoSkin')})

    server.skins_for_current_html(job, ao3.fileops, ao3)

    assert (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').read_text(encoding='utf-8') == ''


def test_a_page_that_will_not_read_saves_nothing_so_the_next_run_asks_again(tmp_path):
    ao3, job = current_html(tmp_path, {})
    ao3.repo.get_soup.side_effect = exceptions.InvalidStatusCodeException('503')

    server.skins_for_current_html(job, ao3.fileops, ao3)

    assert not (tmp_path / strings.SKINS_FOLDER_NAME / '41822007.css').exists()


def test_a_work_downloaded_this_run_or_with_no_html_or_that_failed_is_passed_over(tmp_path):
    ao3, job = current_html(tmp_path, {})
    ao3.reindexed |= {'2', '3'}
    ao3.skins_saved.add('41822007')
    (tmp_path / strings.WORKS_FOLDER_NAME / '2 Other - Writer 2024-12-14.epub').write_bytes(b'epub')
    (tmp_path / strings.WORKS_FOLDER_NAME / '3 Gone - Writer 2024-12-14.html').write_bytes(b'x')
    ao3.failures.append({'id': '3', 'link': 'https://archiveofourown.org/works/3', 'error': 'gone'})

    server.skins_for_current_html(job, ao3.fileops, ao3)

    ao3.repo.get_soup.assert_not_called()


def test_without_the_option_no_skin_is_fetched(tmp_path):
    ao3, job = current_html(tmp_path, {WORK_PAGE: page('unlockedWork')})
    ao3.skins = False

    server.skins_for_current_html(job, ao3.fileops, ao3)

    ao3.repo.get_soup.assert_not_called()


def test_every_run_ends_by_fetching_the_skins_of_current_html_before_ficHub():
    import inspect
    source = inspect.getsource(server.finish_run)
    assert source.index('skins_for_current_html') < source.index('rescue_with_fichub')

# endregion


# region which runs offer it

@pytest.mark.parametrize('action', list(server.SKIN_ACTIONS))
def test_the_scans_and_the_fic_runs_keep_the_option(action):
    assert action in (server.ACTION_BOOKMARKS, server.ACTION_QUICK, server.ACTION_CUSTOM,
                      server.ACTION_WORK, server.ACTION_WORKS)


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


@pytest.mark.parametrize('action', [server.ACTION_SYNC, server.ACTION_NEW, server.ACTION_UPDATE,
                                    server.ACTION_COLLECTIONS])
def test_a_run_that_does_not_offer_skins_cannot_be_told_to(action):
    assert started_options(action, {'skins': True})['skins'] is False


@pytest.mark.parametrize('action', [server.ACTION_BOOKMARKS, server.ACTION_QUICK,
                                    server.ACTION_CUSTOM])
def test_a_scan_that_offers_skins_is_taken_at_its_word(action):
    assert started_options(action, {'skins': True})['skins'] is True

# endregion
