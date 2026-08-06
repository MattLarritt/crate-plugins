/** The shape of crate's IPv4-pinned text fetch, passed in via ctx.http — see routes(). */
type GetText = (
  url: string,
  opts?: { timeoutMs?: number; headers?: Record<string, string> },
) => Promise<string>;

/**
 * Bring a chord sheet in from an Ultimate Guitar URL.
 *
 * There is no API. The page is a React app, but it ships its entire state in one attribute —
 * `<div class="js-store" data-content="{…escaped JSON…}">` — so the chords, the tuning, the
 * capo and the chord SHAPES all arrive in the same request that serves the HTML. No headless
 * browser, no scraping of rendered markup.
 *
 * Fragility stated plainly, because it will matter one day: this depends on a page structure
 * nobody promised. A redesign breaks it, and the failure has to look like "could not read
 * that page" rather than an empty sheet — the person still has their own text either way,
 * since an import only ever REPLACES the source on request.
 *
 * Fetched on demand for one URL a person pasted, which is the same page they could open
 * themselves; nothing is crawled, bulk-fetched or stored beyond that person's own sheet.
 */

export interface UgChordShape {
  /** Fret per string, HIGH E FIRST — UG's own order. -1 is a muted string. */
  frets: number[];
  /** Fingering per string, 0 for none. Same order as frets. */
  fingers: number[];
  /** Where the diagram's first fret sits, for shapes played up the neck. */
  baseFret: number;
  /** Barres, as UG describes them. */
  barres: { fret: number; from: number; to: number; finger: number }[];
}

export interface UgTab {
  artist: string;
  song: string;
  /** 'Chords', 'Tab', 'Ukulele'… what UG thinks this page is. */
  kind: string;
  tuning: string;
  capo: string;
  /** The raw sheet, still carrying [ch] and [tab] markup for the parser. */
  content: string;
  /** Chord name to its voicings, best first. UG usually offers several. */
  shapes: Record<string, UgChordShape[]>;
  url: string;
}

/** Only real UG tab pages. Anything else is a mistake worth naming rather than fetching. */
export function isUgUrl(v: string): boolean {
  return /^https?:\/\/(tabs\.)?ultimate-guitar\.com\/tab\//i.test(v.trim());
}

interface Store {
  store?: {
    page?: {
      data?: {
        tab?: { song_name?: string; artist_name?: string; type?: string };
        tab_view?: {
          wiki_tab?: { content?: string };
          meta?: { tuning?: { value?: string }; capo?: number | string };
          applicature?: Record<
            string,
            {
              frets?: number[];
              fingers?: number[];
              fret?: number;
              listCapos?: { fret?: number; startString?: number; lastString?: number; finger?: number }[];
            }[]
          >;
        };
      };
    };
  };
}

/**
 * Undo HTML entity escaping in the data-content attribute.
 *
 * Hand-written rather than pulled in: the attribute is escaped by a serialiser, so only the
 * five XML entities and numeric escapes appear. &amp; is done LAST, or "&amp;lt;" would
 * decode twice and turn text into markup.
 */
function unescapeAttr(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * HTML entities inside the sheet itself.
 *
 * Separate from unescapeAttr, and needed because the two escapings are separate: the attribute
 * is escaped by whatever serialises the page, but the stored tab content has its OWN entities —
 * "It&rsquo;s a sign of the times" arrives exactly like that after the JSON has been parsed.
 * Only the handful a tab body actually contains: curly quotes, dashes, and the five XML ones.
 */
const NAMED: Record<string, string> = {
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
};

function decodeEntities(v: string): string {
  return v.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const n = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

export async function fetchUgTab(url: string, getText: GetText): Promise<UgTab> {
  if (!isUgUrl(url)) throw new Error('that is not an ultimate-guitar tab URL');

  // A browser User-Agent because the default one is refused, and this is a page a person
  // asked for rather than a crawl.
  let html: string;
  try {
    html = await getText(url, {
      timeoutMs: 15_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        Accept: 'text/html',
      },
    });
  } catch (err) {
    // "HTTP 404" is what the transport says and means nothing to somebody who just pasted a
    // link. The two answers worth distinguishing are "that page is not there" and "the fetch
    // failed", because only the first is the person's to fix.
    const msg = (err as Error).message;
    const status = /HTTP (\d{3})/.exec(msg)?.[1];
    if (status === '404' || status === '410') {
      throw new Error('Ultimate Guitar has no tab at that link — check the URL');
    }
    throw new Error(`could not fetch that page from Ultimate Guitar (${msg})`);
  }

  const m = /class="js-store"\s+data-content="([\s\S]*?)"><\/div>/.exec(html);
  if (!m?.[1]) throw new Error('could not find the chords on that page — Ultimate Guitar may have changed');

  let store: Store;
  try {
    store = JSON.parse(unescapeAttr(m[1])) as Store;
  } catch {
    throw new Error('could not read that page’s data');
  }

  const data = store.store?.page?.data;
  const view = data?.tab_view;
  const content = decodeEntities(view?.wiki_tab?.content ?? '');
  if (!content.trim()) throw new Error('that page has no chord sheet on it');

  const shapes: Record<string, UgChordShape[]> = {};
  for (const [name, variants] of Object.entries(view?.applicature ?? {})) {
    const list: UgChordShape[] = [];
    for (const v of variants ?? []) {
      if (!Array.isArray(v.frets) || !v.frets.length) continue;
      list.push({
        frets: v.frets,
        fingers: Array.isArray(v.fingers) ? v.fingers : v.frets.map(() => 0),
        baseFret: Number(v.fret) || 0,
        barres: (v.listCapos ?? [])
          .filter((b) => Number.isFinite(Number(b.fret)))
          .map((b) => ({
            fret: Number(b.fret),
            from: Number(b.startString ?? 0),
            to: Number(b.lastString ?? 0),
            finger: Number(b.finger ?? 1),
          })),
      });
    }
    if (list.length) shapes[name] = list;
  }

  const capo = view?.meta?.capo;
  return {
    artist: data?.tab?.artist_name ?? '',
    song: data?.tab?.song_name ?? '',
    kind: data?.tab?.type ?? '',
    tuning: view?.meta?.tuning?.value ?? '',
    capo: capo === undefined || capo === null || capo === 0 ? '' : String(capo),
    content,
    shapes,
    url: url.trim(),
  };
}
