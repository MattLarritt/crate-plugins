import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePlayer } from 'crate/player';
import type { PanelProps } from '../../../types/contract';
import { moodNow, plan, resetMood, vote, type Mood, type PlannedTrack } from './api';
import { getVersion, isActive, playedIds, startSession, stopSession, subscribe } from './session';

/**
 * The DJ window: what is playing, what is next, and the two buttons that steer everything.
 *
 * The design rule is that every vote reshapes the FUTURE and never interrupts the present —
 * "less like this" does not skip the song (the skip button is right there if you mean that),
 * it re-deals everything after it. The one exception is vetoing the NEXT track, whose whole
 * point is that it never reaches the speakers.
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

  /** A fresh tail against the mood as it stands, keeping `keep` (a just-approved next) first. */
  const redeal = useCallback(
    async (keep?: PlannedTrack | null) => {
      const exclude = [
        ...playedIds(),
        ...(p.current ? [p.current.trackId] : []),
        ...(keep ? [keep.trackId] : []),
      ];
      const r = await plan(TAIL, exclude);
      p.replaceUpcoming(keep ? [keep, ...r.tracks] : r.tracks);
    },
    [p],
  );

  const voteOn = (trackId: number, direction: 'more' | 'less', keepNext?: boolean) => {
    setBusy(true);
    void vote(trackId, direction)
      .then(async (r) => {
        setMood(r.mood);
        const what = [r.applied.artist, ...r.applied.genres.slice(0, 2)].join(', ');
        say('good', direction === 'more' ? `More like: ${what}` : `Less like: ${what}`);
        // The mood moved, so everything not yet played is re-dealt against the new mood.
        await redeal(keepNext && next ? next : null);
      })
      .catch((e: Error) => say('bad', e.message))
      .finally(() => setBusy(false));
  };

  const start = (seed: boolean) => {
    setBusy(true);
    void (async () => {
      if (seed && p.current) await vote(p.current.trackId, 'more').then((r) => setMood(r.mood));
      const exclude = p.current ? [p.current.trackId] : [];
      const r = await plan(seed || p.current ? TAIL : TAIL + 1, exclude);
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
            Press play and vote. <strong>More like this</strong> and{' '}
            <strong>less like this</strong> nudge the artist, the album and the genres of what
            is playing — and the queue re-deals itself around your votes. The effect fades over
            a few hours, so it follows tonight&rsquo;s mood, not last week&rsquo;s.
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
            <div className="iscard now">
              <div className="k muted">Now playing</div>
              <div className="t">{p.current.title}</div>
              <div className="s muted">
                {p.current.artistName}
                {p.current.albumTitle ? ` · ${p.current.albumTitle}` : ''}
              </div>
              <div className="isvotes">
                <button
                  className="btn isvote more"
                  disabled={busy}
                  onClick={() => voteOn(p.current!.trackId, 'more')}
                >
                  More like this
                </button>
                <button
                  className="btn sec isvote less"
                  disabled={busy}
                  onClick={() => voteOn(p.current!.trackId, 'less')}
                >
                  Less like this
                </button>
              </div>
            </div>
          )}

          <div className="iscard next">
            <div className="k muted">Up next</div>
            {next ? (
              <>
                <div className="t">{next.title}</div>
                <div className="s muted">
                  {next.artistName}
                  {next.albumTitle ? ` · ${next.albumTitle}` : ''}
                </div>
                <div className="isvotes">
                  {/* Approving next locks it in place; the rest of the tail still re-deals. */}
                  <button
                    className="btn sec isvote more"
                    disabled={busy}
                    onClick={() => voteOn(next.trackId, 'more', true)}
                  >
                    Good pick
                  </button>
                  {/* The veto: the one vote that changes the present, because "next" has not
                      happened yet — it is replaced before it ever reaches the speakers. */}
                  <button
                    className="btn sec isvote less"
                    disabled={busy}
                    onClick={() => voteOn(next.trackId, 'less')}
                  >
                    Not this one
                  </button>
                </div>
              </>
            ) : (
              <div className="s muted">finding something…</div>
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
