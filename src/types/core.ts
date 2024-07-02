// core.ts

export class RiverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiverStreamError';
  }
}

export interface BaseEvent {
  type: string;
  message?: string;
  data?: unknown;
  error?: unknown;
  stream?: boolean;
}

export type EventMap = Record<string, BaseEvent>;

export interface RiverConfig {
  headers?: Record<string, string>;
  chunk_size?: number;
}

export type EventHandler<T> = (data: T) => void;

export interface StreamOptions {
  stream?: boolean;
}

// Existing types
export type IterableSource<T> = Iterable<T> | AsyncIterable<T>;

// New helper type to ensure data is iterable for streamed events
type EnsureIterable<T, S extends boolean> = S extends true
  ? T extends IterableSource<infer U> ? T : never
  : T;