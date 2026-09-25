import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CratePlugin, ExternalHit, ExternalSource, PluginContext } from '../../../types/contract.js';
import { Ytdlp } from './ytdlp.js';
import { bestThumbnail, channelArtist, expiryOf, isTopic, parseTitle, rank, type SearchEntry } from './rank.js';

/**
 * YouTube as an external source: when a song is not in the library, it can still play.
 *
 * This plugin answers crate's four questions — search, describe, where is the audio, fetch it
 * to a file — and nothing else. crate owns the ids, the streaming, the "has this been listened
 * to" policy, the import and the caps (see its lib/external.ts), which is why there is no
 * client half here: the web page and OpenSubsonic render external songs themselves.
 *
 * AUDIO FORMAT. m4a (AAC) wherever YouTube offers it, which is nearly always. Not because it is
 * the best audio YouTube has — Opus usually is — but because iOS's AVPlayer, which almost every
 * iPhone Subsonic client plays through, cannot decode Opus or WebM at all. A song that streams
 * beautifully in a browser and silently fails on the phone is worse than a slightly lower
 * bitrate everywhere.
 */

const FORMAT = 'bestaudio[ext=m4a]/bestaudio';
const watchUrl = (key: string) => `https://www.youtube.com/watch?v=${key}`;
/** Eleven characters of YouTube's alphabet. Anything else is not a key this plugin issued. */
const KEY_RE = /^[A-Za-z0-9_-]{11}$/;

/** The parts of yt-dlp's full info JSON this plugin reads. */
interface VideoInfo {
  id: string;
  title: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  // YouTube Music metadata, present on "Artist - Topic" uploads and many official ones.
  track?: string;
  artist?: string;
  artists?: string[];
  album?: string;
  // The selected format, when a format was requested.
  url?: string;
  ext?: string;
  filesize?: number;
  filesize_approx?: number;
  http_headers?: Record<string, string>;
}

/** Best identity for a video: YouTube Music's own fields, then the parsed title, then the channel. */
export function identify(info: VideoInfo): ExternalHit {
  const parsed = parseTitle(info.title);
  const channel = info.channel ?? info.uploader ?? '';
  const artist =
    info.artists?.[0] ?? info.artist ?? (isTopic(channel) ? channelArtist(channel) : parsed.artist ?? channelArtist(channel));
  return {
    key: info.id,
    title: info.track || parsed.title || info.title,
    artist: artist || 'Unknown artist',
    ...(info.album ? { album: info.album } : {}),
    ...(info.duration ? { durationS: Math.round(info.duration) } : {}),
    ...(info.thumbnail ? { coverUrl: info.thumbnail } : {}),
  };
}

function source(ctx: PluginContext, yt: Ytdlp): ExternalSource {
  const dl = join(ctx.dataDir, 'dl');
  const num = (k: string, d: number) => {
    const v = Number(ctx.settings.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };

  const info = async (key: string, extra: string[] = []): Promise<VideoInfo> => {
    if (!KEY_RE.test(key)) throw new Error('not a YouTube video id');
    const out = await yt.run(['-J', '--no-playlist', ...extra, watchUrl(key)], { timeoutMs: 45_000 });
    return JSON.parse(out) as VideoInfo;
  };

  /** Staging files from downloads that never made it into the library, cleared after a day. */
  const sweep = async () => {
    const names = await readdir(dl).catch(() => [] as string[]);
    for (const n of names) {
      const f = join(dl, n);
      const s = await stat(f).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 24 * 3600 * 1000) await rm(f, { force: true });
    }
  };

  return {
    id: 'youtube',
    label: 'YouTube',

    async search(q, limit) {
      // Asked for more than will be kept: the ranking drops live sets, loops and karaoke, and
      // needs something left over to choose from.
      // The caller's limit, or the admin's "Results per search" when that is higher — so the
      // setting raises the OpenSubsonic fallback, and a page's See more can still ask for more.
      const want = Math.max(limit, num('maxResults', limit));
      const out = await yt.run(['--flat-playlist', '-J', `ytsearch${Math.max(want * 2, 8)}:${q}`], {
        timeoutMs: 20_000,
      });
      const parsed = JSON.parse(out) as {
        entries?: (SearchEntry & { thumbnails?: { url?: string; width?: number }[] })[];
      };
      const entries = (parsed.entries ?? []).map((e) => {
        const thumb = e.thumbnail ?? bestThumbnail(e.thumbnails);
        return { ...e, ...(thumb ? { thumbnail: thumb } : {}) };
      });
      return rank(entries, q, {
        limit: want,
        minDurationS: num('minDurationS', 60),
        maxDurationS: num('maxDurationS', 900),
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
      const i = await info(key, ['-f', FORMAT]);
      if (!i.url) throw new Error('YouTube offered no audio for that video');
      const size = i.filesize ?? i.filesize_approx;
      return {
        url: i.url,
        mime: i.ext === 'm4a' || i.ext === 'mp4' ? 'audio/mp4' : i.ext === 'webm' ? 'audio/webm' : 'audio/mp4',
        ...(i.http_headers ? { headers: i.http_headers } : {}),
        ...(size ? { sizeBytes: size } : {}),
        ...(expiryOf(i.url) ? { expiresAt: expiryOf(i.url) } : {}),
      };
    },

    async acquire(key, hit) {
      await mkdir(dl, { recursive: true });
      void sweep().catch(() => undefined);
      const meta = await info(key).catch(() => null);
      const who = meta ? identify(meta) : hit;

      // --print after_move:filepath prints the FINAL path, after conversion — which is the only
      // path that exists once yt-dlp has finished, and saves guessing the extension.
      const out = await yt.run(
        [
          '--no-playlist',
          '-f',
          FORMAT,
          '-x',
          '--audio-format',
          'm4a',
          '--embed-metadata',
          '--embed-thumbnail',
          '--no-overwrites',
          '-o',
          join(dl, `${key}.%(ext)s`),
          '--print',
          'after_move:filepath',
          watchUrl(key),
        ],
        { timeoutMs: 10 * 60_000 },
      );
      const file = out.trim().split('\n').filter(Boolean).pop();
      if (!file) throw new Error('yt-dlp finished without saying where the file is');
      await stat(file);
      return {
        file,
        artist: who.artist,
        title: who.title,
        ...(who.album ? { album: who.album } : {}),
      };
    },
  };
}

let shared: Ytdlp | null = null;

const plugin: CratePlugin = {
  id: 'youtube',

  settings: [
    { key: 'maxResults', label: 'Results per search', type: 'number', default: 5, hint: 'At least this many YouTube songs per search — what a Subsonic app gets when the library has none. The web page asks for more when you press See more.' },
    { key: 'minDurationS', label: 'Shortest song (seconds)', type: 'number', default: 60, hint: 'Drops previews, intros and shorts.' },
    { key: 'maxDurationS', label: 'Longest song (seconds)', type: 'number', default: 900, hint: 'Drops full albums, mixes and hour-long loops.' },
  ],

  source(ctx) {
    shared ??= new Ytdlp(ctx.dataDir, ctx.log);
    // Warm it at boot so the first search does not also pay for the install.
    void shared.ready().catch((err: Error) => ctx.log.warn({ err: err.message }, 'youtube: yt-dlp not ready'));
    return source(ctx, shared);
  },

  routes(app, ctx) {
    /** What yt-dlp is doing, for the admin: version, when it last checked, the last error. */
    app.get('/api/youtube/status', async (req, reply) => {
      const c = ctx.need(req, reply);
      if (!c) return;
      if (!c.isAdmin) return reply.code(403).send({ error: 'admin only' });
      shared ??= new Ytdlp(ctx.dataDir, ctx.log);
      return shared.current();
    });

    /** Check for a yt-dlp update now, rather than waiting for the daily check. */
    app.post('/api/youtube/update', async (req, reply) => {
      const c = ctx.need(req, reply);
      if (!c) return;
      if (!c.isAdmin) return reply.code(403).send({ error: 'admin only' });
      shared ??= new Ytdlp(ctx.dataDir, ctx.log);
      await shared.ready();
      await shared.update('asked for by an admin');
      return shared.current();
    });
  },
};

export default plugin;
