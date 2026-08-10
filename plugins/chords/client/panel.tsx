import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chords, saveChords, deleteChords, type ChordSheetResponse, type ParsedSheet, type SheetBlock } from './api';
import {
  fromUg,
  preferFlatsFor,
  shapesFor,
  transposeChordName,
  ukeShapesFor,
  type Shape,
} from './chordshapes';
import { WORDMARK } from 'crate/logo';

/**
 * Somebody's chords for the song that is playing.
 *
 * The layout is the point of this file. A chord sheet on a screen is normally one endless column
 * you scroll with a hand that is holding a guitar, which is the wrong shape for the activity —
 * so this sets the sheet in COLUMNS and pages sideways, like sheet music on a stand.
 *
 * How the paging works, because it is not obvious from the CSS: the sheet is laid out by CSS
 * multi-column inside a viewport that hides its overflow. `column-fill: auto` with a fixed
 * height makes the content flow into as many columns as it needs, running off to the right, and a
 * page turn translates it by one page's worth — the container width plus one gap, for the reason
 * given at PAGE STRIDE below. The browser does the column breaking, which it is far better at
 * than any measuring loop would be.
 *
 * Alignment is monospace, and that is deliberate rather than lazy: a chord sits at a CHARACTER
 * column over its syllable, so `left: 12ch` lands it exactly where the parser said, at any font
 * size, in any column width. A proportional font would need per-glyph measurement to put a chord
 * over the right vowel.
 *
 * Column count, type size and where the chord diagrams live are all the reader's choice and are
 * remembered — a 34" monitor wants eight columns and a laptop wants three, and neither is a
 * default the code can guess.
 */

/**
 * Below this the panel is a different thing, not a smaller one.
 *
 * A phone has no room for columns, no pointer to hover with, and a thumb that already knows how
 * to scroll — so it gets one scrolling column at the smallest type with the controls removed,
 * rather than a pager and three steppers eating a quarter of the screen. Mirrored in the CSS;
 * the two have to agree or the layout and the JS will disagree about which mode they are in.
 */
const COMPACT_QUERY = '(max-width: 820px)';

/** Space between columns, in px. Needed as a number, not just CSS — see PAGE STRIDE below. */
const GAP = 28;
/** Never smaller than this, even on a phone: past it the sheet is a texture, not words. */
const FLOOR_FONT = 8;
/** And never larger on a phone — the ask was density, so a short-lined sheet stays compact. */
const MOBILE_MAX_FONT = 12.5;
/** How far down the sheet has to move before the diagrams get out of the way. */
const TUCK_AFTER = 28;
/** The most columns anybody can ask for. Eight on a very wide monitor is genuinely readable. */
const MAX_COLUMNS = 8;
/**
 * Auto takes the most columns it can while the type stays COMFORTABLE — not merely legible.
 *
 * Two thresholds rather than one, because they answer different questions. Comfort is what auto
 * is willing to trade away to win a column, and it is deliberately generous: on a 34" monitor a
 * capped-at-four auto produced 831px columns holding 360px of text, which is most of a very
 * expensive screen doing nothing. MIN_FONT is only the floor for a size somebody asked for.
 */
const COMFORT_FONT = 13;
const MIN_FONT = 10.5;
/** Auto will not grow past this either — one column does not mean giant type. */
const MAX_FONT = 15;

/** Type size, relative to the size that exactly fits the chosen column count. */
const SIZE_STEPS = [
  { label: 'Smallest', mult: 0.72 },
  { label: 'Smaller', mult: 0.85 },
  { label: 'Normal', mult: 1 },
  { label: 'Larger', mult: 1.18 },
  { label: 'Largest', mult: 1.4 },
];
const NORMAL_SIZE = 2;

/** Where the chord diagrams sit, or whether they sit anywhere. */
type StripWhere = 'top' | 'left' | 'off';

/** Which instrument the diagrams describe. The sheet itself is instrument-agnostic. */
type Instrument = 'guitar' | 'ukulele';

interface ViewPrefs {
  /** Columns per page, or 0 for "work it out". */
  cols: number;
  /** Index into SIZE_STEPS. */
  size: number;
  strip: StripWhere;
  instrument: Instrument;
}

const PREFS_KEY = 'crate.chords.view';
const DEFAULT_PREFS: ViewPrefs = { cols: 0, size: NORMAL_SIZE, strip: 'top', instrument: 'guitar' };

function readPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw) as Partial<ViewPrefs>;
    return {
      // Clamped on the way in: a stored value from an older build, or one somebody edited by
      // hand, must not be able to produce a layout with zero or ninety columns.
      cols: Math.min(Math.max(Number(v.cols) || 0, 0), MAX_COLUMNS),
      size: Math.min(Math.max(Number(v.size) ?? NORMAL_SIZE, 0), SIZE_STEPS.length - 1),
      strip: v.strip === 'left' || v.strip === 'off' ? v.strip : 'top',
      instrument: v.instrument === 'ukulele' ? 'ukulele' : 'guitar',
    };
  } catch {
    // Private browsing throws on access rather than returning null, and a view preference is
    // not worth a blank panel.
    return DEFAULT_PREFS;
  }
}

function writePrefs(p: ViewPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* nothing to do, and nothing worth telling anybody */
  }
}

/*
 * Transposition is remembered PER TRACK, not with the view preferences.
 *
 * A capo position is a fact about one song in one singer's range — the view preferences are
 * about this screen and apply to everything. Somebody who moves "Tonight, Tonight" down three
 * expects it there next week, and expects the next song untouched.
 */
const SHIFT_KEY = 'crate.chords.shift';

function readShift(trackId: number): number {
  try {
    const raw = localStorage.getItem(SHIFT_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const n = Number(map[String(trackId)]) || 0;
    return Math.min(11, Math.max(-11, n));
  } catch {
    return 0;
  }
}

function writeShift(trackId: number, semitones: number): void {
  try {
    const raw = localStorage.getItem(SHIFT_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    if (semitones === 0) delete map[String(trackId)];
    else map[String(trackId)] = semitones;
    localStorage.setItem(SHIFT_KEY, JSON.stringify(map));
  } catch {
    /* a remembered key is not worth a blank panel in private browsing */
  }
}

/**
 * How the transpose control reads. "Key" when untouched, then a signed semitone count with
 * the capo equivalent for the direction a guitarist can actually clamp — up. Down three is
 * not a capo position, so it does not claim to be one.
 */
function shiftLabel(shift: number): string {
  if (shift === 0) return 'Key';
  if (shift > 0) return `+${shift} · capo ${shift}`;
  return String(shift);
}

/** Whether the panel is in its phone shape. Follows a rotation, not just the first paint. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

/**
 * The width of one character, as a fraction of the font size.
 *
 * Measured rather than assumed, and cached: the monospace stack resolves differently on every
 * platform — SF Mono is 0.6em per character, Consolas 0.55 — and this number decides the type
 * size that makes the sheet fit. Guessing 0.6 on a machine that resolves to Consolas would set
 * the type 9% too small and waste a column's worth of width.
 */
let chRatio = 0;
function charRatio(): number {
  if (chRatio) return chRatio;
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-family:var(--mono)';
  probe.textContent = '0'.repeat(50);
  document.body.appendChild(probe);
  chRatio = probe.getBoundingClientRect().width / 5000 || 0.6;
  probe.remove();
  return chRatio;
}

/** The widest line in the song, in characters — what the type size has to fit. */
function widthOf(blocks: SheetBlock[]): number {
  let w = 0;
  for (const b of blocks) {
    if (b.kind === 'line') {
      w = Math.max(w, b.lyric.length);
      for (const c of b.chords) w = Math.max(w, c.col + c.name.length);
    } else if (b.kind === 'tab') {
      for (const l of b.lines) w = Math.max(w, l.length);
    } else if (b.kind === 'text') {
      w = Math.max(w, b.text.length);
    }
  }
  return w;
}

/**
 * One chord diagram.
 *
 * Six strings, low E on the left, drawn the way a chord chart is drawn rather than the way a
 * fretboard photograph looks. A shape played up the neck shows its own fret window with the
 * position numbered, because five dots with no fret number is not a chord.
 */
function Diagram({ shape, size = 50 }: { shape: Shape; size?: number }) {
  const played = shape.frets.filter((f) => f > 0);
  const lowest = played.length ? Math.min(...played) : 1;
  const highest = played.length ? Math.max(...played) : 1;
  // Four frets shown. The window starts at the lowest fingered fret once the shape has climbed
  // past the nut, so a barre at the 8th does not draw eight empty frets.
  const FRETS = 4;
  const start = highest <= FRETS ? 1 : Math.max(1, Math.min(lowest, highest - FRETS + 1));
  const openNut = start === 1;

  /*
   * The headroom above the nut is not decoration: the × and ○ marks live there. An earlier
   * version gave it 16% of the height and the marks clipped against the top edge while the
   * first-fret dots sat ON the nut line — legible at 64px, a smudge at 46.
   */
  const w = size;
  const h = size * 1.3;
  const padX = w * 0.14;
  const padTop = size * 0.3;
  const padBottom = size * 0.06;
  // Four strings for a ukulele shape, six for guitar — the shape itself says which.
  const strings = shape.frets.length;
  const gridW = w - padX * 2;
  const gridH = h - padTop - padBottom;
  const stringGap = gridW / (strings - 1);
  const fretGap = gridH / FRETS;

  return (
    <svg className="cdiagram" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      {/* Nut when the shape is at the top of the neck, otherwise a plain fret and a number. */}
      <line
        x1={padX}
        y1={padTop}
        x2={padX + gridW}
        y2={padTop}
        className={openNut ? 'nut' : 'fret'}
      />
      {Array.from({ length: FRETS }, (_, i) => (
        <line
          key={`f${i}`}
          x1={padX}
          y1={padTop + fretGap * (i + 1)}
          x2={padX + gridW}
          y2={padTop + fretGap * (i + 1)}
          className="fret"
        />
      ))}
      {Array.from({ length: strings }, (_, i) => (
        <line
          key={`s${i}`}
          x1={padX + stringGap * i}
          y1={padTop}
          x2={padX + stringGap * i}
          y2={padTop + gridH}
          className="string"
        />
      ))}
      {!openNut && (
        <text x={padX - 2} y={padTop + fretGap * 0.7} className="cfret" textAnchor="end">
          {start}
        </text>
      )}
      {shape.frets.map((f, i) => {
        const x = padX + stringGap * i;
        if (f === -1) {
          return (
            <text key={i} x={x} y={padTop - size * 0.08} className="cmark" textAnchor="middle">
              ×
            </text>
          );
        }
        if (f === 0) {
          return (
            <circle key={i} cx={x} cy={padTop - size * 0.15} r={size * 0.06} className="copen" />
          );
        }
        const row = f - start;
        // A fingered note outside the window would be drawn on the edge, which reads as a
        // different chord — better to leave it out than to lie about where it is.
        if (row < 0 || row >= FRETS) return null;
        const finger = shape.fingers[i] ?? 0;
        return (
          <g key={i}>
            <circle cx={x} cy={padTop + fretGap * (row + 0.5)} r={size * 0.08} className="cdot" />
            {finger > 0 && (
              <text
                x={x}
                y={padTop + fretGap * (row + 0.5) + size * 0.035}
                className="cfinger"
                textAnchor="middle"
              >
                {finger}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

type UgShapes = Record<string, { frets: number[]; fingers: number[]; baseFret: number }[]>;

/**
 * Every voicing known for one chord.
 *
 * Guitar prefers the import's shapes — the tabber chose them — and falls back to the derived
 * chart. Ukulele always derives: an Ultimate Guitar applicature is six guitar strings, and
 * there is nothing honest a four-string diagram can take from it.
 */
function voicings(name: string, imported: UgShapes, instrument: Instrument, shifted = false): Shape[] {
  if (instrument === 'ukulele') return ukeShapesFor(name);
  /*
   * A transposed sheet cannot use the import's shapes. They are keyed by the ORIGINAL chord
   * name, and sliding one up two frets is right for a barre chord and nonsense for an open
   * one — the open strings do not move. The derived chart knows the real voicing at the new
   * root, so once the sheet is shifted that is the only honest source.
   */
  if (!shifted) {
    const ug = imported[name];
    if (ug?.length) return fromUg(ug);
  }
  return shapesFor(name);
}

/** Where a hovered chord's card should appear, measured from the thing being hovered. */
interface Peek {
  name: string;
  left: number;
  top: number;
  bottom: number;
}

function peekAt(name: string, el: Element): Peek {
  const r = el.getBoundingClientRect();
  return { name, left: r.left, top: r.top, bottom: r.bottom };
}

function Blocks({
  blocks,
  onPeek,
}: {
  blocks: SheetBlock[];
  onPeek: (p: Peek | null) => void;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'section') {
          return (
            <div key={i} className="csection">
              {b.label}
            </div>
          );
        }
        if (b.kind === 'gap') return <div key={i} className="cgap" />;
        if (b.kind === 'text') {
          return (
            <div key={i} className="ctext">
              {b.text}
            </div>
          );
        }
        if (b.kind === 'tab') {
          return (
            <pre key={i} className="ctab">
              {b.lines.join('\n')}
            </pre>
          );
        }
        return (
          <div key={i} className="cline">
            {b.chords.length > 0 && (
              <div className="cchords">
                {b.chords.map((c, j) =>
                  c.deco ? (
                    <span key={j} className="cdeco" style={{ left: `${c.col}ch` }}>
                      {c.name}
                    </span>
                  ) : (
                    /*
                     * Hover, not click. Looking up a shape is a glance, and a glance should not
                     * cost two clicks (one to open, one to dismiss) while both hands are on the
                     * guitar. Still a button so that a keyboard and a touch screen can both
                     * reach it — focus and tap show the same card.
                     */
                    <button
                      key={j}
                      type="button"
                      className="cchord"
                      style={{ left: `${c.col}ch` }}
                      onMouseEnter={(e) => onPeek(peekAt(c.name, e.currentTarget))}
                      onMouseLeave={() => onPeek(null)}
                      onFocus={(e) => onPeek(peekAt(c.name, e.currentTarget))}
                      onBlur={() => onPeek(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPeek(peekAt(c.name, e.currentTarget));
                      }}
                    >
                      {c.name}
                    </button>
                  ),
                )}
              </div>
            )}
            {b.lyric !== '' && <div className="clyric">{b.lyric}</div>}
          </div>
        );
      })}
    </>
  );
}

/** One segmented control. Small, unlabelled buttons reading as a single choice. */
function Segments<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: { v: T; label: string; title?: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="cseg">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={value === o.v ? 'on' : ''}
          title={o.title}
          onClick={() => onPick(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A −/+ stepper with the current value spelled out between them.
 *
 * The label can be a button too, and for the column stepper it has to be: stepping down from one
 * column has nowhere left to go, so without a way back "Auto" became a setting you could leave
 * and never return to.
 */
function Stepper({
  label,
  canDown,
  canUp,
  onDown,
  onUp,
  onLabel,
  labelTitle,
  down = '−',
  up = '+',
}: {
  label: string;
  canDown: boolean;
  canUp: boolean;
  onDown: () => void;
  onUp: () => void;
  onLabel?: () => void;
  labelTitle?: string;
  down?: string;
  up?: string;
}) {
  return (
    <div className="cstep">
      <button type="button" disabled={!canDown} onClick={onDown} title="Less">
        {down}
      </button>
      {onLabel ? (
        <button type="button" className="lbl" onClick={onLabel} title={labelTitle}>
          {label}
        </button>
      ) : (
        <span>{label}</span>
      )}
      <button type="button" disabled={!canUp} onClick={onUp} title="More">
        {up}
      </button>
    </div>
  );
}

/**
 * The chord panel: the whole window above the play bar.
 *
 * Full height on purpose, including over the app's own header — hence the wordmark in the
 * corner, which is the only thing left saying where you are. Chords are read from further away
 * than anything else in this app and the columns are the whole point, so every pixel that is not
 * the sheet is a pixel arguing for itself.
 */
export function ChordPanel({
  trackId,
  title,
  artistName,
  onClose,
  say,
}: {
  trackId: number;
  title: string;
  artistName: string;
  onClose: () => void;
  say: (k: 'good' | 'bad', t: string) => void;
}) {
  const [data, setData] = useState<ChordSheetResponse | 'loading'>('loading');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [peek, setPeek] = useState<Peek | null>(null);
  /** Semitones the sheet is displaced by. Loaded per track, so switching songs reloads it. */
  const [shift, setShift] = useState(() => readShift(trackId));
  useEffect(() => setShift(readShift(trackId)), [trackId]);
  /*
   * Takes a DELTA and updates functionally, rather than taking the computed next value.
   * Two quick taps on ♯ both read the same stale `shift` from their closure and both
   * asked for +1, so the sheet moved a semitone for two presses.
   */
  const changeShift = (delta: number | 'reset') => {
    setShift((prev) => {
      const next = delta === 'reset' ? 0 : Math.min(11, Math.max(-11, prev + delta));
      writeShift(trackId, next);
      return next;
    });
  };
  const [showPreamble, setShowPreamble] = useState(false);
  const [prefs, setPrefs] = useState<ViewPrefs>(readPrefs);
  const compact = useCompact();
  /** On a phone the diagrams slide away as soon as the sheet moves. */
  const [tucked, setTucked] = useState(false);
  const lastScroll = useRef(0);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const change = (patch: Partial<ViewPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writePrefs(next);
      return next;
    });
  };

  useEffect(() => {
    setData('loading');
    setEditing(false);
    setPage(0);
    setPeek(null);
    setShowPreamble(false);
    let dead = false;
    chords(trackId)
      .then((d) => {
        if (dead) return;
        setData(d);
        setDraft(d.body);
        // Nothing written yet: open straight into the editor, because an empty reader is a
        // dead end and the first thing anybody does here is paste a link.
        if (!d.body) setEditing(true);
      })
      .catch(() => {
        if (!dead) {
          setData({ body: '', sourceUrl: '', shapes: {}, tuning: '', capo: '', parsed: null });
        }
      });
    return () => {
      dead = true;
    };
  }, [trackId]);

  const rawParsed: ParsedSheet | null = data === 'loading' ? null : data.parsed;

  /*
   * The sheet as it should be READ right now: every chord name moved by `shift`.
   *
   * Done here rather than by rewriting the stored body, so the sheet on the server stays
   * exactly what the tabber wrote and the transposition is a lens over it. Tab blocks pass
   * through untouched — their fret numbers are positions on a fretboard, and adding two to
   * each would silently move the open strings, which are not notes you can shift.
   */
  const parsed: ParsedSheet | null = useMemo(() => {
    if (!rawParsed || shift === 0) return rawParsed;
    const flats = preferFlatsFor(rawParsed.chords[0], shift);
    const move = (name: string) => transposeChordName(name, shift, flats);
    const block = (b: SheetBlock): SheetBlock =>
      b.kind === 'line' && b.chords
        ? { ...b, chords: b.chords.map((c) => (c.deco ? c : { ...c, name: move(c.name) })) }
        : b;
    return {
      preamble: rawParsed.preamble.map(block),
      blocks: rawParsed.blocks.map(block),
      chords: rawParsed.chords.map(move),
    };
  }, [rawParsed, shift]);

  /*
   * Watch the viewport rather than the window: the diagram rail can take a strip off the left
   * and the column layout has to follow that, not just an orientation change.
   *
   * The PADDING is subtracted, and that is not a detail. clientWidth includes it, so measuring
   * it raw made every column 16px wider than the room it had — at 800px the second column then
   * missed by 4px and the browser silently dropped to one column per page, ten pages deep. The
   * columns live in the content box, so the content box is what has to be measured.
   */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      setBox({ w: Math.max(el.clientWidth - padX, 0), h: Math.max(el.clientHeight - padY, 0) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [editing, data === 'loading']);

  /**
   * How wide a column is, and how big the type.
   *
   * Column WIDTH rather than column count, which is what keeps the reader's choices from
   * fighting each other. Ask for eight columns and the largest type and the two cannot both be
   * had — so the width is the wider of "an eighth of the room" and "wide enough for the longest
   * line", and the browser then fits however many of those actually go on a page. The count
   * degrades and the sheet stays readable; the alternative is columns that overlap their
   * neighbours, which is unreadable and looks broken.
   */
  const layout = useMemo(() => {
    const chars = parsed ? Math.max(widthOf(parsed.blocks), 20) : 40;
    const mult = SIZE_STEPS[prefs.size]?.mult ?? 1;
    if (!box.w) return { colW: 0, font: 13 * mult, wanted: prefs.cols || 1 };
    const ratio = charRatio();
    /** The type size at which the longest line exactly fills one of `c` columns. */
    const fitFont = (c: number) => (box.w - GAP * (c - 1)) / c / (chars * ratio);

    /*
     * A phone gets one column of small type, and no say in it.
     *
     * The size is the FIT — the largest that keeps the longest line inside the screen — held
     * under a cap so a short-lined sheet comes out dense too instead of growing to fill the
     * width. Applying the "Smallest" multiplier on top, as the first attempt did, compounded two
     * shrinks: These Days fits at 10px on a 375px screen and 72% of that is 7px, which is a
     * texture rather than words. Small enough to fit IS the smallest useful size here.
     */
    if (compact) {
      const fit = Math.max(fitFont(1), FLOOR_FONT);
      return { colW: 0, font: Math.min(fit, MOBILE_MAX_FONT), wanted: 1 };
    }

    let wanted = prefs.cols;
    if (!wanted) {
      wanted = 1;
      for (let c = MAX_COLUMNS; c >= 1; c--) {
        if (fitFont(c) >= COMFORT_FONT) {
          wanted = c;
          break;
        }
      }
    }
    const font = Math.min(Math.max(fitFont(wanted), MIN_FONT), MAX_FONT) * mult;
    const share = (box.w - GAP * (wanted - 1)) / wanted;
    return { colW: Math.max(share, chars * ratio * font), font, wanted };
  }, [box.w, parsed, prefs.cols, prefs.size, compact]);

  /**
   * PAGE STRIDE, and the reason this is measured rather than `translateX(-100%)`.
   *
   * A page turn has to move by the distance between column 1 and column N+1, and that is the
   * container width PLUS one gap — the gap that would have followed the last column of the page.
   * Translating by 100% (the container width alone) leaves every page one gap to the right of
   * where it belongs, so page two arrived shifted by 28px with its last column clipped. Measured
   * on the real layout: columns started at 0, 387, 774, 1160, 1547 — the fifth at 1547, not at
   * the container's 1519.
   */
  const [stride, setStride] = useState(0);
  /** How many columns a page actually holds, which is not always how many were asked for. */
  const [actualCols, setActualCols] = useState(1);

  // useLayoutEffect so the page count and stride are right before the first paint that could
  // otherwise show a stale "1 of 1".
  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    if (compact) {
      // One tall column that scrolls, so there is nothing to page and nothing to measure.
      setStride(0);
      setPages(1);
      setActualCols(1);
      setPage(0);
      return;
    }
    const step = flow.clientWidth + GAP;
    const total = Math.max(1, Math.ceil((flow.scrollWidth + GAP) / Math.max(step, 1)));
    setStride(step);
    setPages(total);
    setActualCols(
      layout.colW > 0 ? Math.max(1, Math.floor((flow.clientWidth + GAP) / (layout.colW + GAP))) : 1,
    );
    setPage((p) => Math.min(p, total - 1));
  }, [parsed, layout, box.h, box.w, showPreamble, compact]);

  // Page with the arrow keys, the way somebody with a guitar in their lap would want to.
  useEffect(() => {
    if (editing || compact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        setPage((p) => Math.min(p + 1, pages - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setPage((p) => Math.max(p - 1, 0));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, pages, onClose, compact]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveChords(trackId, draft);
      setData(saved);
      setDraft(saved.body);
      setEditing(false);
      setPage(0);
      if (saved.imported) {
        say('good', `Imported ${saved.imported.song} — ${saved.imported.artist}`);
      } else if (saved.body) {
        say('good', 'Chords saved');
      }
    } catch (err) {
      say('bad', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const shapes: UgShapes = data === 'loading' ? {} : data.shapes;
  const peekShapes = peek ? voicings(peek.name, shapes, prefs.instrument, shift !== 0) : [];

  /** The diagram rail, in whichever direction it is running. */
  const strip = (where: 'top' | 'left') =>
    parsed && parsed.chords.length > 0 ? (
      <div className={`cstrip ${where}`}>
        {/* Which instrument the diagrams describe. Lives IN the strip because that is what it
            changes — and because on a phone the footer tools do not exist. */}
        <div className="cinstr" role="group" aria-label="Diagram instrument">
          {(['guitar', 'ukulele'] as const).map((inst) => (
            <button
              key={inst}
              type="button"
              className={prefs.instrument === inst ? 'on' : ''}
              onClick={() => change({ instrument: inst })}
            >
              {inst === 'guitar' ? 'Guitar' : 'Uke'}
            </button>
          ))}
        </div>
        {/* Transpose lives in the strip too, not only in the footer: on a phone there IS no
            footer, and changing key is the one thing you do with a guitar in your hands. */}
        <div className="cshift" role="group" aria-label="Transpose">
          <button type="button" onClick={() => changeShift(-1)} disabled={shift <= -11} title="Down a semitone">
            ♭
          </button>
          <button
            type="button"
            className={shift === 0 ? 'lbl' : 'lbl on'}
            onClick={() => changeShift('reset')}
            disabled={shift === 0}
            title={shift === 0 ? 'Written key' : 'Back to the written key'}
          >
            {shiftLabel(shift)}
          </button>
          <button type="button" onClick={() => changeShift(1)} disabled={shift >= 11} title="Up a semitone">
            ♯
          </button>
        </div>
        {parsed.chords.map((name) => {
          const v = voicings(name, shapes, prefs.instrument, shift !== 0);
          return (
            <button
              key={name}
              type="button"
              className="cstripitem"
              title={v.length > 1 ? `${v.length} voicings` : v[0]?.label}
              onMouseEnter={(e) => setPeek(peekAt(name, e.currentTarget))}
              onMouseLeave={() => setPeek(null)}
              onFocus={(e) => setPeek(peekAt(name, e.currentTarget))}
              onBlur={() => setPeek(null)}
            >
              <span className="n">{name}</span>
              {v[0] ? <Diagram shape={v[0]} /> : <span className="cnodiagram">?</span>}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="chordpanel">
      <div className="chordhead">
        {/* This panel covers the app's own header, so the wordmark is the only thing left
            saying which application you are looking at. */}
        <svg className="chordlogo" viewBox={`0 0 ${WORDMARK.w} ${WORDMARK.h}`} role="img" aria-label="Crate">
          <path fill="currentColor" fillRule="evenodd" d={WORDMARK.d} />
        </svg>
        <div className="words">
          <div className="t">{title}</div>
          <div className="s muted">
            {artistName}
            {data !== 'loading' && data.tuning ? ` · ${data.tuning}` : ''}
            {data !== 'loading' && data.capo ? ` · capo ${data.capo}` : ''}
          </div>
        </div>
        {data !== 'loading' && data.sourceUrl && !editing && (
          // Where an import came from, credited and reachable. The tabber wrote this.
          <a
            className="csource muted"
            href={data.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Ultimate Guitar
          </a>
        )}
        {!editing && (
          <button className="btn sec sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {editing && data !== 'loading' && data.body && (
          <button
            className="btn sec sm"
            onClick={() => {
              setDraft(data.body);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        )}
        {editing && (
          <button className="btn sm" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        <button className="btn sec sm" onClick={onClose}>
          Close
        </button>
      </div>

      {data === 'loading' && <div className="spinner">Looking up your chords…</div>}

      {editing && data !== 'loading' && (
        <div className="chordedit">
          <p className="muted sm">
            Type the chords above the words, or paste an Ultimate Guitar link on the first line and
            save — it will be fetched and formatted. Only you can see this.
          </p>
          <textarea
            className="chordbox"
            value={draft}
            spellCheck={false}
            placeholder={
              'https://tabs.ultimate-guitar.com/tab/…\n\nor type it yourself:\n\n' +
              '[Verse 1]\nC              G\nSitting here with nothing to say\n'
            }
            onChange={(e) => setDraft(e.target.value)}
          />
          {data.body && (
            <button
              className="btn sec sm cdelete"
              onClick={() => {
                setDraft('');
                void (async () => {
                  await deleteChords(trackId).catch(() => {});
                  setData({
                    body: '',
                    sourceUrl: '',
                    shapes: {},
                    tuning: '',
                    capo: '',
                    parsed: null,
                  });
                  say('good', 'Chord sheet removed');
                })();
              }}
            >
              Delete this sheet
            </button>
          )}
        </div>
      )}

      {!editing && parsed && (
        <>
          {/* Diagrams and the tabber's notes, which slide out of the way on a phone as soon
              as the sheet moves — see onScroll below. On a desktop this never collapses. */}
          <div className={`chordtuck${tucked ? ' tucked' : ''}`}>
            {(compact || prefs.strip === 'top') && strip('top')}

            {parsed.preamble.length > 0 && (
            <div className="cpreamble">
              <button className="btn sec sm" onClick={() => setShowPreamble((s) => !s)}>
                {showPreamble ? 'Hide the tabber’s notes' : 'About this tab'}
              </button>
              {showPreamble && (
                <div
                  className="cpreamblebody"
                  style={{ fontSize: `${Math.max(layout.font, 11)}px` }}
                >
                  <Blocks blocks={parsed.preamble} onPeek={setPeek} />
                </div>
              )}
            </div>
            )}
          </div>

          <div className="chordmain">
            {!compact && prefs.strip === 'left' && strip('left')}
            <div
              className="chordviewport"
              ref={viewportRef}
              onScroll={(e) => {
                if (!compact) return;
                /*
                 * Hide going down, come back coming up — the behaviour of every mobile toolbar,
                 * and the reason it is not simply "hidden below 28px": on a long sheet that
                 * would mean scrolling all the way back to the top to look up a shape.
                 */
                const y = e.currentTarget.scrollTop;
                const was = lastScroll.current;
                lastScroll.current = y;
                if (y <= TUCK_AFTER) setTucked(false);
                else if (y > was + 4) setTucked(true);
                else if (y < was - 12) setTucked(false);
              }}
            >
              <div
                className="chordflow"
                ref={flowRef}
                style={{
                  // Width, not count — see the note on `layout`. Neither applies on a phone,
                  // which is one plain column that scrolls.
                  columnWidth: !compact && layout.colW ? `${layout.colW}px` : undefined,
                  columnGap: GAP,
                  fontSize: `${layout.font}px`,
                  transform: compact ? undefined : `translateX(-${page * stride}px)`,
                }}
              >
                <Blocks blocks={parsed.blocks} onPeek={setPeek} />
              </div>
            </div>
          </div>

          {!compact && (
          <div className="chordfoot">
            <div className="ctools">
              <Stepper
                label={shiftLabel(shift)}
                down="♭"
                up="♯"
                canDown={shift > -11}
                canUp={shift < 11}
                onDown={() => changeShift(-1)}
                onUp={() => changeShift(1)}
                onLabel={shift === 0 ? undefined : () => changeShift('reset')}
                labelTitle="Back to the written key"
              />
              <Segments<StripWhere>
                value={prefs.strip}
                options={[
                  { v: 'top', label: 'Top', title: 'Chord shapes across the top' },
                  { v: 'left', label: 'Left', title: 'Chord shapes down the left' },
                  { v: 'off', label: 'Off', title: 'No chord shapes' },
                ]}
                onPick={(v) => change({ strip: v })}
              />
              <Segments<Instrument>
                value={prefs.instrument}
                options={[
                  { v: 'guitar', label: 'Guitar', title: 'Guitar chord diagrams' },
                  { v: 'ukulele', label: 'Ukulele', title: 'Ukulele chord diagrams (GCEA)' },
                ]}
                onPick={(v) => change({ instrument: v })}
              />
              <Stepper
                label={SIZE_STEPS[prefs.size]?.label ?? 'Normal'}
                down="A−"
                up="A+"
                canDown={prefs.size > 0}
                canUp={prefs.size < SIZE_STEPS.length - 1}
                onDown={() => change({ size: prefs.size - 1 })}
                onUp={() => change({ size: prefs.size + 1 })}
              />
              {/* The steppers act on what you can SEE: from Auto, "+" means one more column
                  than you have got, not some remembered number. The label goes back to Auto. */}
              <Stepper
                label={
                  prefs.cols === 0
                    ? `Auto (${actualCols})`
                    : `${prefs.cols} column${prefs.cols === 1 ? '' : 's'}${
                        // Say so when the ask could not be met, rather than quietly showing
                        // a different number of columns than the one on the button.
                        actualCols !== prefs.cols ? ` → ${actualCols}` : ''
                      }`
                }
                canDown={(prefs.cols || actualCols) > 1}
                canUp={(prefs.cols || actualCols) < MAX_COLUMNS}
                onDown={() => change({ cols: Math.max((prefs.cols || actualCols) - 1, 1) })}
                onUp={() => change({ cols: Math.min((prefs.cols || actualCols) + 1, MAX_COLUMNS) })}
                onLabel={prefs.cols === 0 ? undefined : () => change({ cols: 0 })}
                labelTitle="Back to automatic"
              />
            </div>
            <div className="cpager">
              <button
                className="btn sec sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
              >
                ‹ Back
              </button>
              <span className="muted sm">
                {pages > 1 ? `Page ${page + 1} of ${pages}` : 'One page'}
              </span>
              <button
                className="btn sec sm"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => Math.min(p + 1, pages - 1))}
              >
                Next ›
              </button>
            </div>
          </div>
          )}
        </>
      )}

      {/*
       * The hovered chord's shapes, floated next to it.
       *
       * pointer-events: none in the CSS, which is what makes hover work at all: a card that
       * could take the pointer would land under the cursor, steal the hover, and flicker itself
       * in and out. It is never interactive, so it costs nothing to make it untouchable.
       */}
      {peek && (
        <div
          className="cpeek"
          style={{
            left: Math.min(Math.max(peek.left - 8, 8), Math.max(window.innerWidth - 380, 8)),
            // Below the chord normally, above it when there is no room below.
            ...(peek.bottom + 190 < window.innerHeight
              ? { top: peek.bottom + 6 }
              : { bottom: window.innerHeight - peek.top + 6 }),
          }}
        >
          <div className="t">{peek.name}</div>
          {peekShapes.length === 0 ? (
            <div className="muted sm">
              No diagram for this one — a guessed shape would be worse than none.
            </div>
          ) : (
            <div className="cvrow">
              {peekShapes.map((s, i) => (
                <div key={i} className="cvitem">
                  <Diagram shape={s} size={58} />
                  <div className="muted sm">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
