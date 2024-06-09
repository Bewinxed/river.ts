import {
  RiverError
} from "../types/core.js";
export class RiverClient extends EventTarget {
  /**
   * Initializes a new instance of the River class.
   * @param events - The event map object.
   * @param config - The configuration options for the River instance.
   */
  constructor(events, config = {}) {
    super();
    this.events = events;
    this.config = config;
    this.config = config;
  }
  /**
   * An object to store event handlers.
   * Each key in the object corresponds to an event type, and its value is a function that handles that event.
   * @type {{ [K in keyof T]?: EventHandler<T[K]> }}
   */
  handlers = {};
  /**
   * Stores the request information for event streaming.
   * @type {RequestInfo | undefined}
   */
  request_info;
  /**
   * Stores the initialization options for event streaming requests.
   * @type {(RequestInit & { method: HTTPMethods }) | undefined}
   */
  request_init;
  /**
   * Keeps track of the number of reconnection attempts made during event streaming.
   * @type {number}
   */
  reconnectAttempts = 0;
  /**
   * The delay (in milliseconds) between each reconnection attempt during event streaming.
   * @type {number}
   */
  reconnectDelay = 1e3;
  /**
   * Represents an EventSource object for server-sent events. Used when performing GET requests.
   * @type {EventSource | undefined}
   */
  eventSource;
  /**
   * An AbortController instance used to abort fetch requests during event streaming.
   * @type {AbortController | undefined}
   */
  abortController;
  /**
   * A flag indicating whether the River instance is in the process of closing.
   * This helps prevent unnecessary reconnection attempts after closing.
   * @type {boolean}
   */
  closing = false;
  static init(events, config) {
    return new RiverClient(events, config);
  }
  // function to get return type of specific event
  event(event_type) {
    return this.events[event_type];
  }
  /**
   * Registers an event handler for a specific event type.
   * @template K - The key of the event type in the event map.
   * @param event_type - The event type to listen for, which must be a valid key in the event map.
   * @param handler - A callback function that handles events of the specified type and receives an argument containing the event data.
   * @returns The River instance with the added event listener, allowing method chaining.
   */
  on(event_type, handler) {
    const wrapped_handler = (event) => {
      if (this.events[event_type]) {
        handler(event.detail);
      }
    };
    this.addEventListener(
      event_type,
      wrapped_handler
    );
    return this;
  }
  /**
   * Handles an event by dispatching a CustomEvent.
   * @template K - The key of the event type.
   * @param event_type - The event type key.
   * @param data - The event data.
   */
  handle_event(event_type, data) {
    const event = new CustomEvent(event_type, {
      detail: data
    });
    this.dispatchEvent(event);
  }
  /**
   * Prepares the River instance with request information.
   * @param input - The request info.
   * @param init - The request init options.
   * @returns The River instance.
   */
  prepare(input, init) {
    this.request_info = input;
    this.request_init = init;
    return this;
  }
  /**
   * Starts the event streaming.
   * This uses EventSource on GET requests, and Fetch with bodyreader otherwise
   */
  async stream() {
    if (!this.request_info) {
      throw new RiverError("Request information not set.");
    }
    if (this.request_init?.headers || (this.request_init?.method ?? "GET") !== "GET" || EventSource === void 0) {
      try {
        this.abortController = new AbortController();
        await this.fetch_event_stream();
      } catch (error) {
        if (this.closing) {
          return;
        }
        console.error("Error during fetch stream:", error?.message);
        await this.reconnect();
      }
    } else {
      this.eventSource = new EventSource(this.request_info.toString());
      const custom_event_listener = (event) => {
        {
          const baseEvent = {
            type: event.type,
            message: event.data,
            data: null,
            error: null
          };
          try {
            baseEvent.data = JSON.parse(event.data);
          } catch (error) {
          }
          this.handle_event(baseEvent.type, baseEvent);
        }
      };
      this.eventSource.onmessage = custom_event_listener;
      for (const event_type in this.events) {
        this.eventSource.addEventListener(event_type, custom_event_listener);
      }
      this.eventSource.onerror = (error) => {
        console.error("EventSource error:", error);
        this.close();
        this.reconnect();
      };
    }
  }
  async fetch_event_stream() {
    const response = await fetch(this.request_info, {
      headers: this.config.headers,
      ...this.request_init,
      signal: this.abortController?.signal
    });
    if (!response.ok || !response.body) {
      throw new RiverError(
        `Failed to fetch: ${response.status} ${response.statusText}`
      );
    }
    const reader = response.body.getReader();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("Stream finished");
        break;
      }
      buffer += new TextDecoder().decode(value);
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        if (event.trim() !== "") {
          const lines = event.trim().split("\n");
          let baseEvent = {
            type: "",
            message: "",
            data: null,
            error: null
          };
          for (const line of lines) {
            if (line.startsWith("event:")) {
              baseEvent.type = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              try {
                const type = baseEvent.type;
                baseEvent = JSON.parse(data);
                baseEvent.type = type;
              } catch (error) {
                baseEvent.message = data;
              }
            } else if (line.startsWith("id:")) {
            } else if (line.startsWith("retry:")) {
              const retryDelay = Number.parseInt(line.slice(6).trim(), 10);
              if (!Number.isNaN(retryDelay)) {
                this.reconnectDelay = retryDelay;
              }
            }
          }
          if (baseEvent.type === "error") {
            baseEvent.error = baseEvent.data;
          }
          this.handle_event(baseEvent.type, baseEvent);
        }
      }
    }
  }
  close() {
    this.closing = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = void 0;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = void 0;
    }
    this.dispatchEvent(new CustomEvent("close"));
  }
  async reconnect() {
    this.reconnectAttempts++;
    console.log(`Reconnecting in ${this.reconnectDelay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay));
    await this.stream();
  }
}
