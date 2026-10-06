import type { TrainingEvent } from "./schema";

/** Global event emitter — set by main.ts, read by engine */
let _listener: ((event: TrainingEvent) => void) | null = null;

export function setTrainingListener(fn: (event: TrainingEvent) => void): void {
  _listener = fn;
}

export function clearTrainingListener(): void {
  _listener = null;
}

/** Synchronous engine probes only: never pass an async callback. */
export function withoutTrainingEvents<T>(probe: () => T): T {
  const listener = _listener;
  _listener = null;
  try {
    return probe();
  } finally {
    _listener = listener;
  }
}

export function emit(event: TrainingEvent): void {
  _listener?.(event);
}
