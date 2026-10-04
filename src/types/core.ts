// core.ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

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

/** Thrown to a `request()` caller whose response failed its schema. */
export class InvalidMessageError extends Error {
  constructor(
    public type: string,
    public issues: ReadonlyArray<StandardSchemaV1.Issue>
  ) {
    super(
      `Invalid '${type}' message: ${issues.map((i) => i.message).join('; ')}`
    );
    this.name = 'InvalidMessageError';
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
  /** Standard Schema (zod, valibot, arktype, ...) that validates incoming `data`. */
  schema?: StandardSchemaV1;
  /** Standard Schema that validates the response to a WebSocket `request()`. */
  responseSchema?: StandardSchemaV1;
}

/** Receives every incoming message that failed its schema. `raw` is the message as received. */
export type InvalidHandler = (
  type: string,
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
  raw: unknown
) => void;

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
  ? Omit<T[K], 'type' | 'stream' | 'chunkSize' | 'schema' | 'responseSchema'>
  : never;

/**
 * Replaces `data` / `response` with the output type of `schema` /
 * `responseSchema` when an event definition carries them.
 */
export type ApplySchemas<E> = E extends
  | { schema: StandardSchemaV1 }
  | { responseSchema: StandardSchemaV1 }
  ? Omit<
      E,
      | (E extends { schema: StandardSchemaV1 } ? 'data' : never)
      | (E extends { responseSchema: StandardSchemaV1 } ? 'response' : never)
    > &
      (E extends { schema: infer S extends StandardSchemaV1 }
        ? { data: StandardSchemaV1.InferOutput<S> }
        : {}) &
      (E extends { responseSchema: infer R extends StandardSchemaV1 }
        ? { response: StandardSchemaV1.InferOutput<R> }
        : {})
  : E;
