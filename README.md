![00171-1636846244](https://github.com/Bewinxed/river.ts/assets/9145989/091aba33-d05b-496e-a44b-aa59e9ff469d)
# 🌊 river.ts | ✨ Composable, Typesafe SSE Events

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.3.5-blue.svg)](https://www.typescriptlang.org/)
<!-- npm library link -->
[![npm](https://img.shields.io/npm/v/river.ts)](https://www.npmjs.com/package/river.ts)

river.ts is a **Based** library for handling server-sent events (SSE) in TypeScript. It allows you to build a common interface for events, then call it from one place **Both** on server and client.
Currently compatible with express-like backends.

## 🌟 Features
- 💡 Easy-to-use API for subscribing to and handling events
- 🔄 Automatic reconnection with configurable delay
- 🔌 Works with GET & Other HTTP Methods along with custom headers, body, etc...
- 🛠️ Event listeners for events, with typesafe event handlers.

## 📦 Installation
### Bun
```bash
bun install river.ts
```
### NPM (why tho)
```bash
npm install river.ts
```

## 🚀 Usage
### 🏗 Build your event map
Chain commands together to build a map of events, you can add the types as type arguments or function arguments.
```typescript
import { River } from 'river.ts';

const events = new River()
	.map_event("ping", {
		message: "pong",
	})
	.map_event("payload", {
		data: [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
		],
	});
```
### 🌠 On the Server
```typescript
// init the server
const server = events.server();

// Then, use .stream() as body init it using the `Response` object of your framework
function GET(req: Request) {
	return new Response(
		server.stream((emitter) => {
			// do stuff
			// emit simple text message
			emitter.emit_event("ping", { message: "pong" });

			// do more stuff
			// emit complex json data
			emitter.emit_event("payload", {
				// type safe data
				data: [
					{ id: 1, name: "Alice" },
					{ id: 2, name: "Bob" },
				],
			});
		}),
		{
			// convenience method to set headers for text/event-stream
			headers:
				server.headers(
					// optional, set your headers
				),
		},
	);
}
```
### 🚀 On the client
```typescript

// On the client
const client = events.client();

client
	// add url, method, headers, etc (GET/POST/Etc, all work)
	.prepare("http://localhost:3000/events", {
		// custom headers
		method: "POST",
		body: JSON.stringify({}),
	})
	// add event listeners
	.on("ping", (res) => {
		console.log("on data", res);
		// typeof res
		// {
		// 	message: string;
		// 	type: "ping";
		// }
	})
	// add more event listeners
	.on("payload", (res) => {
		console.log("on data", res);
		// typeof res
		// {
		// 	data: {
		// 		id: number;
		// 		name: string;
		// 	}[];
		// 	type: "payload";
		// };
		if (!res.data) {
			// you can close it anytime if you assign it to a constant beforehand
			client.close();
		}
	})
	// start the stream
	.stream();
```

## 🎉 Contributing
Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.

## 📄 License
Don't be a bozo
