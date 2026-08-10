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
  kind: 'artist' | 'album' | 'track' | 'genre' | 'style' | 'era' | 'energy';
  label: string;
  weight: number;
}

export interface Mood {
  into: MoodEntry[];
  outOf: MoodEntry[];
}

/**
 * afterTrackId = the track this batch will play after, so no artist repeats across the seam.
 * played = what the session has already played, OLDEST FIRST — the planner cools an artist
 * down by how many songs ago they were on, which `exclude` cannot say because it mixes the
 * played tracks with the ones still queued.
 */
export const plan = (count: number, exclude: number[], afterTrackId?: number, played?: number[]) =>
  post<{ tracks: PlannedTrack[] }>('/api/ishuffle/plan', { count, exclude, afterTrackId, played });

export const vote = (trackId: number, direction: 'more' | 'less') =>
  post<{
    ok: true;
    // genres are the TRACK's own when its file names them; era is its decade ("1990s"),
    // energy the analyzer's band — both null when unknown.
    applied: {
      artist: string;
      album: string;
      genres: string[];
      era: string | null;
      energy?: 'chill' | 'medium' | 'high' | null;
    };
    mood: Mood;
  }>('/api/ishuffle/vote', { trackId, direction });

export const moodNow = () => get<{ mood: Mood }>('/api/ishuffle/mood');

export const resetMood = () => post<{ ok: true }>('/api/ishuffle/reset', {});

/** Freeze the mood as a dynamic playlist — it keeps dealing this vibe after the mood fades. */
export const saveMoodPlaylist = (name?: string) =>
  post<{ ok: true; id: number; name: string }>('/api/ishuffle/save-playlist', { name });

/** Talk to the DJ: free text becomes weight deltas in the same vocabulary votes use. */
export const sayToDj = (text: string) =>
  post<{ ok: true; summary: string; mood: Mood }>('/api/ishuffle/say', { text });
