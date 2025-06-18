![00171-1636846244](https://github.com/Bewinxed/river.ts/assets/9145989/091aba33-d05b-496e-a44b-aa59e9ff469d)

# 🌊 river.ts | ✨ Composable, Typesafe SSE & WebSocket Events

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.3.5-blue.svg)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/river.ts)](https://www.npmjs.com/package/river.ts)

river.ts is a powerful library for handling both Server-Sent Events (SSE) and WebSockets in TypeScript. It allows you to build a common interface for events, then use it consistently on both server and client sides, with full type safety.
Compatible with express-like backends, modern frontend frameworks, and WebSocket implementations.

## 🌟 Features

- 💡 Easy-to-use API for defining, emitting, and handling events
- 🔄 Automatic reconnection with configurable options
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
```

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
    }
  }
});
```

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