import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePlayer } from 'crate/player';
import { plan } from './api';
import { getVersion, isActive, notePlayed, playedIds, sessionSource, stopSession, subscribe } from './session';

/**
 * The always-running half: keeps a live session's queue topped up, and notices when the user
 * has moved on.
 *
 * This is why the Service slot exists — the panel is only mounted while somebody looks at it,
 * and a DJ who stops working when you close their window is not a DJ. This component renders
 * nothing; it watches the player and acts.
 */
export function IntelligentShuffleService() {
  const p = usePlayer();
  useSyncExternalStore(subscribe, getVersion);
  const fetching = useRef(false);

  // Everything that reaches the speakers this session is off the menu afterwards.
  const currentId = p.current?.trackId ?? 0;
  useEffect(() => {
    if (isActive() && currentId) notePlayed(currentId);
  }, [currentId]);

  /*
   * The user outranks the DJ, silently. play() always stamps a new source label, so a label
   * that no longer matches the session's means somebody started an album, a playlist, a
   * search result — a choice. The session ends itself rather than fighting the queue back.
   */
  useEffect(() => {
    if (isActive() && p.source !== sessionSource()) stopSession();
  }, [p.source]);

  // Top up before the tank is empty: when fewer than three tracks remain ahead, plan five
  // more against the mood as it stands NOW — later votes shape later batches.
  const remaining = p.queue.length - p.index - 1;
  useEffect(() => {
    if (!isActive() || remaining >= 3 || fetching.current) return;
    fetching.current = true;
    const queued = p.queue.map((t) => t.trackId);
    // The new batch plays after whatever is currently last, so tell the planner — the
    // no-same-artist-twice rule has to hold across that seam too.
    const lastQueued = p.queue[p.queue.length - 1]?.trackId;
    void plan(5, [...playedIds(), ...queued], lastQueued)
      .then((r) => {
        if (isActive() && r.tracks.length) p.enqueue(r.tracks);
      })
      .catch(() => {
        /* a failed top-up is a shorter queue, not an error worth a toast */
      })
      .finally(() => {
        fetching.current = false;
      });
  }, [remaining, p]);

  return null;
}
