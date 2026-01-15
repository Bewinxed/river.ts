// core.ts

export class RiverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiverStreamError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(
    public type: string,
    public timeout: number
  ) {
    super(`Request '${type}' timed out after ${timeout}ms`);
    this.name = 'RequestTimeoutError';
  }
}

export class WebSocketClosedError extends Error {
  constructor() {
    super('WebSocket closed while request was pending');
    this.name = 'WebSocketClosedError';
  }
}

export interface BaseEvent {
  type: string;
  message?: string;
  data?: unknown;
  response?: unknown; // Response type for request/response patterns
  error?: unknown;
  stream?: boolean;
  chunkSize?: number;
}

export type EventMap = Record<string, BaseEvent>;

export interface RiverConfig {
  headers?: Record<string, string>;
}

export type EventHandler<T> = (data: T) => void;

export interface StreamOptions {
  stream?: boolean;
}

// Existing types
export type IterableSource<T> = Iterable<T> | AsyncIterable<T>;

// New helper type to ensure data is iterable for streamed events
type EnsureIterable<T, S extends boolean> = S extends true
  ? T extends IterableSource<infer U>
    ? T
    : never
  : T;

export type EventData<T, K extends keyof T> = T[K] extends BaseEvent
  ? T[K]['message'] extends string
    ? T[K]['message']
    : T[K]['stream'] extends true
    ? T[K]['data'] extends (infer U)[]
      ? U[]
      : T[K]['data'] extends IterableSource<infer U>
      ? IterableSource<U>
      : never
    : T[K]['data']
  : never;

/**
 * Extracts the response type for request/response patterns.
 * Falls back to EventData<T, K> if no explicit response type is defined.
 */
export type ResponseData<T, K extends keyof T> = T[K] extends BaseEvent
  ? T[K]['response'] extends undefined
    ? EventData<T, K> // Fall back to event data type if no response defined
    : T[K]['response'] extends never
    ? EventData<T, K> // Fall back if response is never
    : T[K]['response']
  : never;

// Type to extract only user-defined properties (excluding stream and chunkSize)
export type EmitPayload<T, K extends keyof T> = T[K] extends BaseEvent
  ? Omit<T[K], 'type' | 'stream' | 'chunkSize'>
  : never;
