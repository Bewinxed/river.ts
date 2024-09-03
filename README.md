![00171-1636846244](https://github.com/Bewinxed/river.ts/assets/9145989/091aba33-d05b-496e-a44b-aa59e9ff469d)

# 🌊 river.ts | ✨ Composable, Typesafe SSE Events

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.3.5-blue.svg)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/river.ts)](https://www.npmjs.com/package/river.ts)

river.ts is a powerful library for handling server-sent events (SSE) in TypeScript. It allows you to build a common interface for events, then use it consistently on both server and client sides.
Compatible with express-like backends and modern frontend frameworks.

## 🌟 Features

- 💡 Easy-to-use API for defining, emitting, and handling events
- 🔄 Automatic reconnection with configurable options
- 🔌 Works with various HTTP methods and supports custom headers, body, etc.
- 🛠️ Type-safe event handlers and payload definitions
- 🚀 Streamlined setup for both server and client sides

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
    stream: true
  })
  .build();
```

### 🌠 On the Server

Use `RiverEmitter` to set up the server-side event emitter:

```typescript
import { RiverEmitter } from 'river.ts/server';
import { events } from './events';

const emitter = RiverEmitter.init(events);

function handleSSE(req: Request, res: Response) {
  const stream = emitter.stream({
    callback: async (emit) => {
      await emit('ping', { message: 'pong' });
      await emit('payload', {
        data: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' }
        ]
      });
    },
    clientId: '...', // optional param to set a custom client ID
    ondisconnect: (clientId) => {
      // optional param to handle disconnections
    }
  });

  return new Response(stream, {
    headers: emitter.headers()
  });
}
```

### 🚀 On the Client

Use `RiverClient` to set up the client-side event listener:

```typescript
import { RiverClient } from 'river.ts/client';
import { events } from './events';

const client = RiverClient.init(events);

client
  .prepare('http://localhost:3000/events', {
    method: 'GET',
    headers: {
      // Add any custom headers here
    }
  })
  .on('ping', (data) => {
    console.log('Ping received:', data.message);
  })
  .on('payload', (data) => {
    console.log('Payload received:', data);
  })
  .stream();
```

## 🔍 Type Safety

Leverage TypeScript's type system for type-safe event handling:

```typescript
import { InferEventType } from 'river.ts';

type Events = typeof events;
type PingEvent = InferEventType<Events, 'ping'>;
// {
//   message: string;
//   type: "ping";
// }

const pingEvents: PingEvent[] = [];
pingEvents.push({
  message: 'pong',
  type: 'ping'
});
```

## 🎉 Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.

## 📄 License

This project is licensed under the MIT License.
