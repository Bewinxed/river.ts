import type { HTTPMethods } from '../types/http';
import type {
  EventMap,
  RiverConfig,
  EventHandler,
  IterableSource
} from '../types/core';
import { RiverError } from '../types/core';

export class RiverClient<T extends EventMap> extends EventTarget {
  private requestInfo?: RequestInfo;
  private requestInit?: RequestInit & { method: HTTPMethods };
  private eventSource?: EventSource;
  private abortController?: AbortController;
  private closing = false;
  public isStreaming = false;
  private customListeners: { [K in keyof T]?: Set<EventHandler<T[K]>> } = {};

  private constructor(
    private events: T,
    private config: RiverConfig & {
      fetchFn?: typeof fetch;
      reconnect?: boolean;
    } = {
      fetchFn: fetch,
      reconnect: false
    }
  ) {
    super();
    if (!this.config.fetchFn) {
      this.config.fetchFn = fetch;
    }
    this.on('close', () => {
      console.info("Stream closed by server via 'close' event");
      this.close();
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.close());
    }
  }

  public static init<T extends EventMap>(
    events: T,
    config?: RiverConfig & { fetchFn?: typeof fetch; reconnect?: boolean }
  ): RiverClient<T> {
    return new RiverClient<T>(events, config);
  }

  public on<K extends keyof T>(
    eventType: K,
    handler: (data: T[K]) => void
  ): this {
    if (!this.customListeners[eventType]) {
      this.customListeners[eventType] = new Set();
    }

    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    this.customListeners[eventType]!.add(handler as EventHandler<T[K]>);
    return this;
  }

  public off<K extends keyof T>(
    eventType: K,
    handler: EventHandler<T[K]>
  ): this {
    if (this.customListeners[eventType]) {
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      this.customListeners[eventType]!.delete(handler);
    }
    return this;
  }

  public prepare(
    input: RequestInfo,
    init: RequestInit & { method: HTTPMethods } = { method: 'GET' }
  ): this {
    this.requestInfo = input;
    this.requestInit = init;
    return this;
  }

  public async stream(): Promise<void> {
    if (!this.requestInfo || this.isStreaming) {
      return;
    }

    this.isStreaming = true;
    this.abortController = new AbortController();

    try {
      if (this.shouldUseEventSource()) {
        this.setupEventSource();
      } else {
        await this.fetchEventStream();
      }
    } catch (error) {
      if (this.closing) {
        return;
      }
      console.error('Stream error:', error);
      this.handleStreamError(error);
    }
  }

  private shouldUseEventSource(): boolean {
    return (
      !this.requestInit?.headers &&
      (this.requestInit?.method ?? 'GET') === 'GET' &&
      typeof EventSource !== 'undefined'
    );
  }

  private setupEventSource(): void {
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    this.eventSource = new EventSource(this.requestInfo!.toString());
    this.eventSource.onmessage = this.handleEventSourceMessage.bind(this);
    this.eventSource.onerror = this.handleEventSourceError.bind(this);

    for (const eventType in this.events) {
      this.eventSource.addEventListener(
        eventType,
        this.handleEventSourceMessage.bind(this)
      );
    }
  }

  private handleEventSourceMessage(event: MessageEvent): void {
    try {
      const parsedData = JSON.parse(event.data);
      this.processEvent(event.type as keyof T, parsedData);
    } catch (error) {
      console.error('Error parsing event data:', error);
    }
  }

  private handleEventSourceError(error: Event): void {
    console.error('EventSource error:', error);
    this.close();
  }

  private async fetchEventStream(): Promise<void> {
    const init: RequestInit = Object.assign({}, this.requestInit);
    if (this.config.headers) {
      init.headers = Object.assign(
        {},
        this.config.headers,
        this.requestInit?.headers
      );
    }
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    init.signal = this.abortController!.signal;

    try {
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      const response = await this.config.fetchFn!(this.requestInfo!, init);

      if (!response.ok || !response.body) {
        throw new RiverError(
          `Failed to fetch: ${response.status} ${response.statusText}`
        );
      }

      const reader = response.body.getReader();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value);
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (event.trim()) {
            this.processRawEvent(event);
          }
        }
      }
    } catch (error) {
      this.handleStreamError(error);
    }
  }

  private processRawEvent(event: string): void {
    const parts = event.split('\n');
    let eventType = '';
    let data = '';

    for (const part of parts) {
      if (part.startsWith('event:')) {
        eventType = part.slice(6).trim();
      } else if (part.startsWith('data:')) {
        data = part.slice(5).trim();
      }
    }

    if (eventType && data) {
      try {
        this.processEvent(eventType as keyof T, JSON.parse(data));
      } catch (error) {
        console.error('Error parsing event data:', error);
      }
    }
  }

  private processEvent<K extends keyof T>(eventType: K, data: unknown): void {
    const listeners = this.customListeners[eventType];
    if (listeners) {
      for (const listener of listeners) {
        listener(data as T[K]);
      }
    }
  }

  private handleStreamError(error: unknown): void {
    this.isStreaming = false;
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('Fetch aborted');
    } else if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      console.log('Network error: likely due to page navigation');
    } else {
      console.error('Stream error:', error);
    }
    this.close();
  }

  public close(): void {
    if (this.closing) return;

    this.closing = true;
    this.isStreaming = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
    this.dispatchEvent(new CustomEvent('close'));

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', () => this.close());
    }
  }
}
