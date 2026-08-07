// plugins/intelligent-shuffle/server/index.ts
var HALF_LIFE_S = 4 * 3600;
var FLOOR = 0.05;
var DELTAS = {
  more: { track: 2.5, album: 1, artist: 1, genre: 2.5 },
  less: { track: -4, album: -1.5, artist: -1.5, genre: -2.5 }
};
var HARD_NO = -3;
var TEMPERATURE = 1.5;
var PER_ARTIST_CAP = 2;
var now = () => Math.floor(Date.now() / 1e3);
var decayed = (w, at) => w * Math.pow(0.5, Math.max(0, now() - at) / HALF_LIFE_S);
var plugin = {
  id: "intelligent-shuffle",
  migrate(db) {
    db.exec(`
      -- The mood, as numbers. One row per (user, kind, key); weight decays by read-time maths
      -- rather than a sweeper, so a stale row is harmless and pruning is cosmetic.
      CREATE TABLE IF NOT EXISTS ishuffle_weights (
        user_id    INTEGER NOT NULL,
        kind       TEXT    NOT NULL CHECK (kind IN ('artist','album','track','genre')),
        key        TEXT    NOT NULL,
        -- What to call this weight on screen ("Deftones", "nu metal") \u2014 stored at write time
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
    const library = (userId) => db.prepare(
      `SELECT t.id, t.title, t.artist_name, t.album_title, t.duration_s,
                  t.norm_artist, t.norm_album
             FROM user_tracks ut JOIN tracks t ON t.id = ut.track_id
            WHERE ut.user_id = ?`
    ).all(userId);
    const weights = (userId) => {
      const rows = db.prepare("SELECT kind, key, label, weight, updated_at FROM ishuffle_weights WHERE user_id = ?").all(userId);
      const map = /* @__PURE__ */ new Map();
      for (const r of rows) map.set(`${r.kind}|${r.key}`, { w: decayed(r.weight, r.updated_at), label: r.label });
      return map;
    };
    const genresOf = (artists) => {
      const out = /* @__PURE__ */ new Map();
      if (!artists.length) return out;
      const marks = artists.map(() => "?").join(",");
      const rows = db.prepare(`SELECT norm_artist, genre FROM artist_genres WHERE norm_artist IN (${marks})`).all(...artists);
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
         weight = excluded.weight, label = excluded.label, updated_at = excluded.updated_at`
    );
    const addWeight = (userId, kind, key, label, delta) => {
      const row = db.prepare("SELECT weight, updated_at FROM ishuffle_weights WHERE user_id = ? AND kind = ? AND key = ?").get(userId, kind, key);
      const current = row ? decayed(row.weight, row.updated_at) : 0;
      bump.run(userId, kind, key, label, current + delta, now());
    };
    const mood = (userId) => {
      const all = [...weights(userId).entries()].map(([k, v]) => ({ kind: k.split("|")[0], label: v.label || k.split("|")[1], weight: v.w })).filter((e) => Math.abs(e.weight) >= FLOOR);
      all.sort((a, b) => b.weight - a.weight);
      return {
        into: all.filter((e) => e.weight > 0).slice(0, 8),
        outOf: all.filter((e) => e.weight < 0).slice(-8).reverse()
      };
    };
    app.post("/api/ishuffle/plan", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      const b = req.body ?? {};
      const count = Math.min(Math.max(Number(b.count) || 6, 1), 30);
      const exclude = new Set(Array.isArray(b.exclude) ? b.exclude.map(Number) : []);
      const afterId = Number(b.afterTrackId) || 0;
      const afterArtist = afterId ? db.prepare("SELECT norm_artist FROM tracks WHERE id = ?").get(afterId)?.norm_artist ?? "" : "";
      const lib = library(c.id);
      const w = weights(c.id);
      const genres = genresOf([...new Set(lib.map((t) => t.norm_artist))]);
      const recent = new Set(
        db.prepare("SELECT track_id FROM plays WHERE user_id = ? AND last_played > ?").all(c.id, now() - 4 * 3600).map((r) => r.track_id)
      );
      let pool = lib.filter((t) => !exclude.has(t.id));
      if (pool.filter((t) => !recent.has(t.id)).length >= count * 2) {
        pool = pool.filter((t) => !recent.has(t.id));
      }
      const scored = pool.map((t) => {
        const gs = genres.get(t.norm_artist) ?? [];
        const gw = gs.length ? gs.reduce((sum, g) => sum + (w.get(`genre|${g}`)?.w ?? 0), 0) / gs.length : 0;
        const score = (w.get(`track|${String(t.id)}`)?.w ?? 0) + (w.get(`album|${t.norm_artist}|${t.norm_album}`)?.w ?? 0) + (w.get(`artist|${t.norm_artist}`)?.w ?? 0) + gw;
        return { t, score };
      }).filter((e) => e.score > HARD_NO);
      const picked = [];
      const perArtist = /* @__PURE__ */ new Map();
      const candidates = [...scored];
      while (picked.length < count && candidates.length) {
        const max = Math.max(...candidates.map((e) => e.score));
        const expWeights = candidates.map((e) => Math.exp((e.score - max) / TEMPERATURE));
        const total = expWeights.reduce((a, x) => a + x, 0);
        let roll = Math.random() * total;
        let idx = 0;
        for (; idx < candidates.length - 1; idx++) {
          roll -= expWeights[idx];
          if (roll <= 0) break;
        }
        const [chosen] = candidates.splice(idx, 1);
        if (!chosen) break;
        const artistCount = perArtist.get(chosen.t.norm_artist) ?? 0;
        if (artistCount >= PER_ARTIST_CAP) continue;
        perArtist.set(chosen.t.norm_artist, artistCount + 1);
        picked.push(chosen.t);
      }
      const ordered = [];
      let lastArtist = afterArtist;
      const unplaced = [...picked];
      while (unplaced.length) {
        let at = unplaced.findIndex((t2) => t2.norm_artist !== lastArtist);
        if (at === -1) at = 0;
        const [t] = unplaced.splice(at, 1);
        if (!t) break;
        ordered.push(t);
        lastArtist = t.norm_artist;
      }
      return {
        tracks: ordered.map((t) => ({
          trackId: t.id,
          title: t.title,
          artistName: t.artist_name,
          albumTitle: t.album_title,
          durationS: t.duration_s
        }))
      };
    });
    app.post("/api/ishuffle/vote", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      const b = req.body ?? {};
      const trackId = Number(b.trackId);
      const direction = b.direction === "less" ? "less" : b.direction === "more" ? "more" : null;
      if (!direction) return reply.code(400).send({ error: "direction must be 'more' or 'less'" });
      const t = db.prepare("SELECT id, title, artist_name, album_title, norm_artist, norm_album FROM tracks WHERE id = ?").get(trackId);
      if (!t) return reply.code(404).send({ error: "no such track" });
      const d = DELTAS[direction];
      addWeight(c.id, "track", String(t.id), t.title, d.track);
      addWeight(c.id, "album", `${t.norm_artist}|${t.norm_album}`, t.album_title, d.album);
      addWeight(c.id, "artist", t.norm_artist, t.artist_name, d.artist);
      const gs = (genresOf([t.norm_artist]).get(t.norm_artist) ?? []).slice(0, 6);
      for (const g of gs) addWeight(c.id, "genre", g, g, d.genre);
      db.prepare(
        "DELETE FROM ishuffle_weights WHERE user_id = ? AND abs(weight) < ? AND updated_at < ?"
      ).run(c.id, FLOOR, now() - 24 * 3600);
      return {
        ok: true,
        applied: { artist: t.artist_name, album: t.album_title, genres: gs },
        mood: mood(c.id)
      };
    });
    app.get("/api/ishuffle/mood", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      return { mood: mood(c.id) };
    });
    app.post("/api/ishuffle/reset", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      db.prepare("DELETE FROM ishuffle_weights WHERE user_id = ?").run(c.id);
      return { ok: true };
    });
  }
};
var index_default = plugin;
export {
  index_default as default
};
