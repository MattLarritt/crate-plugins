// plugins/youtube/server/index.ts
import { mkdir as mkdir2, readdir, rm as rm2, stat as stat2 } from "node:fs/promises";
import { join as join2 } from "node:path";

// plugins/youtube/server/ytdlp.ts
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, stat, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
var RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
var DAY_MS = 24 * 3600 * 1e3;
var ERROR_UPDATE_GAP_MS = 3600 * 1e3;
function assetName() {
  return process.arch === "arm64" ? "yt-dlp_musllinux_aarch64" : "yt-dlp_musllinux";
}
var Ytdlp = class {
  constructor(dataDir, log) {
    this.dataDir = dataDir;
    this.log = log;
    this.bin = join(dataDir, "bin", "yt-dlp");
    this.stateFile = join(dataDir, "bin", "state.json");
    this.status = { path: this.bin, version: null, installedAt: null, lastUpdateCheck: null, lastError: null };
  }
  bin;
  stateFile;
  installing = null;
  updating = null;
  lastErrorUpdate = 0;
  status;
  current() {
    return { ...this.status };
  }
  /** A usable binary, installing it first if there is none. Updates happen in the background. */
  async ready() {
    const present = await stat(this.bin).then(
      () => true,
      () => false
    );
    if (!present) {
      this.installing ??= this.install().finally(() => this.installing = null);
      await this.installing;
    } else if (this.status.version === null) {
      await this.loadState();
    }
    if (!this.status.lastUpdateCheck || Date.now() - this.status.lastUpdateCheck > DAY_MS) {
      void this.update("daily");
    }
    return this.bin;
  }
  /**
   * Run yt-dlp and return stdout.
   *
   * Always with --ignore-config (a stray config file must not change behaviour), a cache inside
   * the plugin's own directory (the signature cache makes later calls much faster), and Node as
   * the JS runtime. stderr is kept only for the error message, capped.
   */
  async run(args, opts = {}) {
    const bin = await this.ready();
    const full = [
      "--ignore-config",
      "--no-warnings",
      "--no-progress",
      "--cache-dir",
      join(this.dataDir, "cache"),
      "--js-runtimes",
      `node:${process.execPath}`,
      ...args
    ];
    try {
      return await exec(bin, full, opts.timeoutMs ?? 6e4);
    } catch (err) {
      const message = err.message;
      this.status.lastError = message.slice(0, 300);
      if (/ERROR: \[youtube|Sign in to confirm|nsig|signature|Unsupported URL|Requested format/i.test(message)) {
        if (Date.now() - this.lastErrorUpdate > ERROR_UPDATE_GAP_MS) {
          this.lastErrorUpdate = Date.now();
          void this.update("after an error");
        }
      }
      throw err;
    }
  }
  async loadState() {
    const raw = await readFile(this.stateFile, "utf8").catch(() => null);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        this.status.installedAt = s.installedAt ?? null;
        this.status.lastUpdateCheck = s.lastUpdateCheck ?? null;
      } catch {
      }
    }
    this.status.version = await exec(this.bin, ["--version"], 15e3).then((v) => v.trim()).catch(() => null);
  }
  async saveState() {
    await writeFile(
      this.stateFile,
      JSON.stringify({ installedAt: this.status.installedAt, lastUpdateCheck: this.status.lastUpdateCheck })
    ).catch(() => void 0);
  }
  /**
   * Download the release binary and refuse it unless it matches the published checksum.
   *
   * Downloaded to a temporary name, hashed while it streams, and only renamed into place and
   * made executable once the hash matches — so a truncated or tampered download is never run.
   */
  async install() {
    const dir = join(this.dataDir, "bin");
    await mkdir(dir, { recursive: true });
    const asset = assetName();
    this.log.warn({ asset }, "youtube: installing yt-dlp");
    const sums = await fetchText(`${RELEASE}/SHA2-256SUMS`);
    const expected = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, name]) => name === asset)?.[0];
    if (!expected || !/^[0-9a-f]{64}$/i.test(expected)) {
      throw new Error(`no published checksum for ${asset}`);
    }
    const tmp = join(dir, `.yt-dlp.${process.pid}.download`);
    const actual = await download(`${RELEASE}/${asset}`, tmp);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      await rm(tmp, { force: true });
      throw new Error(`yt-dlp checksum mismatch: expected ${expected}, got ${actual}`);
    }
    await chmod(tmp, 493);
    await rename(tmp, this.bin);
    this.status.installedAt = Date.now();
    this.status.lastUpdateCheck = Date.now();
    this.status.version = await exec(this.bin, ["--version"], 15e3).then((v) => v.trim()).catch(() => null);
    this.status.lastError = null;
    await this.saveState();
    this.log.warn({ version: this.status.version }, "youtube: yt-dlp installed");
  }
  /** yt-dlp's own self-update. One at a time; a failure is recorded, never thrown. */
  update(why) {
    this.updating ??= (async () => {
      try {
        const out = await exec(this.bin, ["-U"], 18e4);
        this.status.lastUpdateCheck = Date.now();
        this.status.version = await exec(this.bin, ["--version"], 15e3).then((v) => v.trim()).catch(() => this.status.version);
        await this.saveState();
        this.log.info({ why, version: this.status.version, out: out.trim().split("\n").pop() }, "youtube: yt-dlp update check");
      } catch (err) {
        this.status.lastError = `update failed: ${err.message}`.slice(0, 300);
        this.log.warn({ why, err: err.message }, "youtube: yt-dlp update failed");
      }
    })().finally(() => this.updating = null);
    return this.updating;
  }
};
function exec(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => {
      out += c;
      if (out.length > 32e6) proc.kill("SIGKILL");
    });
    proc.stderr.on("data", (c) => {
      err = (err + c).slice(-4e3);
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    timer.unref();
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(signal ? `yt-dlp killed (${signal})` : err.trim().split("\n").slice(-3).join(" ") || `yt-dlp exited ${code}`));
    });
  });
}
function get(url, hops = 5) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { family: 4, headers: { "User-Agent": "crate-youtube-plugin" } }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && hops > 0) {
        res.resume();
        resolve(get(new URL(loc, url).href, hops - 1));
        return;
      }
      if ((res.statusCode ?? 0) >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
    req.setTimeout(3e4, () => req.destroy(new Error(`timed out fetching ${url}`)));
    req.end();
  });
}
async function fetchText(url) {
  const res = await get(url);
  let body = "";
  res.setEncoding("utf8");
  for await (const chunk of res) body += chunk;
  return body;
}
async function download(url, to) {
  const res = await get(url);
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const file = createWriteStream(to);
    res.on("data", (c) => hash.update(c));
    res.on("error", reject);
    file.on("error", reject);
    file.on("finish", () => resolve());
    res.pipe(file);
  });
  return hash.digest("hex");
}

// plugins/youtube/server/rank.ts
var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
var UNWANTED = [
  [/\bkaraoke\b/i, "karaoke", 30],
  [/\breaction\b|\breacts?\b/i, "reaction", 30],
  [/\b(?:\d+\s*)?hours?\b|\b1h\b|\bloop\b/i, "hour", 30],
  [/\btutorial\b|\blesson\b|\bhow to play\b/i, "tutorial", 30],
  [/\bnightcore\b/i, "nightcore", 25],
  [/\bslowed\b|\bsped up\b|\breverb\b/i, "slowed", 25],
  [/\b8d\b/i, "8d", 25],
  [/\bcover\b/i, "cover", 18],
  [/\blive\b|\bconcert\b|\bperformance\b/i, "live", 15],
  [/\binstrumental\b/i, "instrumental", 15],
  [/\bremix\b|\bmix\b/i, "remix", 12],
  [/\bacoustic\b/i, "acoustic", 8],
  [/\blyrics?\b/i, "lyric", 3]
];
function parseTitle(raw) {
  const noise = /\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|m\/v|explicit|clean)\b[^)\]]*)[)\]]\s*/gi;
  let t = raw.replace(noise, " ").replace(/\s*\|.*$/, "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s+(?:official\s+(?:music\s+)?(?:video|audio)|lyric\s+video|audio)$/i, "").trim();
  const dash = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { artist: dash[1].trim(), title: dash[2].trim() };
  return { artist: null, title: t };
}
function channelArtist(channel) {
  return channel.replace(/\s+-\s+Topic$/i, "").replace(/VEVO$/i, "").replace(/\s+(?:official|music)$/i, "").trim();
}
var isTopic = (channel) => /\s+-\s+Topic$/i.test(channel ?? "");
function rank(entries, q, opts) {
  const asked = q.toLowerCase();
  const scored = [];
  entries.forEach((e, i) => {
    if (!e.id || !e.title) return;
    if (!VIDEO_ID.test(e.id) || e.ie_key && e.ie_key !== "Youtube") return;
    const d = e.duration ?? null;
    if (d !== null && (d < opts.minDurationS || d > opts.maxDurationS)) return;
    const channel = e.channel ?? e.uploader ?? "";
    let score = (entries.length - i) * 2;
    if (isTopic(channel)) score += 40;
    if (/official\s+audio/i.test(e.title)) score += 15;
    else if (/official\s+(?:music\s+)?video/i.test(e.title)) score += 8;
    if (/vevo$/i.test(channel)) score += 6;
    for (const [re, word, penalty] of UNWANTED) {
      if (re.test(e.title) && !asked.includes(word)) score -= penalty;
    }
    const parsed = parseTitle(e.title);
    const artist = isTopic(channel) ? channelArtist(channel) : parsed.artist ?? channelArtist(channel);
    scored.push({
      key: e.id,
      title: parsed.title || e.title,
      artist: artist || "Unknown artist",
      ...d !== null ? { durationS: Math.round(d) } : {},
      ...e.thumbnail ? { coverUrl: e.thumbnail } : {},
      score
    });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, opts.limit);
}
function bestThumbnail(thumbs) {
  if (!thumbs?.length) return void 0;
  const usable = thumbs.filter((t) => t.url);
  const sized = usable.filter((t) => (t.width ?? 0) > 0 && (t.width ?? 0) <= 500);
  const pick = (sized.length ? sized : usable).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return pick?.url;
}
function expiryOf(url) {
  try {
    const v = new URL(url).searchParams.get("expire");
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : void 0;
  } catch {
    return void 0;
  }
}

// plugins/youtube/server/index.ts
var FORMAT = "bestaudio[ext=m4a]/bestaudio";
var watchUrl = (key) => `https://www.youtube.com/watch?v=${key}`;
var KEY_RE = /^[A-Za-z0-9_-]{11}$/;
function identify(info) {
  const parsed = parseTitle(info.title);
  const channel = info.channel ?? info.uploader ?? "";
  const artist = info.artists?.[0] ?? info.artist ?? (isTopic(channel) ? channelArtist(channel) : parsed.artist ?? channelArtist(channel));
  return {
    key: info.id,
    title: info.track || parsed.title || info.title,
    artist: artist || "Unknown artist",
    ...info.album ? { album: info.album } : {},
    ...info.duration ? { durationS: Math.round(info.duration) } : {},
    ...info.thumbnail ? { coverUrl: info.thumbnail } : {}
  };
}
var EMPTY_GENRES = /* @__PURE__ */ new Set(["music", "entertainment", "people & blogs", "film & animation"]);
async function nameIt(ctx, meta, who) {
  const genre = meta?.genre && !EMPTY_GENRES.has(meta.genre.toLowerCase()) ? meta.genre : void 0;
  let named = {
    artist: who.artist,
    title: who.title,
    ...who.album ? { album: who.album } : {},
    ...meta?.album_artist && meta.album_artist !== who.artist ? { albumArtist: meta.album_artist } : {},
    ...meta?.track_number ? { trackNo: meta.track_number } : {},
    ...meta?.release_year ? { year: meta.release_year } : {},
    ...genre ? { genre } : {}
  };
  if (!meta || ctx.settings.get("aiCleanup") !== true || !ctx.ai?.available()) return named;
  const channel = meta.channel ?? meta.uploader;
  const ai = await ctx.ai.identifySong({
    videoTitle: meta.title,
    ...channel ? { channel } : {},
    ...meta.description ? { description: meta.description } : {},
    ...meta.track ? { track: meta.track } : {},
    ...meta.artists?.[0] ?? meta.artist ? { artist: meta.artists?.[0] ?? meta.artist } : {},
    ...meta.album ? { album: meta.album } : {},
    ...meta.release_year ? { releaseYear: meta.release_year } : {},
    ...meta.duration ? { durationS: Math.round(meta.duration) } : {},
    guess: { artist: who.artist, title: who.title, ...who.album ? { album: who.album } : {} }
  }).catch(() => null);
  if (ai) {
    named = { ...named, ...ai };
    ctx.log.info({ key: meta.id, artist: ai.artist, title: ai.title, album: ai.album }, "youtube: named by AI");
  }
  return named;
}
function source(ctx, yt) {
  const dl = join2(ctx.dataDir, "dl");
  const num = (k, d) => {
    const v = Number(ctx.settings.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const info = async (key, extra = []) => {
    if (!KEY_RE.test(key)) throw new Error("not a YouTube video id");
    const out = await yt.run(["-J", "--no-playlist", ...extra, watchUrl(key)], { timeoutMs: 45e3 });
    return JSON.parse(out);
  };
  const sweep = async () => {
    const names = await readdir(dl).catch(() => []);
    for (const n of names) {
      const f = join2(dl, n);
      const s = await stat2(f).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 24 * 3600 * 1e3) await rm2(f, { force: true });
    }
  };
  return {
    id: "youtube",
    label: "YouTube",
    async search(q, limit) {
      const want = Math.max(limit, num("maxResults", limit));
      const out = await yt.run(["--flat-playlist", "-J", `ytsearch${Math.max(want * 2, 8)}:${q}`], {
        timeoutMs: 2e4
      });
      const parsed = JSON.parse(out);
      const entries = (parsed.entries ?? []).map((e) => {
        const thumb = e.thumbnail ?? bestThumbnail(e.thumbnails);
        return { ...e, ...thumb ? { thumbnail: thumb } : {} };
      });
      return rank(entries, q, {
        limit: want,
        minDurationS: num("minDurationS", 60),
        maxDurationS: num("maxDurationS", 900)
      });
    },
    async describe(key) {
      try {
        return identify(await info(key));
      } catch {
        return null;
      }
    },
    async resolveStream(key) {
      const i = await info(key, ["-f", FORMAT]);
      if (!i.url) throw new Error("YouTube offered no audio for that video");
      const size = i.filesize ?? i.filesize_approx;
      return {
        url: i.url,
        mime: i.ext === "m4a" || i.ext === "mp4" ? "audio/mp4" : i.ext === "webm" ? "audio/webm" : "audio/mp4",
        ...i.http_headers ? { headers: i.http_headers } : {},
        ...size ? { sizeBytes: size } : {},
        ...expiryOf(i.url) ? { expiresAt: expiryOf(i.url) } : {}
      };
    },
    async acquire(key, hit) {
      await mkdir2(dl, { recursive: true });
      void sweep().catch(() => void 0);
      const meta = await info(key).catch(() => null);
      const who = meta ? identify(meta) : hit;
      const named = await nameIt(ctx, meta, who);
      const out = await yt.run(
        [
          "--no-playlist",
          "-f",
          FORMAT,
          "-x",
          "--audio-format",
          "m4a",
          "--embed-metadata",
          "--embed-thumbnail",
          "--no-overwrites",
          "-o",
          join2(dl, `${key}.%(ext)s`),
          "--print",
          "after_move:filepath",
          watchUrl(key)
        ],
        { timeoutMs: 10 * 6e4 }
      );
      const file = out.trim().split("\n").filter(Boolean).pop();
      if (!file) throw new Error("yt-dlp finished without saying where the file is");
      await stat2(file);
      return { file, ...named, retag: true };
    }
  };
}
var shared = null;
var plugin = {
  id: "youtube",
  settings: [
    { key: "maxResults", label: "Results per search", type: "number", default: 5, hint: "At least this many YouTube songs per search \u2014 what a Subsonic app gets when the library has none. The web page asks for more when you press See more." },
    { key: "minDurationS", label: "Shortest song (seconds)", type: "number", default: 60, hint: "Drops previews, intros and shorts." },
    { key: "maxDurationS", label: "Longest song (seconds)", type: "number", default: 900, hint: "Drops full albums, mixes and hour-long loops." },
    {
      key: "aiCleanup",
      label: "Allow AI to cleanup and retag tracks downloaded from YouTube",
      type: "boolean",
      default: false,
      hint: "Uses crate's OpenAI key (Admin \u2192 Integrations) to name each kept song from its video \u2014 artist, title, album, year, genre \u2014 before it is tagged and filed. Off, the plugin tidies the video title itself. Either way the file is retagged."
    }
  ],
  source(ctx) {
    shared ??= new Ytdlp(ctx.dataDir, ctx.log);
    void shared.ready().catch((err) => ctx.log.warn({ err: err.message }, "youtube: yt-dlp not ready"));
    return source(ctx, shared);
  },
  routes(app, ctx) {
    app.get("/api/youtube/status", async (req, reply) => {
      const c = ctx.need(req, reply);
      if (!c) return;
      if (!c.isAdmin) return reply.code(403).send({ error: "admin only" });
      shared ??= new Ytdlp(ctx.dataDir, ctx.log);
      return shared.current();
    });
    app.post("/api/youtube/update", async (req, reply) => {
      const c = ctx.need(req, reply);
      if (!c) return;
      if (!c.isAdmin) return reply.code(403).send({ error: "admin only" });
      shared ??= new Ytdlp(ctx.dataDir, ctx.log);
      await shared.ready();
      await shared.update("asked for by an admin");
      return shared.current();
    });
  }
};
var index_default = plugin;
export {
  index_default as default,
  identify,
  nameIt
};
