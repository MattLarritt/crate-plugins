import type Database from 'better-sqlite3';
import type { CratePlugin } from '../../../types/contract.js';

/**
 * Intelligent Shuffle: a dynamic DJ over the user's own library.
 *
 * The idea in one sentence: votes write WEIGHTS, weights DECAY, and the next tracks are drawn
 * from the library scored against whatever the weights say right now.
 *
 * Each "more like this" or "less like this" adds points to the playing track, its album, its
 * artist, and the artist's genres. The decay is the design decision that makes this a DJ
 * rather than a profile: a vote is worth half as much every four hours, so what you loved on
 * Tuesday night does not run Wednesday morning — the weights ARE the current mood, and an
 * empty table is simply an open mind (pure shuffle). Crate's My Algorithm feature already owns
 * long-term taste; this deliberately does not compete with it.
 *
 * Everything is per user: the weights table is keyed by user_id and every statement is scoped
 * by it, the same structural privacy the chords plugin uses.
 */

/** A vote's worth halves every four hours. Mood, not memory. */
const HALF_LIFE_S = 4 * 3600;

/** Below this a weight is noise; pruned on the next vote so the table stays mood-sized. */
const FLOOR = 0.05;

/** What one vote is worth, per key it touches. Vetoes bite harder than praise. */
const DELTAS = {
  more: { track: 3, album: 2, artist: 2, genre: 1 },
  less: { track: -4, album: -2.5, artist: -2.5, genre: -1.5 },
} as const;

/** A summed score below this means "the mood says no": excluded outright, not just unlikely. */
const HARD_NO = -3;

/** Softmax temperature for picking. Lower = obeys the mood harder; higher = more adventurous. */
const TEMPERATURE = 1.5;

/** Tracks the same artist may occupy in one planned batch — the anti-tunnel rule. */
const PER_ARTIST_CAP = 2;

type Kind = 'artist' | 'album' | 'track' | 'genre';

interface LibRow {
  id: number;
  title: string;
  artist_name: string;
  album_title: string;
  duration_s: number | null;
  norm_artist: string;
  norm_album: string;
}

const now = () => Math.floor(Date.now() / 1000);
const decayed = (w: number, at: number) => w * Math.pow(0.5, Math.max(0, now() - at) / HALF_LIFE_S);

const plugin: CratePlugin = {
  id: 'intelligent-shuffle',

  migrate(db) {
    db.exec(`
      -- The mood, as numbers. One row per (user, kind, key); weight decays by read-time maths
      -- rather than a sweeper, so a stale row is harmless and pruning is cosmetic.
      CREATE TABLE IF NOT EXISTS ishuffle_weights (
        user_id    INTEGER NOT NULL,
        kind       TEXT    NOT NULL CHECK (kind IN ('artist','album','track','genre')),
        key        TEXT    NOT NULL,
        -- What to call this weight on screen ("Deftones", "nu metal") — stored at write time
        -- because the readable name is only cheaply known then.
        label      TEXT    NOT NULL DEFAULT '',
        weight     REAL    NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, kind, key)
      );
    `);
  },

  routes(app, ctx) {
    const { db, need } = ctx;

    const library = (userId: number): LibRow[] =>
      db
        .prepare(
          `SELECT t.id, t.title, t.artist_name, t.album_title, t.duration_s,
                  t.norm_artist, t.norm_album
             FROM user_tracks ut JOIN tracks t ON t.id = ut.track_id
            WHERE ut.user_id = ?`,
        )
        .all(userId) as LibRow[];

    /** Every weight the user has, decayed to this moment. */
    const weights = (userId: number) => {
      const rows = db
        .prepare('SELECT kind, key, label, weight, updated_at FROM ishuffle_weights WHERE user_id = ?')
        .all(userId) as { kind: Kind; key: string; label: string; weight: number; updated_at: number }[];
      const map = new Map<string, { w: number; label: string }>();
      for (const r of rows) map.set(`${r.kind}|${r.key}`, { w: decayed(r.weight, r.updated_at), label: r.label });
      return map;
    };

    /** Genres per artist, for the artists asked about. */
    const genresOf = (artists: string[]): Map<string, string[]> => {
      const out = new Map<string, string[]>();
      if (!artists.length) return out;
      const marks = artists.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT norm_artist, genre FROM artist_genres WHERE norm_artist IN (${marks})`)
        .all(...artists) as { norm_artist: string; genre: string }[];
      for (const r of rows) {
        const list = out.get(r.norm_artist) ?? [];
        list.push(r.genre);
        out.set(r.norm_artist, list);
      }
      return out;
    };

    const bump = db.prepare(
      `INSERT INTO ishuffle_weights (user_id, kind, key, label, weight, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, kind, key) DO UPDATE SET
         weight = excluded.weight, label = excluded.label, updated_at = excluded.updated_at`,
    );

    /** Decay-then-add, so old enthusiasm fades at the same rate whether or not you vote. */
    const addWeight = (userId: number, kind: Kind, key: string, label: string, delta: number) => {
      const row = db
        .prepare('SELECT weight, updated_at FROM ishuffle_weights WHERE user_id = ? AND kind = ? AND key = ?')
        .get(userId, kind, key) as { weight: number; updated_at: number } | undefined;
      const current = row ? decayed(row.weight, row.updated_at) : 0;
      bump.run(userId, kind, key, label, current + delta, now());
    };

    /** The mood, human-readable: what it is leaning into and steering away from. */
    const mood = (userId: number) => {
      const all = [...weights(userId).entries()]
        .map(([k, v]) => ({ kind: k.split('|')[0] as Kind, label: v.label || k.split('|')[1]!, weight: v.w }))
        .filter((e) => Math.abs(e.weight) >= FLOOR);
      all.sort((a, b) => b.weight - a.weight);
      return {
        into: all.filter((e) => e.weight > 0).slice(0, 8),
        outOf: all.filter((e) => e.weight < 0).slice(-8).reverse(),
      };
    };

    /**
     * Plan the next tracks: score everything, gate the hard no's, then SAMPLE rather than
     * take the top — softmax over the scores, so a strong mood steers firmly while a mild one
     * merely leans. An empty weights table makes every score the same and this collapses to a
     * fair shuffle, which is exactly the right cold start.
     */
    app.post('/api/ishuffle/plan', async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: 'a token caller has no library' });
      const b = (req.body ?? {}) as { count?: unknown; exclude?: unknown };
      const count = Math.min(Math.max(Number(b.count) || 6, 1), 30);
      const exclude = new Set(Array.isArray(b.exclude) ? b.exclude.map(Number) : []);

      const lib = library(c.id);
      const w = weights(c.id);
      const genres = genresOf([...new Set(lib.map((t) => t.norm_artist))]);
      // Recently finished songs sit out for a while even unvoted — a DJ does not replay the
      // last hour. Softened automatically when the library is too small to afford it.
      const recent = new Set(
        (
          db
            .prepare('SELECT track_id FROM plays WHERE user_id = ? AND last_played > ?')
            .all(c.id, now() - 4 * 3600) as { track_id: number }[]
        ).map((r) => r.track_id),
      );

      let pool = lib.filter((t) => !exclude.has(t.id));
      if (pool.filter((t) => !recent.has(t.id)).length >= count * 2) {
        pool = pool.filter((t) => !recent.has(t.id));
      }

      const scored = pool
        .map((t) => {
          const gs = genres.get(t.norm_artist) ?? [];
          const gw = gs.length
            ? gs.reduce((sum, g) => sum + (w.get(`genre|${g}`)?.w ?? 0), 0) / gs.length
            : 0;
          const score =
            (w.get(`track|${String(t.id)}`)?.w ?? 0) +
            (w.get(`album|${t.norm_artist}|${t.norm_album}`)?.w ?? 0) +
            (w.get(`artist|${t.norm_artist}`)?.w ?? 0) +
            gw;
          return { t, score };
        })
        .filter((e) => e.score > HARD_NO);

      // Softmax sample without replacement, with the per-artist cap keeping variety honest.
      const picked: LibRow[] = [];
      const perArtist = new Map<string, number>();
      const candidates = [...scored];
      while (picked.length < count && candidates.length) {
        const max = Math.max(...candidates.map((e) => e.score));
        const expWeights = candidates.map((e) => Math.exp((e.score - max) / TEMPERATURE));
        const total = expWeights.reduce((a, x) => a + x, 0);
        let roll = Math.random() * total;
        let idx = 0;
        for (; idx < candidates.length - 1; idx++) {
          roll -= expWeights[idx]!;
          if (roll <= 0) break;
        }
        const [chosen] = candidates.splice(idx, 1);
        if (!chosen) break;
        const artistCount = perArtist.get(chosen.t.norm_artist) ?? 0;
        if (artistCount >= PER_ARTIST_CAP) continue;
        perArtist.set(chosen.t.norm_artist, artistCount + 1);
        picked.push(chosen.t);
      }

      return {
        tracks: picked.map((t) => ({
          trackId: t.id,
          title: t.title,
          artistName: t.artist_name,
          albumTitle: t.album_title,
          durationS: t.duration_s,
        })),
      };
    });

    /** A vote: the mood moves, and the response says what moved so the UI can show it. */
    app.post('/api/ishuffle/vote', async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: 'a token caller has no library' });
      const b = (req.body ?? {}) as { trackId?: unknown; direction?: unknown };
      const trackId = Number(b.trackId);
      const direction = b.direction === 'less' ? 'less' : b.direction === 'more' ? 'more' : null;
      if (!direction) return reply.code(400).send({ error: "direction must be 'more' or 'less'" });

      const t = db
        .prepare('SELECT id, title, artist_name, album_title, norm_artist, norm_album FROM tracks WHERE id = ?')
        .get(trackId) as (LibRow & { id: number }) | undefined;
      if (!t) return reply.code(404).send({ error: 'no such track' });

      const d = DELTAS[direction];
      addWeight(c.id, 'track', String(t.id), t.title, d.track);
      addWeight(c.id, 'album', `${t.norm_artist}|${t.norm_album}`, t.album_title, d.album);
      addWeight(c.id, 'artist', t.norm_artist, t.artist_name, d.artist);
      const gs = (genresOf([t.norm_artist]).get(t.norm_artist) ?? []).slice(0, 6);
      for (const g of gs) addWeight(c.id, 'genre', g, g, d.genre);

      // Prune the noise floor while we are here — cosmetic, keeps the table mood-sized.
      db.prepare(
        'DELETE FROM ishuffle_weights WHERE user_id = ? AND abs(weight) < ? AND updated_at < ?',
      ).run(c.id, FLOOR, now() - 24 * 3600);

      return {
        ok: true,
        applied: { artist: t.artist_name, album: t.album_title, genres: gs },
        mood: mood(c.id),
      };
    });

    app.get('/api/ishuffle/mood', async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: 'a token caller has no library' });
      return { mood: mood(c.id) };
    });

    /** A fresh mind: wipe the mood entirely. The DJ forgets, the library does not. */
    app.post('/api/ishuffle/reset', async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: 'a token caller has no library' });
      db.prepare('DELETE FROM ishuffle_weights WHERE user_id = ?').run(c.id);
      return { ok: true };
    });
  },
};

export default plugin;
