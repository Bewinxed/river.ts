/**
 * Custom error type for RiverStream errors.
 */
export class RiverStreamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RiverStreamError";
	}
}

/**
 * Configuration options for RiverStream and ServerRiverStream.
 */
export interface RiverStreamConfig {
	headers?: Record<string, string>;
	bufferSize?: number;
}

export interface BaseEvent {
	type: string;
	message?: string;
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	data?: any;
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	error?: any;
}

export type EventHandler<T extends BaseEvent> = (data: T) => void;

export type EventMap = Record<string, BaseEvent>;
