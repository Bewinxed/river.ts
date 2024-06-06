import type { EventMap, BaseEvent, EventHandler } from "../types/SSREvent";
import type { HTTPMethods } from "../types/http";
import { EventEmitter } from "node:events";
import { IncomingMessage, ServerResponse } from "node:http";

/**
 * Custom error type for RiverStream errors.
 */
class RiverStreamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RiverStreamError";
	}
}

/**
 * Configuration options for RiverStream and ServerRiverStream.
 */
interface RiverStreamConfig {
	headers?: Record<string, string>;
	bufferSize?: number;
}

/**
 * EventTypeBuilder class for building event types.
 * @template T - The type of the event map.
 */

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export class EventTypeBuilder<T extends Record<string, BaseEvent> = {}> {
	private handlers: { [K in keyof T]?: EventHandler<T[K]> } = {};

	constructor(private events: T = {} as T) {}

	/**
	 * Maps an event type to the event map.
	 * @template K - The key of the event type.
	 * @template E - The event type.
	 * @param event_type - The event type key.
	 * @param example_event - An optional example event.
	 * @returns The updated EventTypeBuilder instance.
	 */
	public map_event<K extends string, E extends BaseEvent>(
		event_type: K,
		example_event?: Omit<E, "type">,
	): EventTypeBuilder<T & Record<K, E & { type: K }>> {
		const new_events: T & Record<K, E & { type: K }> = {
			...this.events,
			[event_type]: { type: event_type, ...example_event } as E & { type: K },
		};

		return new EventTypeBuilder<T & Record<K, E & { type: K }>>(new_events);
	}

	/**
	 * Builds the event map.
	 * @returns The built event map.
	 */
	public build(): T {
		return this.events;
	}

	/**
	 * Creates a RiverStream instance.
	 * @returns The RiverStream instance.
	 */
	public client(): RiverStream<T> {
		return RiverStream.init<T>(this.events);
	}

	/**
	 * Creates a ServerRiverStream instance.
	 * @returns The ServerRiverStream instance.
	 */
	public server(): ServerRiverStream<T> {
		return new ServerRiverStream<T>(this.events);
	}
}

/**
 * RiverStream class represents a client-side event stream.
 * It extends the EventTarget class and provides methods for event handling.
 * @template T - The type of the event map.
 */
class RiverStream<T extends EventMap> extends EventTarget {
	public handlers: { [K in keyof T]?: EventHandler<T[K]> } = {};
	private request_info?: RequestInfo;
	private request_init?: RequestInit & { method: HTTPMethods };

	/**
	 * Initializes a new instance of the RiverStream class.
	 * @param events - The event map object.
	 * @param config - The configuration options for the RiverStream instance.
	 */
	private constructor(
		private events: T,
		private config: RiverStreamConfig = {},
	) {
		super();
	}

	/**
	 * Creates a new RiverStream instance.
	 * @template T - The type of the event map.
	 * @param events - The event map object.
	 * @returns The RiverStream instance.
	 */
	public static init<T extends EventMap>(events: T): RiverStream<T> {
		return new RiverStream<T>(events);
	}

	/**
	 * Registers an event handler for the specified event type.
	 * @template K - The key of the event type.
	 * @param event_type - The event type key.
	 * @param handler - The event handler function.
	 * @returns The RiverStream instance.
	 */
	public on<K extends keyof T>(
		event_type: K,
		handler: EventHandler<T[K]>,
	): this {
		const wrapped_handler = (event: CustomEvent<T[K]>) => {
			if (this.events[event_type]) {
				handler(event.detail);
			}
		};
		this.addEventListener(
			event_type as string,
			wrapped_handler as EventListener,
		);
		return this;
	}

	/**
	 * Handles an event by dispatching a CustomEvent.
	 * @template K - The key of the event type.
	 * @param event_type - The event type key.
	 * @param data - The event data.
	 */
	private handle_event<K extends keyof T>(event_type: K, data: T[K]): void {
		console.log("Received event:", event_type);
		console.log("Event data:", data);
		const event = new CustomEvent<T[K]>(event_type as string, {
			detail: data,
		});
		this.dispatchEvent(event);
	}

	/**
	 * Prepares the RiverStream instance with request information.
	 * @param input - The request info.
	 * @param init - The request init options.
	 * @returns The RiverStream instance.
	 */
	public prepare(
		input: RequestInfo,
		init?: RequestInit & { method: HTTPMethods },
	): this {
		this.request_info = input;
		this.request_init = init;
		return this;
	}

	/**
	 * Starts the event streaming.
	 * This uses EventSource on GET requests, and Fetch with bodyreader otherwise
	 */
	public async stream(): Promise<void> {
        if (!this.request_info) {
          throw new RiverStreamError("Request information not set.");
        }
        if (this.request_init?.body || EventSource === undefined) {
          const response = await fetch(this.request_info, this.request_init);
          if (!response.ok || !response.body) {
            throw new RiverStreamError(
              `Failed to fetch: ${response.status} ${response.statusText}`,
            );
          }
      
          const reader = response.body.getReader();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log("Stream finished");
              break;
            }
            buffer += new TextDecoder().decode(value);
            const events = buffer.split("\n\n");
            buffer = events.pop() || "";
      
            for (const event of events) {
              if (event.trim() !== "") {
                const lines = event.trim().split("\n");
                const eventType = lines
                  .find((line) => line.startsWith("event:"))
                  ?.slice(6)
                  .trim();
                const eventData = lines
                  .find((line) => line.startsWith("data:"))
                  ?.slice(5)
                  .trim();
      
                const baseEvent: BaseEvent = {
                  type: eventType || "message",
                  message: "",
                  data: null,
                  error: null,
                };
      
                if (eventData) {
                  try {
                    baseEvent.data = JSON.parse(eventData);
                  } catch (error) {
                    baseEvent.message = eventData;
                  }
                }
      
                if (eventType === "error") {
                  baseEvent.error = eventData;
                }
      
                this.handle_event(baseEvent.type as keyof T, baseEvent as T[keyof T]);
              }
            }
          }
        } else {
          const source = new EventSource(this.request_info.toString());
          source.onmessage = (event) => {
            const baseEvent: BaseEvent = {
              type: event.type,
              message: event.data,
              data: null,
              error: null,
            };
      
            try {
              baseEvent.data = JSON.parse(event.data);
            } catch (error) {
              // If parsing fails, the data is not JSON and will remain as a string in the `message` field
            }
      
            this.handle_event(baseEvent.type as keyof T, baseEvent as T[keyof T]);
          };
      
          source.onerror = (error) => {
            const baseEvent: BaseEvent = {
              type: "error",
              message: "",
              data: null,
              error: error,
            };
            this.handle_event(baseEvent.type as keyof T, baseEvent as T[keyof T]);
          };
        }
      }
}

class ServerRiverStream<T extends EventMap> extends EventEmitter {
	private clients = new Set<WritableStreamDefaultWriter>();

	constructor(
		private event_map: T,
		private config: RiverStreamConfig = {},
	) {
		super();
	}

	public register_client(client: WritableStreamDefaultWriter): void {
		if (!client) {
			throw new Error("Client writer is undefined");
		}

		this.clients.add(client);

		client.closed.then(() => {
			this.clients.delete(client);
		});
	}

	public emit_event<K extends keyof T>(event_type: K, data: T[K]): void {
		console.log("Sending event", event_type);
		const event_data = `event: ${String(event_type)}\ndata: ${JSON.stringify(
			data,
		)}\n\n`;
		for (const client of this.clients) {
			client.write(event_data);
		}
	}

	public stream(
		callback: (emitter: ServerRiverStream<T>) => void,
	): ReadableStream {
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
						},
					}),
				);
			},
		});
	}
}
