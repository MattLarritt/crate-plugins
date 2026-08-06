import { useCallback, useEffect, useState } from 'react';
import { usePlayer } from 'crate/player';
import { requestPanel } from 'crate/plugins';
import type { Say } from '../../../types/contract';
import { deleteChords, myChords, type ChordSheetListing } from './api';

/**
 * Everything this person has written chords or notes for.
 *
 * The panel itself only opens from the play bar, which is right when you are playing along and
 * wrong when you are looking for the thing you wrote last week. So this exists to answer "what
 * have I got?", and a row does the whole gesture: it starts the song AND asks for the sheet,
 * because nobody opens their chord sheet in silence.
 */
export function ChordSheetsPane({ say }: { say: Say }) {
  const p = usePlayer();
  const [sheets, setSheets] = useState<ChordSheetListing[] | 'loading'>('loading');

  const load = useCallback(() => {
    myChords()
      .then((r) => setSheets(r.sheets))
      .catch((e: Error) => {
        setSheets([]);
        say('bad', e.message);
      });
  }, [say]);
  useEffect(load, [load]);

  if (sheets === 'loading') return <div className="spinner">Finding what you have written…</div>;
  if (!sheets.length) {
    return (
      <p className="muted">
        Nothing yet. Play a song, press the guitar on the player, and either type the chords or
        paste an Ultimate Guitar link. Only you can see what you write.
      </p>
    );
  }

  return (
    <div className="sheetlist">
      {sheets.map((s) => (
        <div key={s.trackId} className="sheetrow">
          <button
            type="button"
            className="words"
            title="Play this and open the chords"
            onClick={() => {
              requestPanel('chords');
              p.play(
                [
                  {
                    trackId: s.trackId,
                    title: s.title,
                    artistName: s.artistName,
                    albumTitle: s.albumTitle,
                    durationS: s.durationS,
                  },
                ],
                0,
                'your chord sheets',
              );
            }}
          >
            <span className="t">{s.title}</span>
            <span className="s muted">
              {s.artistName}
              {s.sourceUrl ? ' · from Ultimate Guitar' : ' · your own notes'}
              {` · ${s.lines} line${s.lines === 1 ? '' : 's'}`}
            </span>
          </button>
          <button
            className="btn sec sm"
            title="Delete this sheet"
            onClick={() => {
              void deleteChords(s.trackId)
                .then(() => {
                  say('good', `Removed your chords for ${s.title}`);
                  load();
                })
                .catch((e: Error) => say('bad', e.message));
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
