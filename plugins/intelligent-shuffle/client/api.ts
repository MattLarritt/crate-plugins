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
  kind: 'artist' | 'album' | 'track' | 'genre';
  label: string;
  weight: number;
}

export interface Mood {
  into: MoodEntry[];
  outOf: MoodEntry[];
}

export const plan = (count: number, exclude: number[]) =>
  post<{ tracks: PlannedTrack[] }>('/api/ishuffle/plan', { count, exclude });

export const vote = (trackId: number, direction: 'more' | 'less') =>
  post<{ ok: true; applied: { artist: string; album: string; genres: string[] }; mood: Mood }>(
    '/api/ishuffle/vote',
    { trackId, direction },
  );

export const moodNow = () => get<{ mood: Mood }>('/api/ishuffle/mood');

export const resetMood = () => post<{ ok: true }>('/api/ishuffle/reset', {});
