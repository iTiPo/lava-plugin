import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { nodeFetch } from '../../src/mcp/node-fetch';

describe('nodeFetch', () => {
	it('posts JSON and returns status, headers, and body', async () => {
		const server = createServer((request, response) => {
			let raw = '';
			request.setEncoding('utf8');
			request.on('data', (chunk) => {
				raw += chunk;
			});
			request.on('end', () => {
				expect(request.method).toBe('POST');
				expect(request.headers['x-custom']).toBe('yes');
				expect(raw).toBe('{"hello":"world"}');
				response.writeHead(201, {
					'Content-Type': 'application/json',
					'Mcp-Session-Id': 'session-1',
				});
				response.end(JSON.stringify({ ok: true }));
			});
		});
		const baseUrl = await listen(server);

		try {
			const response = await nodeFetch(baseUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Custom': 'yes',
				},
				body: JSON.stringify({ hello: 'world' }),
				redirect: 'error',
			});

			expect(response.status).toBe(201);
			expect(response.headers.get('mcp-session-id')).toBe('session-1');
			await expect(response.json()).resolves.toEqual({ ok: true });
		} finally {
			await close(server);
		}
	});

	it('streams response chunks before the response ends', async () => {
		const server = createServer((_request, response) => {
			void (async () => {
				response.writeHead(200, { 'Content-Type': 'text/event-stream' });
				response.write('data: one\n\n');
				await delay(40);
				response.write('data: two\n\n');
				response.end();
			})();
		});
		const baseUrl = await listen(server);

		try {
			const response = await nodeFetch(baseUrl, {
				method: 'GET',
				headers: { Accept: 'text/event-stream' },
			});
			expect(response.ok).toBe(true);
			expect(response.body).not.toBeNull();

			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let received = '';
			const firstChunkAt = Date.now();
			while (!received.includes('data: one')) {
				const chunk = await reader.read();
				expect(chunk.done).toBe(false);
				received += decoder.decode(chunk.value, { stream: true });
			}
			expect(Date.now() - firstChunkAt).toBeLessThan(40);

			while (!received.includes('data: two')) {
				const chunk = await reader.read();
				expect(chunk.done).toBe(false);
				received += decoder.decode(chunk.value, { stream: true });
			}

			const end = await reader.read();
			expect(end.done).toBe(true);
		} finally {
			await close(server);
		}
	});

	it('rejects redirects when redirect mode is error', async () => {
		const server = createServer((_request, response) => {
			response.writeHead(302, { Location: 'http://example.com/elsewhere' });
			response.end();
		});
		const baseUrl = await listen(server);

		try {
			await expect(
				nodeFetch(baseUrl, { redirect: 'error' }),
			).rejects.toThrow(/redirect/i);
		} finally {
			await close(server);
		}
	});

	it('aborts an in-flight request', async () => {
		const server = createServer((_request, _response) => {
			// intentionally never responds
		});
		const baseUrl = await listen(server);
		const controller = new AbortController();

		try {
			const pending = nodeFetch(baseUrl, { signal: controller.signal });
			controller.abort();
			await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		} finally {
			await close(server);
		}
	});
});

async function listen(
	server: ReturnType<typeof createServer>,
): Promise<string> {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Missing fixture port.');
	}
	return `http://127.0.0.1:${address.port}`;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}
