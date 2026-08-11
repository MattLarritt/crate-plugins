import { useSyncExternalStore } from 'react';
import { Svg, type IconProps } from 'crate/icons';
import { getVersion, isActive, subscribe } from './session';

/**
 * Intelligent Shuffle: the shuffle arrows with a spark where they cross.
 *
 * Deliberately reads as "shuffle, plus" — same crossing-paths idea as the transport's shuffle
 * so the kinship is visible at 18px, with the four-point spark saying something is thinking.
 * Line style, matching the other panel toggles.
 *
 * THE SPARK LIGHTS WHEN A SESSION IS LIVE. Until now the only place a running session was
 * visible was inside the panel, so "is the DJ actually on?" was unanswerable without opening it —
 * and the session stops ITSELF whenever somebody plays an album or a search result, by design and
 * silently. A queue that had quietly reverted to playing an album in order was indistinguishable
 * from a DJ making bad choices. The icon is the honest place to say which.
 */
export function IconIntelligentShuffle(p: IconProps) {
  const live = useSyncExternalStore(subscribe, () => isActive(), () => false);
  void useSyncExternalStore(subscribe, getVersion, () => 0);
  return (
    <Svg {...p} stroke>
      <path d="M16.5 4.5 20 7l-3.5 2.5" />
      <path d="M20 7h-2.6a4.2 4.2 0 0 0-3.45 1.82l-.8 1.18" />
      <path d="M16.5 14.5 20 17l-3.5 2.5" />
      <path d="M20 17h-2.6a4.2 4.2 0 0 1-3.45-1.82l-.55-.8" />
      <path d="M4 7h1.1a4.2 4.2 0 0 1 3.45 1.82l.45.66" />
      <path d="M4 17h1.1a4.2 4.2 0 0 0 3.45-1.82l.45-.66" />
      {/* The spark, filled: a stroked star this small closes into a blob. */}
      <path
        d="M6.8 10.4l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z"
        fill="currentColor"
        stroke="none"
      />
      {/* Live: a dot in the corner, the same language a recording light uses. */}
      {live && <circle cx="19.5" cy="12" r="2.4" fill="currentColor" stroke="none" />}
    </Svg>
  );
}
