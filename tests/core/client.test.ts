// tests/server.test.ts
import { River } from "../../src/core/builder";
import { serve } from "bun";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

// Initialize the server before running the tests
let server: ReturnType<typeof serve> | undefined;

beforeAll(async () => {
	const events = new River().map_event("greeting", {
		message: "Hello, World!",
	});
	const serverStream = events.server();

	// Create a Bun server
	server = serve({
		port: 3000,
		async fetch(req: Request) {
			if (req.url.endsWith("/events")) {
				return new Response(
					serverStream.stream((emitter) => {
						// Emit events periodically
						let count = 0;
						const intervalId = setInterval(() => {
							emitter.emit_event("greeting", {
								message: "Hello, World!",
							});
							count++;
							if (count >= 5) {
								clearInterval(intervalId);
							}
						}, 1000);
					}),
					{
						headers: serverStream.headers(),
					},
				);
			}
			return new Response("Not Found", { status: 404 });
		},
	});
	console.log("server started");
});

afterAll(async () => {
	// Stop the server after running the tests
	if (server) {
		server.stop();
	}
});

describe("ServerRiverStream", () => {
	it("should emit events", async () => {
		const events = new River().map_event("greeting", {
			message: "Hello, world!",
		});
		const clientStream = events.client();
		// wait until server is ready for up to 5 seconds by pinging the server
		await new Promise((resolve, reject) => {
			const intervalId = setInterval(async () => {
				try {
					await fetch("http://localhost:3000/events");
					clearInterval(intervalId);
					resolve(undefined);
				} catch (error) {
					// ignore error
				}
			}, 1000);
			setTimeout(() => {
				clearInterval(intervalId);
				reject(new Error("Server did not start in time"));
			}, 5000);
		});

		await clientStream
			.prepare("http://localhost:3000/events", {
				method: "POST",
			})
			.on("greeting", (res) => {
				console.log("on data", res);
				expect(res.type).toBe("greeting");
				expect(res.message).toEqual("Hello, World!");
				clientStream.close();
			})
			.stream();
	});
});
