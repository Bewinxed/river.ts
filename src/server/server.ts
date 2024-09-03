import { EventEmitter } from 'node:events';
import type {
  BaseEvent,
  EventMap,
  RiverConfig,
  IterableSource
} from '../types/core';

export class RiverEmitter<T extends EventMap> extends EventEmitter {
  private config: RiverConfig;
  private clients: Map<string, WritableStreamDefaultWriter> = new Map();

  constructor(private events: T, config: RiverConfig = { headers: {} }) {
    super();
    this.config = config;
  }

  public static init<T extends EventMap>(
    events: T,
    config?: RiverConfig
  ): RiverEmitter<T> {
    return new RiverEmitter<T>(events, config);
  }

  private async emitEvent<K extends keyof T>(
    writer: WritableStreamDefaultWriter,
    event_type: K,
    data: T[K]['data']
  ): Promise<void> {
    const event_config = this.events[event_type];

    if (event_config?.stream) {
      await this.emitStreamEvent(writer, event_type, data);
    } else {
      await this.emitSingleEvent(writer, event_type, data);
    }
  }

  private async emitStreamEvent<K extends keyof T>(
    writer: WritableStreamDefaultWriter,
    event_type: K,
    data: T[K]['data']
  ): Promise<void> {
    const event_config = this.events[event_type];
    const chunk_size = event_config?.chunkSize || 1024;
    const iterable = this.ensureIterable(data);
    let chunk: unknown[] = [];
    for await (const item of iterable) {
      chunk.push(item);
      if (chunk.length >= chunk_size) {
        await this.emitChunk(writer, event_type, chunk);
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      await this.emitChunk(writer, event_type, chunk);
    }
  }

  private isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return Symbol.asyncIterator in Object(value);
  }

  private isIterable(value: unknown): value is Iterable<unknown> {
    return Symbol.iterator in Object(value);
  }

  private ensureIterable(data: unknown): IterableSource<unknown> {
    if (this.isIterable(data)) {
      return data;
    }
    if (this.isAsyncIterable(data)) {
      return data;
    }
    return [data][Symbol.iterator]();
  }

  private async emitChunk<K extends keyof T>(
    writer: WritableStreamDefaultWriter,
    event_type: K,
    chunk: unknown[]
  ): Promise<void> {
    const event_data = `event: ${String(event_type)}\ndata: ${JSON.stringify(
      chunk
    )}\n\n`;
    await writer.write(event_data);
  }

  private async emitSingleEvent<K extends keyof T>(
    writer: WritableStreamDefaultWriter,
    event_type: K,
    data: unknown
  ): Promise<void> {
    await this.emitChunk(writer, event_type, [data]);
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

  // overload to receive only callback

  public stream({
    callback,
    clientId: customClientId,
    ondisconnect
  }: {
    callback: (
      emit: <K extends keyof T>(
        event_type: K,
        data: T[K]['data']
      ) => Promise<void>,
      clientId: string
    ) => void;
    clientId?: string;
    ondisconnect?: (clientId: string) => void;
  }): ReadableStream {
    return new ReadableStream({
      start: (controller) => {
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();

        const headers = this.headers();
        for (const [key, value] of headers.entries()) {
          writer.write(`${key}: ${value}\n`);
        }

        const clientId =
          customClientId || Math.random().toString(36).slice(2, 9);
        this.clients.set(clientId, writer);

        const emit = async <K extends keyof T>(
          event_type: K,
          data: T[K]['data']
        ) => {
          await this.emitEvent(writer, event_type, data);
        };

        callback(emit, clientId);

        writer.closed.then(() => {
          this.clients.delete(clientId);
          if (ondisconnect) {
            ondisconnect(clientId);
          }
        });

        readable
          .pipeTo(
            new WritableStream({
              write: (chunk) => {
                try {
                  controller.enqueue(encoder.encode(chunk));
                } catch (error) {
                  console.error('Error enqueueing chunk:', error);
                  controller.error(error);
                }
              },
              close: () => {
                this.clients.delete(clientId);
                if (ondisconnect) {
                  ondisconnect(clientId);
                }
                controller.close();
              },
              abort: (reason) => {
                this.clients.delete(clientId);
                if (ondisconnect) {
                  ondisconnect(clientId);
                }
                console.debug(
                  `Client ${clientId} disconnected ${
                    reason ? `due to ${reason}` : ''
                  }`
                );
                controller.error(reason);
              }
            })
          )
          .catch((error) => {
            this.clients.delete(clientId);
            if (ondisconnect) {
              ondisconnect(clientId);
            }
            // console.error('Error piping stream:', error);
          });
      },
      cancel: async (reason) => {
        // console.debug('Stream cancelled:', reason);
        for (const [clientId, writer] of this.clients.entries()) {
          if (ondisconnect) {
            ondisconnect(clientId);
          }
          await writer.closed.then(() => writer.abort(reason));
        }
      }
    });
  }

  // New method to broadcast to all connected clients
  public async broadcast<K extends keyof T>(
    event_type: K,
    data: T[K]['data']
  ): Promise<void> {
    const promises = Array.from(this.clients.values()).map((writer) =>
      this.emitEvent(writer, event_type, data)
    );
    await Promise.all(promises);
  }

  // New method to disconnect a specific client
  public async disconnectClient(clientId: string): Promise<void> {
    const writer = this.clients.get(clientId);
    if (writer) {
      await this.emitEvent(writer, 'close', {});
      await writer.close();
      this.clients.delete(clientId);
    }
  }

  // New method to send an event to a specific client
  public async sendToClient<K extends keyof T>(
    clientId: string,
    event_type: K,
    data: T[K]['data']
  ): Promise<void> {
    const writer = this.clients.get(clientId);
    if (writer) {
      await this.emitEvent(writer, event_type, data);
    } else {
      console.error(`Client with ID ${clientId} not found`);
    }
  }
}
