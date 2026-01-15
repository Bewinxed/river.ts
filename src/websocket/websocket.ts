// src/websocket/adapter.ts
import type { EventMap, EventData } from '../types/core';
import { RequestTimeoutError, WebSocketClosedError } from '../types/core';

/**
 * Environment-agnostic WebSocket adapter
 * Can be plugged into existing WebSocket implementations
 */
/** Pending request tracking for request/response semantics */
interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class RiverSocketAdapter<T extends EventMap> {
  private events: T;
  private eventHandlers: {
    [K in keyof T]?: Set<(data: EventData<T, K>, metadata?: any) => void>;
  } = {};
  private debug: boolean = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;

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
          const { type, data, id } = parsed;

          // Check if this is a response to a pending request
          if (id && typeof id === 'string' && this.pendingRequests.has(id)) {
            const pending = this.pendingRequests.get(id)!;
            this.pendingRequests.delete(id);
            clearTimeout(pending.timeout);
            pending.resolve(data);
            return;
          }

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
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    // Use crypto.randomUUID if available, otherwise fall back to counter + timestamp
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `req-${Date.now()}-${++this.requestIdCounter}`;
  }

  /**
   * Send a message and wait for a response with matching id.
   * Implements RPC-style request/response semantics over WebSocket.
   *
   * @param type - Event type
   * @param data - Event payload
   * @param sendFn - Function to send the message (e.g., ws.send)
   * @param timeout - Timeout in ms (default: 30000)
   * @returns Promise that resolves with response data
   * @throws RequestTimeoutError if no response within timeout
   * @throws WebSocketClosedError if WebSocket closes while request is pending
   */
  public request<TResponse = unknown, K extends keyof T = keyof T>(
    type: K,
    data: T[K]['data'],
    sendFn: (message: string) => void,
    timeout: number = 30000
  ): Promise<TResponse> {
    const id = this.generateRequestId();

    return new Promise<TResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new RequestTimeoutError(String(type), timeout));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timeout: timeoutId
      });

      try {
        const message = JSON.stringify({ type, data, id });
        if (this.debug) {
          console.log('Sending request:', message.substring(0, 100));
        }
        sendFn(message);
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Clear all pending requests (e.g., when WebSocket closes)
   * Should be called when the WebSocket connection is closed.
   */
  public clearPendingRequests(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new WebSocketClosedError());
    }
    this.pendingRequests.clear();
  }

  /**
   * Get the number of pending requests
   */
  public getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Check if there are any pending requests
   */
  public hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
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
