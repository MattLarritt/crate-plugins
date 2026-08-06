import { del, get, put } from 'crate/api';

/**
 * The chords plugin's slice of the API, on the shared request helpers.
 *
 * These mirror the plugin's server half (src/plugins/chords/), which is where the reasoning
 * lives — in particular why a chord carries a COLUMN rather than a pixel offset. The parse is
 * done there so that one implementation decides where every chord sits.
 */

export interface SheetChord {
  name: string;
  /** Character column the chord starts at, with markup already removed. */
  col: number;
  /** A bar line or repeat mark rather than a chord: shown, but has no shape. */
  deco?: true;
}

export type SheetBlock =
  | { kind: 'section'; label: string }
  | { kind: 'line'; chords: SheetChord[]; lyric: string }
  | { kind: 'tab'; lines: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'gap' };

export interface ParsedSheet {
  /** Everything before the first section heading: key, capo, who tabbed it, voicing grids. */
  preamble: SheetBlock[];
  blocks: SheetBlock[];
  chords: string[];
}

/** One voicing as Ultimate Guitar describes it — high E first, absolute frets. */
export interface UgShape {
  frets: number[];
  fingers: number[];
  baseFret: number;
  barres: { fret: number; from: number; to: number; finger: number }[];
}

/**
 * One sheet in the "what have I written down" list.
 *
 * Carries enough of the track to play it, because that is the only thing anybody wants to do
 * from this list — see the note on ChordSheets.mine on the server.
 */
export interface ChordSheetListing {
  trackId: number;
  title: string;
  artistName: string;
  albumTitle: string;
  durationS: number | null;
  sourceUrl: string;
  updatedAt: number;
  lines: number;
}

export interface ChordSheetResponse {
  body: string;
  sourceUrl: string;
  shapes: Record<string, UgShape[]>;
  tuning: string;
  capo: string;
  parsed: ParsedSheet | null;
  /** Present only on the response to an import, so the panel can confirm what arrived. */
  imported?: { artist: string; song: string; kind: string };
}

/** This user's own chord sheet for a song. Nobody else can read it — see the server half. */
export const chords = (trackId: number) =>
  get<ChordSheetResponse>(`/api/track/${trackId}/chords`);

/** Save a sheet — or import one, when the first line is an Ultimate Guitar URL. */
export const saveChords = (trackId: number, body: string) =>
  put<ChordSheetResponse>(`/api/track/${trackId}/chords`, { body });

export const deleteChords = (trackId: number) => del<{ ok: true }>(`/api/track/${trackId}/chords`);

export const myChords = () => get<{ sheets: ChordSheetListing[] }>('/api/chords');
