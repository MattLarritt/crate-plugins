/**
 * Choosing which YouTube result is the song, and what it is called.
 *
 * YouTube search is tuned for watching, not listening: for "song 2 blur" it will happily put a
 * live set, a reaction video, a karaoke track or a 10-hour loop ahead of the recording. For a
 * voice request that matters more than anything else in this plugin, because the FIRST result
 * is the one that plays — nobody is going to pick from a list while driving.
 *
 * So the ranking below prefers, in order:
 *
 *   1. "Artist - Topic" channels. These are YouTube Music's auto-generated uploads of the
 *      actual release: the studio recording, audio only, with clean title metadata. When one
 *      exists it is almost always the right answer.
 *   2. Official audio, then official videos (which sometimes have skits or intros).
 *   3. Everything else, in YouTube's own order.
 *
 * and penalises versions nobody asked for — unless they did ask: "song 2 live" should still
 * find the live version. Everything here is pure, so it is tested against fixtures rather than
 * against YouTube.
 */

export interface SearchEntry {
  id: string;
  title: string;
  channel?: string;
  uploader?: string;
  duration?: number | null;
  thumbnail?: string;
}

export interface RankedHit {
  key: string;
  title: string;
  artist: string;
  durationS?: number;
  coverUrl?: string;
  score: number;
}

/** Words that mean "not the recording", each with how hard it is penalised. */
const UNWANTED: [RegExp, string, number][] = [
  [/\bkaraoke\b/i, 'karaoke', 30],
  [/\breaction\b|\breacts?\b/i, 'reaction', 30],
  [/\b(?:\d+\s*)?hours?\b|\b1h\b|\bloop\b/i, 'hour', 30],
  [/\btutorial\b|\blesson\b|\bhow to play\b/i, 'tutorial', 30],
  [/\bnightcore\b/i, 'nightcore', 25],
  [/\bslowed\b|\bsped up\b|\breverb\b/i, 'slowed', 25],
  [/\b8d\b/i, '8d', 25],
  [/\bcover\b/i, 'cover', 18],
  [/\blive\b|\bconcert\b|\bperformance\b/i, 'live', 15],
  [/\binstrumental\b/i, 'instrumental', 15],
  [/\bremix\b|\bmix\b/i, 'remix', 12],
  [/\bacoustic\b/i, 'acoustic', 8],
  [/\blyrics?\b/i, 'lyric', 3],
];

/**
 * Clean a video title into a song title, and pull out an artist if the title carries one.
 *
 * "Blur - Song 2 (Official Music Video) [HD]" → { artist: 'Blur', title: 'Song 2' }.
 * Bracketed noise goes only when it is noise — "(feat. Someone)" and "(Remastered 2012)" say
 * something about the recording and are left alone.
 */
export function parseTitle(raw: string): { artist: string | null; title: string } {
  const noise =
    /\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|m\/v|explicit|clean)\b[^)\]]*)[)\]]\s*/gi;
  let t = raw.replace(noise, ' ').replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim();
  // Trailing "Official Video" without brackets, which some uploaders use.
  t = t.replace(/\s+(?:official\s+(?:music\s+)?(?:video|audio)|lyric\s+video|audio)$/i, '').trim();
  const dash = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { artist: dash[1]!.trim(), title: dash[2]!.trim() };
  return { artist: null, title: t };
}

/** "Blur - Topic" → "Blur"; "BlurVEVO" → "Blur"; anything else unchanged. */
export function channelArtist(channel: string): string {
  return channel
    .replace(/\s+-\s+Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s+(?:official|music)$/i, '')
    .trim();
}

export const isTopic = (channel: string | undefined): boolean => /\s+-\s+Topic$/i.test(channel ?? '');

/**
 * The best few results, best first.
 *
 * `q` is what was asked for; a penalty is waived when the query itself contains the word, so
 * asking for the live version gets it. Length limits drop previews, intros and hour-long
 * compilations outright rather than merely ranking them low.
 */
export function rank(
  entries: SearchEntry[],
  q: string,
  opts: { limit: number; minDurationS: number; maxDurationS: number },
): RankedHit[] {
  const asked = q.toLowerCase();
  const scored: RankedHit[] = [];
  entries.forEach((e, i) => {
    if (!e.id || !e.title) return;
    const d = e.duration ?? null;
    if (d !== null && (d < opts.minDurationS || d > opts.maxDurationS)) return;

    const channel = e.channel ?? e.uploader ?? '';
    // YouTube's own order is worth something, but only a little — it is watch-ranked.
    let score = (entries.length - i) * 2;
    if (isTopic(channel)) score += 40;
    if (/official\s+audio/i.test(e.title)) score += 15;
    else if (/official\s+(?:music\s+)?video/i.test(e.title)) score += 8;
    if (/vevo$/i.test(channel)) score += 6;
    for (const [re, word, penalty] of UNWANTED) {
      if (re.test(e.title) && !asked.includes(word)) score -= penalty;
    }

    const parsed = parseTitle(e.title);
    // A Topic channel IS the artist. Otherwise trust "Artist - Title" over the channel name,
    // because a label or fan channel is not the artist.
    const artist = isTopic(channel) ? channelArtist(channel) : parsed.artist ?? channelArtist(channel);
    scored.push({
      key: e.id,
      title: parsed.title || e.title,
      artist: artist || 'Unknown artist',
      ...(d !== null ? { durationS: Math.round(d) } : {}),
      ...(e.thumbnail ? { coverUrl: e.thumbnail } : {}),
      score,
    });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, opts.limit);
}

/** yt-dlp's thumbnail list for a flat search entry, reduced to the one worth showing. */
export function bestThumbnail(thumbs: { url?: string; width?: number }[] | undefined): string | undefined {
  if (!thumbs?.length) return undefined;
  // Square-ish art reads best in a song row; the widest one under ~500px is plenty and small.
  const usable = thumbs.filter((t) => t.url);
  const sized = usable.filter((t) => (t.width ?? 0) > 0 && (t.width ?? 0) <= 500);
  const pick = (sized.length ? sized : usable).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return pick?.url;
}

/** When a googlevideo-style URL stops working, from its expire= parameter. */
export function expiryOf(url: string): number | undefined {
  try {
    const v = new URL(url).searchParams.get('expire');
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}
