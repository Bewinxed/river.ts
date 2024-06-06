import type { BaseEvent, EventHandler } from "@/types/core";
import { RiverStream } from "./client";
import { ServerRiverStream } from "./server";

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
