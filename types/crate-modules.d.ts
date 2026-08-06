/**
 * What the `crate/...` module specifiers resolve to.
 *
 * At build time each of these is an esbuild alias onto a shim in shims/, and every shim reads
 * one field off window.crateHost — the surface crate's own bundle exposes for plugins. These
 * declarations exist so tsc can check plugin code against that surface; the shapes here mirror
 * web/src/plugins/host.ts in the crate repo, which is the authoritative list.
 */

declare module 'crate/api' {
  /** Shared request helpers: same json handling and NeedsLogin behaviour as core calls. */
  export function get<T>(path: string): Promise<T>;
  export function post<T>(path: string, body: unknown): Promise<T>;
  export function put<T>(path: string, body: unknown): Promise<T>;
  export function del<T>(path: string): Promise<T>;
}

declare module 'crate/player' {
  export interface PlayableTrack {
    trackId: number;
    title: string;
    artistName: string;
    albumTitle: string;
    durationS: number | null;
  }
  export interface PlayerApi {
    queue: PlayableTrack[];
    current: PlayableTrack | null;
    index: number;
    playing: boolean;
    play(tracks: PlayableTrack[], startAt?: number, source?: string): void;
    toggle(): void;
    next(userInitiated?: boolean): void;
    prev(): void;
    seek(seconds: number): void;
  }
  export function usePlayer(): PlayerApi;
}

declare module 'crate/plugins' {
  /** "Open my panel for whatever starts playing next" — the one-slot latch. */
  export function requestPanel(id: string): void;
}

declare module 'crate/icons' {
  import type { ReactNode } from 'react';
  export interface IconProps {
    size?: string | number;
    className?: string;
  }
  /** The shared icon wrapper, so a plugin's icon matches the row it sits in. */
  export function Svg(p: IconProps & { children: ReactNode; stroke?: boolean }): ReactNode;
}

declare module 'crate/logo' {
  export const WORDMARK: { w: number; h: number; d: string };
}
