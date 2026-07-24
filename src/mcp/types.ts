export type McpToolPolicy = 'blocked' | 'ask' | 'auto';
export type ToolAuthorization = 'automatic' | 'once' | 'conversation' | 'always';

export interface McpConversationGrant {
	serverId: string;
	toolName: string;
	fingerprint: string;
}

export interface McpHttpHeader {
	id: string;
	name: string;
	value: string;
}

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
	headers: McpHttpHeader[];
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

/** Build request headers; empty names are skipped; later duplicates win. */
export function headersToRecord(
	headers: McpHttpHeader[],
): Record<string, string> | undefined {
	const result: Record<string, string> = {};
	for (const header of headers) {
		const name = header.name.trim();
		if (!name) continue;
		result[name] = header.value;
	}
	return Object.keys(result).length > 0 ? result : undefined;
}
