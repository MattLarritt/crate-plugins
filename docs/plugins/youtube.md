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

## Settings

On the plugin's row in **Admin → Plugins**:

| Setting | Default | |
|---|---|---|
| Results per search | 5 | At least this many songs per search — what a Subsonic app gets when the library has none. The web page asks for more on See more. |
| Shortest song (seconds) | 60 | Drops previews, intros and shorts. |
| Longest song (seconds) | 900 | Drops full albums, mixes and hour-long loops. |

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

- crate with external sources (in crate since the external-sources release).
- Outbound HTTPS to `github.com` (install and updates) and to YouTube.

## Please note

Downloading from YouTube may be against YouTube's Terms of Service. This plugin is meant for
personal use on your own server; what you do with it is up to you.
