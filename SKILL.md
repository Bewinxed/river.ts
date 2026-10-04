---
name: river-ts-streaming
description: Type-safe Server-Sent Events (SSE) and WebSocket communication using river.ts library. Use when working with this codebase to: (1) Define typed event schemas with RiverEvents builder, (2) Implement SSE streaming on server with RiverEmitter, (3) Consume SSE streams on client with RiverClient, (4) Handle WebSocket communication with RiverSocketAdapter, (5) Implement request/response RPC patterns over WebSocket, (6) Work with chunked/streamed data events.
---

## Quick Reference

river.ts provides three main components:
- `RiverEvents` - Type-safe event schema builder
- `RiverEmitter` - Server-side SSE streaming
- `RiverClient` - Client-side SSE consumption
- `RiverSocketAdapter` - WebSocket message handling with request/response support

## Event Definition

Define events using the builder pattern:

```typescript
import { RiverEvents } from 'river.ts';

const events = new RiverEvents()
  .defineEvent('message', { message: 'Hello' })
  .defineEvent('data', { data: {} as { id: number; name: string } })
  .defineEvent('stream', { data: [] as string[], stream: true, chunkSize: 100 })
  // Request/response pattern with explicit response type
  .defineEvent('rpc.call', {
    data: {} as { method: string; params: unknown },
    response: {} as { result: unknown; error?: string }
  })
  // Runtime validation: `data` is inferred from the schema's output
  .defineEvent('job.run', {
    schema: z.object({ id: z.string(), priority: z.number() }),
    responseSchema: z.object({ ok: z.boolean() }) // optional, for request()
  })
  .build();
```

Reserved event types: `close`, `error` - do not define these.

`schema` and `responseSchema` accept any Standard Schema (zod, valibot, arktype; https://standardschema.dev). Events without one are type-checked only.

## Server-Side SSE (RiverEmitter)

```typescript
import { RiverEmitter } from 'river.ts/server';

const emitter = RiverEmitter.init(events);

// Create SSE stream for HTTP response
const stream = emitter.stream({
  callback: async (emit, clientId) => {
    await emit('message', { message: 'Connected' });
    await emit('data', { data: { id: 1, name: 'test' } });
  },
  clientId: 'optional-custom-id',
  ondisconnect: (clientId) => console.log(`${clientId} disconnected`)
});

return new Response(stream, { headers: emitter.headers() });

// Broadcast to all clients
await emitter.broadcast('message', { message: 'Update' });

// Send to specific client
await emitter.sendToClient('client-id', 'data', { data: { id: 2, name: 'specific' } });
```

Resumable streams. All options are optional:

```typescript
const stream = emitter.stream({
  retry: 3000,            // ms; written once as `retry:` when the stream opens
  keepAlive: 15_000,      // ms; writes a `: keep-alive` comment so proxies keep the connection
  lastEventId: request.headers.get('Last-Event-ID'), // read it from the request yourself
  signal: request.signal,
  callback: async (emit, clientId, lastEventId) => {
    // lastEventId is undefined on a first connection; replay everything after it
    for (const entry of log.after(lastEventId)) {
      await emit('message', { message: entry.text }, entry.id); // 3rd arg = event id
    }
  }
});

await emitter.broadcast('message', { message: 'Update' }, 42);          // optional id
await emitter.sendToClient('client-id', 'message', { message: 'x' }, 43); // optional id
```

Event ids are `string | number` and may be non-ASCII: `stream()` decodes the `Last-Event-ID` header as UTF-8, so the callback gets the id as it was emitted. For `stream: true` events the id is written after the last chunk.

## Client-Side SSE (RiverClient)

```typescript
import { RiverClient } from 'river.ts/client';

const client = RiverClient.init(events, { reconnect: true });

client
  .prepare('http://localhost:3000/events', { method: 'GET' })
  .on('message', (data) => console.log(data.message))
  .on('data', (data) => console.log(data.id, data.name))
  .stream();

// Close connection
client.close();
// stream() can be called again after close()
```

Client options (all optional; reconnect is off by default):

```typescript
const client = RiverClient.init(events, {
  reconnect: true,                       // or { initialDelay: 1000, maxDelay: 30_000 }
  lastEventId: savedId,                  // sent as Last-Event-ID on the first connection
  onInvalid: (type, issues, raw) => {},  // events that fail their schema; never dispatched
  fetchFn: fetch,
  headers: { Authorization: 'Bearer ...' }
});

client.lastEventId; // read-only: id of the last event received; persist it to resume later
client.addEventListener('open', () => {});       // each successful connection
client.addEventListener('reconnect', (e) => {}); // (e as CustomEvent).detail = { attempt, delay, error }
client.addEventListener('close', () => {});      // stopped for good
```

Reconnect rules:
- Retries: network errors, 5xx, 429, and a stream that ends without a `close` event.
- Stops for good: HTTP 204, other 4xx, `client.close()`, the server's `close` event.
- Delay: `Retry-After` (429/503), else the server's `retry:` value, else exponential backoff with jitter, capped at `maxDelay`.
- Every reconnect sends `Last-Event-ID` (fetch path). A GET with no headers at all (none in `init()`, none in `prepare()`) uses the browser `EventSource`, which reconnects and resumes by itself; any header, another method or an initial `lastEventId` selects `fetch`.

The parser follows the WHATWG event-stream rules: CRLF/LF/CR line endings, `:` comments, `event`/`data`/`id`/`retry` fields, multiple `data:` lines joined with `\n`, default type `message`. Event data must be JSON.

## WebSocket Adapter (RiverSocketAdapter)

```typescript
import { RiverSocketAdapter } from 'river.ts/websocket';

const adapter = new RiverSocketAdapter(events, { debug: false });

// Register event handlers
adapter.on('message', (data) => console.log(data));
adapter.off('message', handler); // Unregister

// Handle incoming messages (call from ws.onmessage)
adapter.handleMessage(messageData);

// Send messages
adapter.send('data', { data: { id: 1, name: 'test' } }, (msg) => ws.send(msg));
```

Runtime validation (events with a `schema`):

```typescript
import { RiverSocketAdapter, InvalidMessageError } from 'river.ts/websocket';

const adapter = new RiverSocketAdapter(events, {
  onInvalid: (type, issues, raw) => console.warn(type, issues, raw)
});
```

- `handleMessage()` validates `data` against the event's `schema`; an invalid message goes to `onInvalid` and is not dispatched. Without `onInvalid` it is logged with `console.warn`.
- `request()` validates the response against `responseSchema` (or `schema` when the event has neither `responseSchema` nor a `response` type) and rejects with `InvalidMessageError` (`.type`, `.issues`) when invalid.
- Handlers receive the schema's output. Async schemas are supported and arrival order is kept.
- `RiverClient` does the same for the `data` field of incoming SSE events.

## WebSocket Request/Response Pattern

For RPC-style communication with automatic type inference:

```typescript
import {
  RiverSocketAdapter,
  RequestTimeoutError,
  WebSocketClosedError
} from 'river.ts/websocket';

// Events with explicit response types
const events = new RiverEvents()
  .defineEvent('instance.spawn', {
    data: {} as { cwd: string },
    response: {} as { instanceId: string; status: 'created' | 'error' }
  })
  .build();

const adapter = new RiverSocketAdapter(events);

// Route messages through adapter
ws.onmessage = (e) => adapter.handleMessage(e.data);
ws.onclose = () => adapter.clearPendingRequests();

// Make request - response type is inferred from event definition
const response = await adapter.request(
  'instance.spawn',
  { cwd: '/app' },
  (msg) => ws.send(msg),
  10000 // timeout in ms (default: 30000)
);
// response is typed as { instanceId: string; status: 'created' | 'error' }
```

Wire format for request/response:
```json
// Request (outgoing)
{ "type": "instance.spawn", "data": { "cwd": "/app" }, "id": "uuid" }

// Response (incoming) - server echoes back the id
{ "type": "instance.spawn", "data": { "instanceId": "123", "status": "created" }, "id": "uuid" }
```

## Key Types

```typescript
import { EventData, ResponseData, EmitPayload } from 'river.ts';

// EventData<T, K> - Extract data type for receiving/handling
// ResponseData<T, K> - Extract response type for request() return value
// EmitPayload<T, K> - Extract payload type for emitting (excludes type/stream/chunkSize/schema/responseSchema)
// InvalidHandler - (type, issues, raw) => void, the `onInvalid` signature
// InvalidMessageError - thrown by request() for a response that fails its schema
```

## Project Structure

```
src/
├── index.ts          # Main exports (RiverEvents, types)
├── builder.ts        # RiverEvents builder class
├── validate.ts       # Standard Schema validation shared by client and websocket
├── client/           # RiverClient for SSE consumption
├── server/           # RiverEmitter for SSE streaming
├── websocket/        # RiverSocketAdapter for WebSocket
└── types/
    ├── core.ts       # BaseEvent, EventMap, EventData, ResponseData
    └── http.ts       # HTTPMethods type
```

## Verification

There are no unit tests. Check a change with `bunx tsc --noEmit`, `bun run build`, and a live run against a real server.

## Build and release

Build with: `npm run build` (uses unbuild)

Output goes to `dist/` with separate entry points for `/client`, `/server`, `/websocket`.

Release by bumping the version in `package.json` and pushing to main: `.github/workflows/publish.yml` typechecks, builds and publishes to npm when the version differs from the registry. Do not run `npm publish` by hand.
