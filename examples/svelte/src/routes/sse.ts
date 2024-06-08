import { River } from "river.ts";
import * as river from "river.ts";



export const events = new River()
	.map_event("test_json", {
		data: {
			message: "This is a test SSE message.",
		},
	})
	.map_event("test_msg", {
		message: "This is a test SSE message.",
	});

    const server = new river.ServerRiverStream(events.build());