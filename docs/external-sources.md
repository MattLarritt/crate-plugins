# Writing an external source

[← crate-plugins](../README.md) · [Writing a plugin](writing-a-plugin.md)

An external source is a place songs can come from that isn't the library. The
[YouTube plugin](plugins/youtube.md) is one. A source makes a song you don't own **play
straight away** — in the web search, and through OpenSubsonic, so a phone app or a voice
request just plays it — and, if the listener wants it, **lands it in the library** like any
other import.

Requires a crate with external sources (crate's `src/lib/external.ts`).

## The split

The plugin answers four questions. crate does everything a listener or a client can see.

| The plugin | crate |
|---|---|
| **search** — what songs match this? | ids, auth, ownership |
| **describe** — what is this one? | streaming: Range, transcoding, stale URLs |
| **resolveStream** — where is its audio right now? | when search falls back to a source |
| **acquire** — fetch it to a file | when a song is kept, the download queue, the daily caps |
| | the import: fingerprint, dedupe, file it, add it to the library |

So a source never serves HTTP to a client, never decides whether something is kept, and never
writes to the library itself.

## The interface

A plugin becomes a source by adding `source(ctx)` to its `CratePlugin`
([`types/contract.ts`](../types/contract.ts)):

```ts
source(ctx) {
  return {
    id: 'example',        // [a-z0-9]+ — part of every song id. Never change it.
    label: 'Example',     // how the web search heads this source's section

    async search(q, limit) {
      // Up to `limit` songs, best first. Return [] rather than throwing on nothing found.
      return [{ key: 'abc123', title: 'Song', artist: 'Artist', durationS: 200 }];
    },

    async describe(key) {
      // One song by its key, or null if it no longer exists.
      return { key, title: 'Song', artist: 'Artist' };
    },

    async resolveStream(key) {
      // Where the audio is right now. crate proxies it; it is never handed to a client.
      return {
        url: 'https://…',
        mime: 'audio/mp4',
        headers: {},           // any headers the far end needs
        sizeBytes: 3_200_000,  // if known — some clients need a Content-Length
        expiresAt: 1790000000, // epoch seconds, if the URL expires
      };
    },

    async acquire(key, hit) {
      // Fetch the song to a file under ctx.dataDir and say what it is. crate MOVES the file
      // into the library afterwards.
      return { file: `${ctx.dataDir}/dl/${key}.m4a`, artist: hit.artist, title: hit.title };
    },
  };
}
```

A source can also read **playlists**: add `playlist(url)`, returning `{ title, hits }` in order —
or `null` when the link isn't one of yours, so another source can try it. crate then offers
**Import playlist from <label>** on the Playlists page, makes the playlist, adds what the library
already has, and keeps the rest through `acquire`, each landing in its place.

`ExternalHit` fields: `key` (your own id for the song), `title`, `artist`, and optionally
`album`, `durationS`, `coverUrl` (proxied by crate) and `score`.

`acquire` may also return `albumArtist`, `trackNo`, `year` and `genre`, and `retag: true` to have
crate write the final identity into the file's own tags before filing it — which a source should
almost always ask for, since a downloaded file carries the source's tags, not the song's. To name
a song better than your own parsing can, `ctx.ai?.identifySong(...)` asks crate's AI with the
evidence you have; it returns null when it isn't sure.

## What crate does with it

**Ids.** A song is `x-<source>-<key>` everywhere — the web app, OpenSubsonic, playlists. Once a
song is kept, that id *is* the library track: every endpoint resolves it to the file, so an id a
client cached keeps working.

**Search.** The web search shows each source in its own section, after the library. OpenSubsonic
`search2`/`search3` fall back to sources only when the library has no match for a real query —
after a word-by-word match, so "song 2 by blur" still finds the copy you own — never for an
empty query (how clients sync), never past the first page, and never when the client asked for
no songs.

**Songs known by name.** Wherever the web page shows a song the library doesn't hold — a
Discover tile, an album's tracklist, a playlist entry — it offers a play button for a source's
copy. crate searches every enabled source for `artist title` and takes the first hit that is
*surely* that song: every word of the title and the artist, not a live take, cover or remix
unless one was asked for, and a similar length. Otherwise it offers nothing. Your `search`
needs nothing extra for this — but clean `artist` and `title` fields are what let a hit pass.

**Streaming.** crate resolves the stream once per song however many requests arrive together,
caches the URL until shortly before `expiresAt`, and resolves again once if the far end refuses a
stale one. Clients asking for a format or a bitrate get a live transcode from the URL. The
players, and search, ask for the next likely song's stream ahead of time, so a slow
`resolveStream` is paid before anyone presses play.

**Keeping.** A song is kept when somebody asks — the song's ⋯ menu, the player's download button,
or a star in a Subsonic app — or, for listeners who turn it on in Preferences, after thirty
seconds of listening. Keeps count against crate's daily download cap. `acquire` runs one at a
time, retried once on failure; the file is fingerprinted, deduplicated against the library, and
filed under `Artist/Album` (album `Singles` when there is none).

**Switching off.** A disabled source offers nothing and plays nothing it offered before. Songs
already kept stay in the library, and their ids keep working.

## Guidance

- **Serve AAC (m4a) if you can.** iOS's AVPlayer — which almost every iPhone client plays
  through — cannot decode Opus or WebM at all.
- **Keep `search` fast and safe to fail.** crate abandons a search that takes over twenty seconds,
  and a source that throws is treated as having found nothing.
- **Validate keys.** A key reaches `describe`, `resolveStream` and `acquire` from a URL; reject
  anything that isn't the shape your source issues before using it.
- **Tools go in `ctx.dataDir`.** crate's image carries nothing extra for you; install and update
  what you need there. See how the YouTube plugin manages `yt-dlp`.
- **Your ranking matters most.** For a voice request, the first result is the one that plays.
