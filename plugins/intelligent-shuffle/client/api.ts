import { get, post } from 'crate/api';

/** The plugin's slice of the API. Mirrors server/index.ts, where the reasoning lives. */

export interface PlannedTrack {
  trackId: number;
  title: string;
  artistName: string;
  albumTitle: string;
  durationS: number | null;
}

/** What the ghost track currently wants, and how much of the DJ's decision it accounts for. */
export interface Ghost {
  /** 0..1 — the share of the choice the ghost is responsible for right now. */
  say: number;
  votes: number;
  wants: { key: string; value: number; high: boolean }[];
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
/**
 * seedFrom places the GHOST TRACK on a song at the start of a session — a position to steer from,
 * not evidence, so it does not count as a vote. Sent on the first deal only: a top-up that
 * re-seeded would wipe the votes that have shaped it since.
 */
export const plan = (
  count: number,
  exclude: number[],
  afterTrackId?: number,
  played?: number[],
  seedFrom?: number,
) =>
  post<{ tracks: PlannedTrack[] }>('/api/ishuffle/plan', {
    count,
    exclude,
    afterTrackId,
    played,
    seedFrom,
  });

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
    /** Null when the voted track has no characteristic profile, so the ghost did not move. */
    ghost?: Ghost | null;
  }>('/api/ishuffle/vote', { trackId, direction });

export const moodNow = () => get<{ mood: Mood; ghost: Ghost | null }>('/api/ishuffle/mood');

export const resetMood = () => post<{ ok: true }>('/api/ishuffle/reset', {});

/** Freeze the mood as a dynamic playlist — it keeps dealing this vibe after the mood fades. */
export const saveMoodPlaylist = (name?: string) =>
  post<{ ok: true; id: number; name: string }>('/api/ishuffle/save-playlist', { name });

/** Talk to the DJ: free text becomes weight deltas in the same vocabulary votes use. */
export const sayToDj = (text: string) =>
  post<{ ok: true; summary: string; mood: Mood }>('/api/ishuffle/say', { text });
