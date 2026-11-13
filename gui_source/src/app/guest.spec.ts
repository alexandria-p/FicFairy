import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestMode, PREVIEW_KEY } from './guest';
import { GUEST_CONFIG, GuestHelper } from './guest-helper';
import { GUEST_PLAN_CASES } from './guest-plan-cases';
import { GUEST_WORK, GUEST_WORKS } from './download-dialog';
import { GUEST_PACE, GUEST_USERNAME, GuestRun, GuestRunRequest, guestPlan } from './guest-runs';
import { DEFAULT_PAGE_CONFIG, HelperConnection } from './helper-connection';
import { JobAction, JobEvent } from './jobs';
import { DummyData } from './dummy-data';
import { DebugMode } from './debug-mode';
import { StorageChoice } from './storage-choice';

const HOSTED = 'https://helper.example.com';
const NO_WAITING = { page: 0, file: 0, format: 0, work: 0, step: 0, login: 0, question: 10_000 };

function request(action: JobAction, more: Partial<GuestRunRequest> = {}): GuestRunRequest {
  return {
    action,
    filetypes: ['JSON', 'HTML', 'EPUB'],
    options: {},
    username: GUEST_USERNAME,
    works: Array.from({ length: 8 }, (_, n) => ({
      id: String(9100001 + n), title: `Work ${n + 1}`, author: 'Someone', updated: '2026-10-01',
    })),
    collections: ['tea_party'],
    ...more,
  };
}

/** a run played through at once, answering FicHub's question with `answer` */
async function played(run: GuestRun, answer = 'yes'): Promise<JobEvent[]> {
  const seen: JobEvent[] = [];
  run.listen((event) => {
    seen.push(event);
    if (event.type === 'question') setTimeout(() => run.reply(answer), 0);
  }, () => {});
  await run.play();
  return seen;
}

/** a run played through at once, answering every question with `answer` */
async function playedAll(run: GuestRun, answer: string): Promise<JobEvent[]> {
  const seen: JobEvent[] = [];
  run.listen((event) => {
    seen.push(event);
    if (event.type === 'question') queueMicrotask(() => run.reply(answer));
  }, () => {});
  await run.play();
  return seen;
}

function hostedGuest(): HelperConnection {
  const helper = TestBed.inject(HelperConnection);
  helper.settings.set({ ...DEFAULT_PAGE_CONFIG, helperUrl: HOSTED, requirePasscode: true });
  helper.guest.set(true);
  return helper;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("guest mode's pretend runs", () => {
  it('list exactly the steps the helper would, for every run and the choices that shape it', () => {
    // the table is the helper's own step_plan, written out by dev/guest_plan_cases.py
    expect(GUEST_PLAN_CASES.length).toBeGreaterThan(40);
    for (const one of GUEST_PLAN_CASES) {
      const plan = guestPlan(one.action as JobAction, one.filetypes, one.options);
      expect(plan.map((x) => [x.id, x.label]), JSON.stringify(one)).toEqual(one.plan);
    }
  });

  it('go through every step of their checklist and finish, saying in the log they are pretend', async () => {
    for (const action of ['quick', 'bookmarks', 'custom', 'work', 'works', 'import', 'collections', 'collection', 'update', 'sync', 'new'] as JobAction[]) {
      const run = new GuestRun('r', request(action, { url: '9100001\n9100002' }), NO_WAITING);
      const events = await played(run);

      expect(events[0].type).toBe('started');
      expect(events.at(-1)?.type, action).toBe('finished');
      const finished = new Map(events.filter((e) => e.type === 'step').map((e) => [e.id, e.status]));
      for (const step of run.plan) {
        expect(['done', 'skipped'], `${action}: ${step.id}`).toContain(finished.get(step.id));
      }
      expect(events.some((e) => e.type === 'message' && /pretend run/.test(e.text ?? ''))).toBe(true);
    }
  });

  it('finish every run with every combination of its choices, each step done or skipped and nothing else', async () => {
    // every choice that shapes a run or what it says, on and off, for every run and file type set
    const choices = ['series', 'images', 'workdates', 'overwrite', 'nonBookmarks', 'reindex', 'dates',
      'collectionWorks', 'subcollections', 'parentCollections', 'skipLogin', 'replaceOutdated'];
    const actions: JobAction[] = ['bookmarks', 'quick', 'custom', 'new', 'sync', 'update', 'work', 'works', 'import', 'collections', 'collection'];
    const filetypeSets = [['JSON', 'HTML', 'EPUB', 'PDF'], ['JSON', 'HTML'], ['JSON'], ['HTML', 'AZW3']];
    let played = 0;
    for (const action of actions) {
      for (const filetypes of filetypeSets) {
        for (let mask = 0; mask < 1 << choices.length; mask += action === 'custom' || action === 'quick' ? 3 : 19) {
          const options: Record<string, unknown> = { start: 1, pages: 0, dateFrom: '', dateTo: '', floorRun: '' };
          choices.forEach((name, bit) => (options[name] = !!(mask & (1 << bit))));
          // a run with no works at all, and one with only a couple, as well as the usual library
          const works = mask % 3 === 0 ? [] : mask % 3 === 1 ? request(action).works.slice(0, 2) : request(action).works;
          const run = new GuestRun(`r${played}`, request(action, { filetypes, options, works, url: 'https://archiveofourown.org/works/9100001/chapters/42' }), NO_WAITING);
          const events = await playedAll(run, mask % 2 ? 'yes' : 'no');
          const where = `${action} ${filetypes.join('+')} ${JSON.stringify(options)} works:${works.length}`;

          expect(events.at(-1)?.type, where).toBe('finished');
          const planned = new Set(run.plan.map((x) => x.id));
          const ended = new Map<string, string>();
          for (const e of events.filter((e) => e.type === 'step')) {
            expect(planned.has(e.id ?? ''), `${where}: an unplanned step ${e.id}`).toBe(true);
            ended.set(e.id ?? '', e.status ?? '');
          }
          for (const id of planned) expect(['done', 'skipped'], `${where}: ${id}`).toContain(ended.get(id));
          expect(events.some((e) => e.type === 'authenticated'), where).toBe(!options['skipLogin']);
          played++;
        }
      }
    }
    expect(played).toBeGreaterThan(2_000);
  }, 120_000);

  it('sign in as the made-up account, and fail one work so FicHub has something to rescue', async () => {
    const events = await played(new GuestRun('r', request('bookmarks'), NO_WAITING));

    expect(events.find((e) => e.type === 'authenticated')?.username).toBe(GUEST_USERNAME);
    const question = events.find((e) => e.type === 'question');
    expect(question?.name).toBe('fichub');
    expect(events.find((e) => e.type === 'rescued')?.rescued?.length).toBe(1);
    expect(events.filter((e) => e.type === 'failures').at(-1)?.failures).toEqual([]);
  });

  it("look up exactly the works a fic run's box names - a chapter's number is never a work", async () => {
    const lookedUp = (events: JobEvent[]) =>
      events.filter((e) => e.type === 'message').map((e) => /looking up work (\d+)/.exec(e.text ?? '')?.[1]).filter(Boolean);

    const several = await played(new GuestRun('r', request('works', { url: GUEST_WORKS }), NO_WAITING));
    expect(lookedUp(several)).toEqual(['1234567', '2345678', '3456789', '4567890', '5678901']);

    const one = await played(new GuestRun('r', request('work', { url: GUEST_WORK }), NO_WAITING));
    expect(lookedUp(one)).toEqual(['1234567']);
  });

  it('keep the failure when FicHub is turned down', async () => {
    const events = await played(new GuestRun('r', request('bookmarks'), NO_WAITING), 'no');

    expect(events.find((e) => e.type === 'step' && e.id === 'fichub')?.status).toBe('skipped');
    expect(events.filter((e) => e.type === 'failures').at(-1)?.failures?.length).toBe(1);
  });

  it('take the default when a question goes unanswered for its wait - 10 seconds, said in seconds', async () => {
    expect(GUEST_PACE.question).toBe(10_000);
    const run = new GuestRun('r', request('bookmarks'), { ...NO_WAITING, question: 200 });
    const events: JobEvent[] = [];
    run.listen((e) => events.push(e), () => {});
    await run.play();

    const question = events.find((e) => e.type === 'question');
    expect(question?.timeoutMinutes).toBe(10 / 60);
    expect(events.some((e) => e.type === 'message' && /nobody answered within/.test(e.text ?? ''))).toBe(true);
    // the default is FicHub's yes: the failed work is rescued
    expect(events.find((e) => e.type === 'rescued')?.rescued?.length).toBe(1);
  });

  it('stop when told, ending as stopped', async () => {
    const run = new GuestRun('r', request('bookmarks'), { ...NO_WAITING, login: 50 });
    const events: JobEvent[] = [];
    run.listen((e) => events.push(e), () => {});
    const playing = run.play();
    setTimeout(() => run.stop(), 10);
    await playing;

    expect(events.at(-1)).toEqual({ type: 'finished', cancelled: true });
  });

  it('stop at once while a question waits, without running out its 10 seconds', async () => {
    const run = new GuestRun('r', request('bookmarks'), NO_WAITING);
    const events: JobEvent[] = [];
    run.listen((e) => {
      events.push(e);
      if (e.type === 'question') setTimeout(() => run.stop(), 0);
    }, () => {});
    const started = Date.now();
    await run.play();

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(events.at(-1)).toEqual({ type: 'finished', cancelled: true });
    expect(events.some((e) => e.type === 'rescued')).toBe(false);
  });

  it('hold on a pause and carry on after Resume, saying both', async () => {
    const run = new GuestRun('r', request('work', { url: '9100001' }), { ...NO_WAITING, login: 400 });
    const events: JobEvent[] = [];
    run.listen((e) => events.push(e), () => {});
    const playing = run.play();
    run.pause();
    await vi.waitFor(() => expect(events.some((e) => e.type === 'held')).toBe(true));
    run.resume();
    await playing;

    expect(events.some((e) => e.type === 'released')).toBe(true);
    expect(events.at(-1)?.type).toBe('finished');
  });
});

describe('guest mode', () => {
  it("answers every request to the helper in the page, so nothing is ever sent", async () => {
    const sent = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', sent);
    const helper = hostedGuest();
    TestBed.inject(GuestHelper);

    const config = await (await helper.call('/api/config')).json();
    const settingsFile = await helper.call('/api/settings-file', { method: 'POST', body: '{}' });
    const started = await helper.call('/api/jobs', {
      method: 'POST', body: JSON.stringify({ action: 'work', filetypes: ['JSON'], options: {}, url: '9100001' }),
    });
    const { jobId } = await started.json();
    const running = await (await helper.call('/api/jobs')).json();

    expect(config).toEqual(GUEST_CONFIG);
    expect(settingsFile.status).toBe(403);
    expect(started.status).toBe(202);
    expect(running.jobs[0].id).toBe(jobId);
    await helper.call(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    expect(sent).not.toHaveBeenCalled();
  });

  it("streams a pretend run's events as the helper streams a real one's", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const helper = hostedGuest();
    TestBed.inject(GuestHelper);
    const started = await helper.call('/api/jobs', {
      method: 'POST', body: JSON.stringify({ action: 'work', filetypes: ['JSON'], options: { skipLogin: true }, url: '9100001' }),
    });
    const { jobId } = await started.json();
    const types: string[] = [];

    await new Promise<void>((done) =>
      helper.stream(`/api/jobs/${jobId}/events`, (data) => types.push(JSON.parse(data).type), done),
    );

    expect(types[0]).toBe('started');
    expect(types).toContain('steps');
    expect(types.at(-1)).toBe('finished');
  }, 20_000);

  it('is always on This computer, whatever this browser chose - and keeps that choice for later', () => {
    localStorage.setItem('ao3.storageMode', 'dropbox');
    const helper = hostedGuest();
    const storage = TestBed.inject(StorageChoice);

    expect(storage.mode()).toBe('local');
    storage.set('dropbox');
    expect(storage.mode()).toBe('local');

    helper.guest.set(false);
    expect(storage.mode()).toBe('dropbox');
  });

  it('shows the dummy library, and never debug mode', () => {
    localStorage.setItem('ao3.debugMode', 'on');
    hostedGuest();
    expect(TestBed.inject(DummyData).active()).toBe(true);
    expect(TestBed.inject(DebugMode).on()).toBe(false);
  });

  it('ends once the helper accepts the passcode saved here, and not before', async () => {
    localStorage.setItem('ao3.helperPasscode', 'saved');
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(String(url));
      return new Response('{}', { status: 200 });
    }));
    const helper = hostedGuest();
    const guest = TestBed.inject(GuestMode);

    await guest.checkSaved();

    expect(asked).toEqual([`${HOSTED}/api/auth`]);
    expect(helper.guest()).toBe(false);
  });

  it('forgets a saved passcode the helper refuses, and stays a guest', async () => {
    localStorage.setItem('ao3.helperPasscode', 'old');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const helper = TestBed.inject(HelperConnection);
    helper.passcode.set('old');
    hostedGuest();
    const guest = TestBed.inject(GuestMode);

    await guest.checkSaved();

    expect(helper.guest()).toBe(true);
    expect(localStorage.getItem('ao3.helperPasscode')).toBeNull();
    // a guest is not shown the passcode window unasked
    expect(helper.passcodeWanted()).toBe(false);
    expect(guest.note()).toContain('no longer accepted');
  });

  it('stays a guest, saying so, when the helper cannot be asked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const helper = TestBed.inject(HelperConnection);
    helper.passcode.set('saved');
    hostedGuest();
    const guest = TestBed.inject(GuestMode);

    await guest.checkSaved();

    expect(helper.guest()).toBe(true);
    expect(guest.note()).toContain('could not be checked');
  });

  it('can be previewed from the DEBUG tab on a copy on this computer, and left again with no passcode', async () => {
    const sent = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', sent);
    const helper = TestBed.inject(HelperConnection);
    const guest = TestBed.inject(GuestMode);

    guest.startPreview();
    expect(helper.guest()).toBe(true);
    expect(guest.preview()).toBe(true);
    // a preview has no owner login: the way back is the banner's
    guest.openLogin();
    expect(guest.loginOpen()).toBe(false);

    await guest.endPreview();
    expect(helper.guest()).toBe(false);
    expect(sent).not.toHaveBeenCalled();
  });

  it('opens the next visit in the preview this browser was left in, asking the helper nothing', () => {
    const sent = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', sent);
    TestBed.inject(GuestMode).startPreview();
    expect(localStorage.getItem(PREVIEW_KEY)).toBe('on');

    // the next visit: a fresh page, which only this browser's memory carries the preview into
    TestBed.resetTestingModule();
    const helper = TestBed.inject(HelperConnection);
    const guest = TestBed.inject(GuestMode);
    expect(helper.guest()).toBe(false);
    guest.resumePreview();

    expect(helper.guest()).toBe(true);
    expect(guest.preview()).toBe(true);
    expect(sent).not.toHaveBeenCalled();
  });

  it('forgets the preview once Leave guest preview is pressed, so the next visit opens as usual', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const guest = TestBed.inject(GuestMode);
    guest.startPreview();
    await guest.endPreview();
    expect(localStorage.getItem(PREVIEW_KEY)).toBeNull();

    TestBed.resetTestingModule();
    TestBed.inject(GuestMode).resumePreview();
    expect(TestBed.inject(HelperConnection).guest()).toBe(false);
  });

  it('forgets a hosted preview left with no passcode saved too - it was turned off all the same', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const { guest } = hostedPreview('');
    await guest.endPreview();
    expect(localStorage.getItem(PREVIEW_KEY)).toBeNull();
  });

  it('resumes a hosted preview without sending the passcode, and leaves it with the saved one', async () => {
    localStorage.setItem(PREVIEW_KEY, 'on');
    const asked = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', asked);
    const helper = TestBed.inject(HelperConnection);
    helper.settings.set({ ...DEFAULT_PAGE_CONFIG, helperUrl: HOSTED, requirePasscode: true });
    helper.passcode.set('saved');
    const guest = TestBed.inject(GuestMode);

    guest.resumePreview();
    // the saved passcode is not put to the helper as the page opens in a preview
    await guest.checkSaved();
    expect(guest.preview()).toBe(true);

    await guest.endPreview();
    expect(asked).not.toHaveBeenCalled();
    expect(helper.guest()).toBe(false);
  });

  it('resumed with no passcode saved, a hosted preview becomes guest mode on leaving and asks for it', () => {
    localStorage.setItem(PREVIEW_KEY, 'on');
    const helper = TestBed.inject(HelperConnection);
    helper.settings.set({ ...DEFAULT_PAGE_CONFIG, helperUrl: HOSTED, requirePasscode: true });
    const guest = TestBed.inject(GuestMode);
    guest.resumePreview();
    void guest.endPreview();
    expect(helper.guest()).toBe(true);
    expect(guest.loginOpen()).toBe(true);
  });

  it('says it is checking a saved passcode only when there is one', () => {
    const helper = TestBed.inject(HelperConnection);
    const guest = TestBed.inject(GuestMode);
    guest.checking.set(true);
    expect(guest.checkingSaved()).toBe(false);
    helper.passcode.set('saved');
    expect(guest.checkingSaved()).toBe(true);
  });


  /** a hosted copy, logged in, previewing guest mode */
  function hostedPreview(passcode = 'saved') {
    const helper = TestBed.inject(HelperConnection);
    helper.settings.set({ ...DEFAULT_PAGE_CONFIG, helperUrl: HOSTED, requirePasscode: true });
    if (passcode) helper.passcode.set(passcode);
    const guest = TestBed.inject(GuestMode);
    guest.startPreview();
    return { helper, guest };
  }

  it('leaves a hosted preview at once with a passcode saved here, asking the helper nothing', async () => {
    // the owner toggles the preview freely - asleep helper or not
    const asked = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', asked);
    const { helper, guest } = hostedPreview();

    await guest.endPreview();

    expect(asked).not.toHaveBeenCalled();
    expect(helper.guest()).toBe(false);
    expect(guest.preview()).toBe(false);
    expect(guest.loginOpen()).toBe(false);
  });

  it('stays a guest, asking for the passcode, when a hosted preview has none saved', async () => {
    const asked = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', asked);
    const { helper, guest } = hostedPreview('');
    await guest.endPreview();
    expect(asked).not.toHaveBeenCalled();
    expect(helper.guest()).toBe(true);
    expect(guest.note()).toContain('Log in with the passcode');
    expect(guest.loginOpen()).toBe(true);
  });


});
