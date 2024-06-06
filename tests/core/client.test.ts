import { EventTypeBuilder } from "../../src/core/builder"
import { serve } from "bun";
import type { ServerResponse } from "node:http";

const events = new EventTypeBuilder().map_event("greeting", { message: "Hello, world!"})

// Create a ServerRiverStream instance
const serverStream = events.server();
// Create a Bun server
const server = serve({
  port: 3000,
  async fetch(req: Request, server) {
    if (req.url.endsWith("/events")) {
        return new Response(serverStream.stream((emitter) => {
            // Emit events periodically
            let count = 0;
            const intervalId = setInterval(() => {
              emitter.emit_event("greeting", {
                type: "greeting",
                message: `Hello, world! (${count})`,
              });
              count++;
              if (count >= 5) {
                clearInterval(intervalId);
              }
            }, 1000);
          }), {
            headers: serverStream.headers()
      
          })
      
    }
    return new Response(Bun.file("tests/test.html"))
    // return new Response("Not Found", { status: 404 });
  },
});

// Create a RiverStream instance
const clientStream = events.client();

// Start streaming from the server
clientStream.prepare("http://localhost:3000/events", {
    method: "POST",
}).stream()

clientStream.on("greeting", (data) => {
  console.log(data);
})

// Keep the server running for a specific duration (e.g., 10 seconds)
// setTimeout(() => {
//   server.stop();
// }, 10000);

