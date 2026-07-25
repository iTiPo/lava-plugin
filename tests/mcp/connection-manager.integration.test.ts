import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { McpSettingsStore } from '../../src/mcp/settings-store';
import { McpConnectionManager } from '../../src/mcp/connection-manager';
import type { McpServerConfig } from '../../src/mcp/types';

describe('MCP connection manager', () => {
    it('discovers and calls a Streamable HTTP tool', async () => {
        const server = createServer((request, response) => {
            let raw = '';
            request.setEncoding('utf8');
            request.on('data', (chunk) => {
                raw += chunk;
            });
            request.on('end', () => {
                expect(request.headers['x-test-token']).toBe('fixture-secret');
                const message = raw ? (JSON.parse(raw) as RpcMessage) : undefined;
                if (!message || !('id' in message)) {
                    response.writeHead(202).end();
                    return;
                }

                response.setHeader('Content-Type', 'application/json');
                if (message.method === 'initialize') {
                    respond(response, message.id, {
                        protocolVersion: '2025-06-18',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'Fixture', version: '1.0.0' },
                    });
                } else if (message.method === 'tools/list') {
                    respond(response, message.id, {
                        tools: [
                            {
                                name: 'echo',
                                title: 'Echo',
                                description: 'Echo a message',
                                inputSchema: {
                                    type: 'object',
                                    properties: { message: { type: 'string' } },
                                },
                            },
                        ],
                    });
                } else if (message.method === 'tools/call') {
                    const params = message.params as {
                        arguments?: { message?: string };
                    };
                    respond(response, message.id, {
                        content: [
                            {
                                type: 'text',
                                text: params.arguments?.message ?? '',
                            },
                        ],
                    });
                } else {
                    respond(response, message.id, {});
                }
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing fixture port.');

        const config: McpServerConfig = {
            id: 'fixture',
            name: 'Fixture',
            url: `http://127.0.0.1:${address.port}`,
            enabled: true,
            headers: [
                { id: 'h1', name: 'X-Test-Token', value: 'fixture-secret' },
            ],
            tools: [],
        };
        const settings = new FakeSettings(config);
        const manager = new McpConnectionManager(
            settings as unknown as McpSettingsStore,
        );

        try {
            const connection = await manager.getAgentTools();
            expect(connection.descriptors).toHaveLength(1);
            expect(connection.descriptors[0]).toMatchObject({
                serverId: 'fixture',
                toolName: 'echo',
                policy: 'ask',
            });

            const tool = connection.tools[connection.descriptors[0]!.id];
            expect(tool?.execute).toBeTypeOf('function');
            const output: unknown = await tool!.execute!(
                { message: 'hello' },
                {
                    toolCallId: 'call-1',
                    messages: [],
                    abortSignal: undefined,
                    context: undefined,
                },
            );
            expect(output).toMatchObject({
                content: [{ type: 'text', text: 'hello' }],
            });
        } finally {
            await manager.closeAll();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        }
    });
});

interface RpcMessage {
    jsonrpc: '2.0';
    id?: string | number;
    method: string;
    params?: unknown;
}

class FakeSettings {
    constructor(private config: McpServerConfig) {}

    subscribe(_listener: (change: 'configuration' | 'manifest') => void): () => void {
        return () => undefined;
    }

    listServers(): McpServerConfig[] {
        return [
            {
                ...this.config,
                headers: this.config.headers.map((header) => ({ ...header })),
                tools: [...this.config.tools],
            },
        ];
    }

    getServer(): McpServerConfig {
        return this.listServers()[0]!;
    }

    async updateServer(
        _id: string,
        update: Partial<Omit<McpServerConfig, 'id'>>,
    ): Promise<void> {
        this.config = { ...this.config, ...update };
    }
}

function respond(
    response: import('node:http').ServerResponse,
    id: string | number | undefined,
    result: unknown,
): void {
    response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}
