import { RiverEmitter } from "river.ts/server";
import { events } from "../sse.js";

export const POST = async (event) => {
	const server = RiverEmitter.init(events);
	return new Response(
		server.stream((emitter) => {
			let count = 0;
			setInterval(() => {
				if (count >= 10) {
					clearInterval(this); // stop the interval
					return;
				}
				count++;

				emitter.emit_event("test_msg", {
					message: "This is a test SSE message.",
				});
				emitter.emit_event("test_json", {
					data: {
						message: "This is a test SSE message.",
					},
				});
			}, 1000);
		}),
		{
			headers: server.headers(),
		},
	);
};
