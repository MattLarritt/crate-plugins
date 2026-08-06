// plugins/chords/server/store.ts
var nowSec = () => Math.floor(Date.now() / 1e3);
var MAX_SHEET_BYTES = 128 * 1024;
function toSheet(r) {
  let shapes = {};
  if (r.shapes) {
    try {
      shapes = JSON.parse(r.shapes);
    } catch {
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
    updatedAt: r.updated_at
  };
}
var ChordSheets = class {
  constructor(db) {
    this.db = db;
  }
  get(userId, trackId) {
    const r = this.db.prepare(
      `SELECT track_id, body, source_url, shapes, tuning, capo, updated_at
           FROM chord_sheets WHERE user_id = ? AND track_id = ?`
    ).get(userId, trackId);
    return r ? toSheet(r) : null;
  }
  /** Which of these tracks the person has written something for — for showing a marker. */
  haveFor(userId, trackIds) {
    if (!trackIds.length) return /* @__PURE__ */ new Set();
    const marks = trackIds.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT track_id FROM chord_sheets WHERE user_id = ? AND track_id IN (${marks})`).all(userId, ...trackIds);
    return new Set(rows.map((r) => r.track_id));
  }
  /**
   * Everything this person has written, newest first — the "my chord sheets" list.
   *
   * Carries enough of the track to PLAY it, because that is what somebody opening this list
   * wants: the sheet is for playing along to, and a list that can only describe the song sends
   * them off to find it by hand.
   */
  mine(userId, limit = 200) {
    const rows = this.db.prepare(
      `SELECT c.track_id, c.body, c.source_url, c.shapes, c.tuning, c.capo, c.updated_at,
                t.title, t.artist_name AS artistName, t.album_title AS albumTitle,
                t.duration_s AS durationS
           FROM chord_sheets c
           JOIN tracks t ON t.id = c.track_id
          WHERE c.user_id = ?
          ORDER BY c.updated_at DESC
          LIMIT ?`
    ).all(userId, limit);
    return rows.map((r) => ({
      ...toSheet(r),
      title: r.title,
      artistName: r.artistName,
      albumTitle: r.albumTitle,
      durationS: r.durationS
    }));
  }
  /**
   * Write a sheet.
   *
   * An upsert rather than insert-or-update, so saving is idempotent and a slow network that
   * retries cannot produce a constraint error over somebody's own work. created_at survives an
   * update — when they first wrote it is a different fact from when they last touched it.
   */
  save(userId, trackId, v) {
    const t = nowSec();
    this.db.prepare(
      `INSERT INTO chord_sheets
           (user_id, track_id, body, source_url, shapes, tuning, capo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, track_id) DO UPDATE SET
           body       = excluded.body,
           source_url = excluded.source_url,
           shapes     = excluded.shapes,
           tuning     = excluded.tuning,
           capo       = excluded.capo,
           updated_at = excluded.updated_at`
    ).run(
      userId,
      trackId,
      v.body,
      v.sourceUrl ?? "",
      v.shapes && Object.keys(v.shapes).length ? JSON.stringify(v.shapes) : "",
      v.tuning ?? "",
      v.capo ?? "",
      t,
      t
    );
  }
  remove(userId, trackId) {
    this.db.prepare("DELETE FROM chord_sheets WHERE user_id = ? AND track_id = ?").run(userId, trackId);
  }
};

// plugins/chords/server/chordsheet.ts
var CHORD_RE = /^[A-G](?:#|b)?(?:maj|min|m|M|aug|dim|sus|add|°|\+)?\d*(?:sus\d|add\d|maj\d|b\d|#\d|no\d)*(?:\/[A-G](?:#|b)?)?$/;
var DECO_RE = /^(?:\||\|\||%|-+|[xX]\d{1,2}|\d{1,2}[xX]|N\.?C\.?|:|\|:|:\||\.{2,})$/;
var bare = (v) => v.replace(/[()[\],]/g, "").trim();
function isChordToken(v) {
  const t = bare(v);
  return Boolean(t) && t.length <= 12 && CHORD_RE.test(t);
}
function isDecoToken(v) {
  const t = bare(v);
  return Boolean(t) && DECO_RE.test(t);
}
function looksLikeChordLine(line) {
  const tokens = line.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  let chords = 0;
  for (const t of tokens) {
    if (isChordToken(t)) chords++;
    else if (!isDecoToken(t)) return false;
  }
  if (!chords) return false;
  if (tokens.length === 1) {
    return tokens[0].length > 1 && /[#b0-9]|m|sus|add|dim|aug/.test(tokens[0]);
  }
  return true;
}
var STRING_ROW = /^\s*[eEADGB][b#]?\s*\|/;
function looksLikeTabGrid(line) {
  if (STRING_ROW.test(line) && /[-\d]/.test(line)) return true;
  return /-{3,}/.test(line) && /[|\d]/.test(line);
}
var ANNOTATION_ONLY = /^(?:\s|\([^)]*\)|\[[^\]]*\]|[xX]\s?\d{1,2}|\d{1,2}\s?[xX]|N\.?C\.?|[|%:,.\-–—])*$/;
function chordsFromMarkup(line) {
  const chords = [];
  let text = "";
  let rest = "";
  let i = 0;
  const plain = (v) => {
    text += v;
    rest += v;
  };
  while (i < line.length) {
    const open = line.indexOf("[ch]", i);
    if (open === -1) {
      plain(line.slice(i));
      break;
    }
    plain(line.slice(i, open));
    const close = line.indexOf("[/ch]", open);
    if (close === -1) {
      plain(line.slice(open));
      break;
    }
    const name = line.slice(open + 4, close);
    chords.push({ name, col: text.length });
    text += name;
    i = close + 5;
  }
  return { text, chords, rest };
}
function maskChords(text, chords) {
  const out = [...text];
  for (const c of chords) {
    for (let i = 0; i < c.name.length; i++) out[c.col + i] = " ";
  }
  return out.join("");
}
function annotationsIn(text, chords) {
  const out = [];
  const re = /\S+/g;
  let m;
  const masked = maskChords(text, chords);
  while (m = re.exec(masked)) out.push({ name: m[0], col: m.index, deco: true });
  return out;
}
function chordsFromColumns(line) {
  const out = [];
  const re = /\S+/g;
  let m;
  while (m = re.exec(line)) {
    if (isChordToken(m[0])) {
      out.push({ name: bare(m[0]), col: m.index });
      continue;
    }
    if (m[0].trim()) out.push({ name: m[0], col: m.index, deco: true });
  }
  return out;
}
function sources(lines) {
  const out = [];
  let depth = 0;
  let region = 0;
  for (const raw of lines) {
    let text = raw;
    const opened = text.includes("[tab]");
    if (opened && depth === 0) region++;
    depth += (text.match(/\[tab\]/g) ?? []).length;
    const closes = (text.match(/\[\/tab\]/g) ?? []).length;
    text = text.replace(/\[\/?tab\]/g, "");
    out.push({ text, region: depth > 0 || closes ? region : 0 });
    depth = Math.max(0, depth - closes);
  }
  return out;
}
function parseSheet(raw) {
  const src = sources(raw.replace(/\r\n?/g, "\n").split("\n"));
  const blocks = [];
  const chords = [];
  const seen = /* @__PURE__ */ new Set();
  const note = (list) => {
    for (const c of list) {
      if (c.name && !c.deco && !seen.has(c.name)) {
        seen.add(c.name);
        chords.push(c.name);
      }
    }
  };
  const gridRegions = /* @__PURE__ */ new Set();
  for (const s of src) {
    if (s.region && looksLikeTabGrid(s.text)) gridRegions.add(s.region);
  }
  const gap = () => {
    if (blocks.length && blocks[blocks.length - 1]?.kind !== "gap") blocks.push({ kind: "gap" });
  };
  for (let i = 0; i < src.length; i++) {
    const cur = src[i];
    const line = cur.text;
    if (cur.region && gridRegions.has(cur.region)) {
      const buf = [];
      while (i < src.length && src[i].region === cur.region) {
        const { text, chords: found } = chordsFromMarkup(src[i].text);
        note(found);
        buf.push(text);
        i++;
      }
      i--;
      blocks.push({ kind: "tab", lines: buf });
      continue;
    }
    if (!cur.region && looksLikeTabGrid(line)) {
      const buf = [];
      while (i < src.length && !src[i].region && looksLikeTabGrid(src[i].text)) {
        buf.push(src[i].text);
        i++;
      }
      i--;
      blocks.push({ kind: "tab", lines: buf });
      continue;
    }
    const section = /^\s*\[([^\]]{1,40})\]\s*$/.exec(line);
    if (section) {
      blocks.push({ kind: "section", label: section[1].trim() });
      continue;
    }
    if (!line.trim()) {
      gap();
      continue;
    }
    if (line.includes("[ch]")) {
      const { text, chords: found, rest } = chordsFromMarkup(line);
      note(found);
      if (found.length && ANNOTATION_ONLY.test(rest)) {
        const marks = annotationsIn(text, found);
        const row = marks.length ? [...found, ...marks].sort((a, b) => a.col - b.col) : found;
        const next = src[i + 1]?.text;
        if (next !== void 0 && next.trim() && !next.includes("[ch]") && !looksLikeTabGrid(next)) {
          blocks.push({ kind: "line", chords: row, lyric: next });
          i++;
          continue;
        }
        blocks.push({ kind: "line", chords: row, lyric: "" });
        continue;
      }
      blocks.push({ kind: "line", chords: found, lyric: maskChords(text, found) });
      continue;
    }
    if (looksLikeChordLine(line)) {
      const found = chordsFromColumns(line);
      note(found);
      const next = src[i + 1]?.text;
      if (next !== void 0 && next.trim() && !looksLikeChordLine(next) && !looksLikeTabGrid(next) && !/^\s*\[[^\]]{1,40}\]\s*$/.test(next)) {
        blocks.push({ kind: "line", chords: found, lyric: next });
        i++;
        continue;
      }
      blocks.push({ kind: "line", chords: found, lyric: "" });
      continue;
    }
    blocks.push({ kind: "text", text: line });
  }
  while (blocks[blocks.length - 1]?.kind === "gap") blocks.pop();
  const first = blocks.findIndex((b) => b.kind === "section");
  const preamble = first > 0 ? blocks.splice(0, first) : [];
  while (preamble[preamble.length - 1]?.kind === "gap") preamble.pop();
  return { preamble, blocks, chords };
}

// plugins/chords/server/ultimateguitar.ts
function isUgUrl(v) {
  return /^https?:\/\/(tabs\.)?ultimate-guitar\.com\/tab\//i.test(v.trim());
}
function unescapeAttr(v) {
  return v.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
}
var NAMED = {
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201D",
  ldquo: "\u201C",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  nbsp: " ",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  amp: "&"
};
function decodeEntities(v) {
  return v.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith("#")) {
      const n = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
async function fetchUgTab(url, getText) {
  if (!isUgUrl(url)) throw new Error("that is not an ultimate-guitar tab URL");
  let html;
  try {
    html = await getText(url, {
      timeoutMs: 15e3,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
        Accept: "text/html"
      }
    });
  } catch (err) {
    const msg = err.message;
    const status = /HTTP (\d{3})/.exec(msg)?.[1];
    if (status === "404" || status === "410") {
      throw new Error("Ultimate Guitar has no tab at that link \u2014 check the URL");
    }
    throw new Error(`could not fetch that page from Ultimate Guitar (${msg})`);
  }
  const m = /class="js-store"\s+data-content="([\s\S]*?)"><\/div>/.exec(html);
  if (!m?.[1]) throw new Error("could not find the chords on that page \u2014 Ultimate Guitar may have changed");
  let store;
  try {
    store = JSON.parse(unescapeAttr(m[1]));
  } catch {
    throw new Error("could not read that page\u2019s data");
  }
  const data = store.store?.page?.data;
  const view = data?.tab_view;
  const content = decodeEntities(view?.wiki_tab?.content ?? "");
  if (!content.trim()) throw new Error("that page has no chord sheet on it");
  const shapes = {};
  for (const [name, variants] of Object.entries(view?.applicature ?? {})) {
    const list = [];
    for (const v of variants ?? []) {
      if (!Array.isArray(v.frets) || !v.frets.length) continue;
      list.push({
        frets: v.frets,
        fingers: Array.isArray(v.fingers) ? v.fingers : v.frets.map(() => 0),
        baseFret: Number(v.fret) || 0,
        barres: (v.listCapos ?? []).filter((b) => Number.isFinite(Number(b.fret))).map((b) => ({
          fret: Number(b.fret),
          from: Number(b.startString ?? 0),
          to: Number(b.lastString ?? 0),
          finger: Number(b.finger ?? 1)
        }))
      });
    }
    if (list.length) shapes[name] = list;
  }
  const capo = view?.meta?.capo;
  return {
    artist: data?.tab?.artist_name ?? "",
    song: data?.tab?.song_name ?? "",
    kind: data?.tab?.type ?? "",
    tuning: view?.meta?.tuning?.value ?? "",
    capo: capo === void 0 || capo === null || capo === 0 ? "" : String(capo),
    content,
    shapes,
    url: url.trim()
  };
}

// plugins/chords/server/index.ts
var chordsPlugin = {
  id: "chords",
  migrate(db) {
    db.exec(`
      -- Chord sheets and notes, one per person per song.
      --
      -- PRIVATE, and structurally so: the primary key leads with user_id and every statement that
      -- touches this table is scoped by it, so there is no query shape that could return one
      -- person's sheet to another. That is not decoration \u2014 somebody's working notes on a song
      -- are theirs, and two people who both play the same track will write different things about
      -- it. No sharing, so no visibility flag to get wrong.
      --
      -- The SOURCE is stored, not the parse. Parsing is cheap and the parser will improve; the
      -- text is what somebody typed and the only thing that cannot be regenerated.
      CREATE TABLE IF NOT EXISTS chord_sheets (
        user_id    INTEGER NOT NULL,
        track_id   INTEGER NOT NULL,
        -- The sheet as written: [ch] markup if imported, plain columns if hand-typed.
        body       TEXT    NOT NULL DEFAULT '',
        -- Where an import came from, so it can be pulled again. Empty when hand-written.
        source_url TEXT    NOT NULL DEFAULT '',
        -- Chord shapes from the import, as JSON: name -> voicings. Empty when unknown, in which
        -- case the client falls back to its own dictionary.
        shapes     TEXT    NOT NULL DEFAULT '',
        tuning     TEXT    NOT NULL DEFAULT '',
        capo       TEXT    NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, track_id)
      );
    `);
  },
  routes(app, ctx) {
    const { userlib, need } = ctx;
    const chords = new ChordSheets(ctx.db);
    app.get("/api/track/:trackId/chords", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no chord sheets" });
      const trackId = Number(req.params.trackId);
      if (!userlib.byId(trackId)) return reply.code(404).send({ error: "no such track" });
      const sheet = chords.get(c.id, trackId);
      if (!sheet) return { body: "", sourceUrl: "", shapes: {}, tuning: "", capo: "", parsed: null };
      return { ...sheet, parsed: parseSheet(sheet.body) };
    });
    app.put("/api/track/:trackId/chords", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no chord sheets" });
      const trackId = Number(req.params.trackId);
      if (!userlib.byId(trackId)) return reply.code(404).send({ error: "no such track" });
      const raw = String(req.body?.body ?? "");
      if (Buffer.byteLength(raw, "utf-8") > MAX_SHEET_BYTES) {
        return reply.code(413).send({ error: "that is longer than a chord sheet \u2014 128 KB is the limit" });
      }
      if (!raw.trim()) {
        chords.remove(c.id, trackId);
        return { body: "", sourceUrl: "", shapes: {}, tuning: "", capo: "", parsed: null };
      }
      const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? "";
      if (isUgUrl(firstLine)) {
        let tab;
        try {
          tab = await fetchUgTab(firstLine, ctx.http.getText);
        } catch (err) {
          return reply.code(502).send({ error: err.message });
        }
        chords.save(c.id, trackId, {
          body: tab.content,
          sourceUrl: tab.url,
          shapes: tab.shapes,
          tuning: tab.tuning,
          capo: tab.capo
        });
        const saved2 = chords.get(c.id, trackId);
        return {
          ...saved2,
          parsed: parseSheet(saved2.body),
          imported: { artist: tab.artist, song: tab.song, kind: tab.kind }
        };
      }
      chords.save(c.id, trackId, { body: raw });
      const saved = chords.get(c.id, trackId);
      return { ...saved, parsed: parseSheet(saved.body) };
    });
    app.delete("/api/track/:trackId/chords", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no chord sheets" });
      chords.remove(c.id, Number(req.params.trackId));
      return { ok: true };
    });
    app.get("/api/chords", async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: "a token caller has no chord sheets" });
      return {
        sheets: chords.mine(c.id).map((s) => ({
          trackId: s.trackId,
          title: s.title,
          artistName: s.artistName,
          albumTitle: s.albumTitle,
          durationS: s.durationS,
          sourceUrl: s.sourceUrl,
          updatedAt: s.updatedAt,
          lines: s.body.split("\n").length
        }))
      };
    });
  }
};
var index_default = chordsPlugin;
export {
  index_default as default
};
