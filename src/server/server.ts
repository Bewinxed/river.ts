// src/server/server.ts

import { EventEmitter } from 'node:events';
import type {
  BaseEvent,
  EventMap,
  RiverConfig,
  IterableSource
} from '../types/core';

export class RiverEmitter<T extends EventMap> extends EventEmitter {
  private clients: Set<WritableStreamDefaultWriter> = new Set();

  constructor(
    private events: T,
    private config: RiverConfig = { headers: {} }
  ) {
    super();
  }

  public static init<T extends EventMap>(
    events: T,
    config?: RiverConfig
  ): RiverEmitter<T> {
    return new RiverEmitter<T>(events, config);
  }

  public register_client(client: WritableStreamDefaultWriter): void {
    if (!client) {
      throw new Error('Client writer is undefined');
    }

    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Content-Encoding': 'none',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Origin, X-Requested-With, Content-Type, Accept',
      ...this.config.headers
    });

    for (const [key, value] of headers.entries()) {
      client.write(`${key}: ${value}\n`);
    }

    this.clients.add(client);

    client.closed.then(() => {
      this.clients.delete(client);
    });
  }

  public async emit_event<K extends keyof T>(
    event_type: K,
    data: T[K]['data']
  ): Promise<void> {
    const event_config = this.events[event_type];

    if (event_config?.stream) {
      await this.emit_stream_event(event_type, data);
    } else {
      await this.emit_single_event(event_type, data);
    }
  }

  private async emit_stream_event<K extends keyof T>(
    event_type: K,
    data: T[K]['data']
  ): Promise<void> {
    const event_config = this.events[event_type];
    const chunk_size = event_config?.chunk_size || 1024;
    const iterable = this.ensure_iterable(data);
    let chunk: unknown[] = [];
    for await (const item of iterable) {
      chunk.push(item);
      if (chunk.length >= chunk_size) {
        await this.emit_chunk(event_type, chunk);
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      await this.emit_chunk(event_type, chunk);
    }
  }

  private is_async_iterable(value: unknown): value is AsyncIterable<unknown> {
    return Symbol.asyncIterator in Object(value);
  }

  private is_iterable(value: unknown): value is Iterable<unknown> {
    return Symbol.iterator in Object(value);
  }

  private ensure_iterable(data: unknown): IterableSource<unknown> {
    if (this.is_iterable(data)) {
      return data;
    }
    if (this.is_async_iterable(data)) {
      return data;
    }
    return [data][Symbol.iterator]();
  }

  // Add a new method to emit chunks
  private async emit_chunk<K extends keyof T>(
    event_type: K,
    chunk: unknown[]
  ): Promise<void> {
    const event_data = `event: ${String(event_type)}\ndata: ${JSON.stringify(
      chunk
    )}\n\n`;
    const promises = Array.from(this.clients).map((client) =>
      client.write(event_data)
    );
    await Promise.all(promises);
  }

  // Modify the emit_single_event method
  private async emit_single_event<K extends keyof T>(
    event_type: K,
    data: unknown
  ): Promise<void> {
    await this.emit_chunk(event_type, [data]);
  }

  public headers(headers_override?: Record<string, string>): Headers {
    return new Headers({
      'Content-Type': 'text/event-stream',
      'Content-Encoding': 'none',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Origin, X-Requested-With, Content-Type, Accept',
      ...this.config.headers,
      ...headers_override
    });
  }

  public stream(callback: (emitter: RiverEmitter<T>) => void): ReadableStream {
    return new ReadableStream({
      start: (controller) => {
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();

        this.register_client(writer);

        callback(this);

        readable.pipeTo(
          new WritableStream({
            write: (chunk) => {
              controller.enqueue(encoder.encode(chunk));
            },
            close: () => {
              controller.close();
            }
          })
        );
      }
    });
  }
}
