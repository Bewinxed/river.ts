import { describe, it, beforeAll, afterAll, expect } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RiverEvents } from '../src';
import { RiverSocketAdapter } from '../src/websocket';

describe('Autobahn WebSocket Tests', () => {
  let server;

  // Start server before running tests
  beforeAll(() => {
    // Create reports directory if it doesn't exist
    const reportsDir = join(process.cwd(), 'reports');
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    // Define events for our WebSocket implementation
    const events = new RiverEvents()
      .defineEvent('message', { data: '' as string | Uint8Array })
      .build();

    // Create our socket adapter
    const socketAdapter = new RiverSocketAdapter(events);

    // Register event handlers
    socketAdapter.on('message', (data) => {
      // console.log(
      //   `Received message: ${typeof data === 'string' ? data : 'binary data'}`
      // );
    });

    const clients_counter = {
      clients: 0,
      get: function () {
        return this.clients;
      },
      inc: function () {
        this.clients++;
        return this.clients;
      },
      dec: function () {
        this.clients--;
        return this.clients;
      }
    };

    // Create the WebSocket server
    server = Bun.serve({
      port: 9001,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response('Expected a WebSocket connection', { status: 400 });
      },
      websocket: {
        message(ws, message) {
          try {
            // Process the message with our adapter
            socketAdapter.handleMessage(message);

            // Echo back exactly what we received (required for Autobahn tests)
            ws.send(message);
          } catch (error) {
            console.error('Error handling message:', error);
          }
        },
        open(ws) {
          console.log(`Client ${clients_counter.inc()} connected`);
        },
        close(ws, code, reason) {
          console.log(
            `Client ${clients_counter.dec()} disconnected: ${code} - ${reason}`
          );
        }
      }
    });

    console.log(`WebSocket server running at ws://localhost:9001`);
  });

  // Stop server after tests
  afterAll(async () => {
    if (server) {
      server.stop();
      console.log('WebSocket server stopped');
    }
    // check the reports json file
    const reports_json = Bun.file('./reports/index.json');
    expect(await reports_json.exists()).toBe(true);
    const contents = JSON.parse(await reports_json.text()) as {
      RiverSocketAdapter: {
        [key: string]: {
          behavior: string;
          behaviorClose: string;
          duration: number;
          remoteCloseCode: number;
          reportfile: string;
        };
      };
    };
    expect(contents.RiverSocketAdapter).toBeDefined();
    expect(Object.keys(contents.RiverSocketAdapter).length).toBeGreaterThan(0);
    const keys = Object.keys(contents.RiverSocketAdapter);
    for (const key of keys) {
      expect(contents.RiverSocketAdapter[key].behavior === 'FAIL').toBe(false);
    }
  });

  it(
    'should run Autobahn tests using Docker',
    async () => {
      // Get host machine IP address
      const hostIP = '172.17.0.1'; // Default Docker host IP on Linux

      // Create config file for the Docker container
      const configPath = join(process.cwd(), 'fuzzingclient.json');
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            outdir: '/reports',
            servers: [
              {
                agent: 'RiverSocketAdapter',
                url: `ws://${hostIP}:9001`, // Use explicit IP instead of hostname
                options: {
                  failByDrop: false
                }
              }
            ],
            cases: ['*'],
            'exclude-cases': [],
            'exclude-agent-cases': {}
          },
          null,
          2
        )
      );

      console.log('Created fuzzingclient.json for Docker container');
      console.log(`Using host IP: ${hostIP}`);

      // Run the Autobahn tests using the official Docker image
      console.log('Running Autobahn tests using Docker...');
      console.log(
        'This will run the tests against your server at ws://localhost:9001'
      );

      // Use network=host to simplify networking
      const dockerProcess = Bun.spawn(
        [
          'docker',
          'run',
          '--rm',
          '--network=host',
          '-v',
          `${process.cwd()}/fuzzingclient.json:/config/fuzzingclient.json`,
          '-v',
          `${process.cwd()}/reports:/reports`,
          'crossbario/autobahn-testsuite',
          'wstest',
          '-m',
          'fuzzingclient',
          '-s',
          '/config/fuzzingclient.json'
        ],
        {
          stdout: 'inherit',
          stderr: 'inherit'
        }
      );

      // Wait for the Docker container to complete
      const exitCode = await dockerProcess.exited;

      console.log(`Autobahn tests completed with exit code: ${exitCode}`);
      console.log('Check the reports directory for test results');
      console.log(
        'Open reports/index.html in your browser to view the results'
      );

      // The test passes if Docker runs successfully
      expect(exitCode).toBe(0);
    },
    { timeout: 600000 }
  ); // 10 minute timeout
});
