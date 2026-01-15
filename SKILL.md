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
  .build();
```

Reserved event types: `close`, `error` - do not define these.

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
```

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
// EmitPayload<T, K> - Extract payload type for emitting (excludes type/stream/chunkSize)
```

## Project Structure

```
src/
├── index.ts          # Main exports (RiverEvents, types)
├── builder.ts        # RiverEvents builder class
├── client/           # RiverClient for SSE consumption
├── server/           # RiverEmitter for SSE streaming
├── websocket/        # RiverSocketAdapter for WebSocket
└── types/
    ├── core.ts       # BaseEvent, EventMap, EventData, ResponseData
    └── http.ts       # HTTPMethods type
```

## Testing

Run tests with: `bun test`

Test files are in `tests/` directory. WebSocket request tests are in `tests/websocket/request.test.ts`.

## Build

Build with: `npm run build` (uses unbuild)

Output goes to `dist/` with separate entry points for `/client`, `/server`, `/websocket`.
