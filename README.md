![00171-1636846244](https://github.com/Bewinxed/river.ts/assets/9145989/091aba33-d05b-496e-a44b-aa59e9ff469d)

# 🌊 river.ts | ✨ Composable, Typesafe SSE & WebSocket Events

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.3.5-blue.svg)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/river.ts)](https://www.npmjs.com/package/river.ts)

river.ts is a powerful library for handling both Server-Sent Events (SSE) and WebSockets in TypeScript. It allows you to build a common interface for events, then use it consistently on both server and client sides, with full type safety.
Compatible with express-like backends, modern frontend frameworks, and WebSocket implementations.

## 🌟 Features

- 💡 Easy-to-use API for defining, emitting, and handling events
- 🔄 Opt-in reconnection with backoff, `Retry-After` and resume via `Last-Event-ID`
- ✅ Optional runtime validation with any [Standard Schema](https://standardschema.dev) library (zod, valibot, arktype, ...)
- 📜 Spec-compliant event-stream parsing (multi-line data, comments, CRLF/LF/CR, split UTF-8)
- 🔌 Works with various HTTP methods and supports custom headers, body, etc.
- 🛠️ Type-safe event handlers and payload definitions
- 🚀 Streamlined setup for both server and client sides
- 🧩 Unified API for both SSE and WebSockets
- 💻 Environment-agnostic WebSocket adapter
- 📊 Chunking support for stream-based events
- 🌐 Built-in proper cleanup and lifecycle management

## 📦 Installation

```bash
npm install river.ts
# or
yarn add river.ts
# or
pnpm add river.ts
# or
bun add river.ts
```

## 🚀 Usage

### 🏗 Define your event map


Use the `RiverEvents` class to define your event structure:

```typescript
import { RiverEvents } from 'river.ts';

const events = new RiverEvents()
  .defineEvent('ping', {
    message: 'pong'
  })
  .defineEvent('payload', {
    data: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ],
    stream: true,
    chunk_size: 100 // Optional: customize chunk size for streamed events
  })
  .build();
```

### 🌠 On the Server (SSE)

Use `RiverEmitter` to set up the server-side event emitter:

```typescript
import { RiverEmitter } from 'river.ts/server';
import { events } from './events';

const emitter = RiverEmitter.init(events);

// Example with a standard web server
function handleSSE(req, res) {
  const stream = emitter.stream({
    callback: async (emit, clientId) => {
      console.log(`Client ${clientId} connected`);
      
      // Emit single events
      await emit('ping', { message: 'pong' });
      
      // Emit streamed events (will be automatically chunked)
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `Item ${i}` }));
      await emit('payload', largeDataset);
      
      // You can access the client ID that was generated or provided
      console.log(`Finished initial events for client ${clientId}`);
    },
    clientId: 'custom-id-123', // Optional: set a custom client ID
    ondisconnect: (clientId) => {
      console.log(`Client ${clientId} disconnected`);
    },
    signal: request.signal // Optional: link to an AbortSignal
  });

  return new Response(stream, {
    headers: emitter.headers()
  });
}

// Later, you can broadcast to all clients
await emitter.broadcast('update', { message: 'System update completed' });

// Or send to a specific client
await emitter.sendToClient('custom-id-123', 'private', { message: 'Just for you' });

// Get all connected clients
const clients = emitter.getConnectedClients();
console.log(`${clients.length} clients connected`);

// Disconnect a specific client
await emitter.disconnectClient('custom-id-123');
```

#### Event ids, replay, retry and keep-alive

Give events an id and a reconnecting client tells you where it stopped. All of these are optional:

```typescript
function handleSSE(request: Request) {
  const stream = emitter.stream({
    // Sent once as `retry: 3000`: how long clients wait before reconnecting
    retry: 3000,
    // Writes a comment line every 15s so proxies keep an idle connection open
    keepAlive: 15_000,
    // The id of the last event this client received, if it is reconnecting
    lastEventId: request.headers.get('Last-Event-ID'),
    signal: request.signal,
    callback: async (emit, clientId, lastEventId) => {
      // Replay what the client missed, then carry on live
      for (const entry of log.after(lastEventId)) {
        // Third argument: the event id, written as an `id:` line
        await emit('ping', { message: entry.text }, entry.id);
      }
    }
  });

  return new Response(stream, { headers: emitter.headers() });
}

// broadcast() and sendToClient() take the same optional id
await emitter.broadcast('ping', { message: 'pong' }, 42);
```

| `stream()` option | Type | What it does |
| --- | --- | --- |
| `retry` | `number` (ms) | Written once as a `retry:` field when the stream opens. |
| `lastEventId` | `string \| null` | The request's `Last-Event-ID` header. Passed to `callback` as its third argument (`undefined` when absent). |
| `keepAlive` | `number` (ms) | Interval at which a `: keep-alive` comment is written. Clients ignore it. |

Ids are strings or numbers. Keep them ASCII: they travel back in an HTTP header. For a `stream: true` event the id is written after the last chunk, so a client that lost the connection halfway asks for the event again.

### 🚀 On the Client (SSE)

Use `RiverClient` to set up the client-side event listener:

```typescript
import { RiverClient } from 'river.ts/client';
import { events } from './events';

const client = RiverClient.init(events, {
  reconnect: true // Optional: enable automatic reconnection
});

client
  .prepare('http://localhost:3000/events', {
    method: 'GET',
    headers: {
      // Add any custom headers here
      'Authorization': 'Bearer token123'
    }
  })
  .on('ping', (data) => {
    console.log('Ping received:', data.message);
  })
  .on('payload', (data) => {
    // For streamed events, this will be called with each chunk
    console.log('Payload chunk received:', data);
  })
  .on('close', () => {
    console.log('Server closed the connection');
  })
  .stream();

// To close the connection manually
client.close();

// stream() can be called again after close()
client.stream();
```

#### Reconnecting and resuming

Reconnection is off by default. Turn it on with `reconnect: true`, or pass the backoff limits:

```typescript
const client = RiverClient.init(events, {
  reconnect: { initialDelay: 1000, maxDelay: 30_000 }, // these are the defaults
  // Resume across page reloads: start from the id you saved last time
  lastEventId: localStorage.getItem('lastEventId') ?? undefined
});

client.addEventListener('open', () => console.log('connected'));
client.addEventListener('reconnect', (event) => {
  const { attempt, delay, error } = (event as CustomEvent).detail;
  console.log(`reconnecting in ${delay}ms (attempt ${attempt})`, error);
});
client.addEventListener('close', () => console.log('stopped for good'));

client.on('ping', () => {
  // Read-only: the id of the last event received
  localStorage.setItem('lastEventId', client.lastEventId);
});
```

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `reconnect` | `boolean \| { initialDelay?, maxDelay? }` | `false` | Retry after a dropped connection. |
| `lastEventId` | `string` | `''` | Sent as `Last-Event-ID` on the first connection. |
| `onInvalid` | `(type, issues, raw) => void` | warns | Receives events that fail their schema (see [Runtime validation](#-runtime-validation)). |
| `fetchFn` | `typeof fetch` | `fetch` | Custom fetch implementation. |
| `headers` | `Record<string, string>` | none | Sent with every request. |

With `reconnect` on:

- **Retried:** network errors, `5xx` and `429` responses, and a stream that ends without a `close` event.
- **Not retried:** HTTP `204`, any other `4xx`, `client.close()`, and the server's `close` event.
- **Delay:** `Retry-After` on a `429` or `503`; otherwise the server's `retry:` value if it sent one; otherwise exponential backoff with jitter from `initialDelay` up to `maxDelay`.
- **Resume:** every reconnect sends the last received event id as the `Last-Event-ID` header, so the server can replay from there.

A plain `GET` without headers uses the browser's `EventSource`, which reconnects and sends `Last-Event-ID` by itself. Requests with headers, another method, or an initial `lastEventId` use `fetch`. The parser follows the [WHATWG event-stream rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation): CRLF, LF or CR line endings, `:` comments, `event` / `data` / `id` / `retry` fields, several `data:` lines joined with a newline, and `message` as the default event type.

### 🔌 WebSocket Support

river.ts also includes an environment-agnostic WebSocket adapter that can be used with any WebSocket implementation:

```typescript
import { RiverEvents } from 'river.ts';
import { RiverSocketAdapter } from 'river.ts/websocket';

// Define your events
const events = new RiverEvents()
  .defineEvent('message', { data: '' as string | Uint8Array })
  .defineEvent('notification', { data: { id: 0, text: '' } })
  .build();

// Create adapter
const socketAdapter = new RiverSocketAdapter(events, { debug: true });

// Register event handlers
socketAdapter.on('message', (data) => {
  console.log(`Received message: ${typeof data === 'string' ? data : 'binary data'}`);
});

socketAdapter.on('notification', (data) => {
  console.log(`Notification #${data.id}: ${data.text}`);
});

// Example using with Bun's WebSocket server
const server = Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response('Expected a WebSocket connection', { status: 400 });
  },
  websocket: {
    message(ws, message) {
      // Process incoming messages with the adapter
      socketAdapter.handleMessage(message);

      // Send a message using the adapter
      socketAdapter.send('notification',
        { id: 1, text: 'Message received!' },
        (msg) => ws.send(msg)
      );
    },
    open(ws) {
      console.log('Client connected');
    },
    close(ws, code, reason) {
      console.log(`Client disconnected: ${code} - ${reason}`);
      // Clean up pending requests on close
      socketAdapter.clearPendingRequests();
    }
  }
});
```

### 📡 Request/Response Pattern (RPC-style)

The WebSocket adapter supports RPC-style request/response semantics using the `request()` method. You can define both request (`data`) and response types in your event definitions:

```typescript
import { RiverEvents } from 'river.ts';
import {
  RiverSocketAdapter,
  RequestTimeoutError,
  WebSocketClosedError
} from 'river.ts/websocket';

// Define events with explicit request (data) and response types
const events = new RiverEvents()
  .defineEvent('instance.spawn', {
    data: {} as { cwd: string; model?: string },
    response: {} as { instanceId: string; status: 'created' | 'error' }
  })
  .defineEvent('task.execute', {
    data: {} as { taskId: string; params: Record<string, unknown> },
    response: {} as { result: unknown; executionTime: number }
  })
  // Events without explicit response fall back to data type
  .defineEvent('ping', {
    data: {} as { timestamp: number }
  })
  .build();

const adapter = new RiverSocketAdapter(events);

// Using with a WebSocket client
const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
  // Route all incoming messages through the adapter
  adapter.handleMessage(event.data);
};

ws.onclose = () => {
  // Clean up pending requests when connection closes
  adapter.clearPendingRequests();
};

// Make an RPC-style request - response type is automatically inferred!
async function spawnInstance(cwd: string) {
  try {
    const response = await adapter.request(
      'instance.spawn',
      { cwd },
      (msg) => ws.send(msg),
      10000 // 10 second timeout (default: 30000ms)
    );
    // response is typed as { instanceId: string; status: 'created' | 'error' }
    console.log('Instance spawned:', response.instanceId);
    console.log('Status:', response.status);
    return response;
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      console.error(`Request timed out after ${error.timeout}ms`);
    } else if (error instanceof WebSocketClosedError) {
      console.error('Connection closed while waiting for response');
    }
    throw error;
  }
}

// Multiple concurrent requests are supported
const [instance1, instance2] = await Promise.all([
  adapter.request('instance.spawn', { cwd: '/app1' }, (msg) => ws.send(msg)),
  adapter.request('instance.spawn', { cwd: '/app2' }, (msg) => ws.send(msg))
]);
// Both are typed as { instanceId: string; status: 'created' | 'error' }
```

#### Wire Format

The `request()` method adds a unique `id` field to outgoing messages for correlation:

```typescript
// Outgoing request
{ "type": "instance.spawn", "data": { "cwd": "/app" }, "id": "abc123" }

// Server should echo back the same id in the response
{ "type": "instance.spawn", "data": { "instanceId": "inst-1", "status": "created" }, "id": "abc123" }
```

Messages without an `id` field (or with an unrecognized `id`) are dispatched to regular event handlers as before.

## ✅ Runtime validation

Types alone do not check what arrives over the wire. Give an event a `schema` from any [Standard Schema](https://standardschema.dev) library and incoming data is validated before your handler runs. The event's `data` type is inferred from the schema's output, so you do not write it twice.

```typescript
import { RiverEvents } from 'river.ts';
import { RiverClient } from 'river.ts/client';
import { RiverSocketAdapter, InvalidMessageError } from 'river.ts/websocket';
import { z } from 'zod';

const events = new RiverEvents()
  .defineEvent('job.run', {
    schema: z.object({ id: z.string(), priority: z.number() }),
    // Optional: validates the response to request()
    responseSchema: z.object({ ok: z.boolean() })
  })
  // Events without a schema behave exactly as before
  .defineEvent('ping', { message: 'pong' })
  .build();

// SSE client: validates the `data` of each incoming event
const client = RiverClient.init(events, {
  onInvalid: (type, issues, raw) => console.warn(type, issues, raw)
});
client.on('job.run', (event) => event.data.priority); // number

// WebSocket adapter: validates handleMessage() data and request() responses
const adapter = new RiverSocketAdapter(events, {
  onInvalid: (type, issues, raw) => console.warn(type, issues, raw)
});
adapter.on('job.run', (data) => data.priority); // number
```

- An invalid message is never dispatched. It goes to `onInvalid(type, issues, raw)`, where `issues` are the schema's issues and `raw` is the message as received. Without `onInvalid` it is logged with `console.warn`.
- `request()` rejects with `InvalidMessageError` (which carries `type` and `issues`) when the response is invalid.
- A response is checked by `responseSchema`. If the event has no `responseSchema` and no `response` type, it is checked by `schema`.
- Handlers receive the schema's output, so transforms and defaults apply.
- Schemas may validate asynchronously. Messages are still dispatched in the order they arrived.
- Outgoing messages (`emit`, `send`, `request`) are type-checked only.

## 🔍 Type Safety

Leverage TypeScript's type system for type-safe event handling:

```typescript
import { EventData } from 'river.ts';
import { events } from './events';

type Events = typeof events;

// Get the data type for a specific event
type PayloadData = EventData<Events, 'payload'>;

// Type-safe event handlers
function handlePayload(data: PayloadData) {
  // TypeScript knows the exact shape of this data
  data.forEach(item => console.log(item.id, item.name));
}

// This would cause a TypeScript error if 'ping' doesn't have this structure
client.on('ping', (data) => {
  console.log(data.missing_property); // TypeScript error!
});
```

## 🎉 Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.

## 📄 License

This project is licensed under the MIT License.