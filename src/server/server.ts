import type { Writable } from 'node:stream'; // For potential Node.js piping example later
import type { EmitPayload } from '../types/core';

// --- Placeholder Types (Replace with your actual definitions) ---
// Make sure these align with your '../types/core' definitions
export interface BaseEvent {
  /** The expected type of the data payload for this event. */
  data?: unknown;
  /** If true, data can be an Iterable or AsyncIterable and will be chunked. */
  stream?: boolean;
  /** Size of chunks when stream=true. Defaults to 1024. */
  chunkSize?: number;
}
export type EventMap = Record<string, BaseEvent>;

export interface RiverConfig {
  /** Default headers to merge with standard SSE headers. */
  headers?: Record<string, string>;
}

/** Represents a source that can be iterated over, synchronously or asynchronously. */
export type IterableSource<T> = Iterable<T> | AsyncIterable<T>;
// --- End Placeholder Types ---

// Helper type to infer the item type from potential iterables
type InferItemType<D> = D extends Iterable<infer U>
  ? U
  : D extends AsyncIterable<infer V>
  ? V
  : D;

// Interface for storing client information
interface ClientInfo {
  writer: WritableStreamDefaultWriter;
  /** Function to cleanup resources for this client. Accepts an optional reason. */
  cleanup: (reason?: unknown) => Promise<void>;
}

export class RiverEmitter<T extends EventMap> {
  private config: RiverConfig;
  // Store writer and its associated cleanup function for each client
  private clients: Map<string, ClientInfo> = new Map();
  // Store the event definitions provided at initialization
  private eventDefinitions: T;

  constructor(events: T, config: RiverConfig = { headers: {} }) {
    // No longer extends EventEmitter
    this.eventDefinitions = events;
    this.config = config;
  }

  /**
   * Initializes a new RiverEmitter instance.
   * @param events - An object defining the events and their expected data types.
   * @param config - Optional configuration, primarily for default headers.
   */
  public static init<T extends EventMap>(
    events: T,
    config?: RiverConfig
  ): RiverEmitter<T> {
    return new RiverEmitter<T>(events, config);
  }

  // Type guard for AsyncIterable
  private isAsyncIterable<Item = unknown>(
    value: unknown
  ): value is AsyncIterable<Item> {
    return (
      typeof value === 'object' &&
      value !== null &&
      Symbol.asyncIterator in value
    );
  }

  // Type guard for Iterable
  private isIterable<Item = unknown>(value: unknown): value is Iterable<Item> {
    return (
      typeof value === 'object' && value !== null && Symbol.iterator in value
    );
  }

  /**
   * Ensures the data is an iterable source (sync or async).
   * If the input is not iterable, it's wrapped in an async generator yielding the single item.
   * Preserves the inferred item type.
   */
  private ensureIterable<D>(data: D): IterableSource<InferItemType<D>> {
    type Item = InferItemType<D>;

    if (this.isIterable<Item>(data)) {
      return data;
    }
    if (this.isAsyncIterable<Item>(data)) {
      return data;
    }

    // Wrap single item in an async generator for consistent handling
    async function* singleItemGenerator(): AsyncIterable<Item> {
      yield data as Item;
    }
    return singleItemGenerator();
  }

  /**
   * Safely writes a pre-formatted string chunk to the writer.
   * Returns true on success, false on failure.
   */
  private async writeChunk(
    writer: WritableStreamDefaultWriter,
    chunkString: string
  ): Promise<boolean> {
    try {
      // Underlying `write` doesn't guarantee completion on return, but await helps backpressure.
      await writer.write(chunkString);
      return true;
    } catch (error) {
      // Error during write usually means the connection is broken.
      console.warn('RiverEmitter: Error writing chunk:', error);
      return false; // Indicate failure
    }
  }

  /**
   * Handles emitting events where the data is potentially iterable (stream: true).
   * Chunks the data according to event config or defaults.
   */
  private async emitStreamEvent<K extends keyof T>(
    writer: WritableStreamDefaultWriter,
    event_type: K,
    payload: EmitPayload<T, K> // Expects the specific payload type for the event
  ): Promise<void> {
    const event_config = this.eventDefinitions[event_type];
    const chunk_size = event_config?.chunkSize ?? 1024; // Default chunk size

    // Extract data from payload for streaming - streaming events must have data property
    const data = (payload as any).data;
    if (data === undefined) {
      throw new Error(`Stream event ${String(event_type)} requires a 'data' property`);
    }

    // Infer the type of items within the data
    type Item = InferItemType<T[K]['data']>;
    const iterable = this.ensureIterable<T[K]['data']>(data);

    let chunk: Item[] = [];
    let writeSuccess = true;

    try {
      for await (const item of iterable) {
        chunk.push(item);
        if (chunk.length >= chunk_size) {
          // Create payload with chunked data, preserving other properties
          const chunkPayload = { ...payload, data: chunk } as any;
          const event_data = `event: ${String(
            event_type
          )}\ndata: ${JSON.stringify(chunkPayload)}\n\n`;
          writeSuccess = await this.writeChunk(writer, event_data);
          if (!writeSuccess) break; // Stop iteration if write failed
          chunk = []; // Reset chunk
        }
      }
      // Send any remaining items after the loop finishes (if write hasn't failed)
      if (writeSuccess && chunk.length > 0) {
        // Create payload with remaining chunked data, preserving other properties
        const finalPayload = { ...payload, data: chunk } as any;
        const event_data = `event: ${String(
          event_type
        )}\ndata: ${JSON.stringify(finalPayload)}\n\n`;
        await this.writeChunk(writer, event_data);
      }
    } catch (error) {
      // Error during iteration itself
      console.error(
        `RiverEmitter: Error iterating stream for event ${String(event_type)}:`,
        error
      );
      // The connection is likely broken; cleanup will be triggered by write failure or cancellation.
    }
  }

  /**
   * Handles emitting a single event payload (stream: false or undefined).
   */
  private async emitSingleEvent<K extends keyof T>(
    writer: WritableStreamDefaultWriter,
    event_type: K,
    payload: EmitPayload<T, K> // Expects the specific payload type for the event
  ): Promise<void> {
    // Send the structured payload, correctly JSON stringified.
    const event_data = `event: ${String(event_type)}\ndata: ${JSON.stringify(
      payload
    )}\n\n`;
    await this.writeChunk(writer, event_data);
  }

  /**
   * Internal router to dispatch events to the correct handler (single vs. stream).
   * This is the function used by public methods like broadcast, sendToClient, and the stream callback's emit.
   */
  private async emitEventInternal<K extends keyof T>(
    writer: WritableStreamDefaultWriter,
    event_type: K,
    payload: EmitPayload<T, K> // Expects the specific payload type for the event
  ): Promise<void> {
    const event_config = this.eventDefinitions[event_type];

    // Check the definition provided during initialization
    if (event_config?.stream) {
      await this.emitStreamEvent(writer, event_type, payload);
    } else {
      await this.emitSingleEvent(writer, event_type, payload);
    }
  }

  /**
   * Generates standard SSE headers, merged with configured and override headers.
   * Intended to be used by the server framework when creating the HTTP Response.
   * @param headers_override - Specific headers to add or override for this response.
   */
  public headers(headers_override?: Record<string, string>): Headers {
    const defaultHeaders = {
      'Content-Type': 'text/event-stream',
      'Content-Encoding': 'none',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Sensible CORS defaults - consider making Access-Control-Allow-Origin configurable
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Origin, X-Requested-With, Content-Type, Accept'
    };

    return new Headers({
      ...defaultHeaders, // Start with SSE defaults
      ...this.config.headers, // Merge configured defaults
      ...headers_override // Apply specific overrides
    });
  }

  /**
   * Creates a ReadableStream for a new SSE connection.
   * The stream outputs Uint8Array chunks representing the SSE message payload.
   * @param options - Configuration for this specific stream connection.
   * @param options.callback - Function executed when the connection starts. Receives an `emit` function scoped to this client and the `clientId`.
   * @param options.clientId - Optional custom client ID. If not provided, a random one is generated.
   * @param options.ondisconnect - Optional callback executed when this client disconnects.
   * @param options.signal - Optional AbortSignal to link stream lifecycle to an external signal (e.g., HTTP request).
   */
  public stream({
    callback,
    clientId: customClientId,
    ondisconnect,
    signal
  }: {
    callback: (
      emit: <K extends keyof T>(
        event_type: K,
        payload: EmitPayload<T, K>
      ) => Promise<void>,
      clientId: string
    ) => void | Promise<void>; // Allow async setup
    clientId?: string;
    ondisconnect?: (clientId: string) => void;
    signal?: AbortSignal;
  }): ReadableStream<Uint8Array> {
    // Explicitly returns stream of bytes

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const emitterInstance = this; // Stable reference for closures
    let writerRef: WritableStreamDefaultWriter | null = null; // Ref for cancellation
    let clientIdRef: string | null = null; // Ref for cancellation/cleanup

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        // Use TransformStream for encoding and managing writer lifecycle conveniently
        const { readable, writable } = new TransformStream<string, Uint8Array>({
          transform(chunk, ctl) {
            ctl.enqueue(encoder.encode(chunk)); // Encode string messages to bytes
          }
        });

        writerRef = writable.getWriter();
        const writer = writerRef; // Local non-nullable ref for start scope

        clientIdRef = customClientId || Math.random().toString(36).slice(2, 9);
        const clientId = clientIdRef; // Local non-nullable ref

        // --- Idempotent Cleanup Function ---
        // Handles all disconnection aspects for this specific client.
        const cleanup = async (reason?: unknown) => {
          // Check if already cleaned up (idempotency)
          if (!emitterInstance.clients.has(clientId)) {
            return;
          }

          const reasonStr =
            reason instanceof Error ? reason.message : String(reason);
          console.debug(
            `RiverEmitter: Cleaning up client ${clientId}${
              reason ? ` (Reason: ${reasonStr})` : ''
            }`
          );

          // 1. Remove from active clients *before* potentially slow operations
          emitterInstance.clients.delete(clientId);

          // 2. Call user's disconnect callback
          if (ondisconnect) {
            try {
              ondisconnect(clientId);
            } catch (err) {
              console.error(
                `RiverEmitter: Error in ondisconnect for ${clientId}:`,
                err
              );
            }
          }

          // 3. Abort the writer to stop any pending writes and signal downstream
          if (writer) {
            // Don't await abort, just fire and forget. Catch potential rejection.
            writer.abort(reason).catch((_err) => {
              /* Usually safe to ignore abort errors */
            });
          }

          // 4. Ensure the main ReadableStream controller is closed if it's still active
          try {
            // desiredSize becomes null when closed/errored
            if (controller.desiredSize !== null) {
              controller.close(); // Graceful close if possible
            }
          } catch {
            /* Ignore error if already closed/errored */
          }
        };
        // ------------------------------------

        // Store client info including the specific cleanup function
        emitterInstance.clients.set(clientId, { writer, cleanup });

        // Typed emit function scoped to this client's writer
        const emit = async <K extends keyof T>(
          event_type: K,
          payload: EmitPayload<T, K>
        ): Promise<void> => {
          // Only attempt to emit if the client is still considered connected
          if (emitterInstance.clients.has(clientId)) {
            await emitterInstance.emitEventInternal(writer, event_type, payload);
          } else {
            console.warn(
              `RiverEmitter: Attempted to emit to disconnected client ${clientId}`
            );
            // Optionally throw an error here if needed
            // throw new Error(`Client ${clientId} is disconnected.`);
          }
        };

        // --- Event Listener Handling ---
        const externalAbortHandler = () => {
          console.debug(
            `RiverEmitter: External signal aborted for client ${clientId}.`
          );
          cleanup('External Signal Abort'); // Trigger cleanup
        };
        // Add listener if signal is provided
        signal?.addEventListener('abort', externalAbortHandler, { once: true });

        // Cleanup listener when the stream naturally ends or errors
        const removeSignalListener = () => {
          signal?.removeEventListener('abort', externalAbortHandler);
        };
        // --- End Event Listener Handling ---

        // Pipe the encoded bytes to the main stream controller
        readable
          .pipeTo(
            new WritableStream({
              write(chunk) {
                try {
                  if (controller.desiredSize !== null) {
                    controller.enqueue(chunk);
                  } else {
                    // Controller closed, stop piping (shouldn't happen often if cleanup works)
                    console.warn(
                      `RiverEmitter: Controller closed for ${clientId}, but pipe write attempted.`
                    );
                    // Might need to abort the readable side of transform stream here?
                  }
                } catch (error) {
                  console.error(
                    `RiverEmitter: Error enqueueing chunk for client ${clientId}:`,
                    error
                  );
                  cleanup('Enqueue Error'); // Trigger cleanup on enqueue failure
                }
              },
              close() {
                // Internal pipe finished gracefully - usually means writer was closed intentionally
                // console.debug(`RiverEmitter: Internal pipe closed for ${clientId}`);
                removeSignalListener();
                try {
                  if (controller.desiredSize !== null) {
                    controller.close(); // Ensure main controller is also closed
                  }
                } catch {
                  /* Ignore */
                }
              },
              abort(reason) {
                console.error(
                  `RiverEmitter: Internal pipe aborted for client ${clientId}:`,
                  reason
                );
                removeSignalListener();
                // Abort here likely means connection issue from source (writer)
                cleanup(reason ?? 'Internal Pipe Abort'); // Trigger cleanup
                try {
                  if (controller.desiredSize !== null) {
                    controller.error(reason); // Signal error to stream consumer
                  }
                } catch {
                  /* Ignore */
                }
              }
            })
          )
          .catch((error) => {
            // Catch errors from the piping process itself (less common)
            console.error(
              `RiverEmitter: Error piping stream for client ${clientId}:`,
              error
            );
            cleanup(error ?? 'Pipe Error'); // Trigger cleanup
            removeSignalListener();
          });

        // Watch for the writer closing/erroring independently (e.g., write error caught by writeChunk)
        writer.closed
          .catch((error) => {
            console.warn(
              `RiverEmitter: Writer closed unexpectedly for client ${clientId}:`,
              error
            );
            cleanup(error ?? 'Writer Closed Error'); // Trigger cleanup
          })
          .finally(() => {
            // Always remove listener when writer loop finishes, regardless of success/error
            removeSignalListener();
          });

        // Execute the user's setup callback
        try {
          console.log(`RiverEmitter: Client ${clientId} connected.`);
          await callback(emit, clientId);
          // If the callback completing naturally means the stream should end,
          // you might close the writer here:
          // await writer.close(); // This would trigger the pipe close/cleanup path.
          // Usually for SSE, the connection stays open until explicitly closed or cancelled.
        } catch (error) {
          console.error(
            `RiverEmitter: Error in stream callback for client ${clientId}:`,
            error
          );
          if (controller.desiredSize !== null) {
            controller.error(error); // Propagate callback error to the stream consumer
          }
          await cleanup(error); // Ensure cleanup happens on callback error
        }
      },

      // cancel is called when the *consumer* of the ReadableStream stops reading
      // (e.g., browser closes connection, or downstream pipe breaks)
      async cancel(reason) {
        console.debug(
          `RiverEmitter: Stream cancelled for client ${clientIdRef}${
            reason ? ` (Reason: ${reason})` : ''
          }`
        );
        const clientId = clientIdRef; // Get the captured clientId
        if (clientId) {
          const clientInfo = emitterInstance.clients.get(clientId);
          if (clientInfo) {
            // Call the specific cleanup function associated with this client
            await clientInfo.cleanup(reason ?? 'Cancel'); // Pass reason
          }
        }
        // No need to iterate all clients here! This only affects the cancelled stream.
      }
    });

    return stream;
  }

  /**
   * Sends an event to all currently connected clients.
   * Uses Promise.allSettled to attempt sending to all, even if some fail.
   */
  public async broadcast<K extends keyof T>(
    event_type: K,
    payload: EmitPayload<T, K>
  ): Promise<void> {
    // Get a stable list of client entries [clientId, clientInfo] *before* awaiting
    const clientEntries = Array.from(this.clients.entries());
    if (clientEntries.length === 0) {
      return; // Nothing to broadcast to
    }

    const promises = clientEntries.map(
      (
        [, { writer }] // Only need writer for the promise
      ) => this.emitEventInternal(writer, event_type, payload)
    );

    const results = await Promise.allSettled(promises);

    // Process results, relating back to the stable clientEntries list
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        // Get the corresponding client entry using the index
        const clientEntry = clientEntries[index]; // Type is [string, ClientInfo] | undefined

        // *** FIX: Check if clientEntry exists before accessing it ***
        if (clientEntry) {
          const clientId = clientEntry[0]; // Safely access the clientId (the key)
          console.error(
            `RiverEmitter: Failed to broadcast event ${String(
              event_type
            )} to client ${clientId}:`,
            result.reason
          );

          // Optional: Attempt to disconnect the client that failed broadcasting
          // Consider potential race conditions if broadcast is called very frequently
          // this.disconnectClient(clientId);
        } else {
          // This case indicates a logic error or unexpected concurrent modification,
          // but satisfies TypeScript's check.
          console.error(
            `RiverEmitter: Mismatch processing broadcast result at index ${index}. Client entry not found.`
          );
        }
      }
    });
  }

  /**
   * Gracefully disconnects a specific client by closing its writer.
   * The cleanup function associated with the client will handle map removal and ondisconnect.
   * @param clientId - The ID of the client to disconnect.
   */
  public async disconnectClient(clientId: string): Promise<void> {
    const clientInfo = this.clients.get(clientId);
    if (clientInfo) {
      console.log(
        `RiverEmitter: Disconnecting client ${clientId} by server request.`
      );
      // Trigger the cleanup process for this specific client
      await clientInfo.cleanup('Server Disconnect Request');
    } else {
      console.warn(
        `RiverEmitter: Attempted to disconnect non-existent client ${clientId}`
      );
    }
  }

  /**
   * Sends an event to a single specific client identified by its ID.
   */
  public async sendToClient<K extends keyof T>(
    clientId: string,
    event_type: K,
    payload: EmitPayload<T, K>
  ): Promise<void> {
    const clientInfo = this.clients.get(clientId);
    if (clientInfo) {
      try {
        await this.emitEventInternal(clientInfo.writer, event_type, payload);
      } catch (error) {
        console.error(
          `RiverEmitter: Error sending event ${String(
            event_type
          )} to client ${clientId}:`,
          error
        );
        // Optional: Trigger disconnect on send error
        // await clientInfo.cleanup(error ?? `Send Error to ${clientId}`);
      }
    } else {
      // Log if trying to send to a client that's no longer in the map
      console.warn(
        `RiverEmitter: Client ${clientId} not found for sendToClient event ${String(
          event_type
        )}.`
      );
    }
  }

  /**
   * Returns an array of IDs of all currently connected clients.
   */
  public getConnectedClients(): string[] {
    return Array.from(this.clients.keys());
  }
}
