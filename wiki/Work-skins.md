A **work skin** is the styling an author gives a work on AO3 - colours, fonts, chat-log layouts and so on. AO3's own download leaves it out, so FicFairy fetches it separately.

**Work skins only come from AO3.** A fic FicFairy has to get from FicHub never has one: FicHub doesn't keep the author's styling.

## Where a skin is kept

Each skin is saved beside your works as `skins/<work number>.css`. A work checked and found to have no skin gets an empty `skins/<work number>.none` instead. **Only the custom run's [DEBUG] Just fetch work skins reads a `.none`**, to sort works for its choices: *Works never checked for a skin* leaves them out (they have been checked), and *Works last known to have no skin* takes just them, in case their authors have added one since. No other run looks at it - a run that fetches skins reads the work's page whatever is saved. When you open a work's HTML from FicFairy, its saved skin is shown with it. The HTML file itself is never changed.

## When a skin is fetched

**A skin is never put into an HTML file.** It is only ever saved as CSS beside your works.

Only a run with **[DEBUG] Fetch work skin for HTML downloads** ticked saves skins. That box is on the file types page of every run (every custom run too, whatever it covers - all but *Just fetch work skins*, and not on a retry). A repair from **Resolve issues** has its own, **[DEBUG] Fetch work skins**, on a page just before the login - and needs no HTML, since it reads every work's page anyway. It is in debug mode only and off to begin with, and **only works with HTML ticked**, on every run but a repair from Resolve issues - without HTML it is greyed out. Unticked, a run saves no skin and asks AO3 nothing extra.

Ticked, a run gets a skin in one of two ways:

- **For free** - a run that already opens a work's page on AO3 (to index it or check it for updates) saves that page's skin at the same time. No extra request, and it is AO3's latest. It happens every time the page is read, whether or not the work's HTML is downloaded.
- **In a step of its own** - every other run reads skins only for the works whose HTML it downloads (a new download, an updated chapter, or HTML overwritten). That is one more request per work, made after the downloads: **Fetch work skins for the HTML downloaded**. A work whose HTML is already current is not checked.

| Run | With the debug box ticked | Cost |
| --- | --- | --- |
| **Download/update a specific fic** | Saved while indexing - each fic is looked up on AO3. Every time. | Free |
| **Download/update several fics** | Saved while indexing - each fic is looked up on AO3. Every time. | Free |
| **Custom run - Just update existing works**, *Check against latest on AO3* | Saved while indexing - every work in your index is looked up on AO3. Every time. | Free |
| **Updating unfinished fics** (the *[DEBUG] just update incomplete* run) | Saved while re-reading each unfinished fic. Every time. | Free |
| **New bookmarks + incomplete fics** | Saved while re-reading each unfinished fic. Then its own step for the other works whose HTML was downloaded. | Free, then up to one request per work |
| **Custom run - Just update existing works**, *Check against current index* | Its own step. Only works whose HTML is downloaded. | Up to one request per work |
| **Quick Scan** | Its own step. Only works whose HTML is downloaded. | Up to one request per work |
| **(Full scan) Reindex & Update All** | Its own step, for works whose HTML is downloaded. Free for the works it opens anyway: non-bookmarks checked with *Check all non-bookmarks for updates too*, and every work downloaded when JSON is unticked. | Up to one request per work |
| **Custom run - all bookmarks, a page range or a date range** | Its own step. Only works whose HTML is downloaded. | Up to one request per work |
| **Index my collections / Index collection by URL** (with *Index and download encountered works*) | Its own step. Only works whose HTML is downloaded. | Up to one request per work |
| **Retry** | As for the run being retried - the box stays as it was. It also goes back for the skins the earlier attempt didn't get (failed, or still waiting), whether or not their HTML is downloaded again. | As for that run, plus up to one request per missed skin |
| **Resolve issues** (a repair run) | Its own box, **[DEBUG] Fetch work skins**, on a page of its own just before the AO3 login - debug mode only. **No HTML needed**: saved for every work the repair reads from AO3, whether it is looking up a missing index or searching for updates (or repairing a file). Every time. Never from FicHub. | Free |
| **[DEBUG] Just fetch work skins** (custom run) | The whole run: each work's page is read for its skin, every time the run is started. Nothing is indexed or downloaded. | One request per work |

## Fetching skins on their own (debug mode)

- **Custom run > [DEBUG] Just fetch work skins** - for works with HTML in your library: works *never checked for a skin* (the default), works *that already have a skin saved*, works *last known to have no skin*, or *all works*.
- **[DEBUG] Download work skin** - in a work's **⋯** menu, or on the selection bar for the works you've ticked. It opens a window of its own, **Download work skin** (or **Download work skins** for several), straight on the AO3 login - there is nothing else to choose. **Fetch work skins** starts it, and each work picked is checked again whatever is saved for it.

A work with a skin saved shows a brush button on the Works tab, just left of the eye at the bottom of its entry. Hover says **Open downloaded workskin**; clicking it opens the saved CSS in a new tab.

## Retrying

- **A run with the box ticked** - any retry goes back for the skins its earlier attempt didn't get: the ones that failed and the ones still waiting when it stopped. They are read in **Fetch work skins for the HTML downloaded**, even though their HTML isn't downloaded again. This works for every run, *Download/update several fics* included - whichever way it is retried (from the top, carrying on, or just the fics it could not get). A page the retry reads anyway costs nothing extra.
- **A skins-only run** (*Just fetch work skins*, or **Download work skin**) offers two ways: **From the top** fetches every work's skin again; **Just the skins it could not get** fetches only the ones that failed and the works it never reached. The second is offered first when there are any.

## In History

A run that saved any skin lists them under **Work skins saved**. A run with the debug box ticked says so in its options (*work skins saved as css*); a *Just fetch work skins* run says what it covered.

## If a skin can't be fetched

The run lists the work as a skin that *could not be fetched or saved*, in the run window at the end, in History, and in the **Download issues** file. If a run is stopped, fails, or skips the skins step, the works whose HTML is still waiting for its skin are listed too (*HTML downloaded, work skin not fetched*), so you can fetch them later.
