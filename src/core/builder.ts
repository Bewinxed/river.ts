// builder.ts
import type { BaseEvent, EventHandler } from "../types/core";
import { RiverStream } from "./client";
import { ServerRiverStream } from "./server";

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export class River<T extends Record<string, BaseEvent> = {}> {
	/**
	 * A dictionary of event handlers. Each key corresponds to an event type and its associated handler function.
	 */
	private handlers: { [K in keyof T]?: EventHandler<T[K]> } = {};

	/**
	 * Creates a new River instance with an optional initial event map.
	 * @param events - The initial event map. Defaults to an empty object.
	 */
	constructor(private events: T = {} as T) {}

	/**
	 * Maps an event type to the event map and returns a new River instance with the updated event map.
	 * @template K - The key of the event type.
	 * @template E - The event type, which extends from an object that contains 'message' and 'error' properties (optional).
	 * @param event_type - The event type key.
	 * @param example_event - An optional example event to be added to the event map.
	 * @returns A new River instance with the updated event map.
	 */
	public map_event<
		K extends string,
		E extends Omit<BaseEvent, "type"> = BaseEvent,
	>(event_type: K, example_event?: E): River<T & Record<K, E & { type: K }>> {
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
	 * Builds and returns the event map that has been constructed using the `map_event` method.
	 * @returns {T} The built event map.
	 */
	public build(): T {
		return this.events;
	}

	/**
	 * Initializes a new RiverStream instance for client-side usage with the current event map, allowing you to subscribe and emit events.
	 * @returns {RiverStream<T>} The initialized RiverStream instance.
	 */
	public client(): RiverStream<T> {
		return RiverStream.init<T>(this.events);
	}

	/**
	 * Initializes a new ServerRiverStream instance for server-side usage with the current event map, allowing you to subscribe and emit events.
	 * @returns {ServerRiverStream<T>} The initialized ServerRiverStream instance.
	 */
	public server(): ServerRiverStream<T> {
		return new ServerRiverStream<T>(this.events);
	}
}
