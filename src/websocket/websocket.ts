// src/websocket/adapter.ts
import type { EventMap, EventData } from '../types/core';

/**
 * Environment-agnostic WebSocket adapter
 * Can be plugged into existing WebSocket implementations
 */
export class RiverSocketAdapter<T extends EventMap> {
  private events: T;
  private eventHandlers: {
    [K in keyof T]?: Set<(data: EventData<T, K>, metadata?: any) => void>;
  } = {};

  constructor(events: T) {
    this.events = events;
  }

  /**
   * Register an event handler
   */
  public on<K extends keyof T>(
    type: K,
    handler: (data: EventData<T, K>, metadata?: any) => void
  ): this {
    if (!this.eventHandlers[type]) {
      this.eventHandlers[type] = new Set();
    }
    this.eventHandlers[type]?.add(handler);
    return this;
  }

  /**
   * Unregister an event handler
   */
  public off<K extends keyof T>(
    type: K,
    handler: (data: EventData<T, K>, metadata?: any) => void
  ): this {
    this.eventHandlers[type]?.delete(handler);
    return this;
  }

  /**
   * Handle an incoming message from any WebSocket implementation
   * Can be plugged into any existing onmessage handler
   */
  public handleMessage(
    message: string | Buffer | ArrayBuffer | Blob,
    metadata?: any
  ): void {
    try {
      // Convert message to string if needed
      const messageStr =
        typeof message === 'string'
          ? message
          : message instanceof Blob
          ? '[Blob data]' // Would need async handling for Blobs
          : new TextDecoder().decode(message as ArrayBuffer);

      // Parse the message
      const { type, data } = JSON.parse(messageStr);

      // Dispatch to handlers
      this.dispatchEvent(type, data, metadata);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  /**
   * Create a message string ready to be sent
   * Can be used with any send method
   */
  public createMessage<K extends keyof T>(type: K, data: T[K]['data']): string {
    return JSON.stringify({ type, data });
  }

  /**
   * Helper to send a message if you provide a send function
   * Works with any WebSocket implementation
   */
  public send<K extends keyof T>(
    type: K,
    data: T[K]['data'],
    sendFn: (message: string) => void
  ): boolean {
    try {
      const message = this.createMessage(type, data);
      sendFn(message);
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }

  /**
   * Dispatch an event to registered handlers
   */
  private dispatchEvent<K extends keyof T>(
    type: K,
    data: any,
    metadata?: any
  ): void {
    const handlers = this.eventHandlers[type];
    if (handlers) {
      handlers.forEach((handler) => {
        handler(data as EventData<T, K>, metadata);
      });
    }
  }
}
