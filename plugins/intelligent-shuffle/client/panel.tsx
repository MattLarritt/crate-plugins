import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePlayer } from 'crate/player';
import type { PanelProps } from '../../../types/contract';
import { moodNow, plan, resetMood, vote, type Mood } from './api';
import { getVersion, isActive, playedIds, startSession, stopSession, subscribe } from './session';

/**
 * The DJ window: what is playing, two big buttons, and a read-only glimpse of what is next.
 *
 * Built for the car-stereo test: YES and NO on the playing song, nothing else to learn. The
 * first version also offered votes on the next track and re-dealt the queue on EVERY vote —
 * three controls all mutating the same queue, so "next" changed under you and a skip landed
 * somewhere you had never been shown. It felt random because it was. The rules now:
 *
 *   YES  — the mood is noted; the QUEUE DOES NOT MOVE. A skip goes exactly where "up next"
 *          says. New enthusiasm reaches the speakers through the next top-up, a few tracks
 *          out, which is how a human DJ works a request in too.
 *   NO   — the mood is noted and the unplayed tail re-deals ONCE, visibly. You said "not this
 *          vibe"; the queue changing is the expected answer, and it happens while you watch.
 */

const SOURCE = 'Intelligent Shuffle';
/** How far ahead a re-deal plans. Small on purpose: the mood may move again before track six. */
const TAIL = 5;

export function IntelligentShufflePanel({ onClose, say }: PanelProps) {
  const p = usePlayer();
  useSyncExternalStore(subscribe, getVersion);
  const [mood, setMood] = useState<Mood | null>(null);
  const [busy, setBusy] = useState(false);
  const active = isActive();

  useEffect(() => {
    void moodNow()
      .then((r) => setMood(r.mood))
      .catch(() => setMood(null));
  }, []);

  const next = p.queue[p.index + 1] ?? null;

  /** A fresh tail against the mood as it stands. Only a NO triggers this — see voteOn. */
  const redeal = useCallback(async () => {
    const exclude = [...playedIds(), ...(p.current ? [p.current.trackId] : [])];
    const r = await plan(TAIL, exclude, p.current?.trackId);
    p.replaceUpcoming(r.tracks);
  }, [p]);

  const voteOn = (trackId: number, direction: 'more' | 'less') => {
    setBusy(true);
    void vote(trackId, direction)
      .then(async (r) => {
        setMood(r.mood);
        const what = [r.applied.artist, ...r.applied.genres.slice(0, 2)].join(', ');
        say('good', direction === 'more' ? `More like: ${what}` : `Less like: ${what}`);
        // YES keeps the queue; NO re-deals it. One rule each — see the note above.
        if (direction === 'less') await redeal();
      })
      .catch((e: Error) => say('bad', e.message))
      .finally(() => setBusy(false));
  };

  const start = (seed: boolean) => {
    setBusy(true);
    void (async () => {
      if (seed && p.current) await vote(p.current.trackId, 'more').then((r) => setMood(r.mood));
      const exclude = p.current ? [p.current.trackId] : [];
      const r = await plan(seed || p.current ? TAIL : TAIL + 1, exclude, p.current?.trackId);
      if (!r.tracks.length) {
        say('bad', 'nothing to play — is your library empty?');
        return;
      }
      if (p.current) {
        // Music is playing: the session adopts it as its first track and swaps the tail.
        startSession(p.source);
        p.replaceUpcoming(r.tracks);
      } else {
        startSession(SOURCE);
        p.play(r.tracks, 0, SOURCE);
      }
    })()
      .catch((e: Error) => say('bad', e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="ispanel">
      <div className="ishead">
        <div className="words">
          <div className="t">Intelligent Shuffle</div>
          <div className="s muted">
            {active ? 'listening to your votes' : 'a DJ that learns the room'}
          </div>
        </div>
        {active && (
          <button className="btn sec sm" onClick={() => stopSession()}>
            Stop
          </button>
        )}
        <button className="btn sec sm" onClick={onClose}>
          Close
        </button>
      </div>

      {!active && (
        <div className="isstart">
          <p>
            Two buttons, that&rsquo;s the whole thing: <strong>more like this</strong> or{' '}
            <strong>less like this</strong> on whatever is playing. Yes leans the coming songs
            toward this vibe; no steers away and re-deals the queue. Votes fade over a few
            hours, so it follows tonight&rsquo;s mood, not last week&rsquo;s.
          </p>
          <div className="isstartrow">
            {p.current && (
              <button className="btn" disabled={busy} onClick={() => start(true)}>
                Start from this song
              </button>
            )}
            <button className="btn sec" disabled={busy} onClick={() => start(false)}>
              {p.current ? 'Start fresh' : 'Start shuffling'}
            </button>
          </div>
        </div>
      )}

      {active && (
        <div className="isbody">
          {p.current && (
            <div className="isnow">
              <div className="k muted">Now playing</div>
              <div className="t">{p.current.title}</div>
              <div className="s muted">
                {p.current.artistName}
                {p.current.albumTitle ? ` · ${p.current.albumTitle}` : ''}
              </div>
              {/* The whole control surface: yes or no, thumb-sized. */}
              <div className="isbig">
                <button
                  className="isyes"
                  disabled={busy}
                  onClick={() => voteOn(p.current!.trackId, 'more')}
                >
                  <span className="mark">↑</span>
                  More like this
                </button>
                <button
                  className="isno"
                  disabled={busy}
                  onClick={() => voteOn(p.current!.trackId, 'less')}
                >
                  <span className="mark">↓</span>
                  Less like this
                </button>
              </div>
            </div>
          )}

          {/* Read-only on purpose: next is a promise the skip button keeps. Voting on it was
              a second steering wheel, and the car only needs one. */}
          <div className="isnext muted">
            {next ? (
              <>
                <span className="k">Up next</span> {next.title} — {next.artistName}
              </>
            ) : (
              <span className="k">finding what's next…</span>
            )}
          </div>

          {mood && (mood.into.length > 0 || mood.outOf.length > 0) && (
            <div className="ismood">
              {mood.into.length > 0 && (
                <div className="isrow">
                  <span className="k muted">Leaning into</span>
                  {mood.into.map((e) => (
                    <span key={`${e.kind}:${e.label}`} className="ischip in">
                      {e.label}
                    </span>
                  ))}
                </div>
              )}
              {mood.outOf.length > 0 && (
                <div className="isrow">
                  <span className="k muted">Steering away</span>
                  {mood.outOf.map((e) => (
                    <span key={`${e.kind}:${e.label}`} className="ischip out">
                      {e.label}
                    </span>
                  ))}
                </div>
              )}
              <button
                className="btn sec sm"
                disabled={busy}
                onClick={() => {
                  void resetMood().then(() => {
                    setMood({ into: [], outOf: [] });
                    say('good', 'Mood cleared — open mind');
                  });
                }}
              >
                Forget the mood
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
