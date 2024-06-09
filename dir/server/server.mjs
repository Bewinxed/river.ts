import { EventEmitter } from "node:events";
export class RiverEmitter extends EventEmitter {
  constructor(events, config = {}) {
    super();
    this.events = events;
    this.config = config;
    this.events = events;
    this.config = config;
  }
  clients = /* @__PURE__ */ new Set();
  /**
   * Creates a new River instance.
   * @template T - The type of the event map.
   * @param events - The event map object containing the event types and their data structures.
   * @returns A new River instance with the specified event map.
   */
  static init(events, config) {
    return new RiverEmitter(events, config);
  }
  register_client(client) {
    if (!client) {
      throw new Error("Client writer is undefined");
    }
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Content-Encoding": "none",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
      ...this.config.headers
    });
    for (const [key, value] of Object.entries(headers)) {
      client.write(`${key}: ${value}
`);
    }
    this.clients.add(client);
    if (this.config.headers) {
    }
    client.closed.then(() => {
      this.clients.delete(client);
    });
  }
  emit_event(event_type, data) {
    console.log("Sending event", event_type);
    const event_data = `event: ${String(event_type)}
data: ${data.data ? JSON.stringify(data.data) : data.message}

`;
    for (const client of this.clients) {
      client.write(event_data);
    }
  }
  headers(headers_override) {
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Content-Encoding": "none",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
      ...this.config.headers,
      ...headers_override
    });
    return headers;
  }
  stream(callback) {
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
            }
          })
        );
      }
    });
  }
}
