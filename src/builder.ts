// builder.ts

import type { BaseEvent, IterableSource } from './types/core';
import type { EventMap } from './types/core';

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

type IterableErrorMessage =
  "ERROR: For streamed events (stream: true), 'data' must be iterable. Consider using an array, generator, or other iterable type.";

type EnsureIterable<T> = T extends IterableSource<unknown>
  ? T
  : T extends string
  ? T
  : IterableErrorMessage;

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export class RiverEvents<T extends EventMap = {}> {
  constructor(private events: T = {} as T) {}

  public define_event<K extends string, E extends Omit<BaseEvent, 'type'>>(
    event_type: K,
    config?: E &
      (E['stream'] extends true
        ? { stream: true; data: EnsureIterable<E['data']> }
        : { stream?: false })
  ): RiverEvents<Prettify<T & Record<K, Prettify<{ type: K } & E>>>> {
    const new_events = {
      ...this.events,
      [event_type]: { type: event_type, ...config }
    } as T & Record<K, E & { type: K }>;

    return new RiverEvents<T & Record<K, E & { type: K }>>(new_events);
  }

  public build(): T {
    return this.events;
  }
}
