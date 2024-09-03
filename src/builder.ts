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
type ReservedEventTypeMessage<K extends string> =
  `ERROR: Event type ${K} is reserved.'`;
export class RiverEvents<T extends EventMap = { close: BaseEvent }> {
  constructor(
    private events: T = {
      close: { type: 'close' }
    } as T & { close: BaseEvent }
  ) {}

  public defineEvent<K extends string, E extends Omit<BaseEvent, 'type'>>(
    event_type: K extends 'close' ? ReservedEventTypeMessage<K> : K,
    config?: E &
      (E['stream'] extends true
        ? { stream: true; data: EnsureIterable<E['data']>; chunk_size?: number }
        : { stream?: false; chunk_size?: number })
  ): RiverEvents<Prettify<T & Record<K, Prettify<{ type: K } & E>>>> {
    if (event_type === 'close') {
      throw new Error(`ERROR: Event type ${event_type} is reserved.`);
    }
    const new_events = {
      ...this.events,
      [event_type]: { type: event_type, ...config }
    } as unknown as T & Record<K, E & { type: K }>;
    return new RiverEvents<T & Record<K, E & { type: K }>>(new_events);
  }

  public build(): T {
    return this.events;
  }
}
