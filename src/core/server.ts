// server.ts

import type { BaseEvent, RiverStreamConfig } from "@/types/core";
import { EventEmitter } from "node:events";

export class ServerRiverStream<
	T extends Record<string, BaseEvent>,
> extends EventEmitter {
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

		// write headers for event stream
		client.write("Content-Type: text/event-stream\n\n");
		// cors
		client.write("Access-Control-Allow-Origin: *\n\n");
		client.write(
			"Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept",
		);
		// keep connection alive
		client.write("Cache-Control: no-cache, no-transform\n\n");
		client.write("Connection: keep-alive\n\n");

		this.clients.add(client);

		client.closed.then(() => {
			this.clients.delete(client);
		});
	}

    public emit_event<K extends keyof T>(event_type: K, data: Omit<T[K], 'type'>): void {
        console.log("Sending event", event_type);
        const event_data = `event: ${String(event_type)}\ndata: ${JSON.stringify(data as T[K])}\n\n`;
        for (const client of this.clients) {
            client.write(event_data);
        }
    }

	public headers(headers_override?: Record<string, string>): Headers {
		const headers = new Headers({
			"Content-Type": "text/event-stream",
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
