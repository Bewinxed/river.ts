//
import type { HTTPMethods } from "../types/http.js";
import {
	type EventMap,
	type BaseEvent,
	type EventHandler,
	RiverError,
	type RiverConfig,
} from "../types/core.js";

/**
 * River class represents a client-side event stream.
 * It extends the EventTarget class and provides methods for event handling.
 * @template T - The type of the event map.
 */
export class RiverClient<T extends EventMap> extends EventTarget {
	/**
	 * An object to store event handlers.
	 * Each key in the object corresponds to an event type, and its value is a function that handles that event.
	 * @type {{ [K in keyof T]?: EventHandler<T[K]> }}
	 */
	public handlers: { [K in keyof T]?: EventHandler<T[K]> } = {};

	/**
	 * Stores the request information for event streaming.
	 * @type {RequestInfo | undefined}
	 */
	private request_info?: RequestInfo;

	/**
	 * Stores the initialization options for event streaming requests.
	 * @type {(RequestInit & { method: HTTPMethods }) | undefined}
	 */
	private request_init?: RequestInit & { method: HTTPMethods };

	/**
	 * Keeps track of the number of reconnection attempts made during event streaming.
	 * @type {number}
	 */
	private reconnectAttempts = 0;

	/**
	 * The delay (in milliseconds) between each reconnection attempt during event streaming.
	 * @type {number}
	 */
	private reconnectDelay = 1000;

	/**
	 * Represents an EventSource object for server-sent events. Used when performing GET requests.
	 * @type {EventSource | undefined}
	 */
	private eventSource?: EventSource;

	/**
	 * An AbortController instance used to abort fetch requests during event streaming.
	 * @type {AbortController | undefined}
	 */
	private abortController?: AbortController;

	/**
	 * A flag indicating whether the River instance is in the process of closing.
	 * This helps prevent unnecessary reconnection attempts after closing.
	 * @type {boolean}
	 */
	private closing = false;

	/**
	 * Initializes a new instance of the River class.
	 * @param events - The event map object.
	 * @param config - The configuration options for the River instance.
	 */
	private constructor(
		private events: T,
		private config: RiverConfig = {},
	) {
		super();
		this.config = config;
	}

	public static init<T extends EventMap>(
		events: T,
		config?: RiverConfig,
	): RiverClient<T> {
		return new RiverClient<T>(events, config);
	}

	// function to get return type of specific event
	public event<K extends keyof T>(event_type: K): T[K] {
		return this.events[event_type];
	}

	/**
	 * Registers an event handler for a specific event type.
	 * @template K - The key of the event type in the event map.
	 * @param event_type - The event type to listen for, which must be a valid key in the event map.
	 * @param handler - A callback function that handles events of the specified type and receives an argument containing the event data.
	 * @returns The River instance with the added event listener, allowing method chaining.
	 */
	public on<K extends keyof T>(
		event_type: K,
		handler: (data: T[K]) => void,
	): this {
		const wrapped_handler = (event: CustomEvent<T[K]>) => {
			if (this.events[event_type]) {
				handler(event.detail as T[K]);
			}
		};
		// Add an event listener for the specified event type using the provided callback function.
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
		const event = new CustomEvent<T[K]>(event_type as string, {
			detail: data as T[K],
		});
		this.dispatchEvent(event);
	}

	/**
	 * Prepares the River instance with request information.
	 * @param input - The request info.
	 * @param init - The request init options.
	 * @returns The River instance.
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
			throw new RiverError("Request information not set.");
		}

		if (
			this.request_init?.headers ||
			(this.request_init?.method ?? "GET") !== "GET" ||
			EventSource === undefined
		) {
			try {
				this.abortController = new AbortController();
				await this.fetch_event_stream();
			} catch (error) {
				if (this.closing) {
					return;
				}
				console.error("Error during fetch stream:", (error as Error)?.message);
				await this.reconnect();
			}
		} else {
			this.eventSource = new EventSource(this.request_info.toString());

			const custom_event_listener = (event: MessageEvent) => {
				{
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
				}
			};

			this.eventSource.onmessage = custom_event_listener;
			for (const event_type in this.events) {
				this.eventSource.addEventListener(event_type, custom_event_listener);
			}

			this.eventSource.onerror = (error) => {
				console.error("EventSource error:", error);
				this.close();
				this.reconnect();
			};
		}
	}

	private async fetch_event_stream(): Promise<void> {
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		const response = await fetch(this.request_info!, {
			headers: this.config.headers,
			...this.request_init,
			signal: this.abortController?.signal,
		});

		if (!response.ok || !response.body) {
			throw new RiverError(
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
					let baseEvent: BaseEvent = {
						type: "",
						message: "",
						data: null,
						error: null,
					};

					for (const line of lines) {
						if (line.startsWith("event:")) {
							baseEvent.type = line.slice(6).trim();
						} else if (line.startsWith("data:")) {
							const data = line.slice(5).trim();
							try {
								const type = baseEvent.type;
								baseEvent = JSON.parse(data);
								baseEvent.type = type;
							} catch (error) {
								baseEvent.message = data;
							}
						} else if (line.startsWith("id:")) {
							// Handle event ID if needed
						} else if (line.startsWith("retry:")) {
							const retryDelay = Number.parseInt(line.slice(6).trim(), 10);
							if (!Number.isNaN(retryDelay)) {
								this.reconnectDelay = retryDelay;
							}
						}
					}

					if (baseEvent.type === "error") {
						baseEvent.error = baseEvent.data;
					}

					this.handle_event(baseEvent.type as keyof T, baseEvent as T[keyof T]);
				}
			}
		}
	}

	public close(): void {
		this.closing = true;
		if (this.eventSource) {
			this.eventSource.close();
			this.eventSource = undefined;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = undefined;
		}
		this.dispatchEvent(new CustomEvent("close"));
	}

	private async reconnect(): Promise<void> {
		this.reconnectAttempts++;
		console.log(`Reconnecting in ${this.reconnectDelay}ms...`);
		await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay));
		await this.stream();
	}
}
