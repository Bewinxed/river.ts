import type { HTTPMethods } from '../types/http';
import type {
  EventMap,
  RiverConfig,
  EventHandler,
  InvalidHandler
} from '../types/core';
import { RiverError } from '../types/core';
import { createValidator } from '../validate';

export interface ReconnectOptions {
  /** First backoff delay in ms (default 1000). Doubles on every failed attempt. */
  initialDelay?: number;
  /** Upper bound for the backoff delay in ms (default 30000). */
  maxDelay?: number;
}

export interface RiverClientConfig extends RiverConfig {
  fetchFn?: typeof fetch;
  /** Reconnect after network errors, 5xx/429 responses and an unexpected end of stream. Default false. */
  reconnect?: boolean | ReconnectOptions;
  /** Event id to resume from; sent as `Last-Event-ID` on the first connection. */
  lastEventId?: string;
  /** Called for every event whose data fails its schema. The event is not dispatched. */
  onInvalid?: InvalidHandler;
}

const EOL = /\r\n|\r|\n/g;

/**
 * Incremental parser for the WHATWG event-stream format
 * (https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).
 * Returns a function that is fed decoded text as it arrives.
 */
function createParser(
  lastEventId: string,
  on: {
    event: (type: string, data: string) => void;
    id: (id: string) => void;
    retry: (ms: number) => void;
  }
): (chunk: string) => void {
  let buffer = '';
  let data = '';
  let type = '';
  let id = lastEventId;
  let skipLF = false; // previous chunk ended in CR: a leading LF belongs to it

  const line = (text: string): void => {
    if (text === '') {
      // Blank line: dispatch. The id is committed even when there is no data.
      on.id(id);
      if (data !== '') on.event(type || 'message', data.slice(0, -1));
      data = type = '';
      return;
    }
    const colon = text.indexOf(':');
    if (colon === 0) return; // comment
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value[0] === ' ') value = value.slice(1);

    if (field === 'data') data += `${value}\n`;
    else if (field === 'event') type = value;
    else if (field === 'id') {
      if (!value.includes('\0')) id = value;
    } else if (field === 'retry') {
      if (/^\d+$/.test(value)) on.retry(Number(value));
    }
  };

  return (chunk) => {
    if (!chunk) return;
    if (skipLF && chunk[0] === '\n') chunk = chunk.slice(1);
    skipLF = chunk.endsWith('\r');
    buffer += chunk;

    let start = 0;
    EOL.lastIndex = 0;
    for (let match = EOL.exec(buffer); match; match = EOL.exec(buffer)) {
      line(buffer.slice(start, match.index));
      start = EOL.lastIndex;
    }
    buffer = buffer.slice(start);
  };
}

/** `Retry-After` is either a number of seconds or an HTTP date. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  return Number.isNaN(ms) ? undefined : Math.max(0, ms);
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

export class RiverClient<T extends EventMap> extends EventTarget {
  private requestInfo?: RequestInfo;
  private requestInit?: RequestInit & { method: HTTPMethods };
  private eventSource?: EventSource;
  private abortController?: AbortController;
  public isStreaming = false;
  private customListeners: { [K in keyof T]?: Set<EventHandler<T[K]>> } = {};
  private lastId: string;
  private retryMs?: number;
  private validate: ReturnType<typeof createValidator>;
  private readonly onUnload = () => this.close();

  private constructor(
    private events: T,
    private config: RiverClientConfig = {}
  ) {
    super();
    this.lastId = config.lastEventId ?? '';
    this.validate = createValidator(config.onInvalid);
    this.on('close', () => {
      console.info("Stream closed by server via 'close' event");
      this.close();
    });
  }

  public static init<T extends EventMap>(
    events: T,
    config?: RiverClientConfig
  ): RiverClient<T> {
    return new RiverClient<T>(events, config);
  }

  /** Id of the last event received. Persist it and pass it back as `lastEventId` to resume. */
  public get lastEventId(): string {
    return this.lastId;
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

  /**
   * Opens the stream. In the fetch path the promise resolves once the stream
   * has stopped for good. Can be called again after `close()`.
   */
  public async stream(): Promise<void> {
    if (!this.requestInfo || this.isStreaming) {
      return;
    }

    this.isStreaming = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.onUnload);
    }

    if (this.shouldUseEventSource()) {
      try {
        this.setupEventSource();
      } catch (error) {
        console.error('Stream error:', error);
        this.close();
      }
      return;
    }

    this.abortController = new AbortController();
    await this.fetchEventStream(this.abortController.signal);
  }

  private shouldUseEventSource(): boolean {
    return (
      !this.requestInit?.headers &&
      // EventSource cannot send an initial Last-Event-ID
      !this.lastId &&
      (this.requestInit?.method ?? 'GET') === 'GET' &&
      typeof EventSource !== 'undefined'
    );
  }

  private setupEventSource(): void {
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    const source = new EventSource(this.requestInfo!.toString());
    const onMessage = (event: MessageEvent) => {
      this.lastId = event.lastEventId;
      this.deliver(event.type, event.data);
    };
    source.onmessage = onMessage;
    source.onerror = (error) => {
      // EventSource reconnects by itself unless it has given up (CLOSED).
      if (this.config.reconnect && source.readyState !== source.CLOSED) return;
      console.error('EventSource error:', error);
      this.close();
    };
    for (const eventType in this.events) {
      source.addEventListener(eventType, onMessage as EventListener);
    }
    this.eventSource = source;
  }

  private async fetchEventStream(signal: AbortSignal): Promise<void> {
    const { reconnect } = this.config;
    const { initialDelay = 1000, maxDelay = 30_000 } =
      typeof reconnect === 'object' ? reconnect : {};
    let failures = 0;

    while (!signal.aborted) {
      let retryAfter: number | undefined;
      let failure: unknown;

      try {
        const headers = new Headers(this.config.headers);
        new Headers(this.requestInit?.headers).forEach((value, key) =>
          headers.set(key, value)
        );
        if (this.lastId) {
          // Header values are byte strings; the id goes out UTF-8 encoded.
          headers.set(
            'Last-Event-ID',
            String.fromCharCode(...new TextEncoder().encode(this.lastId))
          );
        }

        const response = await (this.config.fetchFn ?? fetch)(
          // biome-ignore lint/style/noNonNullAssertion: <explanation>
          this.requestInfo!,
          { ...this.requestInit, headers, signal }
        );

        if (response.status === 204) break; // the server asks us to stop
        if (!response.ok || !response.body) {
          const { status } = response;
          void response.body?.cancel();
          const error = new RiverError(
            `Failed to fetch: ${status} ${response.statusText}`
          );
          if (status !== 429 && status < 500) {
            console.error('Stream error:', error);
            break;
          }
          if (status === 429 || status === 503) {
            retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
          }
          throw error;
        }

        failures = 0;
        this.dispatchEvent(new CustomEvent('open'));

        const feed = createParser(this.lastId, {
          event: (type, data) => this.deliver(type, data),
          id: (id) => {
            this.lastId = id;
          },
          retry: (ms) => {
            this.retryMs = ms;
          }
        });
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          feed(decoder.decode(value, { stream: true }));
        }
        feed(decoder.decode());
      } catch (error) {
        failure = error;
      }

      if (signal.aborted) return;
      if (!reconnect) {
        if (failure) console.error('Stream error:', failure);
        break;
      }

      const backoff = Math.min(maxDelay, initialDelay * 2 ** failures);
      const delay =
        retryAfter ??
        this.retryMs ??
        backoff / 2 + (Math.random() * backoff) / 2;
      failures++;
      this.dispatchEvent(
        new CustomEvent('reconnect', {
          detail: { attempt: failures, delay, error: failure }
        })
      );
      await sleep(delay, signal);
    }

    if (!signal.aborted) this.close();
  }

  /** Parses an event's JSON data, validates it when the event has a schema, and dispatches it. */
  private deliver(type: string, raw: string): void {
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      console.error('Error parsing event data:', error);
      return;
    }
    const schema = this.events[type]?.schema;
    this.validate(type, schema, schema ? payload?.data : payload, raw, (value) =>
      this.processEvent(type, schema ? { ...payload, data: value } : payload)
    );
  }

  private processEvent<K extends keyof T>(eventType: K, data: unknown): void {
    const listeners = this.customListeners[eventType];
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data as T[K]);
        } catch (error) {
          console.error(`Error in '${String(eventType)}' handler:`, error);
        }
      }
    }
  }

  public close(): void {
    if (!this.isStreaming) return;

    this.isStreaming = false;
    this.eventSource?.close();
    this.eventSource = undefined;
    this.abortController?.abort();
    this.abortController = undefined;
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.onUnload);
    }
    this.dispatchEvent(new CustomEvent('close'));
  }
}
