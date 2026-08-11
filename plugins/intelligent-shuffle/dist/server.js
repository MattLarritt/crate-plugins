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
var JUNK = /^(?:seen live|american|british|english|irish|scottish|german|french|australian|canadian|usa|uk|america|états unidos|estados unidos|américain|france|\d{2,4}s?|(?:fe)?male vocals?(?:ists?)?|vocalist|guitarist|guitar|piano|actor|fictional|political|queer|compilation|special purpose artist|grammy winner|favou?rites?|awesome|good|songwriter|producer|instrumental)$/;
var RULES = [
  [/metal|thrash|doom|rapcore|neue deutsche|^heavy$/, "metal"],
  [/industrial|^noise/, "industrial"],
  [/trip.?hop|downtempo|ambient|chillout|new age|lo-fi|lofi/, "downtempo"],
  [/hip.?hop|\brap\b|\btrap\b|boom bap|dirty south|gangsta|drill|grime/, "rap"],
  [/punk|hardcore|easycore|\bemo\b|emocore|screamo/, "punk"],
  [/reggae|dancehall|\bska\b|dub\b/, "reggae"],
  [/indian|bollywood|latin|afrobeat|k-pop|j-pop|world/, "world"],
  [/country|folk|americana|bluegrass|singer.?.?songwriter|red dirt|nashville|heartland|acoustic/, "folk"],
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
  more: { track: 2.5, album: 1, artist: 1, genre: 2.5, style: 2, era: 1.5, energy: 1.5 },
  less: { track: -4, album: -1.5, artist: -1.5, genre: -2.5, style: -2, era: -2, energy: -2 }
};
var HARD_NO = -3;
var TEMPERATURE = 0.6;
var IMPORTANCE = {
  genre: 1,
  style: 1.1,
  era: 0.45,
  energy: 0.4,
  artist: 0.5,
  album: 0.3,
  track: 0.4,
  /*
   * How close a candidate is to the ghost track. Weighted alongside the genre layer rather than
   * replacing it, for two reasons: most of the library has no characteristic profile yet, so a
   * ghost-only DJ would play only the analysed part of it; and the genre layer measurably works
   * (93–98% on target), so the safe way to add an axis is additively. Scaled by ghostInfluence,
   * so with no votes it contributes nothing at all.
   */
  ghost: 1.2
};
var Z_CAP = 3;
var PER_ARTIST_CAP = 1;
var GENRE_CLAMP = 4;
var STYLE_CLAMP = 4.5;
var ADJ_FACTOR = 0.35;
var ERA_CLAMP = 3;
var ESCALATE_WINDOW_S = 6 * 3600;
var ESCALATE_STEP = 0.75;
var ESCALATE_MAX = 3;
var ENERGY_CLAMP = 2.5;
var SPEC_REF = 0.05;
var SPEC_FLOOR = 0.15;
var ARTIST_TAG_FACTOR = 0.6;
var WEIGHT_CEILING = 10;
var REVERSAL_BOOST = 3;
var ARTIST_COOLDOWN = 6;
var COOLDOWN_HALF_SONGS = 2.5;
var GHOST_RATE_LIKE = 0.3;
var GHOST_RATE_DISLIKE = 0.15;
var ghostInfluence = (votes) => votes <= 0 ? 0 : Math.min(1, 1 - Math.pow(0.5, votes / 2));
var energyBandOf = (energy) => {
  if (energy == null || energy < 0) return null;
  if (energy < 0.35) return "chill";
  if (energy < 0.65) return "medium";
  return "high";
};
var WEIGHTS_DDL = `
  CREATE TABLE IF NOT EXISTS ishuffle_weights (
    user_id    INTEGER NOT NULL,
    kind       TEXT    NOT NULL CHECK (kind IN ('artist','album','track','genre','style','era','energy')),
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
    if (existing && !existing.sql.includes("'energy'")) {
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

      -- THE GHOST TRACK. One row per (user, characteristic): a point in the same space every
      -- analysed track occupies, which the next songs are chosen near. The votes column counts
      -- how many votes have shaped it, which is what scales its influence (see ghostInfluence).
      -- No backticks in here: this block is a JS template literal and one would end it.
      --
      -- A row per dimension rather than a JSON blob, so the ghost is inspectable in SQL and the
      -- panel can read the strongest dimensions with an ORDER BY rather than parsing anything.
      CREATE TABLE IF NOT EXISTS ishuffle_ghost (
        user_id    INTEGER NOT NULL,
        key        TEXT    NOT NULL,
        value      REAL    NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      CREATE TABLE IF NOT EXISTS ishuffle_ghost_meta (
        user_id    INTEGER PRIMARY KEY,
        votes      INTEGER NOT NULL DEFAULT 0,
        seeded_at  INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
    `);
  },
  routes(app, ctx) {
    const { db, need } = ctx;
    const trackCols = new Set(
      db.prepare("PRAGMA table_info(tracks)").all().map((c) => c.name)
    );
    const genresCol = trackCols.has("genres") ? "t.genres" : "'' AS genres";
    const energyCol = trackCols.has("energy") ? "CASE WHEN t.energy >= 0 THEN t.energy ELSE NULL END AS energy" : "NULL AS energy";
    const library = (userId) => db.prepare(
      `SELECT t.id, t.title, t.artist_name, t.album_title, t.duration_s,
                  t.norm_artist, t.norm_album, ${genresCol}, t.year, ${energyCol}
             FROM user_tracks ut JOIN tracks t ON t.id = ut.track_id
            WHERE ut.user_id = ?`
    ).all(userId);
    const weights = (userId) => {
      const rows = db.prepare("SELECT kind, key, label, weight, updated_at FROM ishuffle_weights WHERE user_id = ?").all(userId);
      const map = /* @__PURE__ */ new Map();
      for (const r of rows) map.set(`${r.kind}|${r.key}`, { w: decayed(r.weight, r.updated_at), label: r.label });
      return map;
    };
    const ghost = (userId) => {
      const rows = ctx.db.prepare("SELECT key, value FROM ishuffle_ghost WHERE user_id = ?").all(userId);
      const meta = ctx.db.prepare("SELECT votes FROM ishuffle_ghost_meta WHERE user_id = ?").get(userId);
      return {
        profile: Object.fromEntries(rows.map((r) => [r.key, r.value])),
        votes: meta?.votes ?? 0
      };
    };
    const putGhost = ctx.db.prepare(
      `INSERT INTO ishuffle_ghost (user_id, key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    const seedGhost = (userId, trackId) => {
      const v = ctx.characteristics.vectorOf(trackId);
      if (!v || v.size === 0) return false;
      const t = now();
      const tx = ctx.db.transaction(() => {
        ctx.db.prepare("DELETE FROM ishuffle_ghost WHERE user_id = ?").run(userId);
        for (const [key, value] of v) putGhost.run(userId, key, value, t);
        ctx.db.prepare(
          `INSERT INTO ishuffle_ghost_meta (user_id, votes, seeded_at, updated_at) VALUES (?,0,?,?)
             ON CONFLICT(user_id) DO UPDATE SET votes = 0, seeded_at = excluded.seeded_at, updated_at = excluded.updated_at`
        ).run(userId, t, t);
      });
      tx();
      return true;
    };
    const moveGhost = (userId, trackId, direction) => {
      const v = ctx.characteristics.vectorOf(trackId);
      if (!v || v.size === 0) return false;
      const current = ghost(userId).profile;
      const t = now();
      const tx = ctx.db.transaction(() => {
        for (const [key, score] of v) {
          const held = current[key];
          if (held === void 0) {
            if (direction === "less") continue;
            putGhost.run(userId, key, score, t);
            continue;
          }
          const rate = direction === "more" ? GHOST_RATE_LIKE : GHOST_RATE_DISLIKE;
          const step = rate * (score - held);
          const next = direction === "more" ? held + step : held - step;
          putGhost.run(userId, key, Math.max(0, Math.min(1, next)), t);
        }
        ctx.db.prepare(
          `INSERT INTO ishuffle_ghost_meta (user_id, votes, seeded_at, updated_at) VALUES (?,1,?,?)
             ON CONFLICT(user_id) DO UPDATE SET votes = votes + 1, updated_at = excluded.updated_at`
        ).run(userId, t, t);
      });
      tx();
      return true;
    };
    const ghostSummary = (userId) => {
      const g = ghost(userId);
      const wants = Object.entries(g.profile).map(([key, value]) => ({ key, value, high: value >= 0.5 })).sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5)).slice(0, 6);
      return { say: Math.round(ghostInfluence(g.votes) * 100) / 100, votes: g.votes, wants };
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
    const CORPUS_TTL_S = 600;
    const corpusCache = /* @__PURE__ */ new Map();
    const corpus = (userId) => {
      const cached = corpusCache.get(userId);
      if (cached && now() - cached.at < CORPUS_TTL_S) return cached;
      const lib = library(userId);
      const ag = genresOf([...new Set(lib.map((t) => t.norm_artist))]);
      const genreDf = /* @__PURE__ */ new Map();
      const familyDf = /* @__PURE__ */ new Map();
      for (const t of lib) {
        const gs = genresFor(t, ag);
        for (const g of gs) genreDf.set(g, (genreDf.get(g) ?? 0) + 1);
        for (const f of familiesOf(gs)) familyDf.set(f, (familyDf.get(f) ?? 0) + 1);
      }
      const fresh = { n: lib.length, genreDf, familyDf, at: now() };
      corpusCache.set(userId, fresh);
      return fresh;
    };
    const specificity = (df, n) => {
      if (!df || !n || df >= n) return SPEC_FLOOR;
      const ref = Math.log(1 / SPEC_REF);
      return Math.max(SPEC_FLOOR, Math.min(1, Math.log(n / df) / ref));
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
      let moved = current + delta;
      if (current !== 0 && Math.sign(delta) === -Math.sign(current)) {
        const undo = Math.min(Math.abs(delta), Math.abs(current));
        const past = Math.abs(delta) - undo;
        moved = current + Math.sign(delta) * (undo * REVERSAL_BOOST + past);
      }
      const next = Math.max(-WEIGHT_CEILING, Math.min(WEIGHT_CEILING, moved));
      bump.run(userId, kind, key, label, next, now());
    };
    const mood = (userId) => {
      const all = [...weights(userId).entries()].map(([k, v]) => ({ kind: k.split("|")[0], label: v.label || k.split("|")[1], weight: v.w })).filter((e) => e.kind !== "track" && Math.abs(e.weight) >= FLOOR);
      all.sort((a, b) => b.weight - a.weight);
      const seenLabels = /* @__PURE__ */ new Set();
      const deduped = all.filter((e) => {
        const key = e.label.toLowerCase();
        if (seenLabels.has(key)) return false;
        seenLabels.add(key);
        return true;
      });
      return {
        into: deduped.filter((e) => e.weight > 0).slice(0, 8),
        outOf: deduped.filter((e) => e.weight < 0).slice(-8).reverse()
      };
    };
    app.post("/api/ishuffle/plan", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      const b = req.body ?? {};
      const seedFrom = Number(b.seedFrom) || 0;
      if (seedFrom && ctx.characteristics.enabled()) seedGhost(c.id, seedFrom);
      const count = Math.min(Math.max(Number(b.count) || 6, 1), 30);
      const exclude = new Set(Array.isArray(b.exclude) ? b.exclude.map(Number) : []);
      const playedOrder = Array.isArray(b.played) ? b.played.map(Number) : [];
      const afterId = Number(b.afterTrackId) || 0;
      const afterArtist = afterId ? db.prepare("SELECT norm_artist FROM tracks WHERE id = ?").get(afterId)?.norm_artist ?? "" : "";
      const lib = library(c.id);
      const w = weights(c.id);
      const cooldown = /* @__PURE__ */ new Map();
      if (playedOrder.length) {
        const marks = playedOrder.map(() => "?").join(",");
        const artistOf = /* @__PURE__ */ new Map();
        for (const r of db.prepare(`SELECT id, norm_artist FROM tracks WHERE id IN (${marks})`).all(...playedOrder)) {
          artistOf.set(r.id, r.norm_artist);
        }
        playedOrder.forEach((id, i) => {
          const a = artistOf.get(id);
          if (!a) return;
          const songsAgo = playedOrder.length - i;
          cooldown.set(a, ARTIST_COOLDOWN * Math.pow(0.5, (songsAgo - 1) / COOLDOWN_HALF_SONGS));
        });
      }
      const genres = genresOf([...new Set(lib.map((t) => t.norm_artist))]);
      const recent = new Set(
        db.prepare("SELECT track_id FROM plays WHERE user_id = ? AND last_played > ?").all(c.id, now() - 4 * 3600).map((r) => r.track_id)
      );
      let pool = lib.filter((t) => !exclude.has(t.id));
      if (pool.filter((t) => !recent.has(t.id)).length >= count * 2) {
        pool = pool.filter((t) => !recent.has(t.id));
      }
      const g = ghost(c.id);
      const ghostSay = ghostInfluence(g.votes);
      const ghostScores = ghostSay > 0 && ctx.characteristics.enabled() ? ctx.characteristics.scoreAgainst(g.profile) : /* @__PURE__ */ new Map();
      const raw = pool.map((t) => {
        const gs = genresFor(t, genres);
        const gw = gs.reduce((sum, g2) => sum + (w.get(`genre|${g2}`)?.w ?? 0), 0);
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
        const era = eraOf(t.year);
        const ew = era ? w.get(`era|${era.key}`)?.w ?? 0 : 0;
        const band = energyBandOf(t.energy);
        const nw = band ? w.get(`energy|${band}`)?.w ?? 0 : 0;
        return {
          t,
          gw,
          sw,
          ew,
          nw,
          gh: ghostScores.get(t.id),
          aw: w.get(`artist|${t.norm_artist}`)?.w ?? 0,
          alw: w.get(`album|${t.norm_artist}|${t.norm_album}`)?.w ?? 0,
          tw: w.get(`track|${String(t.id)}`)?.w ?? 0,
          cool: cooldown.get(t.norm_artist) ?? 0
        };
      });
      const clamp = (v, c2) => Math.max(-c2, Math.min(c2, v));
      const vetoed = raw.filter(
        (e) => clamp(e.gw, GENRE_CLAMP) + clamp(e.sw, STYLE_CLAMP) + clamp(e.ew, ERA_CLAMP) + clamp(e.nw, ENERGY_CLAMP) + e.aw + e.alw + e.tw > HARD_NO
      );
      const normaliser = (values) => {
        const mean = values.reduce((a, b2) => a + b2, 0) / (values.length || 1);
        const variance = values.reduce((a, b2) => a + (b2 - mean) ** 2, 0) / (values.length || 1);
        const sd = Math.sqrt(variance);
        if (sd < 1e-9) return () => 0;
        return (v) => clamp((v - mean) / sd, Z_CAP);
      };
      const zg = normaliser(vetoed.map((e) => e.gw));
      const zs = normaliser(vetoed.map((e) => e.sw));
      const ze = normaliser(vetoed.map((e) => e.ew));
      const zn = normaliser(vetoed.map((e) => e.nw));
      const za = normaliser(vetoed.map((e) => e.aw));
      const zal = normaliser(vetoed.map((e) => e.alw));
      const zt = normaliser(vetoed.map((e) => e.tw));
      const withGhost = vetoed.map((e) => e.gh).filter((x) => x !== void 0);
      const zgh = normaliser(withGhost);
      const scored = vetoed.map((e) => ({
        t: e.t,
        score: IMPORTANCE.genre * zg(e.gw) + IMPORTANCE.style * zs(e.sw) + IMPORTANCE.era * ze(e.ew) + IMPORTANCE.energy * zn(e.nw) + IMPORTANCE.artist * za(e.aw) + IMPORTANCE.album * zal(e.alw) + IMPORTANCE.track * zt(e.tw) + // Scaled by evidence: nothing at zero votes, full say after about six.
        IMPORTANCE.ghost * ghostSay * (e.gh === void 0 ? 0 : zgh(e.gh)) - e.cool
      }));
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
        `SELECT id, title, artist_name, album_title, norm_artist, norm_album, ${genresCol}, year, ${energyCol}
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
      const cp = corpus(c.id);
      const ownTags = new Set(
        (t.genres ? t.genres.split(", ") : []).map((g) => g.trim().toLowerCase()).filter(Boolean)
      );
      const pull = (g) => specificity(cp.genreDf.get(g) ?? 0, cp.n) * (ownTags.has(g) ? 1 : ARTIST_TAG_FACTOR);
      for (const g of gs) addWeight(c.id, "genre", g, g, d.genre * pull(g));
      const famPull = /* @__PURE__ */ new Map();
      for (const g of gs) {
        const f = familyOf(g);
        if (!f) continue;
        const p = specificity(cp.familyDf.get(f) ?? 0, cp.n) * (ownTags.has(g) ? 1 : ARTIST_TAG_FACTOR);
        famPull.set(f, Math.max(famPull.get(f) ?? 0, p));
      }
      const fams = [...famPull.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 3);
      for (const [f, p] of fams) addWeight(c.id, "style", f, FAMILY_LABEL[f], d.style * p);
      const era = eraOf(t.year);
      if (era) addWeight(c.id, "era", era.key, era.label, d.era);
      const band = energyBandOf(t.energy);
      if (band) addWeight(c.id, "energy", band, `${band} energy`, d.energy);
      const ghostMoved = ctx.characteristics.enabled() && moveGhost(c.id, t.id, direction);
      db.prepare(
        "INSERT INTO ishuffle_votes (user_id, track_id, norm_artist, direction, at) VALUES (?, ?, ?, ?, ?)"
      ).run(c.id, t.id, t.norm_artist, direction, now());
      db.prepare(
        "DELETE FROM ishuffle_weights WHERE user_id = ? AND abs(weight) < ? AND updated_at < ?"
      ).run(c.id, FLOOR, now() - 24 * 3600);
      db.prepare("DELETE FROM ishuffle_votes WHERE at < ?").run(now() - ESCALATE_WINDOW_S);
      return {
        ok: true,
        ghost: ghostMoved ? ghostSummary(c.id) : null,
        applied: {
          artist: t.artist_name,
          album: t.album_title,
          genres: gs,
          styles: fams.map(([f]) => FAMILY_LABEL[f]),
          era: era?.label ?? null,
          energy: band
        },
        mood: mood(c.id)
      };
    });
    app.get("/api/ishuffle/mood", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      return { mood: mood(c.id), ghost: ctx.characteristics.enabled() ? ghostSummary(c.id) : null };
    });
    app.post("/api/ishuffle/save-playlist", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      const requestedName = String(req.body?.name ?? "").trim();
      const terms = [...weights(c.id).entries()].map(([k, v]) => {
        const [kind, ...keyParts] = k.split("|");
        return { kind, key: keyParts.join("|"), weight: v.w, label: v.label };
      }).filter((t) => t.kind !== "track" && t.kind !== "album" && Math.abs(t.weight) >= FLOOR).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 30).map((t) => ({
        kind: t.kind,
        key: t.key,
        weight: Math.round(t.weight * 100) / 100,
        label: t.label || t.key
      }));
      if (!terms.length) {
        return reply.code(400).send({ error: "the mood is empty \u2014 vote on a few songs first" });
      }
      const nameParts = [];
      for (const t of terms) {
        if (t.weight <= 0) continue;
        const label = t.label.toLowerCase();
        if (nameParts.some((p) => p.toLowerCase() === label)) continue;
        nameParts.push(t.label);
        if (nameParts.length === 3) break;
      }
      const name = requestedName || nameParts.join(" \xB7 ") || "DJ mood";
      const rules = JSON.stringify({ v: 1, terms, limit: 50 });
      const id = ctx.userlib.createPlaylist(c.id, name.slice(0, 120), rules);
      ctx.userlib.setPlaylistDescription(id, "Saved from an Intelligent Shuffle mood \u2014 deals fresh songs every time.");
      return { ok: true, id, name };
    });
    app.post("/api/ishuffle/say", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      const text = String(req.body?.text ?? "").trim();
      if (text.length < 2) return reply.code(400).send({ error: "say something" });
      if (text.length > 300) return reply.code(400).send({ error: "keep it under 300 characters" });
      const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'openaiKey'").get();
      if (!keyRow?.value) {
        return reply.code(503).send({ error: "no OpenAI key configured (Admin \u2192 Settings)" });
      }
      const genreCounts = /* @__PURE__ */ new Map();
      for (const r of db.prepare("SELECT genres FROM tracks WHERE genres != ''").all()) {
        for (const g of r.genres.split(", ")) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
      }
      const genreVocab = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([g]) => g);
      const familyVocab = Object.keys(FAMILY_LABEL);
      const eras = db.prepare("SELECT DISTINCT (year/10)*10 AS d FROM tracks WHERE year >= 1900 ORDER BY d").all().map((r) => String(r.d));
      let parsed;
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${keyRow.value}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `You steer a music DJ by translating a listener's words into weight deltas (-3 to +3; positive = more of it, negative = less). Use ONLY these vocabularies. genres: ${genreVocab.join(", ")}. styles: ${familyVocab.join(", ")}. eras (decades): ${eras.join(", ")}. energy: chill, medium, high. artists: any artist name the listener mentions, lowercase. Reply with JSON only: {"genres":{},"styles":{},"eras":{},"energy":{},"artists":{},"summary":"<under 10 words, what you did>"} \u2014 omit empty maps.`
              },
              { role: "user", content: text }
            ]
          }),
          signal: AbortSignal.timeout(2e4)
        });
        if (!res.ok) throw new Error(`openai ${res.status}`);
        const body = await res.json();
        parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}");
      } catch (err) {
        ctx.log.warn(`ishuffle say failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.code(502).send({ error: "the DJ didn't catch that \u2014 try again" });
      }
      const clampDelta = (n) => Math.max(-3, Math.min(3, Number(n) || 0));
      let applied = 0;
      const familyBump = /* @__PURE__ */ new Map();
      for (const [g, d] of Object.entries(parsed.genres ?? {})) {
        const delta = clampDelta(d);
        if (!delta) continue;
        const key = g.toLowerCase();
        addWeight(c.id, "genre", key, key, delta);
        applied++;
        const fam = familyOf(key);
        if (fam) {
          const ratio = 0.8;
          familyBump.set(fam, (familyBump.get(fam) ?? 0) + delta * ratio);
        }
      }
      for (const [fam, delta] of familyBump) {
        addWeight(c.id, "style", fam, FAMILY_LABEL[fam], Math.max(-3, Math.min(3, delta)));
      }
      for (const [f, d] of Object.entries(parsed.styles ?? {})) {
        const fam = f.toLowerCase();
        const delta = clampDelta(d);
        if (delta && fam in FAMILY_LABEL) {
          addWeight(c.id, "style", fam, FAMILY_LABEL[fam], delta);
          applied++;
        }
      }
      for (const [e, d] of Object.entries(parsed.eras ?? {})) {
        const delta = clampDelta(d);
        const decade = String(parseInt(e, 10));
        if (delta && /^\d{4}$/.test(decade)) {
          addWeight(c.id, "era", decade, `${decade}s`, delta);
          applied++;
        }
      }
      for (const [band, d] of Object.entries(parsed.energy ?? {})) {
        const delta = clampDelta(d);
        const b = band.toLowerCase();
        if (delta && ["chill", "medium", "high"].includes(b)) {
          addWeight(c.id, "energy", b, `${b} energy`, delta);
          applied++;
        }
      }
      for (const [artist, d] of Object.entries(parsed.artists ?? {})) {
        const delta = clampDelta(d);
        if (delta) {
          addWeight(c.id, "artist", artist.toLowerCase(), artist, delta);
          applied++;
        }
      }
      if (!applied) {
        return reply.code(422).send({ error: "the DJ couldn't map that onto your library" });
      }
      return { ok: true, summary: String(parsed.summary ?? "noted").slice(0, 80), mood: mood(c.id) };
    });
    app.post("/api/ishuffle/reset", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no library" });
      db.prepare("DELETE FROM ishuffle_weights WHERE user_id = ?").run(c.id);
      db.prepare("DELETE FROM ishuffle_votes WHERE user_id = ?").run(c.id);
      db.prepare("DELETE FROM ishuffle_ghost WHERE user_id = ?").run(c.id);
      db.prepare("DELETE FROM ishuffle_ghost_meta WHERE user_id = ?").run(c.id);
      return { ok: true };
    });
  }
};
var index_default = plugin;
export {
  index_default as default
};
