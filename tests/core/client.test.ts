// tests/server.test.ts
import { RiverEvents } from '../../src';
import { RiverEmitter } from '../../src/server';
import { RiverClient } from '../../src/client';
import { serve } from 'bun';
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

// Initialize the server before running the tests
let server: ReturnType<typeof serve> | undefined;

const events = new RiverEvents()
  .defineEvent<'message', { data: { hello: 'world' } }>('message')
  .defineEvent('text_stream', { stream: true, data: '' as string })
  .defineEvent('number_event', {
    data: [] as number[],
    stream: true,
    chunk_size: 100
  })
  .build();

beforeAll(async () => {
  const serverStream = RiverEmitter.init(events, {});

  // Create a Bun server
  server = serve({
    port: 3000,
    async fetch(req: Request) {
      if (req.url.endsWith('/events')) {
        return new Response(
          serverStream.stream({
            callback: async (emit) => {
              // Emit events periodically
              // let count = 0;
              // generate array of 1000 numbers
              const numbers = Array.from({ length: 1000 }, (_, i) => i);
              const text =
                "Ah, the beauty of Ahegao! It's an art style that truly embraces the essence of passion and ecstasy. Imagine a world where faces are canvases, and the artists paint their emotions with unrestrained fervor. Eyes wide open, mouths agape, cheeks flushed—every feature conveys the intensity of the moment. It's as if the pleasure is so overwhelming that it spills forth from their very souls.              ";
              emit('text_stream', text);
              await emit('number_event', numbers);

              // await emit('close', {});
            },
            ondisconnect: (id) => console.error('Client disconnected', id)
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
  it(
    'should emit events',
    async () => {
      const events = new RiverEvents()
        .defineEvent<'message', { data: { hello: 'world' } }>('message')
        .defineEvent('text_stream', { stream: true, data: '' })
        .defineEvent('message_event', { message: '' as string })
        .defineEvent('number_event', {
          data: [] as number[],
          stream: true,
          chunk_size: 100
        })
        .build();

      const clientStream = RiverClient.init(events, {});
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

      await clientStream
        .prepare('http://localhost:3000/events', {
          method: 'POST'
        })
        .on('message', (res) => {
          expect(res.hello).toBe('world');
          expect(res).toEqual({ hello: 'world' });
          // clientStream.close();
        })
        .on('message_event', (res) => {
          // console.log(res.data);
          expect(typeof res).toBe('string');
        })
        // .on('close', (res) => {
        //   clientStream.close()
        // })
        .on('number_event', (res) => {
          console.log(res);
          clientStream.close();
        })
        .stream();

      // run it for 10 seconds
      setTimeout(() => {
        clientStream.close();
      }, 10000);
    },
    {
      timeout: 20000
    }
  );
});
