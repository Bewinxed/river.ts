// src/client/client.ts

import type { HTTPMethods } from '../types/http';
import type {
  BaseEvent,
  EventMap,
  RiverConfig,
  EventHandler
} from '../types/core';
import { RiverError } from '../types/core';

export class RiverClient<T extends EventMap> extends EventTarget {
  private request_info?: RequestInfo;
  private request_init?: RequestInit & { method: HTTPMethods };
  private reconnect_attempts = 0;
  private reconnect_delay = 1000;
  private event_source?: EventSource;
  private abort_controller?: AbortController;
  private closing = false;
  private stream_buffers: { [K in keyof T]?: unknown[] } = {};
  private custom_listeners: { [K in keyof T]?: Set<EventHandler<T[K]>> } = {};

  private constructor(
    private events: T,
    private config: RiverConfig = { chunk_size: 1024 }
  ) {
    super();
  }

  public static init<T extends EventMap>(
    events: T,
    config?: RiverConfig
  ): RiverClient<T> {
    return new RiverClient<T>(events, config);
  }

  public on<K extends keyof T>(
    event_type: K,
    handler: (
      data: T[K]['stream'] extends true ? T[K]['data'] : T[K]['data']
    ) => void
  ): this {
    if (!this.custom_listeners[event_type]) {
      this.custom_listeners[event_type] = new Set();
    }
    const wrappedHandler: EventHandler<T[K]> = (event) => {
      if (this.events[event_type]?.stream) {
        handler(event.data as T[K]['data'][]);
      } else {
        handler(event.data as T[K]['data']);
      }
    };
    this.custom_listeners[event_type]?.add(wrappedHandler);
    return this;
  }

  public off<K extends keyof T>(
    event_type: K,
    handler: EventHandler<T[K]>
  ): this {
    this.custom_listeners[event_type]?.delete(handler);
    return this;
  }

  private handle_event<K extends keyof T>(event_type: K, data: T[K]): void {
    // convert to for of
    for (const handler of this.custom_listeners[event_type] || []) {
      handler(data);
    }
  }

  public prepare(
    input: RequestInfo,
    init?: RequestInit & { method: HTTPMethods }
  ): this {
    this.request_info = input;
    this.request_init = init;
    return this;
  }

  public async stream(): Promise<void> {
    if (!this.request_info) {
      throw new RiverError('Request information not set.');
    }

    if (
      this.request_init?.headers ||
      (this.request_init?.method ?? 'GET') !== 'GET' ||
      typeof EventSource === 'undefined'
    ) {
      try {
        this.abort_controller = new AbortController();
        await this.fetch_event_stream();
      } catch (error) {
        if (this.closing) return;
        console.error('Error during fetch stream:', (error as Error).message);
        await this.reconnect();
      }
    } else {
      this.event_source = new EventSource(this.request_info.toString());
      this.setup_event_source();
    }
  }

  private setup_event_source(): void {
    if (!this.event_source) return;

    const custom_event_listener = (event: MessageEvent): void => {
      try {
        const parsed_data = JSON.parse(event.data);
        this.process_event(event.type as keyof T, parsed_data);
      } catch (error) {
        console.error('Error parsing event data:', error);
      }
    };

    this.event_source.onmessage = custom_event_listener;
    for (const event_type in this.events) {
      this.event_source.addEventListener(event_type, custom_event_listener);
    }

    this.event_source.onerror = (error): void => {
      console.error('EventSource error:', error);
      this.close();
      this.reconnect();
    };
  }

  private async fetch_event_stream(): Promise<void> {
    if (!this.request_info) return;

    const init: RequestInit = Object.assign({}, this.request_init, {
      headers: Object.assign(
        {},
        this.config.headers,
        this.request_init?.headers
      ),
      signal: this.abort_controller?.signal
    });

    const response = await fetch(this.request_info, init);

    if (!response.ok || !response.body) {
      throw new RiverError(
        `Failed to fetch: ${response.status} ${response.statusText}`
      );
    }

    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.debug('Stream finished');
        break;
      }

      buffer += new TextDecoder().decode(value);
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        if (event.trim() !== '') {
          this.process_raw_event(event);
        }
      }
    }
  }

  private process_raw_event(event: string): void {
    const lines = event.trim().split('\n');
    let event_type = '';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event_type = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim();
      }
    }

    if (event_type && data) {
      try {
        const parsed_data = JSON.parse(data);
        this.process_event(event_type as keyof T, parsed_data);
      } catch (error) {
        console.error('Error parsing event data:', error);
      }
    }
  }

  private process_event<K extends keyof T>(event_type: K, data: unknown): void {
    const event_config = this.events[event_type];
    if (event_config?.stream) {
      // For streamed events, data is already an array
      this.handle_event(event_type, { data, stream: true } as T[K]);
    } else {
      // For non-streamed events, we don't wrap the data in an array
      this.handle_event(event_type, { data, stream: false } as T[K]);
    }
  }

  public close(): void {
    this.closing = true;
    if (this.event_source) {
      this.event_source.close();
      this.event_source = undefined;
    }
    if (this.abort_controller) {
      this.abort_controller.abort();
      this.abort_controller = undefined;
    }
    this.dispatchEvent(new CustomEvent('close'));
  }

  private async reconnect(): Promise<void> {
    this.reconnect_attempts++;
    console.warn(`Reconnecting in ${this.reconnect_delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, this.reconnect_delay));
    await this.stream();
  }
}
