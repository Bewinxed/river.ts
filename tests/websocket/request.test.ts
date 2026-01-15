// tests/websocket/request.test.ts
import { RiverEvents } from '../../src';
import {
  RiverSocketAdapter,
  RequestTimeoutError,
  WebSocketClosedError
} from '../../src/websocket';
import { describe, it, expect, beforeEach } from 'bun:test';

// Define test events
const events = new RiverEvents()
  .defineEvent('message', { data: '' as string })
  .defineEvent('instance.spawn', {
    data: {} as { cwd: string; model?: string }
  })
  .defineEvent('ping', { data: {} as { timestamp: number } })
  .build();

describe('RiverSocketAdapter.request()', () => {
  let adapter: RiverSocketAdapter<typeof events>;
  let sentMessages: string[];
  let mockSendFn: (msg: string) => void;

  beforeEach(() => {
    adapter = new RiverSocketAdapter(events, { debug: false });
    sentMessages = [];
    mockSendFn = (msg: string) => sentMessages.push(msg);
  });

  describe('basic request/response flow', () => {
    it('should send a message with an id field', async () => {
      const requestPromise = adapter.request(
        'instance.spawn',
        { cwd: '/app' },
        mockSendFn
      );

      // Verify message was sent with id
      expect(sentMessages.length).toBe(1);
      const sent = JSON.parse(sentMessages[0]);
      expect(sent.type).toBe('instance.spawn');
      expect(sent.data).toEqual({ cwd: '/app' });
      expect(sent.id).toBeDefined();
      expect(typeof sent.id).toBe('string');

      // Simulate response with matching id
      adapter.handleMessage(
        JSON.stringify({
          type: 'instance.spawn',
          data: { instanceId: 'inst-123' },
          id: sent.id
        })
      );

      const result = await requestPromise;
      expect(result).toEqual({ instanceId: 'inst-123' });
    });

    it('should resolve with response data', async () => {
      const requestPromise = adapter.request<{ pong: boolean }>(
        'ping',
        { timestamp: Date.now() },
        mockSendFn
      );

      const sent = JSON.parse(sentMessages[0]);

      // Respond
      adapter.handleMessage(
        JSON.stringify({
          type: 'ping',
          data: { pong: true },
          id: sent.id
        })
      );

      const result = await requestPromise;
      expect(result).toEqual({ pong: true });
    });
  });

  describe('timeout handling', () => {
    it('should reject with RequestTimeoutError after timeout', async () => {
      const requestPromise = adapter.request(
        'instance.spawn',
        { cwd: '/app' },
        mockSendFn,
        100 // 100ms timeout
      );

      await expect(requestPromise).rejects.toThrow(RequestTimeoutError);

      try {
        await requestPromise;
      } catch (error) {
        expect(error).toBeInstanceOf(RequestTimeoutError);
        expect((error as RequestTimeoutError).type).toBe('instance.spawn');
        expect((error as RequestTimeoutError).timeout).toBe(100);
        expect((error as RequestTimeoutError).message).toBe(
          "Request 'instance.spawn' timed out after 100ms"
        );
      }
    });

    it('should use default timeout of 30000ms', () => {
      // Start a request but don't await it
      const requestPromise = adapter.request(
        'ping',
        { timestamp: Date.now() },
        mockSendFn
      );

      // Verify pending request exists
      expect(adapter.getPendingRequestCount()).toBe(1);

      // Cleanup to avoid timeout in test
      adapter.clearPendingRequests();

      // Suppress unhandled rejection
      requestPromise.catch(() => {});
    });
  });

  describe('multiple concurrent requests', () => {
    it('should handle multiple concurrent requests independently', async () => {
      const request1Promise = adapter.request<{ id: number }>(
        'ping',
        { timestamp: 1 },
        mockSendFn
      );

      const request2Promise = adapter.request<{ id: number }>(
        'ping',
        { timestamp: 2 },
        mockSendFn
      );

      expect(sentMessages.length).toBe(2);
      expect(adapter.getPendingRequestCount()).toBe(2);

      const sent1 = JSON.parse(sentMessages[0]);
      const sent2 = JSON.parse(sentMessages[1]);

      // IDs should be unique
      expect(sent1.id).not.toBe(sent2.id);

      // Respond in reverse order
      adapter.handleMessage(
        JSON.stringify({ type: 'ping', data: { id: 2 }, id: sent2.id })
      );

      adapter.handleMessage(
        JSON.stringify({ type: 'ping', data: { id: 1 }, id: sent1.id })
      );

      const [result1, result2] = await Promise.all([
        request1Promise,
        request2Promise
      ]);

      expect(result1).toEqual({ id: 1 });
      expect(result2).toEqual({ id: 2 });
      expect(adapter.getPendingRequestCount()).toBe(0);
    });
  });

  describe('WebSocket close during pending request', () => {
    it('should reject pending requests when clearPendingRequests is called', async () => {
      const requestPromise = adapter.request(
        'instance.spawn',
        { cwd: '/app' },
        mockSendFn
      );

      expect(adapter.hasPendingRequests()).toBe(true);

      // Simulate WebSocket close
      adapter.clearPendingRequests();

      await expect(requestPromise).rejects.toThrow(WebSocketClosedError);
      expect(adapter.hasPendingRequests()).toBe(false);
    });

    it('should reject all pending requests on close', async () => {
      const request1 = adapter.request('ping', { timestamp: 1 }, mockSendFn);
      const request2 = adapter.request('ping', { timestamp: 2 }, mockSendFn);
      const request3 = adapter.request('ping', { timestamp: 3 }, mockSendFn);

      expect(adapter.getPendingRequestCount()).toBe(3);

      adapter.clearPendingRequests();

      await expect(request1).rejects.toThrow(WebSocketClosedError);
      await expect(request2).rejects.toThrow(WebSocketClosedError);
      await expect(request3).rejects.toThrow(WebSocketClosedError);

      expect(adapter.getPendingRequestCount()).toBe(0);
    });
  });

  describe('response without matching request', () => {
    it('should dispatch to regular listeners if id has no pending request', () => {
      const receivedData: any[] = [];
      adapter.on('ping', (data) => receivedData.push(data));

      // Send a message with an id that has no pending request
      adapter.handleMessage(
        JSON.stringify({
          type: 'ping',
          data: { timestamp: 12345 },
          id: 'unknown-id'
        })
      );

      // Should be dispatched to regular listener
      expect(receivedData.length).toBe(1);
      expect(receivedData[0]).toEqual({ timestamp: 12345 });
    });

    it('should dispatch messages without id to regular listeners', () => {
      const receivedData: any[] = [];
      adapter.on('message', (data) => receivedData.push(data));

      adapter.handleMessage(
        JSON.stringify({
          type: 'message',
          data: 'hello world'
        })
      );

      expect(receivedData.length).toBe(1);
      expect(receivedData[0]).toBe('hello world');
    });
  });

  describe('error handling', () => {
    it('should reject if sendFn throws', async () => {
      const throwingSendFn = () => {
        throw new Error('Send failed');
      };

      await expect(
        adapter.request('ping', { timestamp: Date.now() }, throwingSendFn)
      ).rejects.toThrow('Send failed');

      // Should not leave pending request
      expect(adapter.getPendingRequestCount()).toBe(0);
    });
  });

  describe('utility methods', () => {
    it('getPendingRequestCount should return correct count', () => {
      expect(adapter.getPendingRequestCount()).toBe(0);

      adapter.request('ping', { timestamp: 1 }, mockSendFn).catch(() => {});
      expect(adapter.getPendingRequestCount()).toBe(1);

      adapter.request('ping', { timestamp: 2 }, mockSendFn).catch(() => {});
      expect(adapter.getPendingRequestCount()).toBe(2);

      adapter.clearPendingRequests();
      expect(adapter.getPendingRequestCount()).toBe(0);
    });

    it('hasPendingRequests should return correct boolean', () => {
      expect(adapter.hasPendingRequests()).toBe(false);

      adapter.request('ping', { timestamp: 1 }, mockSendFn).catch(() => {});
      expect(adapter.hasPendingRequests()).toBe(true);

      adapter.clearPendingRequests();
      expect(adapter.hasPendingRequests()).toBe(false);
    });
  });
});
