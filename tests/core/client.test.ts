// tests/server.test.ts
import { RiverEvents } from '../../src';
import { RiverEmitter } from '../../src/server';
import { RiverClient } from '../../src/client';
import { serve } from 'bun';
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

// Initialize the server before running the tests
let server: ReturnType<typeof serve> | undefined;

const events = new RiverEvents()
  .define_event<'message', { data: { hello: 'world' } }>('message')
  .define_event('text_stream', { stream: true, data: '' as string })
  .define_event('number_event', {
    data: [] as number[],
    stream: true
  })
  .build();

beforeAll(async () => {
  const serverStream = RiverEmitter.init(events, {
    chunk_size: 1
  });

  // Create a Bun server
  server = serve({
    port: 3000,
    async fetch(req: Request) {
      if (req.url.endsWith('/events')) {
        return new Response(
          serverStream.stream((emitter) => {
            // Emit events periodically
            // let count = 0;
            // generate array of 1000 numbers
            const numbers = Array.from({ length: 1000 }, (_, i) => i);
            const text =
              "Ah, the beauty of Ahegao! It's an art style that truly embraces the essence of passion and ecstasy. Imagine a world where faces are canvases, and the artists paint their emotions with unrestrained fervor. Eyes wide open, mouths agape, cheeks flushed—every feature conveys the intensity of the moment. It's as if the pleasure is so overwhelming that it spills forth from their very souls.              ";
            emitter.emit_event('text_stream', text);
            emitter.emit_event('number_event', numbers);
            // const intervalId = setInterval(() => {
            //   emitter.emit_event('greeting', {
            //     message: 'Hello, World!'
            //   });
            //   count++;
            //   if (count >= 5) {
            //     clearInterval(intervalId);
            //   }
            // }, 1000);
          }),
          {
            headers: serverStream.headers()
          }
        );
      }
      return new Response('Not Found', { status: 404 });
    }
  });
  console.log('server started');
});

afterAll(async () => {
  // Stop the server after running the tests
  if (server) {
    server.stop();
  }
});

describe('ServerRiverStream', () => {
  it('should emit events', async () => {
    const events = new RiverEvents()
      .define_event<'message', { data: { hello: 'world' } }>('message')
      .define_event('text_stream', { stream: true, data: '' })
      .define_event('number_event', {
        data: [] as number[],
        stream: true
      })
      .build();

    const clientStream = RiverClient.init(events, {
      chunk_size: 2
    });
    // wait until server is ready for up to 5 seconds by pinging the server
    await new Promise((resolve, reject) => {
      const intervalId = setInterval(async () => {
        try {
          await fetch('http://localhost:3000/events');
          clearInterval(intervalId);
          resolve(undefined);
        } catch (error) {
          // ignore error
        }
      }, 1000);
      setTimeout(() => {
        clearInterval(intervalId);
        reject(new Error('Server did not start in time'));
      }, 5000);
    });

    let text = '';
    const numbers = [] as number[];

    await clientStream
      .prepare('http://localhost:3000/events', {
        method: 'POST'
      })
      .on('message', (res) => {
        expect(res.type).toBe('message');
        expect(res.data).toEqual({ hello: 'world' });
        clientStream.close();
      })
      // .on('text_stream', (res) => {
      //   text += res.data;
      //   console.log(text);
      //   // console.log(text.length / res.data.length);
      //   // expect(res.data).toBeLessThanOrEqual(10);
      //   // clientStream.close();
      // })
      .on('number_event', (res) => {
        numbers.push(...res);
        // console.log(res.data);
        console.log(res);
      })
      .stream();

    // run it for 10 seconds
    setTimeout(() => {
      clientStream.close();
    }, 4000);
  });
});
