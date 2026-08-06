import { Svg, type IconProps } from 'crate/icons';

/**
 * Intelligent Shuffle: the shuffle arrows with a spark where they cross.
 *
 * Deliberately reads as "shuffle, plus" — same crossing-paths idea as the transport's shuffle
 * so the kinship is visible at 18px, with the four-point spark saying something is thinking.
 * Line style, matching the other panel toggles.
 */
export function IconIntelligentShuffle(p: IconProps) {
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
    </Svg>
  );
}
