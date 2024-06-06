import { River } from "@/core/builder";

// Build your event map
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

// on the server,  init the server
const server = events.server();

// Then, return it using the Response object of your framework
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
