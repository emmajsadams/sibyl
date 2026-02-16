import type { TrainingEvent } from "./schema";

/** Global event emitter — set by main.ts, read by engine */
let _listener: ((event: TrainingEvent) => void) | null = null;

export function setTrainingListener(fn: (event: TrainingEvent) => void): void {
  _listener = fn;
}

export function clearTrainingListener(): void {
  _listener = null;
}

export function emit(event: TrainingEvent): void {
  _listener?.(event);
}
