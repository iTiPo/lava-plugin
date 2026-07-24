export type McpToolPolicy = 'blocked' | 'ask' | 'auto';

export interface McpToolManifestEntry {
    name: string;
    title?: string;
    description?: string;
    fingerprint: string;
    readOnlyHint: boolean;
    policy: McpToolPolicy;
}

export interface McpServerConfig {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    tools: McpToolManifestEntry[];
    manifestUpdatedAt?: number;
}

export interface McpPluginData {
    servers: McpServerConfig[];
}

export interface ConnectedMcpTool {
    id: string;
    serverId: string;
    serverName: string;
    toolName: string;
    title: string;
    fingerprint: string;
    readOnlyHint: boolean;
    policy: McpToolPolicy;
}

export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type ToolApprovalScope = 'once' | 'conversation' | 'always';
