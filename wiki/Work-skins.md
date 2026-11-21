A **work skin** is the styling an author gives a work on AO3 - colours, fonts, chat-log layouts and so on. AO3's own download leaves it out, so FicFairy fetches it separately.

**Work skins only come from AO3.** A fic FicFairy has to get from FicHub never has one: FicHub doesn't keep the author's styling.

## Where a skin is kept

Each skin is saved beside your works as `skins/<work number>.css`. A work checked and found to have no skin gets an empty `skins/<work number>.none` instead, so it isn't asked about again for nothing. When you open a work's HTML from FicFairy, its saved skin is shown with it. The file itself is not changed.

## When a skin is fetched

There are two ways a run gets a skin:

- **Saved for free** - a run that already opens a work's page on AO3 (to index it or check it for updates) saves that page's skin as CSS at the same time. It costs no extra request, and it is AO3's latest. This happens whatever you tick, **every time the page is read**, whether or not the work's HTML is downloaded. The skin is **never** put into the HTML file.
- **[DEBUG] Fetch work skin for HTML downloads** - a box on the file types page, in debug mode only, off to begin with. Ticked, the skin is also put into the HTML file - but **only when the run downloads that work's HTML** (a new download, an updated chapter, or HTML overwritten). A work whose HTML is already current is not checked. Where the run hasn't opened the work's page, that costs one more request, made in a step of its own after the downloads: **Fetch work skins for the HTML downloaded**. Unticked, nothing extra is asked of AO3.

| Run | Saved for free (always) | With the debug box ticked |
| --- | --- | --- |
| **Download/update a specific fic** | While indexing - each fic is looked up on AO3. Every time. | Put into the HTML as it is downloaded. Free. This run always re-downloads, so every time. |
| **Download/update several fics** | While indexing - each fic is looked up on AO3. Every time. | Put into the HTML as it is downloaded. Free. Every time, as above. |
| **Custom run - Just update existing works**, *Check against latest on AO3* | While indexing - every work in your index is looked up on AO3. Every time. | Put into the HTML of works whose HTML is downloaded. Free. Only when the HTML changes. |
| **Custom run - Just update existing works**, *Check against current index* | None - nothing is looked up on AO3. | Its own step after the downloads. Only works whose HTML is downloaded. |
| **Updating unfinished fics** (the *[DEBUG] just update incomplete* run, and that part of *new bookmarks + incomplete fics*) | While re-reading each unfinished fic. Every time. | Put into the HTML of works whose HTML is downloaded. Free. Only when the HTML changes. |
| **Resolve issues** (importing works in your library) | While looking up each work on AO3. Every time. | Not offered. |
| **Quick Scan** | None - it reads your bookmarks listing, which carries no skin. | Its own step after the downloads. Only works whose HTML is downloaded. |
| **(Full scan) Reindex & Update All** | None, except: with *Check all non-bookmarks for updates too*, while checking each non-bookmark; with JSON unticked, while downloading each work (that run opens each work's page). | Its own step after the downloads, for the rest. Only works whose HTML is downloaded. |
| **Custom run - a slice, or all bookmarks** | None, except with *Check all non-bookmarks for updates too*, as above. | Its own step after the downloads. Only works whose HTML is downloaded. |
| **Index my collections / Index collection by URL** (with *Index and download encountered works*) | None - they read collection listings. | Its own step after the downloads. Only works whose HTML is downloaded. |
| **Retry** that re-reads the works it carries on with | While re-reading each one. | As for the run being retried. |
| **[DEBUG] Just fetch work skins** (custom run) | Its own step - the whole run. Each work's page is read for its skin, every time the run is started. Nothing is indexed or downloaded, and no HTML is changed. | - |

## Fetching skins on their own (debug mode)

- **Custom run > [DEBUG] Just fetch work skins** - for works with HTML in your library: works *never checked for a skin* (the default), works *that already have a skin saved*, works *last known to have no skin*, or *all works*.
- **[DEBUG] Download work skin** - in a work's **⋯** menu, or on the selection bar for the works you've ticked. It opens the same run for just those works, and checks each again whatever is saved for it.

A work with a skin saved shows a small brush icon in its top right corner on the Works tab.

## If a skin can't be fetched

The HTML is kept exactly as AO3 sent it. The run lists the work as a skin that *could not be fetched or put in*, in the run window at the end, in History, and in the **Download issues** file. If a run is stopped, fails, or skips the skins step, the works whose HTML is still waiting for its skin are listed too (*HTML downloaded, work skin not fetched*), so you can fetch them later.
