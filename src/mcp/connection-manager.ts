import { createMCPClient, type ListToolsResult, type MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import {
    reconcileManifestPolicies,
    syncConnectedToolPolicies,
} from './approval-policy';
import { fingerprintToolDefinition } from './fingerprint';
import type { McpSettingsStore } from './settings-store';
import type {
    ConnectedMcpTool,
    McpConnectionStatus,
    McpServerConfig,
    McpToolManifestEntry,
} from './types';
import { headersToRecord } from './types';
import { nodeFetch } from './node-fetch';

interface Connection {
    client: MCPClient;
    tools: ToolSet;
    descriptors: ConnectedMcpTool[];
}

type Listener = () => void;

export interface AgentMcpTools {
    tools: ToolSet;
    descriptors: ConnectedMcpTool[];
}

export class McpConnectionManager {
    private readonly connections = new Map<string, Connection>();
    private readonly statuses = new Map<string, McpConnectionStatus>();
    private readonly errors = new Map<string, string>();
    private readonly listeners = new Set<Listener>();
    private readonly generations = new Map<string, number>();
    private readonly inFlight = new Map<string, Promise<Connection>>();
    private readonly unsubscribeSettings: () => void;

    constructor(private readonly settings: McpSettingsStore) {
        this.unsubscribeSettings = this.settings.subscribe(() => {
            this.syncPoliciesFromSettings();
        });
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getStatus(serverId: string): McpConnectionStatus {
        return this.statuses.get(serverId) ?? 'disconnected';
    }

    getError(serverId: string): string {
        return this.errors.get(serverId) ?? '';
    }

    /**
     * Align live connection descriptors with persisted settings policies.
     * Settings are the source of truth for Always-allow / Auto-run.
     */
    syncPoliciesFromSettings(serverId?: string): boolean {
        let changed = false;
        const targets = serverId
            ? ([[serverId, this.connections.get(serverId)]] as const)
            : [...this.connections.entries()];
        for (const [id, connection] of targets) {
            if (!connection) continue;
            const server = this.settings.getServer(id);
            if (!server) continue;
            if (syncConnectedToolPolicies(connection.descriptors, server.tools)) {
                changed = true;
            }
        }
        return changed;
    }

    /** Synced, non-blocked descriptors for the live agent policy checks. */
    listAgentDescriptors(): ConnectedMcpTool[] {
        this.syncPoliciesFromSettings();
        const descriptors: ConnectedMcpTool[] = [];
        for (const connection of this.connections.values()) {
            for (const descriptor of connection.descriptors) {
                if (descriptor.policy === 'blocked') continue;
                descriptors.push(descriptor);
            }
        }
        return descriptors;
    }

    /** Connect every enabled server that has a URL. Skips live/in-flight connections. */
    async connectEnabledServers(): Promise<void> {
        const enabled = this.settings
            .listServers()
            .filter((server) => server.enabled && server.url.trim().length > 0);
        await Promise.all(
            enabled.map(async (server) => {
                const status = this.getStatus(server.id);
                if (status === 'connected' || status === 'connecting') return;
                try {
                    await this.connect(server.id);
                } catch {
                    // Status/error already recorded on the manager.
                }
            }),
        );
    }

    async getAgentTools(): Promise<AgentMcpTools> {
        const enabled = this.settings.listServers().filter((server) => server.enabled);
        const connections = await Promise.all(
            enabled.map(async (server) => {
                try {
                    return await this.connect(server.id);
                } catch {
                    return undefined;
                }
            }),
        );
        return this.assembleAgentTools(connections);
    }

    /** Already-open connections only — no network. Used to mount Agent chat immediately. */
    getConnectedAgentTools(): AgentMcpTools {
        const enabledIds = new Set(
            this.settings.listServers().filter((server) => server.enabled).map((s) => s.id),
        );
        const connections = [...this.connections.entries()]
            .filter(([serverId]) => enabledIds.has(serverId))
            .map(([, connection]) => connection);
        return this.assembleAgentTools(connections);
    }

    /** True when every enabled server with a URL is already connected. */
    allEnabledServersConnected(): boolean {
        const enabled = this.settings
            .listServers()
            .filter((server) => server.enabled && server.url.trim().length > 0);
        if (enabled.length === 0) return true;
        return enabled.every((server) => this.getStatus(server.id) === 'connected');
    }

    private assembleAgentTools(
        connections: (Connection | undefined)[],
    ): AgentMcpTools {
        this.syncPoliciesFromSettings();
        const tools: ToolSet = {};
        const descriptors: ConnectedMcpTool[] = [];
        for (const connection of connections) {
            if (!connection) continue;
            for (const descriptor of connection.descriptors) {
                if (descriptor.policy === 'blocked') continue;
                const tool = connection.tools[descriptor.id];
                if (tool) tools[descriptor.id] = tool;
                descriptors.push(descriptor);
            }
        }
        return { tools, descriptors };
    }

    async refreshServer(serverId: string): Promise<ConnectedMcpTool[]> {
        await this.disconnect(serverId);
        return (await this.connect(serverId, true)).descriptors;
    }

    async connect(serverId: string, refreshManifest = false): Promise<Connection> {
        const existing = this.connections.get(serverId);
        if (existing && !refreshManifest) {
            this.syncPoliciesFromSettings(serverId);
            return existing;
        }

        const pending = this.inFlight.get(serverId);
        if (pending && !refreshManifest) return pending;

        const run = this.openConnection(serverId, refreshManifest).finally(() => {
            if (this.inFlight.get(serverId) === run) this.inFlight.delete(serverId);
        });
        this.inFlight.set(serverId, run);
        return run;
    }

    private async openConnection(
        serverId: string,
        refreshManifest: boolean,
    ): Promise<Connection> {
        const existing = this.connections.get(serverId);
        if (existing && !refreshManifest) {
            this.syncPoliciesFromSettings(serverId);
            return existing;
        }
        const server = this.settings.getServer(serverId);
        if (!server) throw new Error('MCP server not found.');
        if (!server.url) throw new Error('MCP server URL is required.');
        const generation = this.generations.get(serverId) ?? 0;

        this.setStatus(serverId, 'connecting');
        let client: MCPClient | undefined;
        try {
            client = await createMCPClient({
                transport: {
                    type: 'http',
                    url: server.url,
                    headers: headersToRecord(server.headers),
                    redirect: 'error',
                    fetch: nodeFetch,
                },
                clientName: 'getlava-obsidian',
                version: '1.0.0',
                maxRetries: 0,
                onUncaughtError: (error) => {
                    this.errors.set(serverId, errorMessage(error));
                    this.emit();
                },
            });
            const definitions = await listAllTools(client);
            if ((this.generations.get(serverId) ?? 0) !== generation) {
                throw new Error('MCP connection was superseded by a settings change.');
            }
            const latestServer = this.settings.getServer(serverId) ?? server;
            const manifest = await buildManifest(latestServer, definitions);
            // Settings may have changed (e.g. Always allow) while tools/list was in flight.
            const currentServer = this.settings.getServer(serverId) ?? latestServer;
            reconcileManifestPolicies(manifest, currentServer.tools);
            await this.settings.updateServer(
                serverId,
                {
                    tools: manifest,
                    manifestUpdatedAt: Date.now(),
                },
                'manifest',
            );
            const discovered = client.toolsFromDefinitions(definitions);
            const tools: ToolSet = {};
            const descriptors: ConnectedMcpTool[] = [];
            for (const entry of manifest) {
                const source = discovered[entry.name];
                if (!source) continue;
                const id = namespacedToolId(server.id, entry.name, entry.fingerprint);
                tools[id] = withServerMetadata(source, server, entry);
                descriptors.push({
                    id,
                    serverId: server.id,
                    serverName: server.name,
                    toolName: entry.name,
                    title: entry.title ?? entry.name,
                    fingerprint: entry.fingerprint,
                    readOnlyHint: entry.readOnlyHint,
                    policy: entry.policy,
                });
            }
            if ((this.generations.get(serverId) ?? 0) !== generation) {
                throw new Error('MCP connection was superseded by a settings change.');
            }
            const connection = { client, tools, descriptors };
            this.connections.set(serverId, connection);
            this.errors.delete(serverId);
            this.setStatus(serverId, 'connected');
            return connection;
        } catch (error) {
            await client?.close().catch(() => undefined);
            this.errors.set(serverId, errorMessage(error));
            this.setStatus(serverId, 'error');
            throw error;
        }
    }

    async disconnect(serverId: string): Promise<void> {
        this.generations.set(serverId, (this.generations.get(serverId) ?? 0) + 1);
        this.inFlight.delete(serverId);
        const connection = this.connections.get(serverId);
        this.connections.delete(serverId);
        if (connection) await connection.client.close().catch(() => undefined);
        this.setStatus(serverId, 'disconnected');
    }

    async closeAll(): Promise<void> {
        this.unsubscribeSettings();
        await Promise.all(
            [...this.connections.keys()].map((serverId) => this.disconnect(serverId)),
        );
    }

    private setStatus(serverId: string, status: McpConnectionStatus): void {
        this.statuses.set(serverId, status);
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}

async function buildManifest(
    server: McpServerConfig,
    definitions: ListToolsResult,
): Promise<McpToolManifestEntry[]> {
    const existing = new Map(server.tools.map((tool) => [tool.name, tool]));
    return Promise.all(
        definitions.tools.map(async (definition) => {
            const fingerprint = await fingerprintToolDefinition({
                name: definition.name,
                title: definition.title,
                description: definition.description,
                inputSchema: definition.inputSchema,
                outputSchema: definition.outputSchema,
            });
            const previous = existing.get(definition.name);
            const annotations = definition.annotations as
                | { readOnlyHint?: boolean }
                | undefined;
            return {
                name: definition.name,
                title: definition.title ?? definition.name,
                description: definition.description,
                fingerprint,
                readOnlyHint: annotations?.readOnlyHint === true,
                policy:
                    previous?.fingerprint === fingerprint ? previous.policy : 'ask',
            };
        }),
    );
}

function withServerMetadata(
    source: unknown,
    server: McpServerConfig,
    entry: McpToolManifestEntry,
): ToolSet[string] {
    const tool = source as ToolSet[string];
    return {
        ...tool,
        metadata: {
            ...(tool.metadata ?? {}),
            getlava: {
                serverId: server.id,
                serverName: server.name,
                toolName: entry.name,
                fingerprint: entry.fingerprint,
                readOnlyHint: entry.readOnlyHint,
            },
        },
    };
}

export function namespacedToolId(
    serverId: string,
    toolName: string,
    fingerprint: string,
): string {
    const serverPart = sanitizeName(serverId).slice(0, 10);
    const toolPart = sanitizeName(toolName).slice(0, 34);
    return `mcp_${serverPart}_${toolPart}_${fingerprint.slice(0, 12)}`;
}

function sanitizeName(value: string): string {
    return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Could not connect to MCP server.';
}

async function listAllTools(client: MCPClient): Promise<ListToolsResult> {
    const tools: ListToolsResult['tools'] = [];
    let cursor: string | undefined;
    do {
        const page = await client.listTools({
            params: cursor ? { cursor } : undefined,
        });
        tools.push(...page.tools);
        cursor = page.nextCursor;
    } while (cursor);
    return { tools };
}
