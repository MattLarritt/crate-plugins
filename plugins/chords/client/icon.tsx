import { Svg, type IconProps } from 'crate/icons';

/**
 * Guitar: an acoustic body, a neck and a headstock, laid at an angle.
 *
 * An acoustic outline rather than a plectrum or a musical note — both of those already mean
 * other things on a media surface, and this control opens something guitar-shaped. Line style,
 * matching the other panel toggles rather than the transport.
 *
 * Three things this drawing is built around, all learned by rendering the previous attempt at
 * 130px and looking at what was actually there rather than what was intended:
 *
 *   Symmetry.   The body is DRAWN UPRIGHT and rotated, so its two halves cannot drift apart.
 *               The first version freehanded the diagonal out of arcs and produced a lumpy
 *               potato with the sound hole off to one side.
 *   The waist.  It has to be deep — half-width 2 against the lower bout's 4.5 — or a 2px stroke
 *               fills the pinch in and the whole thing reads as a keyhole.
 *   The angle.  Rotation is the only transform here. A scale would take the stroke with it and
 *               this icon would come out lighter than every other one in the row, so the path is
 *               authored small enough to fit the box once turned.
 */
export function IconGuitar(p: IconProps) {
  return (
    <Svg {...p} stroke>
      <g transform="rotate(-30 12 12)">
        {/* Body: upper bout, waist, lower bout, mirrored about x=12 by construction. */}
        <path d="M12 8.8C14.1 8.8 15.4 10.1 15.4 11.7C15.4 13.1 14 13.7 14 15C14 16.4 16.5 17.3 16.5 19C16.5 20.5 14.4 21.5 12 21.5C9.6 21.5 7.5 20.5 7.5 19C7.5 17.3 10 16.4 10 15C10 13.7 8.6 13.1 8.6 11.7C8.6 10.1 9.9 8.8 12 8.8Z" />
        <path d="M12 8.9V4.1" />
        <path d="M10.1 3.2H13.9" />
        {/* Filled, not stroked: a 2.6px ring closes up to a dot at 18px anyway, and a dot that
            is meant to be a dot survives the small sizes cleanly. */}
        <circle cx="12" cy="11.7" r="1.3" fill="currentColor" stroke="none" />
      </g>
    </Svg>
  );
}
