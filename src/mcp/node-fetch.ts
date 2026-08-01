/**
 * Desktop MCP HTTP transport fetch.
 *
 * Obsidian runs in Electron's renderer. `window.fetch` is CORS-bound, so remote
 * MCP servers (e.g. api.githubcopilot.com) fail preflight. This module implements
 * a fetch-compatible client on Node's `http`/`https` (available because the
 * plugin is desktop-only and builtins are esbuild-external).
 *
 * Behavior goals for `@ai-sdk/mcp` Streamable HTTP:
 * - Resolve a Web `Response` as soon as status/headers arrive
 * - Expose a real `ReadableStream` body that enqueues Node `data` chunks
 * - Support POST JSON and GET SSE the transport uses
 * - Honor `AbortSignal` and `redirect: 'error'` (MCP default here)
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type {
	IncomingMessage,
	OutgoingHttpHeaders,
	RequestOptions,
} from 'node:http';

export async function nodeFetch(
	input: RequestInfo | URL,
	init: RequestInit = {},
): Promise<Response> {
	const request = new Request(input, init);
	const signal = init.signal ?? request.signal;
	throwIfAborted(signal);

	const url = new URL(request.url);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new TypeError(`Unsupported protocol: ${url.protocol}`);
	}

	const body = await readRequestBody(request);
	// AbortSignal can flip during the await; re-check via a helper so control-flow
	// analysis does not treat `signal.aborted` as permanently false.
	throwIfAborted(signal);

	const headers = headersToNode(request.headers);
	if (body && !hasHeader(headers, 'content-length')) {
		headers['Content-Length'] = String(body.byteLength);
	}

	const redirect = init.redirect ?? request.redirect;
	const options: RequestOptions = {
		protocol: url.protocol,
		hostname: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
		port: url.port || (url.protocol === 'https:' ? 443 : 80),
		path: `${url.pathname}${url.search}`,
		method: request.method,
		headers,
	};

	const transport = url.protocol === 'https:' ? https : http;

	return new Promise<Response>((resolve, reject) => {
		let settled = false;

		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error instanceof Error ? error : new Error(String(error)));
		};

		const succeed = (response: Response) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(response);
		};

		const req = transport.request(options, (res) => {
			const status = res.statusCode ?? 0;
			if (isRedirectStatus(status) && redirect === 'error') {
				res.resume();
				fail(
					new TypeError(
						`Redirected from ${url.href} to ${res.headers.location ?? 'unknown'} while redirect mode is 'error'`,
					),
				);
				return;
			}

			succeed(nodeResponseToWeb(res, status));
		});

		const onAbort = () => {
			req.destroy();
			fail(abortError());
		};

		const cleanup = () => {
			signal.removeEventListener('abort', onAbort);
		};

		signal.addEventListener('abort', onAbort, { once: true });
		req.on('error', (error) => {
			fail(error);
		});

		if (body) req.write(body);
		req.end();
	});
}

function nodeResponseToWeb(res: IncomingMessage, status: number): Response {
	const headers = new Headers();
	for (const [key, value] of Object.entries(res.headers)) {
		if (value === undefined) continue;
		if (key === 'set-cookie') {
			const cookies = Array.isArray(value) ? value : [value];
			for (const cookie of cookies) headers.append('set-cookie', cookie);
			continue;
		}
		headers.set(key, Array.isArray(value) ? value.join(', ') : value);
	}

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			res.on('data', (chunk: Buffer | string) => {
				const bytes =
					typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
				controller.enqueue(new Uint8Array(bytes));
			});
			res.on('end', () => {
				try {
					controller.close();
				} catch {
					// already closed/cancelled
				}
			});
			res.on('error', (error) => {
				controller.error(error);
			});
		},
		cancel() {
			res.destroy();
		},
	});

	return new Response(body, {
		status,
		statusText: res.statusMessage ?? '',
		headers,
	});
}

async function readRequestBody(request: Request): Promise<Buffer | undefined> {
	if (request.method === 'GET' || request.method === 'HEAD') return undefined;
	if (request.body == null) {
		// Request may still expose buffered body via arrayBuffer()
		const bytes = await request.arrayBuffer();
		return bytes.byteLength > 0 ? Buffer.from(bytes) : undefined;
	}
	const bytes = await request.arrayBuffer();
	return bytes.byteLength > 0 ? Buffer.from(bytes) : undefined;
}

function headersToNode(headers: Headers): OutgoingHttpHeaders {
	const result: OutgoingHttpHeaders = {};
	headers.forEach((value, key) => {
		const lower = key.toLowerCase();
		// Let Node set these from the socket / body.
		if (lower === 'host' || lower === 'connection' || lower === 'content-length') {
			return;
		}
		result[key] = value;
	});
	return result;
}

function hasHeader(headers: OutgoingHttpHeaders, name: string): boolean {
	const lower = name.toLowerCase();
	return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function isRedirectStatus(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw abortError();
}

function abortError(): DOMException {
	return new DOMException('This operation was aborted', 'AbortError');
}
