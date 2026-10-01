# YouTube

[← crate-plugins](../../README.md) · [Writing an external source](../external-sources.md)

When a song isn't in your library, find it on YouTube and play it straight away. Keep the ones
you want and they're downloaded into your library like any other import.

**Plugin id** `youtube` · **Has** a server half only — crate draws everything itself ·
**Requires** a crate with external sources

## What you'll see

- **Web search** gets a **YouTube** section between your library and MusicBrainz: three songs,
  and **See more** for the rest (then up to fifteen). Press play and it plays.
- **OpenSubsonic clients** — phone apps, car stereos, voice assistants — get YouTube songs in
  their search results *only when your library has no match*. So "play Song 2 by Blur" plays
  your copy when you have one, and still plays something when you don't. An empty search, which
  is how clients sync, never goes to YouTube.
- A YouTube song plays like any other: seek, skip, transcode for a client that asks for MP3.

## Keeping a song

A song is added to your library when you ask:

- **Add to library** in the song's ⋯ menu (web search),
- the **download button** in the player while it's streaming,
- or **starring** it in a Subsonic app — the one "keep this" gesture every phone client has.

Or automatically: turn on **Preferences → Add songs from YouTube to my library after I've
listened for 30 seconds**. It is **off by default**, per person. When on, a skip within thirty
seconds (starting any other song) is not a keep.

A kept song is downloaded, fingerprinted, checked against the library (a copy you already own is
reused, not duplicated) and filed as `Artist/Album/Title.m4a` — album `Singles` when YouTube
doesn't name one. Keeps count against crate's daily download cap. From then on it is a library
track, and any client that cached its YouTube id gets the library file.

## Importing a playlist

**Playlists → Import playlist from YouTube** takes a YouTube or YouTube Music playlist link —
`https://music.youtube.com/playlist?list=…` or `https://www.youtube.com/playlist?list=…` — and
makes a crate playlist of the same name, in the same order:

- songs already on the server go straight in (and into your library),
- the rest are kept, one at a time, and each joins the playlist **in its place** as it lands —
  a hundred-song playlist fills in over a while, not all at once,
- keeps count against the daily download cap; over it, the rest are left out and you're told
  how many.

Removed and private videos in the playlist are skipped.

## Naming and tags

A video is titled for viewers — "Blur - Song 2 (Official Music Video) [HD]" on a channel called
"Blur - Topic" — and that is what yt-dlp writes into the file. So before a kept song is filed,
crate **writes the song's real identity into the file's own tags**: artist, title, album, album
artist, track number, year and genre. Every other player that reads the file then sees the
song, not the video.

Where that identity comes from, best first:

1. **AcoustID**, if crate has a key: a confident audio fingerprint names the recording outright.
2. **AI**, if **Allow AI to cleanup and retag tracks downloaded from YouTube** is on and crate has
   an OpenAI key (Admin → Integrations). The model names the song from the video's title,
   channel and description, and crate checks the answer against them — a name that appears
   nowhere in the video's own details is refused, and anything the model isn't sure of stays
   empty rather than guessed.
3. **The plugin's own reading**: YouTube Music's track fields when the video has them, otherwise
   the title with the video noise removed, plus the release year and track number YouTube states.

## Settings

On the plugin's row in **Admin → Plugins**:

| Setting | Default | |
|---|---|---|
| Results per search | 5 | At least this many songs per search — what a Subsonic app gets when the library has none. The web page asks for more on See more. |
| Shortest song (seconds) | 60 | Drops previews, intros and shorts. |
| Longest song (seconds) | 900 | Drops full albums, mixes and hour-long loops. |
| Allow AI to cleanup and retag tracks downloaded from YouTube | off | Names each kept song with AI before it is tagged and filed. Uses crate's OpenAI key. Off, the plugin tidies the title itself; either way the file is retagged. |

## Which result plays

For a voice request, the first result is the one that plays, so ranking matters more than
anything else here. In order:

1. **"Artist - Topic" uploads** — YouTube Music's own copies of the release: the studio
   recording, audio only, clean titles.
2. **Official audio**, then official videos.
3. Everything else, in YouTube's order.

Live sets, covers, karaoke, remixes, slowed or sped-up edits, 8D, reactions, lessons and
lyric videos are pushed down — **unless your search asked for them**: "song 2 live" still finds
the live version. Channels and playlists are never offered as songs.

## Audio

AAC in an M4A container, the best YouTube offers without a Premium account (about 128 kbps),
copied as-is — no re-encoding. Not Opus, although YouTube has it: iOS's AVPlayer, which almost
every iPhone client plays through, cannot decode Opus at all.

## yt-dlp

The plugin manages its own copy of [yt-dlp](https://github.com/yt-dlp/yt-dlp); nothing is added
to crate's image.

- **Installed on first use** from yt-dlp's official GitHub release (the musl build for x86-64 or
  arm64), and **checked against the release's published SHA-256 checksums** before it ever runs.
- **Updated daily**, and straight away after an error that looks like YouTube changing, at most
  once an hour — a copy that isn't kept current stops working quietly.
- Runs with crate's own Node as its JavaScript runtime, which recent yt-dlp needs for YouTube.

It lives in `/data/plugin-data/youtube/` (`bin/`, `cache/`, and `dl/` for downloads in progress,
cleared after a day). Admins can see its version and last error at `GET /api/youtube/status`,
and check for an update now with `POST /api/youtube/update`.

## Needs

- crate with external sources (in crate since the external-sources release). Writing tags and the
  AI naming need a crate new enough to offer them; on an older one, songs are kept with
  YouTube's tags, as before.
- Outbound HTTPS to `github.com` (install and updates) and to YouTube.

## Please note

Downloading from YouTube may be against YouTube's Terms of Service. This plugin is meant for
personal use on your own server; what you do with it is up to you.
