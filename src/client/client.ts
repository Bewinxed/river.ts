import type { HTTPMethods } from '../types/http';
import type {
  EventMap,
  RiverConfig,
  EventHandler,
  IterableSource,
  BaseEvent,
  EventData
} from '../types/core';
import { RiverError } from '../types/core';

export class RiverClient<T extends EventMap> extends EventTarget {
  private request_info?: RequestInfo;
  private request_init?: RequestInit & { method: HTTPMethods };
  private event_source?: EventSource;
  private abort_controller?: AbortController;
  private closing = false;
  public is_streaming = false;
  private custom_listeners: { [K in keyof T]?: Set<EventHandler<T[K]>> } = {};

  private constructor(
    private events: T,
    private config: RiverConfig & { fetch_fn?: typeof fetch } = {
      fetch_fn: fetch
    }
  ) {
    super();
    // this.addEventListener('close', () => {
    //   console.info("Stream closed by server via 'close' event");
    //   this.close();
    // });
    if (!this.config.fetch_fn) {
      this.config.fetch_fn = fetch;
    }
    this.on('close', () => {
      console.info("Stream closed by server via 'close' event");
      this.close();
    });
  }

  public static init<T extends EventMap>(
    events: T,
    config?: RiverConfig & { fetch_fn?: typeof fetch }
  ): RiverClient<T> {
    return new RiverClient<T>(events, config);
  }

  public on<K extends keyof T>(
    event_type: K,
    handler: (data: EventData<T, K>) => void
  ): this {
    if (!this.custom_listeners[event_type]) {
      this.custom_listeners[event_type] = new Set();
    }

    const wrapped_handler: EventHandler<T[K]> = (event) => {
      const base_event = event as BaseEvent;
      if (base_event.message !== undefined) {
        handler(base_event.message as EventData<T, K>);
      } else if (base_event.stream && base_event.data !== undefined) {
        handler(base_event.data as EventData<T, K>);
      } else if (base_event.data !== undefined) {
        handler(base_event.data as EventData<T, K>);
      }
    };

    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    this.custom_listeners[event_type]!.add(wrapped_handler);
    return this;
  }

  public off<K extends keyof T>(
    event_type: K,
    handler: EventHandler<T[K]>
  ): this {
    if (this.custom_listeners[event_type]) {
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      this.custom_listeners[event_type]!.delete(handler);
    }
    return this;
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
    if (!this.request_info || this.is_streaming) {
      return;
    }

    this.is_streaming = true;
    this.abort_controller = new AbortController();

    try {
      if (this.should_use_event_source()) {
        this.setup_event_source();
      } else {
        await this.fetch_event_stream();
      }
    } catch (error) {
      if (this.closing) {
        return;
      }
      console.error('Stream error:', error);
      this.handle_stream_error(error);
    }
  }

  private should_use_event_source(): boolean {
    return (
      !this.request_init?.headers &&
      (this.request_init?.method ?? 'GET') === 'GET' &&
      typeof EventSource !== 'undefined'
    );
  }

  private setup_event_source(): void {
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    this.event_source = new EventSource(this.request_info!.toString());
    this.event_source.onmessage = this.handle_event_source_message.bind(this);
    this.event_source.onerror = this.handle_event_source_error.bind(this);

    for (const event_type in this.events) {
      this.event_source.addEventListener(
        event_type,
        this.handle_event_source_message.bind(this)
      );
    }
  }

  private handle_event_source_message(event: MessageEvent): void {
    try {
      const parsed_data = JSON.parse(event.data);
      this.process_event(event.type as keyof T, parsed_data);
    } catch (error) {
      console.error('Error parsing event data:', error);
    }
  }

  private handle_event_source_error(error: Event): void {
    console.error('EventSource error:', error);
    this.close();
  }

  private async fetch_event_stream(): Promise<void> {
    const init: RequestInit = Object.assign({}, this.request_init);
    if (this.config.headers) {
      init.headers = Object.assign(
        {},
        this.config.headers,
        this.request_init?.headers
      );
    }
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    init.signal = this.abort_controller!.signal;

    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    const response = await this.config.fetch_fn!(this.request_info!, init);

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
        break;
      }

      buffer += new TextDecoder().decode(value);
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        if (event.trim()) {
          this.process_raw_event(event);
        }
      }
    }
  }

  private process_raw_event(event: string): void {
    const parts = event.split('\n');
    let event_type = '';
    let data = '';

    for (const part of parts) {
      if (part.startsWith('event:')) {
        event_type = part.slice(6).trim();
      } else if (part.startsWith('data:')) {
        data = part.slice(5).trim();
      }
    }

    if (event_type && data) {
      try {
        this.process_event(event_type as keyof T, JSON.parse(data));
      } catch (error) {
        console.error('Error parsing event data:', error);
      }
    }
  }

  private process_event<K extends keyof T>(event_type: K, data: unknown): void {
    const listeners = this.custom_listeners[event_type];
    if (listeners) {
      const event_config = this.events[event_type];
      const chunk_size = event_config?.chunk_size || 1024;
      const event_data = {
        data: data,
        stream: event_config?.stream || false,
        chunk_size: chunk_size
      } as T[K];
      for (const listener of listeners) {
        listener(event_data);
      }
    }
  }

  public close(): void {
    this.closing = true;
    this.is_streaming = false;
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

  private handle_stream_error(error: unknown): void {
    this.is_streaming = false;
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('Fetch aborted');
    } else if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      console.log('Network error: likely due to page navigation');
    } else if (!this.closing) {
      console.warn('Unexpected error, attempting to reconnect...');
      setTimeout(() => this.stream(), 1000);
    }
  }
}
