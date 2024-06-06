// builder.ts
import type { BaseEvent, EventHandler } from "@/types/core";
import { RiverStream } from "./client";
import { ServerRiverStream } from "./server";

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export class River<T extends Record<string, BaseEvent> = {}> {
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
	public map_event<
		K extends string,
		E extends Omit<
			{
				type: string;
				message?: string;
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				data?: any;
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				error?: any;
			},
			"type"
		>,
	>(
		event_type: K,
		example_event: E,
	): River<T & Record<K, E & { type: K }>> {
		if (example_event) {
            // @ts-ignore
			example_event.type = event_type;
		}
		// @ts-ignore
		this.events[event_type] = example_event as E & { type: K };

		return new River<T & Record<K, E & { type: K }>>(
			this.events as T & Record<K, E & { type: K }>,
		);
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
