import type Database from 'better-sqlite3';
import type { UgChordShape } from './ultimateguitar.js';

/** Seconds since the epoch — inlined from crate's db/schema because a dynamic plugin
 *  imports nothing from the crate tree; the contract object (ctx) is its whole world. */
const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * Somebody's chord sheet for a song — and nobody else's.
 *
 * Every method takes a userId and every statement is scoped by it. That is the whole privacy
 * model, and it is deliberately structural rather than a check the caller has to remember:
 * there is no `byTrack(trackId)` on this class to misuse, because the question "what are the
 * chords for track 41?" has no answer. Only "what are MY chords for track 41?" does.
 *
 * A sheet is stored as the text somebody wrote, not as a parsed structure. The parser will get
 * better — it already has once — and re-parsing on read costs microseconds, while a stored parse
 * would freeze today's mistakes into the database.
 */

export interface ChordSheet {
  trackId: number;
  body: string;
  sourceUrl: string;
  /** Voicings from an import, by chord name. Empty when the sheet was typed by hand. */
  shapes: Record<string, UgChordShape[]>;
  tuning: string;
  capo: string;
  updatedAt: number;
}

interface Row {
  track_id: number;
  body: string;
  source_url: string;
  shapes: string;
  tuning: string;
  capo: string;
  updated_at: number;
}

/** A sheet's worth of text. Generous for a song, small enough not to be a place to hide a file. */
export const MAX_SHEET_BYTES = 128 * 1024;

function toSheet(r: Row): ChordSheet {
  let shapes: Record<string, UgChordShape[]> = {};
  if (r.shapes) {
    try {
      shapes = JSON.parse(r.shapes) as Record<string, UgChordShape[]>;
    } catch {
      // A sheet with unreadable shapes is still a usable sheet: the words and the chord names
      // are the part that matters, and the client has its own dictionary to fall back on.
      shapes = {};
    }
  }
  return {
    trackId: r.track_id,
    body: r.body,
    sourceUrl: r.source_url,
    shapes,
    tuning: r.tuning,
    capo: r.capo,
    updatedAt: r.updated_at,
  };
}

export class ChordSheets {
  constructor(private db: Database.Database) {}

  get(userId: number, trackId: number): ChordSheet | null {
    const r = this.db
      .prepare(
        `SELECT track_id, body, source_url, shapes, tuning, capo, updated_at
           FROM chord_sheets WHERE user_id = ? AND track_id = ?`,
      )
      .get(userId, trackId) as Row | undefined;
    return r ? toSheet(r) : null;
  }

  /** Which of these tracks the person has written something for — for showing a marker. */
  haveFor(userId: number, trackIds: number[]): Set<number> {
    if (!trackIds.length) return new Set();
    const marks = trackIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT track_id FROM chord_sheets WHERE user_id = ? AND track_id IN (${marks})`)
      .all(userId, ...trackIds) as { track_id: number }[];
    return new Set(rows.map((r) => r.track_id));
  }

  /**
   * Everything this person has written, newest first — the "my chord sheets" list.
   *
   * Carries enough of the track to PLAY it, because that is what somebody opening this list
   * wants: the sheet is for playing along to, and a list that can only describe the song sends
   * them off to find it by hand.
   */
  mine(
    userId: number,
    limit = 200,
  ): (ChordSheet & {
    title: string;
    artistName: string;
    albumTitle: string;
    durationS: number | null;
  })[] {
    const rows = this.db
      .prepare(
        `SELECT c.track_id, c.body, c.source_url, c.shapes, c.tuning, c.capo, c.updated_at,
                t.title, t.artist_name AS artistName, t.album_title AS albumTitle,
                t.duration_s AS durationS
           FROM chord_sheets c
           JOIN tracks t ON t.id = c.track_id
          WHERE c.user_id = ?
          ORDER BY c.updated_at DESC
          LIMIT ?`,
      )
      .all(userId, limit) as (Row & {
      title: string;
      artistName: string;
      albumTitle: string;
      durationS: number | null;
    })[];
    return rows.map((r) => ({
      ...toSheet(r),
      title: r.title,
      artistName: r.artistName,
      albumTitle: r.albumTitle,
      durationS: r.durationS,
    }));
  }

  /**
   * Write a sheet.
   *
   * An upsert rather than insert-or-update, so saving is idempotent and a slow network that
   * retries cannot produce a constraint error over somebody's own work. created_at survives an
   * update — when they first wrote it is a different fact from when they last touched it.
   */
  save(
    userId: number,
    trackId: number,
    v: { body: string; sourceUrl?: string; shapes?: Record<string, UgChordShape[]>; tuning?: string; capo?: string },
  ): void {
    const t = nowSec();
    this.db
      .prepare(
        `INSERT INTO chord_sheets
           (user_id, track_id, body, source_url, shapes, tuning, capo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, track_id) DO UPDATE SET
           body       = excluded.body,
           source_url = excluded.source_url,
           shapes     = excluded.shapes,
           tuning     = excluded.tuning,
           capo       = excluded.capo,
           updated_at = excluded.updated_at`,
      )
      .run(
        userId,
        trackId,
        v.body,
        v.sourceUrl ?? '',
        v.shapes && Object.keys(v.shapes).length ? JSON.stringify(v.shapes) : '',
        v.tuning ?? '',
        v.capo ?? '',
        t,
        t,
      );
  }

  remove(userId: number, trackId: number): void {
    this.db.prepare('DELETE FROM chord_sheets WHERE user_id = ? AND track_id = ?').run(userId, trackId);
  }
}
