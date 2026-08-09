// plugins/intelligent-shuffle/server/taxonomy.ts
var FAMILY_LABEL = {
  metal: "metal",
  industrial: "industrial",
  punk: "punk & hardcore",
  alt: "alt & indie",
  rock: "rock",
  folk: "folk & country",
  blues: "blues & jazz",
  rnb: "r&b & soul",
  rap: "hip-hop",
  pop: "pop",
  electronic: "electronic",
  downtempo: "downtempo",
  reggae: "reggae",
  world: "world",
  classical: "classical"
};
var EDGES = [
  ["metal", "industrial"],
  ["metal", "punk"],
  ["metal", "alt"],
  ["punk", "alt"],
  ["alt", "rock"],
  ["alt", "pop"],
  ["rock", "blues"],
  ["rock", "folk"],
  ["folk", "blues"],
  ["blues", "rnb"],
  ["rnb", "pop"],
  ["rnb", "rap"],
  ["rap", "electronic"],
  ["rap", "reggae"],
  ["rnb", "reggae"],
  ["pop", "electronic"],
  ["electronic", "industrial"],
  ["electronic", "downtempo"],
  ["downtempo", "rnb"],
  ["world", "pop"],
  ["classical", "downtempo"]
];
var ADJACENT = (() => {
  const out = Object.fromEntries(
    Object.keys(FAMILY_LABEL).map((f) => [f, []])
  );
  for (const [a, b] of EDGES) {
    out[a].push(b);
    out[b].push(a);
  }
  return out;
})();
var JUNK = /^(?:seen live|american|british|english|irish|scottish|german|french|australian|canadian|usa|uk|america|états unidos|estados unidos|américain|france|\d{2,4}s?|(?:fe)?male vocals?(?:ists?)?|vocalist|guitarist|guitar|piano|actor|fictional|political|queer|compilation|special purpose artist|grammy winner|favou?rites?|awesome|good)$/;
var RULES = [
  [/metal|thrash|doom|rapcore|neue deutsche|^heavy$/, "metal"],
  [/industrial|^noise/, "industrial"],
  [/trip.?hop|downtempo|ambient|chillout|new age|lo-fi|lofi/, "downtempo"],
  [/hip.?hop|\brap\b|\btrap\b|boom bap|dirty south|gangsta|drill|grime/, "rap"],
  [/punk|hardcore|easycore|\bemo\b|emocore|screamo/, "punk"],
  [/reggae|dancehall|\bska\b|dub\b/, "reggae"],
  [/indian|bollywood|latin|afrobeat|k-pop|j-pop|world/, "world"],
  [/country|folk|americana|bluegrass|singer.?.?songwriter|songwriter|red dirt|nashville|heartland|acoustic/, "folk"],
  [
    /grunge|indie|alternative|\balt\b|alt\.|alternrock|shoegaze|dream pop|madchester|new wave|britpop|jangle|bedroom pop|art rock|art pop|experimental|post-rock|hypnagogic|slowcore|noise rock/,
    "alt"
  ],
  [
    /rock|rockabilly|stoner|surf|psychedeli|krautrock|palm desert|desert|jam band|progressive|heavy psych/,
    "rock"
  ],
  [/r&b|r b|rnb|\bsoul\b|funk|disco|motown|neo.?soul/, "rnb"],
  [/pop|ballad|yacht/, "pop"],
  [
    /electro|techno|house|trance|\bedm\b|eurodance|eurobeat|drum & bass|drum and bass|drum 'n' bass|dubstep|jungle|breakbeat|\bdance\b|rave|leftfield|tronica|garage$|uk garage|idm|synthwave/,
    "electronic"
  ],
  [/blues|jazz|swing|bebop/, "blues"],
  [/classical|score|soundtrack|orchestral|baroque|opera/, "classical"]
];
function isJunk(genre) {
  return JUNK.test(genre.trim().toLowerCase());
}
function familyOf(genre) {
  const g = genre.trim().toLowerCase();
  if (!g || JUNK.test(g)) return null;
  for (const [pattern, family] of RULES) {
    if (pattern.test(g)) return family;
  }
  return null;
}
function familiesOf(genres) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const g of genres) {
    const f = familyOf(g);
    if (f && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

// plugins/intelligent-shuffle/server/index.ts
var HALF_LIFE_S = 4 * 3600;
var FLOOR = 0.05;
var DELTAS = {
  more: { track: 2.5, album: 1, artist: 1, genre: 2.5, style: 2, era: 1.5 },
  less: { track: -4, album: -1.5, artist: -1.5, genre: -2.5, style: -2, era: -2 }
};
var HARD_NO = -3;
var TEMPERATURE = 1;
var PER_ARTIST_CAP = 1;
var GENRE_CLAMP = 4;
var STYLE_CLAMP = 3;
var ADJ_FACTOR = 0.35;
var ERA_CLAMP = 3;
var ESCALATE_WINDOW_S = 6 * 3600;
var ESCALATE_STEP = 0.75;
var ESCALATE_MAX = 3;
var WEIGHTS_DDL = `
  CREATE TABLE IF NOT EXISTS ishuffle_weights (
    user_id    INTEGER NOT NULL,
    kind       TEXT    NOT NULL CHECK (kind IN ('artist','album','track','genre','style','era')),
    key        TEXT    NOT NULL,
    -- What to call this weight on screen ("Deftones", "nu metal", "1990s") \u2014 stored at write
    -- time because the readable name is only cheaply known then.
    label      TEXT    NOT NULL DEFAULT '',
    weight     REAL    NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, key)
  );
`;
var now = () => Math.floor(Date.now() / 1e3);
var decayed = (w, at) => w * Math.pow(0.5, Math.max(0, now() - at) / HALF_LIFE_S);
var eraOf = (year) => {
  if (!year || year < 1900) return null;
  const decade = Math.floor(year / 10) * 10;
  return { key: String(decade), label: `${decade}s` };
};
var plugin = {
  id: "intelligent-shuffle",
  migrate(db) {
    db.exec(WEIGHTS_DDL);
    const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ishuffle_weights'").get();
    if (existing && !existing.sql.includes("'style'")) {
      db.exec(`
        ALTER TABLE ishuffle_weights RENAME TO ishuffle_weights_old;
        ${WEIGHTS_DDL}
        INSERT INTO ishuffle_weights SELECT * FROM ishuffle_weights_old;
        DROP TABLE ishuffle_weights_old;
      `);
    }
    db.exec(`
      -- The raw votes, briefly. Not a second copy of the mood \u2014 this exists so a NEW vote can
      -- look at the last few hours and ask "have they been singling this artist out?" (the
      -- escalation in the header). Rows older than the window are useless and pruned on write.
      CREATE TABLE IF NOT EXISTS ishuffle_votes (
        user_id     INTEGER NOT NULL,
        track_id    INTEGER NOT NULL,
        norm_artist TEXT    NOT NULL,
        direction   TEXT    NOT NULL CHECK (direction IN ('more','less')),
        at          INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ishuffle_votes_user ON ishuffle_votes (user_id, norm_artist, at);
    `);
  },
  routes(app, ctx) {
    const { db, need } = ctx;
    const hasTrackGenres = db.prepare("PRAGMA table_info(tracks)").all().some((c) => c.name === "genres");
    const genresCol = hasTrackGenres ? "t.genres" : "'' AS genres";
    const library = (userId) => db.prepare(
      `SELECT t.id, t.title, t.artist_name, t.album_title, t.duration_s,
                  t.norm_artist, t.norm_album, ${genresCol}, t.year
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
    const genresFor = (t, artistGenres) => {
      const own = t.genres ? t.genres.split(", ") : [];
      const artist = artistGenres.get(t.norm_artist) ?? [];
      const out = [];
      for (const g of [...own, ...artist]) {
        const n = g.trim().toLowerCase();
        if (n && !isJunk(n) && !out.includes(n)) out.push(n);
      }
      return out.slice(0, 10);
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
      const all = [...weights(userId).entries()].map(([k, v]) => ({ kind: k.split("|")[0], label: v.label || k.split("|")[1], weight: v.w })).filter((e) => e.kind !== "track" && Math.abs(e.weight) >= FLOOR);
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
        const gs = genresFor(t, genres);
        const gw = Math.max(
          -GENRE_CLAMP,
          Math.min(GENRE_CLAMP, gs.reduce((sum, g) => sum + (w.get(`genre|${g}`)?.w ?? 0), 0))
        );
        const fams = familiesOf(gs);
        let sw = 0;
        const counted = /* @__PURE__ */ new Set();
        for (const f of fams) {
          sw += w.get(`style|${f}`)?.w ?? 0;
          counted.add(f);
        }
        for (const f of fams) {
          for (const adj of ADJACENT[f]) {
            if (counted.has(adj)) continue;
            counted.add(adj);
            sw += ADJ_FACTOR * (w.get(`style|${adj}`)?.w ?? 0);
          }
        }
        sw = Math.max(-STYLE_CLAMP, Math.min(STYLE_CLAMP, sw));
        const era = eraOf(t.year);
        const ew = era ? Math.max(-ERA_CLAMP, Math.min(ERA_CLAMP, w.get(`era|${era.key}`)?.w ?? 0)) : 0;
        const score = (w.get(`track|${String(t.id)}`)?.w ?? 0) + (w.get(`album|${t.norm_artist}|${t.norm_album}`)?.w ?? 0) + (w.get(`artist|${t.norm_artist}`)?.w ?? 0) + gw + sw + ew;
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
      const t = db.prepare(
        `SELECT id, title, artist_name, album_title, norm_artist, norm_album, ${genresCol}, year
             FROM tracks t WHERE id = ?`
      ).get(trackId);
      if (!t) return reply.code(404).send({ error: "no such track" });
      const d = DELTAS[direction];
      const repeats = db.prepare(
        `SELECT COUNT(DISTINCT track_id) AS n FROM ishuffle_votes
              WHERE user_id = ? AND norm_artist = ? AND direction = ? AND at > ? AND track_id != ?`
      ).get(c.id, t.norm_artist, direction, now() - ESCALATE_WINDOW_S, t.id).n;
      const artistShare = Math.min(ESCALATE_MAX, 1 + ESCALATE_STEP * repeats);
      addWeight(c.id, "track", String(t.id), t.title, d.track);
      addWeight(c.id, "album", `${t.norm_artist}|${t.norm_album}`, t.album_title, d.album);
      addWeight(c.id, "artist", t.norm_artist, t.artist_name, d.artist * artistShare);
      const gs = genresFor(t, genresOf([t.norm_artist])).slice(0, 6);
      for (const g of gs) addWeight(c.id, "genre", g, g, d.genre);
      const fams = familiesOf(gs).slice(0, 3);
      for (const f of fams) addWeight(c.id, "style", f, FAMILY_LABEL[f], d.style);
      const era = eraOf(t.year);
      if (era) addWeight(c.id, "era", era.key, era.label, d.era);
      db.prepare(
        "INSERT INTO ishuffle_votes (user_id, track_id, norm_artist, direction, at) VALUES (?, ?, ?, ?, ?)"
      ).run(c.id, t.id, t.norm_artist, direction, now());
      db.prepare(
        "DELETE FROM ishuffle_weights WHERE user_id = ? AND abs(weight) < ? AND updated_at < ?"
      ).run(c.id, FLOOR, now() - 24 * 3600);
      db.prepare("DELETE FROM ishuffle_votes WHERE at < ?").run(now() - ESCALATE_WINDOW_S);
      return {
        ok: true,
        applied: { artist: t.artist_name, album: t.album_title, genres: gs, era: era?.label ?? null },
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
      db.prepare("DELETE FROM ishuffle_votes WHERE user_id = ?").run(c.id);
      return { ok: true };
    });
  }
};
var index_default = plugin;
export {
  index_default as default
};
