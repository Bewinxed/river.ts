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
  private debug: boolean = false;

  constructor(events: T, options: { debug: boolean } = { debug: false }) {
    this.events = events;
    this.debug = options.debug;
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
   * Enhanced for Autobahn compliance tests
   */
  public handleMessage(
    message: string | Buffer | ArrayBuffer | Uint8Array | Blob,
    metadata?: any
  ): void {
    try {
      // For Autobahn tests, we need to handle all kinds of data
      // but we don't want to try parsing binary data as JSON

      // Handle binary data directly
      if (
        message instanceof ArrayBuffer ||
        message instanceof Uint8Array ||
        (typeof Buffer !== 'undefined' && message instanceof Buffer)
      ) {
        if (this.debug) {
          console.log('Received binary data:', message);
        }
        this.dispatchRawMessage(message, metadata);
        return;
      }

      // Handle Blob asynchronously
      if (typeof Blob !== 'undefined' && message instanceof Blob) {
        if (this.debug) {
          console.log('Received Blob data');
        }
        this.dispatchRawMessage(message, metadata);
        return;
      }

      // Handle string message
      if (typeof message === 'string') {
        if (this.debug) {
          console.log('Received string data:', message.substring(0, 100));
        }

        // Try to parse as JSON, but don't fail if not valid JSON
        try {
          const parsed = JSON.parse(message);
          const { type, data } = parsed;

          // Only dispatch if we have a valid type
          if (
            type &&
            typeof type === 'string' &&
            this.events[type as keyof T]
          ) {
            this.dispatchEvent(type as keyof T, data, metadata);
            return;
          }
        } catch (error) {
          // Not valid JSON, just continue to raw handler
          if (this.debug) {
            console.log('Not valid JSON, treating as raw message');
          }
        }

        // If we reach here, either it wasn't JSON or didn't have a valid type
        this.dispatchRawMessage(message, metadata);
        return;
      }

      // If we get here, dispatch as raw
      this.dispatchRawMessage(message, metadata);
    } catch (error) {
      // Safety net for any errors
    }
  }

  /**
   * Dispatch a raw message to the 'message' event handlers
   */
  private dispatchRawMessage(data: any, metadata?: any): void {
    const messageEventType = 'message' as keyof T;
    if (this.eventHandlers[messageEventType]) {
      this.dispatchEvent(messageEventType, data, metadata);
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
