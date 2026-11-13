"""A bookmark's own details - notes, tags, date and the rest - carry on through every new reading
of its index entry, whether or not it is still a bookmark, until AO3 itself says otherwise.

The page marks an entry as a bookmark or not by hand (`Library.setBookmarked`), writing a new
reading that changes only `bookmarked`; everything the helper writes afterwards has to keep the
details that reading carried, and only a walk of your own AO3 bookmarks replaces them.
"""

import json
import os
from unittest.mock import MagicMock

import pytest

from source_code import indexing, strings
from source_code.ao3 import Ao3, carry_bookmark_details, was_bookmark


LINK = 'https://archiveofourown.org/works/42'
DETAILS = {'date_bookmarked': '02 Mar 2026', 'bookmark_notes': 'mine', 'bookmark_tags': ['comfort'],
           'bookmark_collections': [], 'bookmark_private': True, 'bookmark_rec': True}


@pytest.fixture
def library(fake_fileops):
    os.makedirs(os.path.join(fake_fileops.downloadfolder, strings.INDEXING_FOLDER_NAME), exist_ok=True)
    return fake_fileops


def indexed(library, bookmarked) -> str:
    """An entry marked by hand as the page marks one: a newest reading saying `bookmarked`, with
    the bookmark's details in it."""
    reading = {'indexed_on': '2026-03-02T00:00:00+00:00', 'title': 'Forty Two', 'authors': ['Someone'],
               'date_updated': '01 Mar 2026', **DETAILS}
    if bookmarked is not None: reading['bookmarked'] = bookmarked
    path = os.path.join(library.downloadfolder, strings.INDEXING_FOLDER_NAME, '42 Forty Two - Someone.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'id': '42', 'link': LINK, 'indexes': [reading]}, f)
    return path


def entry_now(path) -> dict:
    with open(path, encoding='utf-8') as f:
        return indexing.flatten(json.load(f))


def downloader(library) -> Ao3:
    return Ao3(MagicMock(), library, ['HTML'], None, False, False)


# region what counts as a bookmark

@pytest.mark.parametrize('entry, counts', [
    ({'bookmarked': True}, True),
    ({'bookmarked': False}, False),
    # an entry from before the field existed is not counted as one: it is marked by hand
    ({'title': 'old'}, False),
    (None, False),
])
def test_only_an_entry_that_says_bookmarked_is_one(entry, counts):
    assert was_bookmark(entry) is counts

# endregion


# region details carry through

@pytest.mark.parametrize('bookmarked', [True, False])
def test_a_reading_that_knows_nothing_of_the_bookmark_keeps_its_details(library, bookmarked):
    path = indexed(library, bookmarked)
    ao3 = downloader(library)

    # a stats-only reading - a work page, FicHub, a series or a collection knows no notes
    ao3.save_metadata({'id': '42', 'link': LINK, 'title': 'Forty Two', 'authors': ['Someone'],
                       'date_updated': '09 Mar 2026', 'kudos': 7})

    entry = entry_now(path)
    assert entry['kudos'] == 7
    assert entry['bookmarked'] is bookmarked
    for field, value in DETAILS.items():
        assert entry[field] == value, field


def test_a_walk_of_your_ao3_bookmarks_writes_what_ao3_says_over_them(library):
    path = indexed(library, False)
    ao3 = downloader(library)

    # a blurb off your own bookmarks listing carries every one of the bookmark's fields
    ao3.save_metadata({'id': '42', 'link': LINK, 'title': 'Forty Two', 'authors': ['Someone'],
                       'date_updated': '01 Mar 2026', 'bookmarked': True,
                       'date_bookmarked': '05 Mar 2026', 'bookmark_notes': '', 'bookmark_tags': [],
                       'bookmark_collections': [], 'bookmark_private': False, 'bookmark_rec': False})

    entry = entry_now(path)
    assert entry['bookmarked'] is True
    assert entry['bookmark_notes'] == ''
    assert entry['bookmark_tags'] == []
    assert entry['date_bookmarked'] == '05 Mar 2026'


def test_carrying_takes_only_what_the_reading_leaves_out():
    on_disk = {'id': '1', 'indexes': [{'indexed_on': 'a', 'bookmarked': False, 'bookmark_notes': 'kept'}]}
    assert carry_bookmark_details({'id': '1', 'title': 'T'}, on_disk) == \
        {'id': '1', 'title': 'T', 'bookmarked': False, 'bookmark_notes': 'kept'}
    assert carry_bookmark_details({'id': '1', 'bookmark_notes': 'new'}, on_disk)['bookmark_notes'] == 'new'
    assert carry_bookmark_details({'id': '1'}, None) == {'id': '1'}

# endregion
