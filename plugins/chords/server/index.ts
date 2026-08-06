import type Database from 'better-sqlite3';
import type { CratePlugin } from '../../../types/contract.js';
import { MAX_SHEET_BYTES, ChordSheets } from './store.js';
import { parseSheet } from './chordsheet.js';
import { fetchUgTab, isUgUrl } from './ultimateguitar.js';

/**
 * Chord sheets: somebody's own chords and notes for a song, on the play bar.
 *
 * The first plugin, and the reason the plugin system exists — this feature used to touch eight
 * shared files in twenty-five places. Everything it is lives in this folder now: the store, the
 * parser that decides where every chord sits, the Ultimate Guitar importer, and the routes.
 *
 * Private without exception: every handler reads c.id and passes it to a store whose statements
 * are all scoped by user, so there is no route here that could serve one person's sheet to
 * another. Two people with the same track have two unrelated sheets.
 *
 * The server hands back the SOURCE plus a parse of it. Parsing on the server rather than in the
 * client because the parser is the interesting half, and one implementation that both the panel
 * and anything later share beats two that drift.
 */
const chordsPlugin: CratePlugin = {
  id: 'chords',

  migrate(db: Database.Database): void {
    db.exec(`
      -- Chord sheets and notes, one per person per song.
      --
      -- PRIVATE, and structurally so: the primary key leads with user_id and every statement that
      -- touches this table is scoped by it, so there is no query shape that could return one
      -- person's sheet to another. That is not decoration — somebody's working notes on a song
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

  routes(app, ctx): void {
    const { userlib, need } = ctx;
    const chords = new ChordSheets(ctx.db);

    /** A sheet, parsed and ready to lay out. 200 with an empty body when nothing is written yet. */
    app.get('/api/track/:trackId/chords', async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: 'a token caller has no chord sheets' });
      const trackId = Number((req.params as { trackId: string }).trackId);
      if (!userlib.byId(trackId)) return reply.code(404).send({ error: 'no such track' });

      const sheet = chords.get(c.id, trackId);
      // Not a 404 when absent: "you have not written this yet" is the normal first answer, and
      // the panel opens on an empty editor rather than on an error.
      if (!sheet) return { body: '', sourceUrl: '', shapes: {}, tuning: '', capo: '', parsed: null };
      return { ...sheet, parsed: parseSheet(sheet.body) };
    });

    /**
     * Save a sheet — or import one, when the first line is an Ultimate Guitar URL.
     *
     * The import lives here rather than behind its own endpoint because it is the same gesture:
     * somebody puts something in the box and saves. Pasting a URL is a shorter way of typing a
     * sheet out, so it produces the same result — their own private copy of the text, which they
     * can then edit like anything else they wrote.
     *
     * A failed import is reported and nothing is saved. The alternative — storing the URL as the
     * sheet body — would silently throw away the paste and show them a one-line "song" whose only
     * lyric is a link.
     */
    app.put('/api/track/:trackId/chords', async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: 'a token caller has no chord sheets' });
      const trackId = Number((req.params as { trackId: string }).trackId);
      if (!userlib.byId(trackId)) return reply.code(404).send({ error: 'no such track' });

      const raw = String((req.body as { body?: unknown } | undefined)?.body ?? '');
      if (Buffer.byteLength(raw, 'utf-8') > MAX_SHEET_BYTES) {
        return reply.code(413).send({ error: 'that is longer than a chord sheet — 128 KB is the limit' });
      }

      // Empty means "I am done with this": stored emptiness is a sheet that reads as a bug.
      if (!raw.trim()) {
        chords.remove(c.id, trackId);
        return { body: '', sourceUrl: '', shapes: {}, tuning: '', capo: '', parsed: null };
      }

      const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? '';
      if (isUgUrl(firstLine)) {
        let tab;
        try {
          tab = await fetchUgTab(firstLine, ctx.http.getText);
        } catch (err) {
          // The message from the importer, which is written to be read by a person: "that page has
          // no chord sheet on it" rather than a status code.
          return reply.code(502).send({ error: (err as Error).message });
        }
        chords.save(c.id, trackId, {
          body: tab.content,
          sourceUrl: tab.url,
          shapes: tab.shapes,
          tuning: tab.tuning,
          capo: tab.capo,
        });
        const saved = chords.get(c.id, trackId)!;
        return {
          ...saved,
          parsed: parseSheet(saved.body),
          imported: { artist: tab.artist, song: tab.song, kind: tab.kind },
        };
      }

      /*
       * Hand-typed. The shapes and the tuning from an earlier import are deliberately NOT kept:
       * once somebody has rewritten the sheet themselves, chord shapes attributed to a page they
       * no longer resemble are worse than none, and the client's own dictionary covers the
       * ordinary chords. Re-importing is one paste away.
       */
      chords.save(c.id, trackId, { body: raw });
      const saved = chords.get(c.id, trackId)!;
      return { ...saved, parsed: parseSheet(saved.body) };
    });

    app.delete('/api/track/:trackId/chords', async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: 'a token caller has no chord sheets' });
      chords.remove(c.id, Number((req.params as { trackId: string }).trackId));
      return { ok: true };
    });

    /** Everything this person has written, for the profile page. */
    app.get('/api/chords', async (req, reply) => {
      const c = need(req, reply);
      if (!c) return;
      if (!c.id) return reply.code(400).send({ error: 'a token caller has no chord sheets' });
      return {
        sheets: chords.mine(c.id).map((s) => ({
          trackId: s.trackId,
          title: s.title,
          artistName: s.artistName,
          albumTitle: s.albumTitle,
          durationS: s.durationS,
          sourceUrl: s.sourceUrl,
          updatedAt: s.updatedAt,
          lines: s.body.split('\n').length,
        })),
      };
    });
  },
};

export default chordsPlugin;
