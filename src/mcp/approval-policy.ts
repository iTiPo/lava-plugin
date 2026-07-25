import type { ChatMode } from '../domain/chat';
import type {
	ConnectedMcpTool,
	McpConversationGrant,
	McpToolManifestEntry,
	McpToolPolicy,
} from './types';

export interface ToolPolicyContext {
	mode: ChatMode;
	tools: ConnectedMcpTool[];
	conversationGrants: McpConversationGrant[];
}

export interface ToolPolicySource {
	name: string;
	fingerprint: string;
	policy: McpToolPolicy;
}

export function resolveToolPolicy(
	toolId: string,
	context: ToolPolicyContext,
): McpToolPolicy | 'built-in' {
	if (toolId === 'readNote') return 'built-in';
	if (context.mode !== 'agent') return 'blocked';
	const descriptor = context.tools.find((tool) => tool.id === toolId);
	if (!descriptor) return 'blocked';
	if (descriptor.policy === 'blocked') return 'blocked';
	if (
		context.conversationGrants.some(
			(grant) =>
				grant.serverId === descriptor.serverId &&
				grant.toolName === descriptor.toolName &&
				grant.fingerprint === descriptor.fingerprint,
		)
	) {
		return 'auto';
	}
	return descriptor.policy;
}

export function countToolPolicies(context: ToolPolicyContext): {
	ask: number;
	auto: number;
} {
	let ask = 0;
	let auto = 0;
	for (const tool of context.tools) {
		const policy = resolveToolPolicy(tool.id, context);
		if (policy === 'ask') ask++;
		if (policy === 'auto') auto++;
	}
	return { ask, auto };
}

/**
 * Keep live connection descriptors aligned with persisted settings policies.
 * Fingerprint mismatches fall back to ask (definition changed).
 */
export function syncConnectedToolPolicies(
	descriptors: ConnectedMcpTool[],
	settingsTools: ReadonlyArray<ToolPolicySource>,
): boolean {
	const byName = new Map(settingsTools.map((tool) => [tool.name, tool]));
	let changed = false;
	for (const descriptor of descriptors) {
		const entry = byName.get(descriptor.toolName);
		if (!entry) continue;
		const nextPolicy =
			entry.fingerprint === descriptor.fingerprint ? entry.policy : 'ask';
		if (descriptor.policy === nextPolicy) continue;
		descriptor.policy = nextPolicy;
		changed = true;
	}
	return changed;
}

/**
 * Prefer the latest persisted policy when writing a freshly built manifest so an
 * in-flight connect cannot clobber Always-allow / settings edits.
 */
export function reconcileManifestPolicies(
	manifest: McpToolManifestEntry[],
	settingsTools: ReadonlyArray<ToolPolicySource>,
): void {
	const byName = new Map(settingsTools.map((tool) => [tool.name, tool]));
	for (const entry of manifest) {
		const current = byName.get(entry.name);
		if (current?.fingerprint === entry.fingerprint) {
			entry.policy = current.policy;
		}
	}
}
