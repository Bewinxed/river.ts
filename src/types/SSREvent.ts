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