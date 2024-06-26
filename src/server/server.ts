// server.ts

import type { BaseEvent, RiverConfig } from "../types/core";
import { EventEmitter } from "node:events";

export class RiverEmitter<
	T extends Record<string, BaseEvent>,
> extends EventEmitter {
	private clients = new Set<WritableStreamDefaultWriter>();

	constructor(
		private events: T,
		private config: RiverConfig = {},
	) {
		super();
		this.events = events;
		this.config = config;
	}

	/**
	 * Creates a new River instance.
	 * @template T - The type of the event map.
	 * @param events - The event map object containing the event types and their data structures.
	 * @returns A new River instance with the specified event map.
	 */
	public static init<T extends Record<string, BaseEvent>>(
		events: T,
		config?: RiverConfig,
	): RiverEmitter<T> {
		return new RiverEmitter<T>(events, config);
	}

	public register_client(client: WritableStreamDefaultWriter): void {
		if (!client) {
			throw new Error("Client writer is undefined");
		}

		const headers = new Headers({
			"Content-Type": "text/event-stream",
			"Content-Encoding": "none",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers":
				"Origin, X-Requested-With, Content-Type, Accept",
			...this.config.headers,
		});

		for (const [key, value] of Object.entries(headers)) {
			client.write(`${key}: ${value}\n`);
		}

		this.clients.add(client);

		if (this.config.headers) {
		}

		client.closed.then(() => {
			this.clients.delete(client);
		});
	}

	public emit_event<K extends keyof T>(
		event_type: K,
		data: Omit<T[K], "type">,
	): void {
		console.log("Sending event", event_type);
		const event_data = `event: ${String(event_type)}\ndata: ${
			data.data ? JSON.stringify(data.data as T[K]) : data.message
		}\n\n`;
		for (const client of this.clients) {
			client.write(event_data);
		}
	}

	public headers(headers_override?: Record<string, string>): Headers {
		const headers = new Headers({
			"Content-Type": "text/event-stream",
			"Content-Encoding": "none",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers":
				"Origin, X-Requested-With, Content-Type, Accept",
			...this.config.headers,
			...headers_override,
		});
		return headers;
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
						},
					}),
				);
			},
		});
	}
}
