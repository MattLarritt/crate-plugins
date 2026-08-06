/**
 * Turn a chord sheet into something a screen can lay out.
 *
 * Two input dialects, one output. Ultimate Guitar marks chords explicitly with [ch]F[/ch] and
 * wraps monospace regions in [tab]…[/tab]. A person typing their own sheet marks nothing —
 * they put chords on one line and the words underneath, and the ALIGNMENT is the only thing
 * saying which syllable a chord falls on.
 *
 * So the unit of output is a line pair: a lyric, plus chords each carrying the column they sat
 * above. Column, not pixel — the renderer decides how wide a character is, and it has to,
 * because the sheet has to reflow into narrow columns without the chords sliding off the words
 * they belong to.
 *
 * The subtle part, and the reason this is a module rather than a regex in a component: a
 * chord's column has to be measured with the MARKUP REMOVED. In "[ch]F[/ch]  [ch]C[/ch]" the
 * second chord starts at raw offset 15 and visual column 3, and 15 is meaningless.
 */

export interface Chord {
  name: string;
  /** Visual column the chord starts at, once markup is stripped. */
  col: number;
  /** A repeat mark or bar line rather than a chord: shown, but not a shape. */
  deco?: true;
}

export type Block =
  /** [Verse 1], [Chorus] — a heading in the sheet. */
  | { kind: 'section'; label: string }
  /** Chords with the words they sit above. Either half can be empty. */
  | { kind: 'line'; chords: Chord[]; lyric: string }
  /** Real tablature: a string grid, preserved exactly because its spacing IS its meaning. */
  | { kind: 'tab'; lines: string[] }
  /** Prose the tabber wrote, kept because it often says how to play the thing. */
  | { kind: 'text'; text: string }
  | { kind: 'gap' };

export interface Sheet {
  /**
   * Everything before the first section heading: who tabbed it, what key it is in, how to play
   * the bridge, and often a chord-voicing grid. Kept, because it is frequently the most useful
   * writing on the page — but kept SEPARATE, because the Harry Styles sheet opens with 31 lines
   * of it and a column layout that leads with the tabber's email address has buried the song.
   */
  preamble: Block[];
  blocks: Block[];
  /** Every distinct chord used, in first-seen order — what the shape strip renders. */
  chords: string[];
}

/**
 * A chord name.
 *
 * Deliberately strict about the root and permissive about the rest: "Cadd9", "F#m7b5", "Bb/D"
 * and "Dsus4" are all chords, while "Oh" and "In" are words that would sail through a looser
 * pattern and turn a lyric into a chord line.
 */
const CHORD_RE =
  /^[A-G](?:#|b)?(?:maj|min|m|M|aug|dim|sus|add|°|\+)?\d*(?:sus\d|add\d|maj\d|b\d|#\d|no\d)*(?:\/[A-G](?:#|b)?)?$/;

/** Marks that share a chord line without being chords: bar lines, repeats, "no chord". */
const DECO_RE = /^(?:\||\|\||%|-+|[xX]\d{1,2}|\d{1,2}[xX]|N\.?C\.?|:|\|:|:\||\.{2,})$/;

const bare = (v: string): string => v.replace(/[()[\],]/g, '').trim();

export function isChordToken(v: string): boolean {
  const t = bare(v);
  return Boolean(t) && t.length <= 12 && CHORD_RE.test(t);
}

function isDecoToken(v: string): boolean {
  const t = bare(v);
  return Boolean(t) && DECO_RE.test(t);
}

/**
 * Does this line hold chords rather than words?
 *
 * Every token has to be a chord or a bar-line-ish mark, and at least one has to be a real
 * chord. The failure mode this guards against is a lyric that happens to be chord-shaped —
 * which is why a line of one short token is read as words: a bare "A" or "I" is far more often
 * a lyric than a chord.
 */
export function looksLikeChordLine(line: string): boolean {
  // Parenthesised directions are the tabber talking, not words being sung — "A E (hold)" is a
  // chord line. Removed before the tokens are judged, or "(hold)" would fail the chord test and
  // sink the line.
  const tokens = line
    .replace(/\([^)]*\)/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return false;
  let chords = 0;
  for (const t of tokens) {
    if (isChordToken(t)) chords++;
    else if (!isDecoToken(t)) return false;
  }
  if (!chords) return false;
  if (tokens.length === 1) {
    // One token alone needs real chord structure to outweigh being a word.
    return tokens[0]!.length > 1 && /[#b0-9]|m|sus|add|dim|aug/.test(tokens[0]!);
  }
  return true;
}

/** A tab line naming its string: "e|--0--2--", "B|-3-". The clearest signal there is. */
const STRING_ROW = /^\s*[eEADGB][b#]?\s*\|/;

/**
 * Actual tablature, as opposed to anything else UG happened to wrap in [tab].
 *
 * Two signals, because either alone gets it wrong. The string label is decisive — nothing else
 * in a sheet begins "e|". Failing that, dashes plus frets, and dashes ALONE are not enough: a
 * sheet's `--------` divider rules are dashes too.
 *
 * The dash threshold is 3, which is why the label test has to exist: hand-typed tab commonly
 * spaces frets two dashes apart ("e|--0--2--3--|") and was being read as prose.
 */
function looksLikeTabGrid(line: string): boolean {
  if (STRING_ROW.test(line) && /[-\d]/.test(line)) return true;
  return /-{3,}/.test(line) && /[|\d]/.test(line);
}

/**
 * Playing directions that share a line with chords without being chords.
 *
 * "(hold)", "(let ring)", "x2", "N.C." — a tabber writes these next to the chord they apply to.
 * They have to be recognised, because the alternative is what happened to the Powderfinger
 * chorus: one `(hold)` on the end of a chord line stopped the line counting as chords, so every
 * chord name printed twice — once as a chip and once again in the text — and the actual words
 * were orphaned on the line below with nothing above them.
 */
const ANNOTATION_ONLY =
  /^(?:\s|\([^)]*\)|\[[^\]]*\]|[xX]\s?\d{1,2}|\d{1,2}\s?[xX]|N\.?C\.?|[|%:,.\-–—])*$/;

/** Pull [ch]…[/ch] out of a line: the visible text, where each chord landed, and what else
 *  was on the line — which decides whether it is a chord line or a lyric with chords in it. */
function chordsFromMarkup(line: string): { text: string; chords: Chord[]; rest: string } {
  const chords: Chord[] = [];
  let text = '';
  let rest = '';
  let i = 0;
  const plain = (v: string) => {
    text += v;
    rest += v;
  };
  while (i < line.length) {
    const open = line.indexOf('[ch]', i);
    if (open === -1) {
      plain(line.slice(i));
      break;
    }
    plain(line.slice(i, open));
    const close = line.indexOf('[/ch]', open);
    if (close === -1) {
      plain(line.slice(open));
      break;
    }
    const name = line.slice(open + 4, close);
    // The column is where the chord begins in the text built SO FAR — the visible position.
    chords.push({ name, col: text.length });
    text += name;
    i = close + 5;
  }
  return { text, chords, rest };
}

/** Blank out the chord names, keeping every other character where it was. */
function maskChords(text: string, chords: Chord[]): string {
  const out = [...text];
  for (const c of chords) {
    for (let i = 0; i < c.name.length; i++) out[c.col + i] = ' ';
  }
  return out.join('');
}

/** The non-chord marks on a chord line, at the columns they were written in. */
function annotationsIn(text: string, chords: Chord[]): Chord[] {
  const out: Chord[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  const masked = maskChords(text, chords);
  while ((m = re.exec(masked))) out.push({ name: m[0], col: m.index, deco: true });
  return out;
}

/** Chords on an unmarked line, by where each token sits. */
function chordsFromColumns(line: string): Chord[] {
  const out: Chord[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (isChordToken(m[0])) {
      out.push({ name: bare(m[0]), col: m.index });
      continue;
    }
    // Kept verbatim: a direction is written the way it is written, so "(hold)" must not arrive
    // as "hold" with its brackets quietly filed off.
    if (m[0].trim()) out.push({ name: m[0], col: m.index, deco: true });
  }
  return out;
}

/** A line with its [tab] markers removed, and which tab region it came from (0 = none). */
interface Src {
  text: string;
  region: number;
}

/**
 * Strip [tab] markers, remembering the regions.
 *
 * The markers cannot be taken at face value. On Ultimate Guitar [tab] means "monospace", and
 * the overwhelmingly common thing inside one is an ordinary chord-over-lyric PAIR — 69 of them
 * in the Harry Styles sheet against 2 unwrapped ones. Rendering those verbatim would abandon
 * the whole point of this feature: no chord positions to reflow, no shapes to look up, no
 * transposing later. So the region is recorded and judged by its CONTENT further down.
 */
function sources(lines: string[]): Src[] {
  const out: Src[] = [];
  let depth = 0;
  let region = 0;
  for (const raw of lines) {
    let text = raw;
    // A region can open and close on one line, or span many.
    const opened = text.includes('[tab]');
    if (opened && depth === 0) region++;
    depth += (text.match(/\[tab\]/g) ?? []).length;
    const closes = (text.match(/\[\/tab\]/g) ?? []).length;
    text = text.replace(/\[\/?tab\]/g, '');
    out.push({ text, region: depth > 0 || closes ? region : 0 });
    depth = Math.max(0, depth - closes);
  }
  return out;
}

/**
 * Parse a sheet.
 *
 * A tab region is kept verbatim only when it actually holds a fret grid; otherwise its lines go
 * through the ordinary chord-line-over-lyric-line pairing, which is what produces the layout
 * everybody recognises. Unmarked grids — somebody pasting tablature into their own sheet —
 * are detected the same way, by shape rather than by markup.
 */
export function parseSheet(raw: string): Sheet {
  const src = sources(raw.replace(/\r\n?/g, '\n').split('\n'));
  const blocks: Block[] = [];
  const chords: string[] = [];
  const seen = new Set<string>();
  const note = (list: Chord[]) => {
    for (const c of list) {
      if (c.name && !c.deco && !seen.has(c.name)) {
        seen.add(c.name);
        chords.push(c.name);
      }
    }
  };
  /** Whether any line of a region is a fret grid — decided once, for the whole region. */
  const gridRegions = new Set<number>();
  for (const s of src) {
    if (s.region && looksLikeTabGrid(s.text)) gridRegions.add(s.region);
  }
  const gap = () => {
    // One gap, however many blank lines: doubled blanks waste the column space this whole
    // layout exists to save.
    if (blocks.length && blocks[blocks.length - 1]?.kind !== 'gap') blocks.push({ kind: 'gap' });
  };

  for (let i = 0; i < src.length; i++) {
    const cur = src[i]!;
    const line = cur.text;

    // A genuine tab region: taken whole, chords noted for the strip, spacing untouched.
    if (cur.region && gridRegions.has(cur.region)) {
      const buf: string[] = [];
      while (i < src.length && src[i]!.region === cur.region) {
        const { text, chords: found } = chordsFromMarkup(src[i]!.text);
        note(found);
        buf.push(text);
        i++;
      }
      i--;
      blocks.push({ kind: 'tab', lines: buf });
      continue;
    }

    // An unmarked grid — pasted tablature — read by shape.
    if (!cur.region && looksLikeTabGrid(line)) {
      const buf: string[] = [];
      while (i < src.length && !src[i]!.region && looksLikeTabGrid(src[i]!.text)) {
        buf.push(src[i]!.text);
        i++;
      }
      i--;
      blocks.push({ kind: 'tab', lines: buf });
      continue;
    }

    const section = /^\s*\[([^\]]{1,40})\]\s*$/.exec(line);
    if (section) {
      blocks.push({ kind: 'section', label: section[1]!.trim() });
      continue;
    }

    if (!line.trim()) {
      gap();
      continue;
    }

    if (line.includes('[ch]')) {
      const { text, chords: found, rest } = chordsFromMarkup(line);
      note(found);
      /*
       * Chords, and possibly directions about how to play them: the words are underneath. The
       * directions travel with the chords as deco entries so they keep their column and stay out
       * of the shape strip.
       */
      if (found.length && ANNOTATION_ONLY.test(rest)) {
        const marks = annotationsIn(text, found);
        const row = marks.length ? [...found, ...marks].sort((a, b) => a.col - b.col) : found;
        const next = src[i + 1]?.text;
        if (next !== undefined && next.trim() && !next.includes('[ch]') && !looksLikeTabGrid(next)) {
          blocks.push({ kind: 'line', chords: row, lyric: next });
          i++;
          continue;
        }
        blocks.push({ kind: 'line', chords: row, lyric: '' });
        continue;
      }
      /*
       * Chords written INSIDE a line of words. The names are masked out of the lyric, because
       * they are already being drawn as chips above it and printing them twice is how the
       * Powderfinger chorus came to have two of every chord.
       */
      blocks.push({ kind: 'line', chords: found, lyric: maskChords(text, found) });
      continue;
    }

    // No markup: decide by shape whether this is a chord line over the next line.
    if (looksLikeChordLine(line)) {
      const found = chordsFromColumns(line);
      note(found);
      const next = src[i + 1]?.text;
      if (
        next !== undefined &&
        next.trim() &&
        !looksLikeChordLine(next) &&
        !looksLikeTabGrid(next) &&
        !/^\s*\[[^\]]{1,40}\]\s*$/.test(next)
      ) {
        blocks.push({ kind: 'line', chords: found, lyric: next });
        i++;
        continue;
      }
      blocks.push({ kind: 'line', chords: found, lyric: '' });
      continue;
    }

    blocks.push({ kind: 'text', text: line });
  }

  // A trailing gap earns nothing.
  while (blocks[blocks.length - 1]?.kind === 'gap') blocks.pop();

  /*
   * Split the preamble off — but only when the sheet is sectioned. A hand-typed sheet often has
   * no headings at all, and there the opening lines ARE the song; hiding them would be the
   * feature eating its own input.
   */
  const first = blocks.findIndex((b) => b.kind === 'section');
  const preamble = first > 0 ? blocks.splice(0, first) : [];
  while (preamble[preamble.length - 1]?.kind === 'gap') preamble.pop();
  return { preamble, blocks, chords };
}

/**
 * How wide the sheet is, in characters.
 *
 * The column layout needs this to pick a font size: a sheet whose longest line is 40 characters
 * can be set larger than one running to 90, and guessing wrong is what makes a chord land over
 * the wrong syllable.
 */
export function sheetWidth(sheet: Sheet): number {
  let w = 0;
  for (const b of sheet.blocks) {
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
