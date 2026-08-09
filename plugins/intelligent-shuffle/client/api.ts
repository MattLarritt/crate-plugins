import { get, post } from 'crate/api';

/** The plugin's slice of the API. Mirrors server/index.ts, where the reasoning lives. */

export interface PlannedTrack {
  trackId: number;
  title: string;
  artistName: string;
  albumTitle: string;
  durationS: number | null;
}

export interface MoodEntry {
  kind: 'artist' | 'album' | 'track' | 'genre' | 'style' | 'era';
  label: string;
  weight: number;
}

export interface Mood {
  into: MoodEntry[];
  outOf: MoodEntry[];
}

/** afterTrackId = the track this batch will play after, so no artist repeats across the seam. */
export const plan = (count: number, exclude: number[], afterTrackId?: number) =>
  post<{ tracks: PlannedTrack[] }>('/api/ishuffle/plan', { count, exclude, afterTrackId });

export const vote = (trackId: number, direction: 'more' | 'less') =>
  post<{
    ok: true;
    // genres are the TRACK's own when its file names them; era is its decade ("1990s") or null.
    applied: { artist: string; album: string; genres: string[]; era: string | null };
    mood: Mood;
  }>('/api/ishuffle/vote', { trackId, direction });

export const moodNow = () => get<{ mood: Mood }>('/api/ishuffle/mood');

export const resetMood = () => post<{ ok: true }>('/api/ishuffle/reset', {});
