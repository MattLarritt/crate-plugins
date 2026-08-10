/**
 * What a chord looks like under the fingers.
 *
 * An imported sheet arrives with Ultimate Guitar's own voicings, which are better than anything
 * computed — they are what a person chose to play. But a sheet somebody typed themselves has
 * nothing attached, and "Cadd9" with no diagram is exactly the moment a beginner gives up. So
 * there are two sources, and they produce the same shape:
 *
 *   imported   UG's applicature, up to 27 voicings per chord, in THEIR string order.
 *   derived    an open-position table for the chords people actually play, plus movable
 *              E-shape and A-shape barres for the other eleven roots.
 *
 * Everything here is LOW E FIRST — the order a chord diagram is drawn in, left to right. UG's
 * arrays run the other way, high E first, so they are reversed at the boundary. Getting that
 * backwards produces a diagram that is plausible, playable, and the wrong chord.
 *
 * A chord this cannot work out gets NO diagram rather than a guess. Somebody trusting a wrong
 * shape is worse off than somebody reading the chord name and working it out themselves.
 */

export interface Shape {
  /** Fret per string, low E first. 0 is open, -1 is muted. */
  frets: number[];
  /** Finger per string, low E first. 0 means unspecified. */
  fingers: number[];
  /** How the voicing is described, for the tooltip: "open", "barre 3rd fret". */
  label: string;
}

/** Semitone of each note name, C = 0. */
const NOTE: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

/** Open notes of the six strings, low E first. */
const OPEN_STRINGS = [4, 9, 2, 7, 11, 4];

export interface ParsedChord {
  root: number;
  /** Normalised quality key: '', 'm', '7', 'm7', 'maj7', 'sus4'… */
  quality: string;
  /** Slash bass, when written. Only used for labelling — the shape ignores it. */
  bass: number | null;
}

/**
 * Every spelling of a quality that means the same chord.
 *
 * An exact table, not prefix-stripping, and that is the point. Stripping a leading "maj" turned
 * Cmaj9 into C9 — a major seventh silently replaced by a dominant one, which is a different
 * chord and the sort of wrong answer somebody would trust. Here an unlisted quality falls
 * through unchanged, matches nothing, and shows no diagram.
 *
 * Note 'M' and 'm' both appear: uppercase is major, lowercase is minor, and case-folding them
 * together would be the same class of mistake.
 */
const ALIAS: Record<string, string> = {
  '': '',
  maj: '',
  major: '',
  M: '',
  m: 'm',
  min: 'm',
  minor: 'm',
  '-': 'm',
  '7': '7',
  dom7: '7',
  m7: 'm7',
  min7: 'm7',
  '-7': 'm7',
  maj7: 'maj7',
  M7: 'maj7',
  ma7: 'maj7',
  'Δ': 'maj7',
  'Δ7': 'maj7',
  sus: 'sus4',
  sus4: 'sus4',
  sus2: 'sus2',
  '6': '6',
  maj6: '6',
  M6: '6',
  m6: 'm6',
  min6: 'm6',
  '9': '9',
  dom9: '9',
};

/**
 * Split a chord name into a root and a quality.
 *
 * The same chord is spelled several ways in the wild — "Cmin7", "Cm7" and "C-7" are one chord
 * and have to key one table entry — so the quality goes through the alias table above.
 */
export function parseChordName(name: string): ParsedChord | null {
  const m = /^([A-G](?:#|b)?)(.*)$/.exec(name.trim());
  if (!m) return null;
  const root = NOTE[m[1]!];
  if (root === undefined) return null;

  let rest = m[2] ?? '';
  let bass: number | null = null;
  const slash = rest.indexOf('/');
  if (slash !== -1) {
    const b = NOTE[rest.slice(slash + 1).trim()];
    bass = b === undefined ? null : b;
    rest = rest.slice(0, slash);
  }

  const written = rest.trim().replace(/°/, 'dim').replace(/^\+$/, 'aug');
  // Exact, then a lowercase retry for MIN7 and friends. 'M' and 'm' are both listed exactly, so
  // the retry can never turn a major into a minor.
  const quality = ALIAS[written] ?? ALIAS[written.toLowerCase()] ?? written;
  return { root, quality, bass };
}

/*
 * Note spellings for writing a root back out, in both directions.
 *
 * Which one to use is a real musical question, not a formatting preference: the key of Eb
 * is spelled with flats and the key of E with sharps, and "D#" in a flat key reads as a
 * mistake to anyone playing from it. transposeChordName picks per target key below.
 */
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Keys conventionally written with flats, as semitones from C. F, Bb, Eb, Ab, Db, Gb. */
const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]);

/** Semitone → note name, spelled for the key the music is now in. */
export function noteName(semitone: number, preferFlats: boolean): string {
  const i = ((semitone % 12) + 12) % 12;
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[i]!;
}

/**
 * Move one chord name by a number of semitones, keeping everything that is not the root.
 *
 * The quality is carried through VERBATIM rather than through the alias table: the sheet
 * said "Cmin7" and the player should still read "min7" a tone up, because rewriting their
 * sheet into a house dialect is not transposing it. Slash basses move too — a G/B is a
 * different chord from a G, and leaving the bass behind would silently change it.
 *
 * `preferFlats` normally follows the transposed KEY (the first chord of the sheet), which is
 * why the caller passes it in rather than each chord deciding for itself.
 */
export function transposeChordName(name: string, semitones: number, preferFlats: boolean): string {
  if (semitones === 0) return name;
  const m = /^([A-G](?:#|b)?)(.*)$/.exec(name.trim());
  if (!m) return name;
  const root = NOTE[m[1]!];
  if (root === undefined) return name;

  let rest = m[2] ?? '';
  let bassOut = '';
  const slash = rest.indexOf('/');
  if (slash !== -1) {
    const bassText = rest.slice(slash + 1).trim();
    const bass = NOTE[bassText];
    // An unrecognised bass ("G/add9" and other oddities) is left exactly as written.
    bassOut = bass === undefined ? `/${bassText}` : `/${noteName(bass + semitones, preferFlats)}`;
    rest = rest.slice(0, slash);
  }
  return noteName(root + semitones, preferFlats) + rest + bassOut;
}

/**
 * Should the transposed sheet be written with flats?
 *
 * Decided once for the whole sheet from its FIRST chord — the nearest thing a chord sheet
 * has to a stated key — so a song never mixes D# and Eb between two lines.
 */
export function preferFlatsFor(firstChord: string | undefined, semitones: number): boolean {
  if (!firstChord) return false;
  const m = /^([A-G](?:#|b)?)/.exec(firstChord.trim());
  const root = m ? NOTE[m[1]!] : undefined;
  if (root === undefined) return false;
  return FLAT_KEYS.has(((root + semitones) % 12 + 12) % 12);
}

/**
 * Open-position voicings, written out.
 *
 * Hand-written rather than derived, and worth the lines: these are the shapes a guitarist
 * actually forms, and a derived barre at the first fret for "C" would be technically correct and
 * useless. Read as low E → high e; x is muted.
 */
const OPEN: Record<string, { frets: number[]; fingers?: number[] }> = {
  C: { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  C7: { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  Cadd9: { frets: [-1, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
  D: { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  D7: { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 3, 1, 2] },
  Dmaj7: { frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1] },
  Dm7: { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
  Dsus2: { frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0] },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
  E: { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  E7: { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  Em7: { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0] },
  Esus4: { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0] },
  F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  G7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 1, 0, 0, 0, 2] },
  A: { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Am: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  A7: { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  Am7: { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  Amaj7: { frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 3, 1, 2, 0] },
  Asus2: { frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  Asus4: { frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  B7: { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
};

/**
 * Movable shapes, as offsets from the root fret.
 *
 * Two families: rooted on the sixth string (the E shapes) and on the fifth (the A shapes),
 * which between them cover every root at some position on the neck. -1 is a string left out.
 * Only qualities whose barre shape is unambiguous are here — a half-remembered m7b5 voicing
 * would be a diagram that teaches somebody the wrong chord.
 */
const MOVABLE: Record<string, { e?: number[]; a?: number[] }> = {
  '': { e: [0, 2, 2, 1, 0, 0], a: [-1, 0, 2, 2, 2, 0] },
  m: { e: [0, 2, 2, 0, 0, 0], a: [-1, 0, 2, 2, 1, 0] },
  '7': { e: [0, 2, 0, 1, 0, 0], a: [-1, 0, 2, 0, 2, 0] },
  m7: { e: [0, 2, 0, 0, 0, 0], a: [-1, 0, 2, 0, 1, 0] },
  maj7: { e: [0, 2, 1, 1, 0, 0], a: [-1, 0, 2, 1, 2, 0] },
  sus4: { e: [0, 2, 2, 2, 0, 0], a: [-1, 0, 2, 2, 3, 0] },
  sus2: { a: [-1, 0, 2, 2, 0, 0] },
  '6': { a: [-1, 0, 2, 2, 2, 2] },
  m6: { a: [-1, 0, 2, 2, 1, 2] },
  '9': { a: [-1, 0, 2, 0, 2, 2] },
};

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

/** Shift a movable shape up the neck to put its root at `fret`. */
function atFret(shape: number[], fret: number, family: 'E' | 'A'): Shape {
  return {
    frets: shape.map((f) => (f === -1 ? -1 : f + fret)),
    // Fingering for a barre is the same everywhere, but only the barre finger is worth
    // asserting; the rest depends on the hand.
    fingers: shape.map(() => 0),
    label: fret === 0 ? 'open' : `${family} shape, barre ${ORD[fret] ?? `fret ${fret}`} fret`,
  };
}

/**
 * Voicings for a chord name, best first.
 *
 * "Best" means what somebody would reach for: the open shape when there is one, then the
 * lowest barre. Returns empty for anything unrecognised.
 */
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function shapesFor(name: string): Shape[] {
  const out: Shape[] = [];
  const parsedFirst = parseChordName(name);
  // The literal spelling first, then the canonical one, so "CM7" finds the open Cmaj7 rather
  // than settling for a barre.
  const open =
    OPEN[name.trim()] ??
    (parsedFirst
      ? (OPEN[SHARP[parsedFirst.root]! + parsedFirst.quality] ??
        OPEN[FLAT[parsedFirst.root]! + parsedFirst.quality])
      : undefined);
  if (open) {
    out.push({
      frets: open.frets,
      fingers: open.fingers ?? open.frets.map(() => 0),
      label: open.frets.some((f) => f === 0) ? 'open' : 'first position',
    });
  }

  const parsed = parsedFirst;
  if (!parsed) return out;
  const movable = MOVABLE[parsed.quality];
  if (!movable) return out;

  // Where the root sits on the sixth and fifth strings. 12 rather than 0 is deliberate for the
  // A family: an "open" A shape only exists for A itself, and every other root needs a fret.
  const eFret = (parsed.root - OPEN_STRINGS[0]! + 12) % 12;
  const aFret = (parsed.root - OPEN_STRINGS[1]! + 12) % 12;
  const cands: Shape[] = [];
  if (movable.e) cands.push(atFret(movable.e, eFret, 'E'));
  if (movable.a) cands.push(atFret(movable.a, aFret, 'A'));
  cands.sort((x, y) => Math.max(...x.frets) - Math.max(...y.frets));

  for (const c of cands) {
    // Not a duplicate of the open voicing already listed.
    if (out.some((o) => o.frets.join() === c.frets.join())) continue;
    out.push(c);
  }
  return out;
}

/** UG's voicings, brought into this module's order and vocabulary. */
export function fromUg(
  variants: { frets: number[]; fingers: number[]; baseFret: number }[],
  limit = 5,
): Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    if (v.frets.length !== 6) continue;
    // UG runs high e → low E. Reversing is the whole conversion; the fret numbers are already
    // absolute, so baseFret is only their drawing hint and this module works its own out.
    const frets = [...v.frets].reverse();
    const key = frets.join();
    if (seen.has(key)) continue;
    seen.add(key);
    const lowest = Math.min(...frets.filter((f) => f > 0));
    out.push({
      frets,
      fingers: [...v.fingers].reverse(),
      label: frets.some((f) => f === 0)
        ? 'open'
        : Number.isFinite(lowest) && lowest > 0
          ? `${ORD[lowest] ?? `fret ${lowest}`} fret`
          : '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---- ukulele ---------------------------------------------------------------

/**
 * Ukulele voicings, DERIVED rather than tabled.
 *
 * The guitar half of this module is a hand-written chart, because guitar voicings are
 * conventions — the "right" F is a cultural fact a search cannot know. Ukulele is a different
 * instrument in a useful way: four strings, chords lie within a few frets of the nut, and the
 * standard shapes ARE the mathematically compact ones — so a small search over GCEA finds the
 * textbook chart (C = 0003, G = 0232, Am = 2000…) instead of hard-coding it, and every root and
 * quality falls out for free, including ones the guitar chart refuses (dim, aug, add9).
 *
 * The same honesty rule holds: a quality this cannot spell gets NO diagram. And the derivation
 * is testable — decode a voicing's notes and they must be exactly the chord's tones.
 */

/** Open strings, low to high as drawn: G C E A. (Re-entrant tuning; pitch class is what matters.) */
const UKE_OPEN = [7, 0, 4, 9];

/**
 * Chord tones by quality, as semitone offsets from the root.
 *
 * `omit` lists tones a four-string instrument may drop — always the fifth, never the third or
 * the tone that names the chord. A 9th chord on four strings is root-3rd-7th-9th, exactly as a
 * uke chart writes it.
 */
const UKE_TONES: Record<string, { tones: number[]; omit?: number[] }> = {
  '': { tones: [0, 4, 7] },
  m: { tones: [0, 3, 7] },
  '7': { tones: [0, 4, 7, 10], omit: [7] },
  m7: { tones: [0, 3, 7, 10], omit: [7] },
  maj7: { tones: [0, 4, 7, 11], omit: [7] },
  sus4: { tones: [0, 5, 7] },
  sus2: { tones: [0, 2, 7] },
  '6': { tones: [0, 4, 7, 9] },
  m6: { tones: [0, 3, 7, 9] },
  '9': { tones: [0, 2, 4, 7, 10], omit: [7] },
  add9: { tones: [0, 2, 4, 7], omit: [7] },
  dim: { tones: [0, 3, 6] },
  dim7: { tones: [0, 3, 6, 9] },
  aug: { tones: [0, 4, 8] },
};

export function ukeShapesFor(name: string): Shape[] {
  const parsed = parseChordName(name);
  if (!parsed) return [];
  const spec = UKE_TONES[parsed.quality];
  if (!spec) return [];

  const tones = new Set(spec.tones.map((t) => (parsed.root + t) % 12));
  const required = new Set(
    spec.tones.filter((t) => !(spec.omit ?? []).includes(t)).map((t) => (parsed.root + t) % 12),
  );

  /*
   * Search windows walking up the neck: in each, a string plays open or within [base, base+3]
   * — a hand's reach. All four strings sound (uke chords do not mute), every note must be a
   * chord tone, and every required tone must be present. Scoring prefers low, open and compact,
   * which is exactly what makes the nut-position search reproduce the standard chart.
   */
  const found = new Map<string, { frets: number[]; score: number }>();
  for (let base = 0; base <= 9; base++) {
    const options: number[][] = UKE_OPEN.map(() => {
      const o = [0];
      for (let f = Math.max(base, 1); f <= base + 3; f++) o.push(f);
      return o;
    });
    for (const f0 of options[0]!)
      for (const f1 of options[1]!)
        for (const f2 of options[2]!)
          for (const f3 of options[3]!) {
            const frets = [f0, f1, f2, f3];
            const notes = frets.map((f, i) => (UKE_OPEN[i]! + f) % 12);
            if (!notes.every((n) => tones.has(n))) continue;
            if (![...required].every((r) => notes.includes(r))) continue;
            const key = frets.join(',');
            if (found.has(key)) continue;
            const fretted = frets.filter((f) => f > 0);
            const maxF = Math.max(0, ...fretted);
            const span = fretted.length ? maxF - Math.min(...fretted) : 0;
            const opens = frets.filter((f) => f === 0).length;
            found.set(key, { frets, score: maxF * 10 + span * 3 - opens });
          }
    // Enough voicings for a picker; walking further up adds ever-worse duplicates.
    if (found.size >= 10) break;
  }

  return [...found.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map(({ frets }) => {
      const maxF = Math.max(...frets);
      return {
        frets,
        // Derived shapes carry no fingering: a wrong finger number teaches a wrong habit,
        // and the Diagram simply draws unnumbered dots for zeros.
        fingers: [0, 0, 0, 0],
        label: maxF <= 3 ? 'open' : `${ORD[Math.min(...frets.filter((f) => f > 0))] ?? 'up the neck'} fret`,
      };
    });
}
