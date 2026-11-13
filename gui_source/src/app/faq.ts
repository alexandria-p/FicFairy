import { Component, computed, inject } from '@angular/core';
import { NamePattern, NameToken, activePattern, nameFrom, namePatternText } from './naming';
import { HelperConnection } from './helper-connection';
import { UpdateCheck } from './updates';

/**
 * The things people ask, and the things they hit without asking.
 *
 * Deliberately free of any dependency on the helper - the page's own config, read before
 * anything started, is all it uses: the most likely moment
 * someone wants this page is when a download did not come out how they expected, which is
 * also a moment the helper may not be running.
 */
@Component({
  selector: 'app-faq',
  templateUrl: './faq.html',
  styleUrl: './faq.css',
})
export class Faq {
  private readonly updates = inject(UpdateCheck);

  /** always the latest release's page, whatever it is called */
  protected readonly latestUrl = this.updates.latestUrl();
  /** the version this page was built as, when it was built by a deployment */
  protected readonly version = this.updates.version();
  private readonly helper = inject(HelperConnection);
  /**
   * only where background runs are offered does the FAQ say how they work - the hosted copy,
   * and never to a guest, whose runs are pretend (`DownloadDialog.offersBackground`)
   */
  protected readonly offersBackground = computed(() => !this.helper.isLocal() && !this.helper.guest());
  /**
   * The privacy policy and the licence are the repository's own files, read on GitHub - the
   * policy as its web-page copy, since GitHub only offers the Word file as a download.
   */
  private readonly repositoryUrl = computed(() => `https://github.com/${this.helper.settings().releasesRepo}`);
  protected readonly privacyPolicyUrl = computed(
    () => `${this.repositoryUrl()}/blob/main/docs/privacy/FicFairy_Privacy-Policy.md`,
  );
  protected readonly licenceUrl = computed(() => `${this.repositoryUrl()}/blob/main/LICENSE`);
  /** the hosted copy says where to get the app in its footer instead (`App.hosted`) */
  protected readonly hosted = !this.helper.isLocal();

  /**
   * How files are named, said for the pattern in force (`FileNamePattern`) - read again when the
   * helper's config brings a different one, since the FAQ can be open before it arrives.
   */
  protected readonly pattern = computed<NamePattern>(() => {
    namePatternText();
    return activePattern();
  });
  /** the pattern with each part named in words */
  protected readonly patternWords = computed(() => {
    const p = this.pattern();
    let out = `{${PART_WORDS[p.order[0]]}}`;
    p.separators.forEach((sep, i) => (out += sep + `{${PART_WORDS[p.order[i + 1]]}}`));
    return out;
  });
  protected readonly indexWords = '{work number} {title} - {author}';
  protected readonly example = computed(() => nameFrom(this.pattern(), EXAMPLE) + '.html');
  /** the naming can be changed only where the helper is on this computer (the DEBUG tab) */
  protected readonly patternEditable = this.helper.isLocal();
}

const PART_WORDS: Record<NameToken, string> = {
  worknum: 'work number',
  title: 'title',
  author: 'author',
  date: 'date updated',
};

const EXAMPLE = { worknum: '34816549', title: 'No Paths Are Bound', author: 'Cataclys', date: '2026-08-23' };
