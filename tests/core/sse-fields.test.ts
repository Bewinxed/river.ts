// tests/core/sse-fields.test.ts
import { RiverEvents } from '../../src';
import { RiverEmitter } from '../../src/server';
import { describe, it, expect } from 'bun:test';

const events = new RiverEvents()
  .defineEvent('message', { message: '' as string })
  .defineEvent('data_event', { data: { childId: '' as string } })
  .defineEvent('stream_event', {
    stream: true,
    data: [] as number[],
    chunkSize: 3
  })
  .build();

/** Helper to read SSE text from a RiverEmitter stream with a timeout. */
async function readSSE(stream: ReadableStream<Uint8Array>, timeoutMs = 2000): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  const readWithTimeout = () =>
    Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), timeoutMs)
      )
    ]);

  for (let i = 0; i < 20; i++) {
    const { value, done } = await readWithTimeout();
    if (done) break;
    if (value) chunks.push(decoder.decode(value));
  }

  reader.cancel();
  return chunks.join('');
}

describe('SSE id: and retry: fields', () => {
  it('should include id: and retry: fields in single events', async () => {
    const emitter = RiverEmitter.init(events);
    const stream = emitter.stream({
      callback: async (emit) => {
        await emit('data_event', {
          data: { childId: 'test123' },
          id: '019abc12-3456-7890',
          retry: 3000
        });
      }
    });

    const output = await readSSE(stream);

    expect(output).toContain('id: 019abc12-3456-7890\n');
    expect(output).toContain('retry: 3000\n');
    expect(output).toContain('event: data_event\n');

    // data should NOT include id or retry
    const dataMatch = output.match(/data: (.+)\n/);
    expect(dataMatch).not.toBeNull();
    const parsed = JSON.parse(dataMatch![1]);
    expect(parsed.id).toBeUndefined();
    expect(parsed.retry).toBeUndefined();
    expect(parsed.data.childId).toBe('test123');
  });

  it('should omit id: and retry: lines when not provided (backward compat)', async () => {
    const emitter = RiverEmitter.init(events);
    const stream = emitter.stream({
      callback: async (emit) => {
        await emit('data_event', { data: { childId: 'test456' } });
      }
    });

    const output = await readSSE(stream);

    expect(output).not.toContain('id:');
    expect(output).not.toContain('retry:');
    expect(output).toStartWith('event: data_event\n');
  });

  it('should include only id: when retry is not provided', async () => {
    const emitter = RiverEmitter.init(events);
    const stream = emitter.stream({
      callback: async (emit) => {
        await emit('data_event', { data: { childId: 'test789' }, id: 'evt-001' });
      }
    });

    const output = await readSSE(stream);

    expect(output).toContain('id: evt-001\n');
    expect(output).not.toContain('retry:');
    expect(output).toStartWith('id: evt-001\n');
  });

  it('should include id: and retry: fields in stream events', async () => {
    const emitter = RiverEmitter.init(events);
    const stream = emitter.stream({
      callback: async (emit) => {
        await emit('stream_event', {
          data: [1, 2, 3, 4, 5],
          id: 'stream-001',
          retry: 5000
        });
      }
    });

    const output = await readSSE(stream);

    expect(output).toContain('id: stream-001\n');
    expect(output).toContain('retry: 5000\n');

    // Data chunks should not contain id or retry
    const dataMatches = [...output.matchAll(/data: (.+)\n/g)];
    expect(dataMatches.length).toBeGreaterThan(0);
    for (const match of dataMatches) {
      const parsed = JSON.parse(match[1]);
      expect(parsed.id).toBeUndefined();
      expect(parsed.retry).toBeUndefined();
    }
  });
});

describe('lastEventId support', () => {
  it('should pass lastEventId to the callback', async () => {
    const emitter = RiverEmitter.init(events);
    let receivedLastEventId: string | null | undefined;

    const stream = emitter.stream({
      callback: async (emit, clientId, lastEventId) => {
        receivedLastEventId = lastEventId;
        await emit('message', { message: 'hello' });
      },
      lastEventId: 'last-evt-42'
    });

    await readSSE(stream);

    expect(receivedLastEventId).toBe('last-evt-42');
  });

  it('should pass undefined lastEventId when not provided', async () => {
    const emitter = RiverEmitter.init(events);
    let receivedLastEventId: string | null | undefined = 'SENTINEL';

    const stream = emitter.stream({
      callback: async (emit, clientId, lastEventId) => {
        receivedLastEventId = lastEventId;
        await emit('message', { message: 'hello' });
      }
    });

    await readSSE(stream);

    expect(receivedLastEventId).toBeUndefined();
  });

  it('should pass null lastEventId when explicitly null', async () => {
    const emitter = RiverEmitter.init(events);
    let receivedLastEventId: string | null | undefined = 'SENTINEL';

    const stream = emitter.stream({
      callback: async (emit, clientId, lastEventId) => {
        receivedLastEventId = lastEventId;
        await emit('message', { message: 'hello' });
      },
      lastEventId: null
    });

    await readSSE(stream);

    expect(receivedLastEventId).toBeNull();
  });
});
