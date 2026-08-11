import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePlayer } from 'crate/player';
import type { PanelProps } from '../../../types/contract';
import { moodNow, plan, resetMood, saveMoodPlaylist, vote, type Ghost, type Mood } from './api';
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
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [busy, setBusy] = useState(false);
  const active = isActive();

  useEffect(() => {
    void moodNow()
      .then((r) => {
        setMood(r.mood);
        if (r.ghost !== undefined) setGhost(r.ghost);
        setGhost(r.ghost ?? null);
      })
      .catch(() => setMood(null));
  }, []);

  const next = p.queue[p.index + 1] ?? null;

  /** A fresh tail against the mood as it stands. Only a NO triggers this — see voteOn. */
  const redeal = useCallback(async () => {
    const exclude = [...playedIds(), ...(p.current ? [p.current.trackId] : [])];
    const r = await plan(TAIL, exclude, p.current?.trackId, exclude);
    p.replaceUpcoming(r.tracks);
  }, [p]);

  const voteOn = (trackId: number, direction: 'more' | 'less') => {
    setBusy(true);
    void vote(trackId, direction)
      .then(async (r) => {
        setMood(r.mood);
        // Artist, a genre or two, the decade and the energy: the vote's reach in one line.
        const what = [
          r.applied.artist,
          ...r.applied.genres.slice(0, 2),
          ...(r.applied.era ? [r.applied.era] : []),
          ...(r.applied.energy ? [`${r.applied.energy} energy`] : []),
        ].join(', ');
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
      /*
       * The ghost starts on the song we started from, when there is one. Deliberately not at 0.5
       * everywhere: that is the least distinctive point in the library, so a DJ seeded there opens
       * with the most forgettable music somebody owns.
       */
      const r = await plan(
        seed || p.current ? TAIL : TAIL + 1,
        exclude,
        p.current?.trackId,
        exclude,
        p.current?.trackId,
      );
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
              {/*
                * Skip: move on, no opinion. Deliberately NOT a third vote — "less like this"
                * already means "not this vibe" and re-deals the queue, so a listener who only
                * wants the next song had to either lie to the DJ or reach past the panel to the
                * play bar. This is the neutral option those two were missing, which is why it
                * is quieter than the pair above it rather than a third big button.
                *
                * userInitiated: true so the core reports it as a SKIP rather than a play. A
                * silent skip would otherwise look like a song you sat through, and the DJ reads
                * the play log.
                */}
              <button className="isskip" disabled={busy} onClick={() => p.next(true)}>
                <span className="mark">↦</span>
                Skip
              </button>
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

          {/*
            * What the ghost wants, when it has enough evidence to want anything. Shown as
            * "more/less <dimension>" rather than as numbers, because the useful reading is the
            * DIRECTION — and the share is stated plainly so a ghost that exists but is not yet
            * steering does not look like it is.
            */}
          {ghost && ghost.wants.length > 0 && ghost.say > 0 && (
            <div className="ismood">
              <div className="isrow">
                <span className="k muted">Sounds like</span>
                {ghost.wants.map((wd) => (
                  <span key={wd.key} className={`ischip ${wd.high ? 'in' : 'out'}`}>
                    {wd.high ? '' : 'less '}
                    {wd.key.replace(/_/g, ' ')}
                  </span>
                ))}
                <span className="k muted">
                  {Math.round(ghost.say * 100)}% of the choice
                </span>
              </div>
            </div>
          )}

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
              <div className="isactions">
                <button
                  className="btn sec sm"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void saveMoodPlaylist()
                      .then((r) => say('good', `Saved "${r.name}" — it keeps dealing this vibe`))
                      .catch((e: Error) => say('bad', e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Save as playlist
                </button>
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
            </div>
          )}

          {/*
            * TALK TO THE DJ IS HIDDEN, NOT REMOVED.
            *
            * POST /api/ishuffle/say works — it translates a sentence into weight deltas in the
            * same vocabulary votes use, and returns a summary. It just does not FEEL like it
            * works, for two reasons worth fixing before it comes back:
            *
            *   1. It never re-deals. A NO vote replaces the unplayed tail while you watch; a
            *      sentence only updated the chips, so the next five songs were whatever they
            *      already were. You said something and nothing you could hear changed.
            *   2. One sentence is quiet against a session's accumulated weights. Deltas cap at
            *      ±3 where a worked-in mood is already sitting past 7, so "90s and heavier"
            *      moved the queue less than the chips implied it had.
            *
            * The server route and sayToDj() stay in place, so restoring this is putting the
            * form back plus a redeal() in the success path.
            */}
        </div>
      )}
    </div>
  );
}
