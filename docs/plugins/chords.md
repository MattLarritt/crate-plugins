# Chords & notes

[← crate-plugins](../../README.md)

Chord sheets and tabs for your songs, on crate's player. Play a song, press the guitar on the
play bar, and either paste an Ultimate Guitar link or type the chords yourself.

**Plugin id** `chords` · **Has** a server half and a client half · **Settings** none

## Using it

- **Import.** Open the panel for a song, press **Edit**, paste an Ultimate Guitar tab link on the
  first line and **Save**. crate fetches the tab, keeps the chord shapes the tabber chose, and
  remembers where it came from (credited in the panel's header).
- **Write your own.** Type chords above the words in plain columns, the way chord sheets are
  usually written — the parser works out which line is chords and where each one sits.
- **Your notes are yours.** Every sheet belongs to one person and one song. Two people who both
  own a track have two unrelated sheets; there is no sharing and no route that could show one
  person's sheet to another.
- **Everything you've written** is listed under **Profile → Chords & notes**.

## Reading it

A chord sheet on a screen is usually one endless column scrolled with a hand that is holding a
guitar. This one is set like sheet music on a stand instead:

- **Columns, paged sideways.** The sheet flows into columns and turns a page at a time — with
  **Back / Next**, or the arrow keys, Page Up / Page Down and Space.
- **Chords sit over their syllable** at any size: the layout is by character column in a
  monospace face.
- **Chord diagrams** across the top, down the left, or off; **guitar** or **ukulele** (GCEA).
  Hover a chord in the sheet to see its shapes.
- **Transpose** with ♭ / ♯. It is capo-aware — a sheet written with a capo keeps making sense.
- **Type size** and **column count** (or Auto) are remembered.
- **About this tab** shows the tabber's own notes that came with an import.

On a phone the sheet becomes one scrolling column with the controls out of the way; the
diagrams slide aside as you scroll down and come back as you scroll up.

## Where it keeps things

One table in crate's database, `chord_sheets`, one row per person per song: the sheet as
written, the source link, the imported chord shapes, tuning and capo. The text is stored, not a
parse of it, so improvements to the parser apply to every sheet you already have. Uninstalling
keeps the table.

## Routes

| | |
|---|---|
| `GET /api/track/:trackId/chords` | Your sheet for a song, with its parse |
| `PUT /api/track/:trackId/chords` | Save — or import, when the first line is an Ultimate Guitar link |
| `DELETE /api/track/:trackId/chords` | Remove your sheet for a song |
| `GET /api/chords` | Every sheet you have |

All of them are signed-in and scoped to the caller.

## Notes

- The importer reads Ultimate Guitar's page structure. If Ultimate Guitar changes it, imports
  stop working until the plugin is updated; sheets you already have are unaffected.
