import { RiverEvents } from "river.ts";

export const events = new RiverEvents()
	.map_event("test_json", {
		data: {
			message: "This is a test SSE message.",
		},
	})
	.map_event("test_msg", {
		message: "This is a test SSE message.",
	})
	.build();
