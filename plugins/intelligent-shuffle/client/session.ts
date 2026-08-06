/**
 * The DJ session: one slot of module state shared by the Service (which keeps the queue fed)
 * and the Panel (which shows the controls).
 *
 * Module scope, not component state, because the two consumers have different lifetimes: the
 * Service is always mounted, the Panel only while open — a session started from the panel must
 * survive the panel closing. Same external-store pattern crate's own plugin runtime uses.
 */

let active = false;
/** The queue label at session start. If it changes, somebody play()ed something else. */
let expectedSource = '';
/** Everything heard this session, so the planner never deals a repeat. */
const played = new Set<number>();

let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  for (const fn of listeners) fn();
};

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getVersion(): number {
  return version;
}

export function isActive(): boolean {
  return active;
}

export function startSession(source: string): void {
  active = true;
  expectedSource = source;
  played.clear();
  bump();
}

export function stopSession(): void {
  if (!active) return;
  active = false;
  bump();
}

export function sessionSource(): string {
  return expectedSource;
}

export function notePlayed(trackId: number): void {
  played.add(trackId);
}

export function playedIds(): number[] {
  return [...played];
}
