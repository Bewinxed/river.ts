//
import type { HTTPMethods } from "@/types/http.js";
import {
	type EventMap,
	type BaseEvent,
	type EventHandler,
	RiverStreamError,
	type RiverStreamConfig,
} from "@/types/core";

/**
 * RiverStream class represents a client-side event stream.
 * It extends the EventTarget class and provides methods for event handling.
 * @template T - The type of the event map.
 */
export class RiverStream<T extends EventMap> extends EventTarget {
	public handlers: { [K in keyof T]?: EventHandler<T[K]> } = {};
	private request_info?: RequestInfo;
	private request_init?: RequestInit & { method: HTTPMethods };
	private reconnectAttempts = 0;
	private reconnectDelay = 1000;
	private eventSource?: EventSource;
	private abortController?: AbortController;
	private closing = false;

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
		handler: (data: T[K]) => void,
	): this {
		const wrapped_handler = (event: CustomEvent<T[K]>) => {
			if (this.events[event_type]) {
				handler(event.detail as T[K]);
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
		const event = new CustomEvent<T[K]>(event_type as string, {
			detail: data as T[K],
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
			try {
				this.abortController = new AbortController();
				await this.startFetchStream();
			} catch (error) {
				if (this.closing) {
					return;
				}
				console.error("Error during fetch stream:", (error as Error)?.message);
				await this.reconnect();
			}
		} else {
			this.eventSource = new EventSource(this.request_info.toString());

			this.eventSource.onmessage = (event) => {
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

			this.eventSource.onerror = (error) => {
				console.error("EventSource error:", error);
				this.close();
				this.reconnect();
			};
		}
	}

	private async startFetchStream(): Promise<void> {
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		const response = await fetch(this.request_info!, {
			...this.request_init,
			signal: this.abortController?.signal,
		});

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
