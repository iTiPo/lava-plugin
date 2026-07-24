import { generateId } from 'ai';
import type { Plugin } from 'obsidian';
import { loadPluginData, updatePluginData } from '../plugin-data';
import type {
    McpPluginData,
    McpServerConfig,
    McpToolManifestEntry,
    McpToolPolicy,
} from './types';

export type McpSettingsChange = 'configuration' | 'manifest';
type Listener = (change: McpSettingsChange) => void;

const MCP_SECRET_PREFIX = 'lava-plugin-mcp-';

export class McpSettingsStore {
    private data: McpPluginData = { servers: [] };
    private readonly listeners = new Set<Listener>();

    constructor(private readonly plugin: Plugin) {}

    async init(): Promise<void> {
        const pluginData = await loadPluginData(this.plugin);
        this.data = normalizeMcpData(pluginData.mcp);
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    listServers(): McpServerConfig[] {
        return this.data.servers.map(cloneServer);
    }

    getServer(id: string): McpServerConfig | undefined {
        const server = this.data.servers.find((candidate) => candidate.id === id);
        return server ? cloneServer(server) : undefined;
    }

    async addServer(): Promise<McpServerConfig> {
        const server: McpServerConfig = {
            id: generateId(),
            name: 'MCP server',
            url: '',
            enabled: true,
            tools: [],
        };
        this.data.servers = [...this.data.servers, server];
        await this.persist('configuration');
        return cloneServer(server);
    }

    async updateServer(
        id: string,
        update: Partial<Omit<McpServerConfig, 'id'>>,
        change: McpSettingsChange = 'configuration',
    ): Promise<void> {
        this.data.servers = this.data.servers.map((server) =>
            server.id === id
                ? normalizeServer({
                      ...server,
                      ...update,
                      id,
                  })
                : server,
        );
        await this.persist(change);
    }

    async removeServer(id: string): Promise<void> {
        this.data.servers = this.data.servers.filter((server) => server.id !== id);
        this.plugin.app.secretStorage.setSecret(secretId(id), '');
        await this.persist('configuration');
    }

    getBearerToken(id: string): string | null {
        return this.plugin.app.secretStorage.getSecret(secretId(id));
    }

    setBearerToken(id: string, token: string): void {
        this.plugin.app.secretStorage.setSecret(secretId(id), token.trim());
        this.emit('configuration');
    }

    async setToolPolicy(
        serverId: string,
        toolName: string,
        policy: McpToolPolicy,
    ): Promise<void> {
        const server = this.data.servers.find((candidate) => candidate.id === serverId);
        if (!server) return;
        server.tools = server.tools.map((tool) =>
            tool.name === toolName ? { ...tool, policy } : tool,
        );
        await this.persist('configuration');
    }

    async setAllToolPolicies(
        serverId: string,
        resolvePolicy: (tool: McpToolManifestEntry) => McpToolPolicy,
    ): Promise<void> {
        const server = this.data.servers.find((candidate) => candidate.id === serverId);
        if (!server) return;
        server.tools = server.tools.map((tool) => ({
            ...tool,
            policy: resolvePolicy(tool),
        }));
        await this.persist('configuration');
    }

    private async persist(change: McpSettingsChange): Promise<void> {
        await updatePluginData(this.plugin, (existing) => ({
            ...existing,
            mcp: this.data,
        }));
        this.emit(change);
    }

    private emit(change: McpSettingsChange): void {
        for (const listener of this.listeners) listener(change);
    }
}

function normalizeMcpData(value: unknown): McpPluginData {
    if (!value || typeof value !== 'object') return { servers: [] };
    const servers = (value as Partial<McpPluginData>).servers;
    return {
        servers: Array.isArray(servers)
            ? servers.filter(isServerLike).map(normalizeServer)
            : [],
    };
}

function isServerLike(value: unknown): value is McpServerConfig {
    if (!value || typeof value !== 'object') return false;
    const server = value as Partial<McpServerConfig>;
    return (
        typeof server.id === 'string' &&
        typeof server.name === 'string' &&
        typeof server.url === 'string'
    );
}

function normalizeServer(server: McpServerConfig): McpServerConfig {
    return {
        id: server.id,
        name: server.name.trim() || 'MCP server',
        url: server.url.trim(),
        enabled: server.enabled !== false,
        tools: Array.isArray(server.tools)
            ? server.tools.filter(isToolLike).map((tool) => ({
                  name: tool.name,
                  title: tool.title,
                  description: tool.description,
                  fingerprint: tool.fingerprint,
                  readOnlyHint: tool.readOnlyHint === true,
                  policy:
                      tool.policy === 'blocked' ||
                      tool.policy === 'auto' ||
                      tool.policy === 'ask'
                          ? tool.policy
                          : 'ask',
              }))
            : [],
        manifestUpdatedAt:
            typeof server.manifestUpdatedAt === 'number'
                ? server.manifestUpdatedAt
                : undefined,
    };
}

function isToolLike(value: unknown): value is McpToolManifestEntry {
    if (!value || typeof value !== 'object') return false;
    const tool = value as Partial<McpToolManifestEntry>;
    return typeof tool.name === 'string' && typeof tool.fingerprint === 'string';
}

function cloneServer(server: McpServerConfig): McpServerConfig {
    return {
        ...server,
        tools: server.tools.map((tool) => ({ ...tool })),
    };
}

function secretId(serverId: string): string {
    return `${MCP_SECRET_PREFIX}${serverId}-bearer`.slice(0, 64);
}
